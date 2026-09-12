package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
)

func (a *app) createPlanRun(response http.ResponseWriter, request *http.Request) {
	var planningRequest domain.PlanningRequest
	if err := decodeJSON(response, request, &planningRequest); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
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
	if planningRequest.ParentRunID != "" {
		parent, err := a.store.PlanRun(request.Context(), planningRequest.ParentRunID)
		if errors.Is(err, database.ErrNotFound) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent plan run does not exist."})
			return
		}
		if err != nil || parent.ScenarioID != planningRequest.ScenarioID {
			writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The parent plan run does not belong to this scenario."})
			return
		}
	}

	run, err := a.scheduler.Plan(request.Context(), scenario, planningRequest)
	if err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"message": err.Error()})
		return
	}
	if err := a.store.SavePlanRun(request.Context(), run, planningRequest.ParentRunID); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The plan run could not be saved."})
		return
	}
	writeJSON(response, http.StatusCreated, run)
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
	writeJSON(response, http.StatusOK, run)
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
