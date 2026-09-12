package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func testConfig() config {
	return config{
		port: "8080",
		allowedOrigins: map[string]struct{}{
			"http://localhost:3001": {},
		},
	}
}

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	newApp(testConfig()).routes().ServeHTTP(response, request)

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

	newApp(testConfig()).routes().ServeHTTP(response, request)

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

	newApp(testConfig()).routes().ServeHTTP(response, request)

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

	newApp(testConfig()).routes().ServeHTTP(response, request)

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

	newApp(testConfig()).routes().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", response.Code)
	}
}

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "http://localhost:3001")
	response := httptest.NewRecorder()

	newApp(testConfig()).routes().ServeHTTP(response, request)

	if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != "http://localhost:3001" {
		t.Fatalf("unexpected CORS origin %q", origin)
	}
}
