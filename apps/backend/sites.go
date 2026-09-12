package main

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
)

type siteScenarioIdentity struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Revision    int                    `json:"revision"`
	Horizon     domain.PlanningHorizon `json:"horizon,omitempty"`
}

type siteCapacity struct {
	SolarKW    float64 `json:"solar_kw"`
	WindKW     float64 `json:"wind_kw"`
	BatteryKWH float64 `json:"battery_kwh"`
	DieselKW   float64 `json:"diesel_kw"`
}

type latestRunSummary struct {
	ID         string             `json:"id"`
	ScenarioID string             `json:"scenario_id"`
	Planner    domain.Planner     `json:"planner"`
	Status     domain.PlanStatus  `json:"status"`
	CreatedAt  time.Time          `json:"created_at"`
	Summary    domain.PlanSummary `json:"summary"`
}

type siteSummary struct {
	ID              string               `json:"id"`
	Name            string               `json:"name"`
	Location        string               `json:"location"`
	Timezone        string               `json:"timezone"`
	Currency        string               `json:"currency"`
	CurrentScenario siteScenarioIdentity `json:"current_scenario"`
	Capacity        siteCapacity         `json:"capacity"`
	ServiceCount    int                  `json:"service_count"`
	CommitmentCount int                  `json:"commitment_count"`
	EventCount      int                  `json:"event_count"`
	LatestRun       *latestRunSummary    `json:"latest_run"`
}

type siteOverview struct {
	Site             domain.Site          `json:"site"`
	CurrentScenario  siteScenarioIdentity `json:"current_scenario"`
	CommitmentCount  int                  `json:"commitment_count"`
	EventCount       int                  `json:"event_count"`
	ActiveEventCount int                  `json:"active_event_count"`
	LatestRun        *latestRunSummary    `json:"latest_run"`
}

type createSiteRequest struct {
	Name            string  `json:"name"`
	Location        string  `json:"location"`
	Timezone        string  `json:"timezone"`
	Currency        string  `json:"currency"`
	SolarCapacityKW float64 `json:"solar_capacity_kw"`
	PeakDemandKW    float64 `json:"peak_demand_kw"`
}

func (a *app) listSites(response http.ResponseWriter, request *http.Request) {
	scenarios, err := a.store.Scenarios(request.Context(), 1000, 0)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The sites could not be loaded."})
		return
	}
	seen := make(map[string]struct{})
	result := make([]siteSummary, 0, len(scenarios))
	for _, scenario := range scenarios {
		if _, exists := seen[scenario.Site.ID]; exists {
			continue
		}
		seen[scenario.Site.ID] = struct{}{}
		run, err := a.store.LatestPlanRun(request.Context(), scenario.ID)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The latest site plans could not be loaded."})
			return
		}
		result = append(result, makeSiteSummary(scenario, run))
	}
	writeJSON(response, http.StatusOK, result)
}

func (a *app) createSite(response http.ResponseWriter, request *http.Request) {
	var input createSiteRequest
	if err := decodeJSON(response, request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Location = strings.TrimSpace(input.Location)
	input.Timezone = strings.TrimSpace(input.Timezone)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	if input.Name == "" || input.Location == "" || input.Timezone == "" || len(input.Currency) != 3 || input.SolarCapacityKW <= 0 || input.PeakDemandKW <= 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": "Name, location, timezone, a three-letter currency, solar capacity, and peak demand are required."})
		return
	}
	location, err := time.LoadLocation(input.Timezone)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The timezone is invalid."})
		return
	}

	siteID := siteSlug(input.Name)
	if siteID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": "The site name must contain a letter or number."})
		return
	}
	if _, err := a.store.ScenarioBySite(request.Context(), siteID); err == nil {
		writeJSON(response, http.StatusConflict, map[string]string{"message": "A site with this name already exists."})
		return
	} else if !errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The site could not be created."})
		return
	}

	scenario := starterSiteScenario(siteID, input, location, time.Now())
	domain.NormalizeScenarioConnections(&scenario)
	if err := domain.ValidateScenario(scenario); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	if err := a.store.CreateScenario(request.Context(), scenario); err != nil {
		if errors.Is(err, database.ErrConflict) {
			writeJSON(response, http.StatusConflict, map[string]string{"message": "A site with this name already exists."})
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The site could not be created."})
		return
	}
	writeJSON(response, http.StatusCreated, makeSiteSummary(scenario, nil))
}

