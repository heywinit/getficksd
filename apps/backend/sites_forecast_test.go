package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestSiteEndpointsUsePersistedScenario(t *testing.T) {
	application := testApp(t)
	listResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, "/v1/sites", nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list sites: %d %s", listResponse.Code, listResponse.Body.String())
	}
	var sites []siteSummary
	if err := json.NewDecoder(listResponse.Body).Decode(&sites); err != nil {
		t.Fatalf("decode sites: %v", err)
	}
	if len(sites) != len(demoOperators) {
		t.Fatalf("unexpected sites: %#v", sites)
	}
	var spiti *siteSummary
	for index := range sites {
		if sites[index].ID == "spiti-valley" {
			spiti = &sites[index]
			break
		}
	}
	if spiti == nil || spiti.Capacity.SolarKW != 220 || spiti.CommitmentCount != 7 || spiti.LatestRun != nil {
		t.Fatalf("unexpected Spiti Valley summary: %#v", spiti)
	}

	detailResponse := httptest.NewRecorder()
	application.routes().ServeHTTP(detailResponse, httptest.NewRequest(http.MethodGet, "/v1/sites/spiti-valley", nil))
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("get site: %d %s", detailResponse.Code, detailResponse.Body.String())
	}
	var overview siteOverview
	if err := json.NewDecoder(detailResponse.Body).Decode(&overview); err != nil {
		t.Fatalf("decode site: %v", err)
	}
	if overview.Site.ID != "spiti-valley" || len(overview.Site.Assets) == 0 || overview.CurrentScenario.Revision != 2 {
		t.Fatalf("unexpected overview: %#v", overview)
	}
}

func TestCreateSiteBuildsStarterScenario(t *testing.T) {
	application := testApp(t)
	body := `{
		"name":"Nubra Microgrid",
		"location":"Nubra Valley, Ladakh, India",
		"timezone":"Asia/Kolkata",
		"currency":"inr",
		"solar_capacity_kw":125,
		"peak_demand_kw":80
	}`
	response := httptest.NewRecorder()
	application.routes().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/sites", strings.NewReader(body)))
	if response.Code != http.StatusCreated {
		t.Fatalf("create site: %d %s", response.Code, response.Body.String())
	}
	var created siteSummary
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatalf("decode created site: %v", err)
	}
	if created.ID != "nubra-microgrid" || created.Currency != "INR" || created.Capacity.SolarKW != 125 {
		t.Fatalf("unexpected created site: %#v", created)
	}
	if created.ServiceCount != 1 || created.CommitmentCount != 1 || created.CurrentScenario.Revision != 1 {
		t.Fatalf("unexpected starter scenario summary: %#v", created)
	}

	scenario, err := application.store.ScenarioBySite(t.Context(), created.ID)
	if err != nil {
		t.Fatalf("load starter scenario: %v", err)
	}
	if err := domain.ValidateScenario(scenario); err != nil {
		t.Fatalf("created invalid starter scenario: %v", err)
	}
	if scenario.Site.Services[0].RatedPowerKW != 80 || len(scenario.Signals) != 2 {
		t.Fatalf("unexpected starter scenario: %#v", scenario)
	}

	duplicate := httptest.NewRecorder()
	application.routes().ServeHTTP(duplicate, httptest.NewRequest(http.MethodPost, "/v1/sites", strings.NewReader(body)))
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("expected duplicate status 409, got %d: %s", duplicate.Code, duplicate.Body.String())
	}
}

