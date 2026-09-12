package weather

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestClientResolvesAndNormalizesForecast(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/geo":
			response.Write([]byte(`{"results":[{"name":"Kaza","admin1":"Himachal Pradesh","country":"India","latitude":32.22,"longitude":78.07,"timezone":"Asia/Kolkata"}]}`))
		case "/forecast":
			response.Write([]byte(forecastFixture))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	now := time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)
	client := NewClient()
	client.HTTPClient = server.Client()
	client.GeocodingURL = server.URL + "/geo"
	client.ForecastURL = server.URL + "/forecast"
	client.Now = func() time.Time { return now }

	location, err := client.Resolve(context.Background(), "Spiti Valley", "Himachal Pradesh, India", "Asia/Kolkata")
	if err != nil {
		t.Fatalf("resolve location: %v", err)
	}
	forecast, err := client.Forecast(context.Background(), "spiti-valley", location)
	if err != nil {
		t.Fatalf("load forecast: %v", err)
	}
	if forecast.Location.Latitude != 32.22 || forecast.Provider.FetchedAt != now {
		t.Fatalf("unexpected forecast metadata: %#v", forecast)
	}
	if len(forecast.Hourly) != 2 || forecast.Hourly[0].Condition != "Partly cloudy" {
		t.Fatalf("unexpected hourly forecast: %#v", forecast.Hourly)
	}
	if len(forecast.Daily) != 1 || forecast.Daily[0].ShortwaveRadiationSumMJM2 != 12.4 {
		t.Fatalf("unexpected daily forecast: %#v", forecast.Daily)
	}
}

func TestClientRejectsIncompleteForecast(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Write([]byte(`{"current":{},"hourly":{"time":[]},"daily":{"time":[]}}`))
	}))
	defer server.Close()
	client := NewClient()
	client.HTTPClient = server.Client()
	client.ForecastURL = server.URL
	_, err := client.Forecast(context.Background(), "site", domain.ForecastLocation{Latitude: 1, Longitude: 2, Timezone: "UTC"})
	if err == nil {
		t.Fatal("expected an incomplete forecast error")
	}
}

const forecastFixture = `{
  "timezone":"Asia/Kolkata",
  "current":{"time":"2026-09-12T13:30","temperature_2m":12.5,"apparent_temperature":11.2,"precipitation":0.1,"cloud_cover":72,"wind_speed_10m":18,"wind_direction_10m":240,"weather_code":2,"is_day":1},
  "hourly":{"time":["2026-09-12T13:00","2026-09-12T14:00"],"temperature_2m":[12,13],"precipitation_probability":[20,30],"precipitation":[0,0.2],"cloud_cover":[70,80],"wind_speed_10m":[18,20],"wind_gusts_10m":[30,34],"shortwave_radiation":[120,100],"weather_code":[2,3]},
  "daily":{"time":["2026-09-12"],"temperature_2m_max":[14],"temperature_2m_min":[5],"sunrise":["2026-09-12T06:05"],"sunset":["2026-09-12T18:35"],"precipitation_sum":[1.2],"precipitation_probability_max":[40],"wind_speed_10m_max":[25],"wind_gusts_10m_max":[42],"shortwave_radiation_sum":[12.4],"weather_code":[61]}
}`
