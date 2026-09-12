package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
	"github.com/heywinit/wattson/backend/internal/scheduler"
)

func testConfig() config {
	return config{
		port: "8080",
		allowedOrigins: map[string]struct{}{
			"http://localhost:3001": {},
		},
	}
}

func testApp(t *testing.T) *app {
	t.Helper()
	connection, err := database.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { connection.Close() })
	store := database.NewStore(connection)
	if err := seedDemoScenarios(context.Background(), store); err != nil {
		t.Fatalf("seed test database: %v", err)
	}
	return newApp(testConfig(), store, scheduler.New())
}

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	testApp(t).routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}

	var body healthResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if body.Status != "ok" || body.Service != "wattson-backend" {
		t.Fatalf("unexpected health response: %#v", body)
	}
}

func TestEventsSendConnectedEvent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodGet, "/v1/events", nil).WithContext(ctx)
	response := httptest.NewRecorder()

	testApp(t).routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"type":"connected"`) {
		t.Fatalf("expected connected event, got %q", response.Body.String())
	}
}

func TestListDemoOperators(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/demo/operators", nil)
	response := httptest.NewRecorder()

	testApp(t).routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}

	var body []demoOperator
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode operators response: %v", err)
	}
	if len(body) != 4 {
		t.Fatalf("expected four demo operators, got %d", len(body))
	}
	if body[0].Site.ID == body[1].Site.ID {
		t.Fatal("expected each operator to have a different site")
	}
}

func TestGetDemoScenario(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/demo/sites/spiti-valley/scenario", nil)
	response := httptest.NewRecorder()

	testApp(t).routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}

	var scenario domain.Scenario
	if err := json.NewDecoder(response.Body).Decode(&scenario); err != nil {
		t.Fatalf("decode scenario response: %v", err)
	}
	if scenario.Site.ID != "spiti-valley" {
		t.Fatalf("expected Spiti Valley, got %q", scenario.Site.ID)
	}
	if scenario.Horizon.IntervalCount != 96 {
		t.Fatalf("expected 96 intervals, got %d", scenario.Horizon.IntervalCount)
	}
	if err := domain.ValidateScenario(scenario); err != nil {
		t.Fatalf("API returned invalid scenario: %v", err)
	}
}

func TestGetDemoScenarioReturnsNotFound(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/demo/sites/missing/scenario", nil)
	response := httptest.NewRecorder()

	testApp(t).routes().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", response.Code)
	}
}

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "http://localhost:3001")
	response := httptest.NewRecorder()

	testApp(t).routes().ServeHTTP(response, request)

	if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != "http://localhost:3001" {
		t.Fatalf("unexpected CORS origin %q", origin)
	}
}

func TestCreateAndReadPlanRun(t *testing.T) {
	application := testApp(t)
	request := httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(`{
		"scenario_id":"spiti-valley-default",
		"planner":"wattson",
		"active_event_ids":["midday-solar-shortfall","evening-fuel-delay"]
	}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	application.routes().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", response.Code, response.Body.String())
	}

	var created domain.PlanRun
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatalf("decode plan run: %v", err)
	}
	if created.Status != domain.PlanComplete || created.Summary.ContractsMet != 2 {
		t.Fatalf("unexpected plan run: %#v", created)
	}

	getRequest := httptest.NewRequest(http.MethodGet, "/v1/plan-runs/"+created.ID, nil)
	getResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected persisted plan run, got %d", getResponse.Code)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/v1/scenarios/spiti-valley-default/plan-runs", nil)
	listResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected plan run list, got %d", listResponse.Code)
	}
	var runs []domain.PlanRun
	if err := json.NewDecoder(listResponse.Body).Decode(&runs); err != nil {
		t.Fatalf("decode plan run list: %v", err)
	}
	if len(runs) != 1 || runs[0].ID != created.ID {
		t.Fatalf("unexpected plan run list: %#v", runs)
	}
}

func TestCreatePlanRunRejectsUnknownEvent(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(`{
		"scenario_id":"spiti-valley-default",
		"planner":"wattson",
		"active_event_ids":["missing-event"]
	}`))
	response := httptest.NewRecorder()
	testApp(t).routes().ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected status 422, got %d: %s", response.Code, response.Body.String())
	}
}

