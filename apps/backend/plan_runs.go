package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/heywinit/wattson/backend/internal/comparison"
	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
)

type planRunResponse struct {
	domain.PlanRun
	Comparison *comparison.Result `json:"comparison,omitempty"`
}

func (a *app) createPlanRun(response http.ResponseWriter, request *http.Request) {
	var planningRequest domain.PlanningRequest
	if err := decodeJSON(response, request, &planningRequest); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if planningRequest.Planner == domain.PlannerBaseline && len(planningRequest.ActiveEventIDs) != 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The baseline planner cannot include active events."})
		return
	}

	scenario, err := a.store.Scenario(request.Context(), planningRequest.ScenarioID)
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The scenario does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be loaded."})
		return
	}
	scenarioHash, err := scenarioSnapshotHash(scenario)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario snapshot could not be recorded."})
		return
	}
	var parentRun *domain.PlanRun
	if planningRequest.ParentRunID != "" {
		parent, err := a.store.PlanRun(request.Context(), planningRequest.ParentRunID)
		if errors.Is(err, database.ErrNotFound) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent plan run does not exist."})
			return
		}
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The parent plan run could not be loaded."})
			return
		}
		if parent.ScenarioID != planningRequest.ScenarioID {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent plan run does not belong to this scenario."})
			return
		}
		if parent.ScenarioRevision != scenario.Revision || parent.ScenarioHash != scenarioHash {
			writeJSON(response, http.StatusConflict, map[string]string{"message": "The parent plan run uses an older scenario revision. Create a fresh baseline."})
			return
		}
		if parent.Planner != domain.PlannerBaseline {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent plan run must use the baseline planner."})
			return
		}
		if parent.Status != domain.PlanComplete && parent.Status != domain.PlanInfeasible {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent baseline must be finished."})
			return
		}
		if len(parent.ActiveEventIDs) != 0 {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent baseline must not include active events."})
			return
		}
		if planningRequest.Planner != domain.PlannerWattson {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "Only a Wattson plan can compare with a baseline parent."})
			return
		}
		parentRun = &parent
	}

	run, err := a.scheduler.Plan(request.Context(), scenario, planningRequest)
	if err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"message": err.Error()})
		return
	}
	run.ParentRunID = planningRequest.ParentRunID
	run.ScenarioRevision = scenario.Revision
	run.ScenarioHash = scenarioHash
	var result *comparison.Result
	if parentRun != nil {
		for index := range run.Decisions {
			difference, err := comparison.BaselineDifferenceForDecision(run.Decisions[index], *parentRun, run)
			if err != nil {
				writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"message": "The parent plan run cannot be compared with this plan: " + err.Error()})
				return
			}
			run.Decisions[index].BaselineDifference = difference
		}
		calculated, err := comparison.Compare(*parentRun, run)
		if err != nil {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"message": "The parent plan run cannot be compared with this plan: " + err.Error()})
			return
		}
		result = &calculated
	}
	if err := a.store.SavePlanRun(request.Context(), run); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan run could not be saved."})
		return
	}
	writeJSON(response, http.StatusCreated, planRunResponse{PlanRun: run, Comparison: result})
}

func (a *app) getPlanRun(response http.ResponseWriter, request *http.Request) {
	run, err := a.store.PlanRun(request.Context(), request.PathValue("runID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The plan run does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan run could not be loaded."})
		return
	}
	result, err := a.comparisonForRun(request, run)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan comparison could not be calculated."})
		return
	}
	writeJSON(response, http.StatusOK, planRunResponse{PlanRun: run, Comparison: result})
}

func (a *app) getPlanRunComparison(response http.ResponseWriter, request *http.Request) {
	run, err := a.store.PlanRun(request.Context(), request.PathValue("runID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The plan run does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan run could not be loaded."})
		return
	}
	result, err := a.comparisonForRun(request, run)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan comparison could not be calculated."})
		return
	}
	if result == nil {
		writeJSON(response, http.StatusConflict, map[string]string{"message": "The plan run does not have a baseline parent."})
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (a *app) comparisonForRun(request *http.Request, run domain.PlanRun) (*comparison.Result, error) {
	if run.ParentRunID == "" {
		return nil, nil
	}
	parent, err := a.store.PlanRun(request.Context(), run.ParentRunID)
	if err != nil {
		return nil, err
	}
	if parent.ScenarioID != run.ScenarioID || parent.ScenarioRevision != run.ScenarioRevision || parent.ScenarioHash != run.ScenarioHash {
		return nil, errors.New("plan run and baseline use different scenario revisions")
	}
	result, err := comparison.Compare(parent, run)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func scenarioSnapshotHash(scenario domain.Scenario) (string, error) {
	document, err := json.Marshal(scenario)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(document)
	return hex.EncodeToString(digest[:]), nil
}

func (a *app) listPlanRuns(response http.ResponseWriter, request *http.Request) {
	limit, err := queryInteger(request, "limit", 20, 1, 100)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	offset, err := queryInteger(request, "offset", 0, 0, 1_000_000)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	runs, err := a.store.PlanRuns(request.Context(), request.PathValue("scenarioID"), int64(limit), int64(offset))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan runs could not be loaded."})
		return
	}
	writeJSON(response, http.StatusOK, runs)
}

func decodeJSON(response http.ResponseWriter, request *http.Request, destination any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("invalid JSON body: only one JSON value is allowed")
	}
	return nil
}

func queryInteger(request *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	value := request.URL.Query().Get(name)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be from %d through %d", name, minimum, maximum)
	}
	return parsed, nil
}
