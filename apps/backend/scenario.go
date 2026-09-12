package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
)

//go:embed seeddata/*.json
var scenarioFiles embed.FS

var demoScenarios = mustLoadDemoScenarios()

func mustLoadDemoScenarios() map[string]domain.Scenario {
	files, err := scenarioFiles.ReadDir("seeddata")
	if err != nil {
		panic(fmt.Errorf("read embedded scenarios: %w", err))
	}

	scenarios := make(map[string]domain.Scenario, len(files))
	for _, file := range files {
		if file.IsDir() {
			continue
		}

		data, err := scenarioFiles.ReadFile("seeddata/" + file.Name())
		if err != nil {
			panic(fmt.Errorf("read embedded scenario %q: %w", file.Name(), err))
		}

		var scenario domain.Scenario
		if err := json.Unmarshal(data, &scenario); err != nil {
			panic(fmt.Errorf("decode embedded scenario %q: %w", file.Name(), err))
		}
		if scenario.Revision < 1 {
			scenario.Revision = 1
		}
		domain.NormalizeScenarioConnections(&scenario)
		if err := domain.ValidateScenario(scenario); err != nil {
			panic(fmt.Errorf("validate embedded scenario %q: %w", file.Name(), err))
		}
		if _, exists := scenarios[scenario.Site.ID]; exists {
			panic(fmt.Errorf("multiple embedded scenarios use site %q", scenario.Site.ID))
		}
		scenarios[scenario.Site.ID] = scenario
	}

	return scenarios
}

func (a *app) getDemoScenario(response http.ResponseWriter, request *http.Request) {
	siteID := request.PathValue("siteID")
	scenario, err := a.store.ScenarioBySite(request.Context(), siteID)
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{
			"message": "No seeded scenario exists for this site.",
		})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be loaded."})
		return
	}

	writeJSON(response, http.StatusOK, scenario)
}

func (a *app) getScenario(response http.ResponseWriter, request *http.Request) {
	scenario, err := a.store.Scenario(request.Context(), request.PathValue("scenarioID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The scenario does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be loaded."})
		return
	}
	writeJSON(response, http.StatusOK, scenario)
}

type scenarioSummary struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	SiteName      string                 `json:"site_name"`
	Location      string                 `json:"location"`
	Revision      int                    `json:"revision"`
	Horizon       domain.PlanningHorizon `json:"horizon"`
	ContractCount int                    `json:"contract_count"`
	EventCount    int                    `json:"event_count"`
}

func (a *app) listScenarios(response http.ResponseWriter, request *http.Request) {
	limit, err := queryInteger(request, "limit", 50, 1, 100)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	offset, err := queryInteger(request, "offset", 0, 0, 1_000_000)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	scenarios, err := a.store.Scenarios(request.Context(), int64(limit), int64(offset))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenarios could not be loaded."})
		return
	}
	summaries := make([]scenarioSummary, 0, len(scenarios))
	for _, scenario := range scenarios {
		summaries = append(summaries, scenarioSummary{
			ID: scenario.ID, Name: scenario.Name, SiteName: scenario.Site.Name,
			Location: scenario.Site.Location, Revision: scenario.Revision, Horizon: scenario.Horizon,
			ContractCount: len(scenario.Contracts), EventCount: len(scenario.Events),
		})
	}
	writeJSON(response, http.StatusOK, summaries)
}

