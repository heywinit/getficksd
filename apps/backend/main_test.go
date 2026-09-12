package main

import (
	"context"
	"encoding/json"
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