func TestPlanRunIncludesMeasuredParentComparison(t *testing.T) {
	application := testApp(t)
	baselineRequest := httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(`{
		"scenario_id":"spiti-valley-default",
		"planner":"baseline",
		"active_event_ids":[]
	}`))
	baselineResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(baselineResponse, baselineRequest)
	if baselineResponse.Code != http.StatusCreated {
		t.Fatalf("expected baseline status 201, got %d: %s", baselineResponse.Code, baselineResponse.Body.String())
	}
	var baseline planRunResponse
	if err := json.NewDecoder(baselineResponse.Body).Decode(&baseline); err != nil {
		t.Fatalf("decode baseline: %v", err)
	}

	candidateBody := fmt.Sprintf(`{
		"scenario_id":"spiti-valley-default",
		"planner":"wattson",
		"active_event_ids":["midday-solar-shortfall","evening-fuel-delay"],
		"parent_run_id":%q
	}`, baseline.ID)
	candidateRequest := httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(candidateBody))
	candidateResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(candidateResponse, candidateRequest)
	if candidateResponse.Code != http.StatusCreated {
		t.Fatalf("expected candidate status 201, got %d: %s", candidateResponse.Code, candidateResponse.Body.String())
	}
	var candidate planRunResponse
	if err := json.NewDecoder(candidateResponse.Body).Decode(&candidate); err != nil {
		t.Fatalf("decode candidate: %v", err)
	}
	if candidate.ParentRunID != baseline.ID || candidate.Comparison == nil {
		t.Fatalf("missing parent comparison: %#v", candidate)
	}
	if candidate.ScenarioRevision < 1 || candidate.ScenarioRevision != baseline.ScenarioRevision {
		t.Fatalf("comparison did not preserve its scenario revision: baseline=%d candidate=%d", baseline.ScenarioRevision, candidate.ScenarioRevision)
	}
	if candidate.Comparison.BaselineRunID != baseline.ID || len(candidate.Comparison.Intervals) != 96 {
		t.Fatalf("unexpected comparison: %#v", candidate.Comparison)
	}
	for _, decision := range candidate.Decisions {
		if !strings.HasPrefix(decision.BaselineDifference, "At ") {
			t.Fatalf("decision difference is not measured: %q", decision.BaselineDifference)
		}
	}

	comparisonRequest := httptest.NewRequest(http.MethodGet, "/v1/plan-runs/"+candidate.ID+"/comparison", nil)
	comparisonResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(comparisonResponse, comparisonRequest)
	if comparisonResponse.Code != http.StatusOK {
		t.Fatalf("expected comparison status 200, got %d: %s", comparisonResponse.Code, comparisonResponse.Body.String())
	}
	var reloadedComparison map[string]any
	if err := json.NewDecoder(comparisonResponse.Body).Decode(&reloadedComparison); err != nil {
		t.Fatalf("decode reloaded comparison: %v", err)
	}
	if reloadedComparison["baseline_run_id"] != baseline.ID {
		t.Fatalf("comparison endpoint returned the wrong baseline: %#v", reloadedComparison)
	}

	runRequest := httptest.NewRequest(http.MethodGet, "/v1/plan-runs/"+candidate.ID, nil)
	runResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(runResponse, runRequest)
	if runResponse.Code != http.StatusOK {
		t.Fatalf("expected run status 200, got %d: %s", runResponse.Code, runResponse.Body.String())
	}
	var reloaded planRunResponse
	if err := json.NewDecoder(runResponse.Body).Decode(&reloaded); err != nil {
		t.Fatalf("decode reloaded plan: %v", err)
	}
	if reloaded.Comparison == nil || reloaded.Comparison.BaselineRunID != baseline.ID {
		t.Fatalf("reloaded plan is missing its comparison: %#v", reloaded)
	}
	for _, decision := range reloaded.Decisions {
		if !strings.HasPrefix(decision.BaselineDifference, "At ") {
			t.Fatalf("reloaded decision difference is not measured: %q", decision.BaselineDifference)
		}
	}
}