func starterSiteScenario(siteID string, input createSiteRequest, location *time.Location, now time.Time) domain.Scenario {
	localNow := now.In(location)
	startsAt := time.Date(localNow.Year(), localNow.Month(), localNow.Day()+1, 0, 0, 0, 0, location)
	solarID := siteID + "-solar"
	serviceID := siteID + "-load"
	minimumPower := input.PeakDemandKW * 0.25
	solarValues := make([]float64, 96)
	demandValues := make([]float64, 96)
	for index := range solarValues {
		hour := (float64(index) + 0.5) / 4
		solarValues[index] = input.SolarCapacityKW * math.Max(0, math.Sin(math.Pi*(hour-6)/12))
		demandValues[index] = input.PeakDemandKW * 0.6
	}
	return domain.Scenario{
		SchemaVersion: "1", Revision: 1, ID: siteID + "-default", Name: "Default operating day",
		Description: "A starter operating scenario. Add grid assets and services before the first plan run.",
		Site: domain.Site{ID: siteID, Name: input.Name, Location: input.Location, Timezone: input.Timezone, Currency: input.Currency,
			Assets:   []domain.Asset{{ID: solarID, Name: "Solar array", Type: domain.AssetSolar, CapacityKW: &input.SolarCapacityKW}},
			Services: []domain.Service{{ID: serviceID, Name: "Primary site load", Description: "The combined electrical demand for this site.", ControlMode: domain.ControlCurtailable, RatedPowerKW: input.PeakDemandKW}},
		},
		Horizon:      domain.PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		InitialState: domain.InitialState{Assets: []domain.AssetState{}},
		Signals: []domain.Signal{
			{ID: siteID + "-solar-forecast", Kind: domain.SignalRenewableAvailability, AssetID: solarID, Unit: "kW", Values: solarValues},
			{ID: siteID + "-demand", Kind: domain.SignalServiceDemand, ServiceID: serviceID, Unit: "kW", Values: demandValues},
		},
		Contracts: []domain.Contract{{ID: siteID + "-supply", Name: "Minimum site supply", ServiceID: serviceID, Kind: domain.ContractContinuousPower, Priority: domain.PriorityEssential, WindowStart: startsAt, Deadline: startsAt.Add(24 * time.Hour), MinimumPowerKW: &minimumPower}},
		Events:    []domain.ScenarioEvent{}, OperatingPolicy: domain.OperatingPolicy{AssumedLossPercent: 0.05},
	}
}

func siteSlug(value string) string {
	var result strings.Builder
	dash := false
	for _, character := range strings.ToLower(value) {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			if dash && result.Len() > 0 {
				result.WriteByte('-')
			}
			result.WriteRune(character)
			dash = false
		} else if result.Len() > 0 {
			dash = true
		}
	}
	return result.String()
}

func (a *app) getSite(response http.ResponseWriter, request *http.Request) {
	scenario, err := a.store.ScenarioBySite(request.Context(), request.PathValue("siteID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The site does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The site could not be loaded."})
		return
	}
	run, err := a.store.LatestPlanRun(request.Context(), scenario.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The latest site plan could not be loaded."})
		return
	}
	writeJSON(response, http.StatusOK, siteOverview{
		Site:            scenario.Site,
		CurrentScenario: siteScenarioIdentity{ID: scenario.ID, Name: scenario.Name, Description: scenario.Description, Revision: scenario.Revision, Horizon: scenario.Horizon},
		CommitmentCount: len(scenario.Contracts), EventCount: len(scenario.Events), ActiveEventCount: activeEventCount(scenario.Events, time.Now()),
		LatestRun: makeLatestRunSummary(run),
	})
}

func makeSiteSummary(scenario domain.Scenario, run *domain.PlanRun) siteSummary {
	return siteSummary{
		ID: scenario.Site.ID, Name: scenario.Site.Name, Location: scenario.Site.Location,
		Timezone: scenario.Site.Timezone, Currency: scenario.Site.Currency,
		CurrentScenario: siteScenarioIdentity{
			ID: scenario.ID, Name: scenario.Name, Revision: scenario.Revision, Horizon: scenario.Horizon,
		},
		Capacity: capacities(scenario.Site.Assets), ServiceCount: len(scenario.Site.Services),
		CommitmentCount: len(scenario.Contracts), EventCount: len(scenario.Events), LatestRun: makeLatestRunSummary(run),
	}
}

func makeLatestRunSummary(run *domain.PlanRun) *latestRunSummary {
	if run == nil {
		return nil
	}
	return &latestRunSummary{ID: run.ID, ScenarioID: run.ScenarioID, Planner: run.Planner, Status: run.Status, CreatedAt: run.CreatedAt, Summary: run.Summary}
}

func capacities(assets []domain.Asset) siteCapacity {
	var result siteCapacity
	for _, asset := range assets {
		switch asset.Type {
		case domain.AssetSolar:
			result.SolarKW += number(asset.CapacityKW)
		case domain.AssetWind:
			result.WindKW += number(asset.CapacityKW)
		case domain.AssetBattery:
			result.BatteryKWH += number(asset.CapacityKWH)
		case domain.AssetDiesel:
			result.DieselKW += number(asset.MaximumOutputKW)
		}
	}
	return result
}

func number(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func activeEventCount(events []domain.ScenarioEvent, now time.Time) int {
	count := 0
	for _, event := range events {
		if event.Start != nil && event.End != nil && !now.Before(*event.Start) && now.Before(*event.End) {
			count++
		}
	}
	return count
}

func siteLocationQuery(site domain.Site) string {
	if site.Location != "" {
		return fmt.Sprintf("%s, %s", site.Name, site.Location)
	}
	return site.Name
}