func (a *app) createScenario(response http.ResponseWriter, request *http.Request) {
	var scenario domain.Scenario
	if err := decodeJSON(response, request, &scenario); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	scenario.Revision = 1
	normalizeScenarioOperatingPolicy(&scenario)
	domain.NormalizeScenarioConnections(&scenario)
	if err := domain.ValidateScenario(scenario); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.store.CreateScenario(request.Context(), scenario); err != nil {
		if errors.Is(err, database.ErrConflict) {
			writeJSON(response, http.StatusConflict, map[string]string{"message": "A scenario with this ID already exists."})
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be created."})
		return
	}
	writeJSON(response, http.StatusCreated, scenario)
}

func (a *app) replaceScenario(response http.ResponseWriter, request *http.Request) {
	scenarioID := request.PathValue("scenarioID")
	var scenario domain.Scenario
	if err := decodeJSON(response, request, &scenario); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if scenario.ID != scenarioID {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The scenario ID must match the path."})
		return
	}
	existing, ok := a.loadScenarioForUpdate(response, request)
	if !ok {
		return
	}
	removeConnectionsForDeletedNodes(existing.Site, &scenario.Site)
	scenario.Revision = existing.Revision + 1
	normalizeScenarioOperatingPolicy(&scenario)
	domain.NormalizeScenarioConnections(&scenario)
	if err := domain.ValidateScenario(scenario); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.store.ReplaceScenario(request.Context(), scenario); err != nil {
		writeScenarioReplaceError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, scenario)
}

func removeConnectionsForDeletedNodes(existing domain.Site, replacement *domain.Site) {
	existingNodes := make(map[string]struct{}, len(existing.Assets)+len(existing.Services))
	replacementNodes := make(map[string]struct{}, len(replacement.Assets)+len(replacement.Services))
	for _, asset := range existing.Assets {
		existingNodes[asset.ID] = struct{}{}
	}
	for _, service := range existing.Services {
		existingNodes[service.ID] = struct{}{}
	}
	for _, asset := range replacement.Assets {
		replacementNodes[asset.ID] = struct{}{}
	}
	for _, service := range replacement.Services {
		replacementNodes[service.ID] = struct{}{}
	}
	connections := replacement.Connections[:0]
	for _, connection := range replacement.Connections {
		_, sourceExisted := existingNodes[connection.SourceID]
		_, sourceRemains := replacementNodes[connection.SourceID]
		_, targetExisted := existingNodes[connection.TargetID]
		_, targetRemains := replacementNodes[connection.TargetID]
		if (sourceExisted && !sourceRemains) || (targetExisted && !targetRemains) {
			continue
		}
		connections = append(connections, connection)
	}
	replacement.Connections = connections
}

func (a *app) deleteScenario(response http.ResponseWriter, request *http.Request) {
	err := a.store.DeleteScenario(request.Context(), request.PathValue("scenarioID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The scenario does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be deleted."})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

type signalValuesRequest struct {
	Values []float64 `json:"values"`
}

func (a *app) replaceSignalValues(response http.ResponseWriter, request *http.Request) {
	var valuesRequest signalValuesRequest
	if err := decodeJSON(response, request, &valuesRequest); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	scenario, ok := a.loadScenarioForUpdate(response, request)
	if !ok {
		return
	}
	signalIndex := -1
	for index, signal := range scenario.Signals {
		if signal.ID == request.PathValue("signalID") {
			signalIndex = index
			break
		}
	}
	if signalIndex == -1 {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The signal does not exist."})
		return
	}
	scenario.Signals[signalIndex].Values = valuesRequest.Values
	a.saveScenarioUpdate(response, request, scenario, http.StatusOK)
}

func (a *app) replaceInitialState(response http.ResponseWriter, request *http.Request) {
	var initialState domain.InitialState
	if err := decodeJSON(response, request, &initialState); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	scenario, ok := a.loadScenarioForUpdate(response, request)
	if !ok {
		return
	}
	scenario.InitialState = initialState
	a.saveScenarioUpdate(response, request, scenario, http.StatusOK)
}

type connectionsRequest struct {
	Connections []domain.Connection `json:"connections"`
}

func (a *app) replaceConnections(response http.ResponseWriter, request *http.Request) {
	var connectionsRequest connectionsRequest
	if err := decodeJSON(response, request, &connectionsRequest); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if connectionsRequest.Connections == nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": "connections is required"})
		return
	}
	scenario, ok := a.loadScenarioForUpdate(response, request)
	if !ok {
		return
	}
	scenario.Site.Connections = connectionsRequest.Connections
	a.saveScenarioUpdate(response, request, scenario, http.StatusOK)
}

func (a *app) createScenarioEvent(response http.ResponseWriter, request *http.Request) {
	var event domain.ScenarioEvent
	if err := decodeJSON(response, request, &event); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	scenario, ok := a.loadScenarioForUpdate(response, request)
	if !ok {
		return
	}
	for _, existingEvent := range scenario.Events {
		if existingEvent.ID == event.ID {
			writeJSON(response, http.StatusConflict, map[string]string{"message": "An event with this ID already exists."})
			return
		}
	}
	scenario.Events = append(scenario.Events, event)
	a.saveScenarioUpdate(response, request, scenario, http.StatusCreated)
}

func (a *app) deleteScenarioEvent(response http.ResponseWriter, request *http.Request) {
	scenario, ok := a.loadScenarioForUpdate(response, request)
	if !ok {
		return
	}
	eventID := request.PathValue("eventID")
	eventIndex := -1
	for index, event := range scenario.Events {
		if event.ID == eventID {
			eventIndex = index
			break
		}
	}
	if eventIndex == -1 {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The event does not exist."})
		return
	}
	scenario.Events = append(scenario.Events[:eventIndex], scenario.Events[eventIndex+1:]...)
	scenario.Revision++
	if err := a.store.ReplaceScenario(request.Context(), scenario); err != nil {
		writeScenarioReplaceError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (a *app) loadScenarioForUpdate(response http.ResponseWriter, request *http.Request) (domain.Scenario, bool) {
	scenario, err := a.store.Scenario(request.Context(), request.PathValue("scenarioID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The scenario does not exist."})
		return domain.Scenario{}, false
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be loaded."})
		return domain.Scenario{}, false
	}
	return scenario, true
}

func (a *app) saveScenarioUpdate(response http.ResponseWriter, request *http.Request, scenario domain.Scenario, status int) {
	scenario.Revision++
	normalizeScenarioOperatingPolicy(&scenario)
	domain.NormalizeScenarioConnections(&scenario)
	if err := domain.ValidateScenario(scenario); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.store.ReplaceScenario(request.Context(), scenario); err != nil {
		writeScenarioReplaceError(response, err)
		return
	}
	writeJSON(response, status, scenario)
}

func normalizeScenarioOperatingPolicy(scenario *domain.Scenario) {
	minimum := 0.0
	capacity := 0.0
	for _, asset := range scenario.Site.Assets {
		if asset.Type != domain.AssetBattery {
			continue
		}
		if asset.MinimumStoredEnergyKWH != nil {
			minimum += *asset.MinimumStoredEnergyKWH
		}
		if asset.CapacityKWH != nil {
			capacity += *asset.CapacityKWH
		}
	}
	if capacity == 0 {
		scenario.OperatingPolicy.ReserveEnergyKWH = 0
		return
	}
	scenario.OperatingPolicy.ReserveEnergyKWH = math.Max(
		minimum,
		math.Min(scenario.OperatingPolicy.ReserveEnergyKWH, capacity),
	)
}

func writeScenarioReplaceError(response http.ResponseWriter, err error) {
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The scenario does not exist."})
		return
	}
	writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be saved."})
}

func seedDemoScenarios(ctx context.Context, store *database.Store) error {
	for _, scenario := range demoScenarios {
		upgraded, err := upgradeLegacySpitiScenario(ctx, store, scenario)
		if err != nil {
			return err
		}
		if upgraded {
			continue
		}
		deleted, err := store.ScenarioWasDeleted(ctx, scenario.ID)
		if err != nil {
			return err
		}
		if deleted {
			continue
		}
		if err := store.CreateScenario(ctx, scenario); err != nil && !errors.Is(err, database.ErrConflict) {
			return err
		}
	}
	return nil
}

const legacySpitiScenarioID = "spiti-valley-default"

func upgradeLegacySpitiScenario(
	ctx context.Context,
	store *database.Store,
	seed domain.Scenario,
) (bool, error) {
	if seed.Site.ID != "spiti-valley" {
		return false, nil
	}
	legacy, err := store.Scenario(ctx, legacySpitiScenarioID)
	if errors.Is(err, database.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !isLegacySpitiScenario(legacy) {
		return false, nil
	}

	replacement := seed
	replacement.ID = legacy.ID
	replacement.Revision = legacy.Revision + 1
	if err := store.ReplaceScenario(ctx, replacement); err != nil {
		return false, fmt.Errorf("upgrade legacy Spiti Valley scenario: %w", err)
	}
	return true, nil
}

func isLegacySpitiScenario(scenario domain.Scenario) bool {
	if scenario.ID != legacySpitiScenarioID || scenario.Site.ID != "spiti-valley" {
		return false
	}
	legacyServices := map[string]struct{}{
		"clinic-cold-chain": {},
		"water-supply":      {},
		"flexible-homes":    {},
	}
	for _, service := range scenario.Site.Services {
		if _, exists := legacyServices[service.ID]; exists {
			return true
		}
	}
	return false
}