func TestPlanRunRejectsStaleOrEventAffectedBaseline(t *testing.T) {
	application := testApp(t)
	eventBaseline := httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(`{
		"scenario_id":"spiti-valley-default",
		"planner":"baseline",
		"active_event_ids":["midday-solar-shortfall"]
	}`))
	eventBaselineResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(eventBaselineResponse, eventBaseline)
	if eventBaselineResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected event-affected baseline status 400, got %d: %s", eventBaselineResponse.Code, eventBaselineResponse.Body.String())
	}

	baselineRequest := httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(`{
		"scenario_id":"spiti-valley-default",
		"planner":"baseline",
		"active_event_ids":[]
	}`))
	baselineResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(baselineResponse, baselineRequest)
	if baselineResponse.Code != http.StatusCreated {
		t.Fatalf("expected baseline status 201, got %d: %s", baselineResponse.Code, baselineResponse.Body.String())
	}
	var baseline planRunResponse
	if err := json.NewDecoder(baselineResponse.Body).Decode(&baseline); err != nil {
		t.Fatalf("decode baseline: %v", err)
	}

	scenario, err := application.store.Scenario(context.Background(), "spiti-valley-default")
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}
	scenario.Name = "Revised after baseline"
	scenarioBody, err := json.Marshal(scenario)
	if err != nil {
		t.Fatalf("encode scenario: %v", err)
	}
	replaceRequest := httptest.NewRequest(http.MethodPut, "/v1/scenarios/spiti-valley-default", strings.NewReader(string(scenarioBody)))
	replaceResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(replaceResponse, replaceRequest)
	if replaceResponse.Code != http.StatusOK {
		t.Fatalf("expected scenario replace status 200, got %d: %s", replaceResponse.Code, replaceResponse.Body.String())
	}

	candidateBody := fmt.Sprintf(`{
		"scenario_id":"spiti-valley-default",
		"planner":"wattson",
		"active_event_ids":[],
		"parent_run_id":%q
	}`, baseline.ID)
	candidateResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(candidateResponse, httptest.NewRequest(http.MethodPost, "/v1/plan-runs", strings.NewReader(candidateBody)))
	if candidateResponse.Code != http.StatusConflict {
		t.Fatalf("expected stale baseline status 409, got %d: %s", candidateResponse.Code, candidateResponse.Body.String())
	}

	noParentResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(noParentResponse, httptest.NewRequest(http.MethodGet, "/v1/plan-runs/"+baseline.ID+"/comparison", nil))
	if noParentResponse.Code != http.StatusConflict {
		t.Fatalf("expected no-parent comparison status 409, got %d: %s", noParentResponse.Code, noParentResponse.Body.String())
	}
}