func TestCreateSiteRejectsInvalidTimezone(t *testing.T) {
	application := testApp(t)
	response := httptest.NewRecorder()
	application.routes().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/sites", strings.NewReader(`{
		"name":"Test Grid",
		"location":"Somewhere",
		"timezone":"Mars/Olympus",
		"currency":"USD",
		"solar_capacity_kw":10,
		"peak_demand_kw":5
	}`)))
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "timezone is invalid") {
		t.Fatalf("unexpected invalid timezone response: %d %s", response.Code, response.Body.String())
	}
}

func TestForecastUsesLocationFallbackAndFreshCache(t *testing.T) {
	var geocodingCalls, forecastCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/geo":
			geocodingCalls.Add(1)
			if request.URL.Query().Get("name") != "Kaza" {
				response.Write([]byte(`{"results":[]}`))
				return
			}
			if request.URL.Query().Get("countryCode") != "IN" {
				t.Errorf("expected India country filter, got %q", request.URL.Query().Get("countryCode"))
			}
			response.Write([]byte(`{"results":[{"name":"Kaza","admin1":"Zamfara State","country":"Nigeria","latitude":12.12,"longitude":6.08,"timezone":"Africa/Lagos"},{"name":"Kaza","admin1":"Himachal Pradesh","country":"India","latitude":32.22,"longitude":78.07,"timezone":"Asia/Kolkata"}]}`))
		case "/forecast":
			forecastCalls.Add(1)
			response.Write([]byte(handlerForecastFixture))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	application := testApp(t)
	application.weather.HTTPClient = server.Client()
	application.weather.GeocodingURL = server.URL + "/geo"
	application.weather.ForecastURL = server.URL + "/forecast"
	application.weather.Now = func() time.Time { return time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC) }

	first := httptest.NewRecorder()
	application.routes().ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/sites/spiti-valley/forecast", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first forecast: %d %s", first.Code, first.Body.String())
	}
	var live domain.WeatherForecast
	if err := json.NewDecoder(first.Body).Decode(&live); err != nil {
		t.Fatalf("decode live forecast: %v", err)
	}
	if live.Provider.CacheStatus != domain.CacheStatusLive || live.OperationalImpact.SolarCapacityKW != 220 {
		t.Fatalf("unexpected live forecast: %#v", live)
	}
	if live.Location.Latitude != 32.22 || live.Location.Name != "Kaza, Himachal Pradesh, India" {
		t.Fatalf("resolver selected the wrong Kaza: %#v", live.Location)
	}
	if geocodingCalls.Load() != 4 {
		t.Fatalf("expected full, cleaned, location, and city geocoding queries, got %d", geocodingCalls.Load())
	}

	second := httptest.NewRecorder()
	application.routes().ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/v1/sites/spiti-valley/forecast", nil))
	var cached domain.WeatherForecast
	if err := json.NewDecoder(second.Body).Decode(&cached); err != nil {
		t.Fatalf("decode cached forecast: %v", err)
	}
	if cached.Provider.CacheStatus != domain.CacheStatusFreshCache || forecastCalls.Load() != 1 {
		t.Fatalf("fresh cache was not used: status=%q calls=%d", cached.Provider.CacheStatus, forecastCalls.Load())
	}
}

func TestForecastFallsBackToStaleCache(t *testing.T) {
	application := testApp(t)
	now := time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)
	application.weather.Now = func() time.Time { return now }
	forecast := domain.WeatherForecast{
		SiteID: "spiti-valley", Location: domain.ForecastLocation{Name: "Kaza", Latitude: 32, Longitude: 78, Timezone: "Asia/Kolkata"},
		Provider: domain.ForecastProvider{Name: "Open-Meteo", URL: "https://open-meteo.com/", FetchedAt: now.Add(-time.Hour), CacheStatus: domain.CacheStatusLive},
		Hourly:   []domain.HourlyWeather{{Time: "2026-09-12T08:00"}}, Daily: []domain.DailyWeather{{Date: "2026-09-12"}},
	}
	if err := application.store.SaveWeatherForecast(t.Context(), forecast, now.Add(-time.Minute)); err != nil {
		t.Fatalf("save stale forecast: %v", err)
	}
	application.weather.HTTPClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, http.ErrServerClosed })}
	response := httptest.NewRecorder()
	application.routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/sites/spiti-valley/forecast", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("stale response: %d %s", response.Code, response.Body.String())
	}
	var body domain.WeatherForecast
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode stale response: %v", err)
	}
	if body.Provider.CacheStatus != domain.CacheStatusStaleCache {
		t.Fatalf("expected stale cache, got %q", body.Provider.CacheStatus)
	}
}

func TestForecastWithoutProviderOrCacheReturnsBadGateway(t *testing.T) {
	application := testApp(t)
	application.weather.HTTPClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, http.ErrServerClosed })}
	response := httptest.NewRecorder()
	application.routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/sites/spiti-valley/forecast", nil))
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "no cached forecast") {
		t.Fatalf("unexpected provider failure: %d %s", response.Code, response.Body.String())
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

const handlerForecastFixture = `{
  "timezone":"Asia/Kolkata",
  "current":{"time":"2026-09-12T13:30","temperature_2m":12.5,"apparent_temperature":11.2,"precipitation":0.1,"cloud_cover":82,"wind_speed_10m":18,"wind_direction_10m":240,"weather_code":3,"is_day":1},
  "hourly":{"time":["2026-09-12T13:00","2026-09-12T14:00"],"temperature_2m":[12,13],"precipitation_probability":[20,30],"precipitation":[0,0.2],"cloud_cover":[80,84],"wind_speed_10m":[18,20],"wind_gusts_10m":[30,34],"shortwave_radiation":[120,100],"weather_code":[2,3]},
  "daily":{"time":["2026-09-12"],"temperature_2m_max":[14],"temperature_2m_min":[5],"sunrise":["2026-09-12T06:05"],"sunset":["2026-09-12T18:35"],"precipitation_sum":[1.2],"precipitation_probability_max":[40],"wind_speed_10m_max":[25],"wind_gusts_10m_max":[42],"shortwave_radiation_sum":[12.4],"weather_code":[61]}
}`