func TestScenarioCreateReplaceAndLiveInputs(t *testing.T) {
	application := testApp(t)
	scenario := demoScenarios["spiti-valley"]
	scenario.ID = "editable-scenario"
	scenario.Site.ID = "editable-site"
	createBody, err := json.Marshal(scenario)
	if err != nil {
		t.Fatalf("encode scenario: %v", err)
	}
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/scenarios", strings.NewReader(string(createBody)))
	createResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected create status 201, got %d: %s", createResponse.Code, createResponse.Body.String())
	}
	var createdScenario domain.Scenario
	if err := json.NewDecoder(createResponse.Body).Decode(&createdScenario); err != nil {
		t.Fatalf("decode created scenario: %v", err)
	}
	if createdScenario.Revision != 1 {
		t.Fatalf("expected initial revision 1, got %d", createdScenario.Revision)
	}

	duplicateResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(duplicateResponse, httptest.NewRequest(http.MethodPost, "/v1/scenarios", strings.NewReader(string(createBody))))
	if duplicateResponse.Code != http.StatusConflict {
		t.Fatalf("expected duplicate status 409, got %d: %s", duplicateResponse.Code, duplicateResponse.Body.String())
	}

	scenario.Name = "Edited scenario"
	replaceBody, err := json.Marshal(scenario)
	if err != nil {
		t.Fatalf("encode replaced scenario: %v", err)
	}
	replaceRequest := httptest.NewRequest(http.MethodPut, "/v1/scenarios/editable-scenario", strings.NewReader(string(replaceBody)))
	replaceResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(replaceResponse, replaceRequest)
	if replaceResponse.Code != http.StatusOK {
		t.Fatalf("expected replace status 200, got %d: %s", replaceResponse.Code, replaceResponse.Body.String())
	}
	var replacedScenario domain.Scenario
	if err := json.NewDecoder(replaceResponse.Body).Decode(&replacedScenario); err != nil {
		t.Fatalf("decode replaced scenario: %v", err)
	}
	if replacedScenario.Revision != 2 {
		t.Fatalf("expected replacement revision 2, got %d", replacedScenario.Revision)
	}

	valuesBody := `{"values":[` + strings.Trim(strings.Repeat("1,", 96), ",") + `]}`
	signalRequest := httptest.NewRequest(http.MethodPut, "/v1/scenarios/editable-scenario/signals/spiti-solar-forecast", strings.NewReader(valuesBody))
	signalResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(signalResponse, signalRequest)
	if signalResponse.Code != http.StatusOK {
		t.Fatalf("expected signal status 200, got %d: %s", signalResponse.Code, signalResponse.Body.String())
	}
	var signalScenario domain.Scenario
	if err := json.NewDecoder(signalResponse.Body).Decode(&signalScenario); err != nil {
		t.Fatalf("decode signal scenario: %v", err)
	}
	if signalScenario.Revision != 3 {
		t.Fatalf("expected signal update revision 3, got %d", signalScenario.Revision)
	}

	stateBody := `{"assets":[{"asset_id":"spiti-battery","type":"battery","stored_energy_kwh":150},{"asset_id":"spiti-diesel","type":"diesel","fuel_available_liters":500,"running":false}]}`
	stateRequest := httptest.NewRequest(http.MethodPut, "/v1/scenarios/editable-scenario/initial-state", strings.NewReader(stateBody))
	stateResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(stateResponse, stateRequest)
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("expected initial state status 200, got %d: %s", stateResponse.Code, stateResponse.Body.String())
	}

	eventBody := `{"id":"new-solar-event","name":"New solar shortfall","type":"renewable_shortfall","signal_id":"spiti-solar-forecast","start":"2026-09-12T01:00:00Z","end":"2026-09-12T02:00:00Z","availability_multiplier":0.5}`
	eventRequest := httptest.NewRequest(http.MethodPost, "/v1/scenarios/editable-scenario/events", strings.NewReader(eventBody))
	eventResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(eventResponse, eventRequest)
	if eventResponse.Code != http.StatusCreated {
		t.Fatalf("expected event status 201, got %d: %s", eventResponse.Code, eventResponse.Body.String())
	}
	duplicateEventResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(duplicateEventResponse, httptest.NewRequest(http.MethodPost, "/v1/scenarios/editable-scenario/events", strings.NewReader(eventBody)))
	if duplicateEventResponse.Code != http.StatusConflict {
		t.Fatalf("expected duplicate event status 409, got %d: %s", duplicateEventResponse.Code, duplicateEventResponse.Body.String())
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/v1/scenarios/editable-scenario/events/new-solar-event", nil)
	deleteResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("expected event delete status 204, got %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
}

func TestDemoSeedPreservesScenarioEdits(t *testing.T) {
	application := testApp(t)
	scenario, err := application.store.Scenario(context.Background(), "spiti-valley-default")
	if err != nil {
		t.Fatalf("load seeded scenario: %v", err)
	}
	scenario.Name = "Operator edited scenario"
	if err := application.store.ReplaceScenario(context.Background(), scenario); err != nil {
		t.Fatalf("replace scenario: %v", err)
	}
	if err := seedDemoScenarios(context.Background(), application.store); err != nil {
		t.Fatalf("seed scenario again: %v", err)
	}
	reloaded, err := application.store.Scenario(context.Background(), "spiti-valley-default")
	if err != nil {
		t.Fatalf("load scenario after seed: %v", err)
	}
	if reloaded.Name != "Operator edited scenario" {
		t.Fatalf("seed overwrote operator edit: %#v", reloaded)
	}
}

func TestScenarioUpdatesRejectInvalidInput(t *testing.T) {
	application := testApp(t)
	mismatchRequest := httptest.NewRequest(http.MethodPut, "/v1/scenarios/spiti-valley-default", strings.NewReader(`{"id":"other"}`))
	mismatchResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(mismatchResponse, mismatchRequest)
	if mismatchResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected ID mismatch status 400, got %d", mismatchResponse.Code)
	}

	invalidSignalRequest := httptest.NewRequest(http.MethodPut, "/v1/scenarios/spiti-valley-default/signals/spiti-solar-forecast", strings.NewReader(`{"values":[1]}`))
	invalidSignalResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(invalidSignalResponse, invalidSignalRequest)
	if invalidSignalResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid signal status 400, got %d: %s", invalidSignalResponse.Code, invalidSignalResponse.Body.String())
	}

	missingEventRequest := httptest.NewRequest(http.MethodDelete, "/v1/scenarios/spiti-valley-default/events/missing", nil)
	missingEventResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(missingEventResponse, missingEventRequest)
	if missingEventResponse.Code != http.StatusNotFound {
		t.Fatalf("expected missing event status 404, got %d: %s", missingEventResponse.Code, missingEventResponse.Body.String())
	}
}
