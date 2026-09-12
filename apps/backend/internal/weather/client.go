package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

const (
	DefaultGeocodingURL = "https://geocoding-api.open-meteo.com/v1/search"
	DefaultForecastURL  = "https://api.open-meteo.com/v1/forecast"
)

type Client struct {
	HTTPClient   *http.Client
	GeocodingURL string
	ForecastURL  string
	Now          func() time.Time
}

func NewClient() *Client {
	return &Client{
		HTTPClient:   &http.Client{Timeout: 12 * time.Second},
		GeocodingURL: DefaultGeocodingURL,
		ForecastURL:  DefaultForecastURL,
		Now:          time.Now,
	}
}

type geocodingResponse struct {
	Results []struct {
		Name      string  `json:"name"`
		Admin1    string  `json:"admin1"`
		Country   string  `json:"country"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Timezone  string  `json:"timezone"`
	} `json:"results"`
}

func (c *Client) Resolve(ctx context.Context, query, locationHint, timezone string) (domain.ForecastLocation, error) {
	values := url.Values{"name": {query}, "count": {"10"}, "language": {"en"}, "format": {"json"}}
	if countryCode := countryCodeForHint(locationHint); countryCode != "" {
		values.Set("countryCode", countryCode)
	}
	var payload geocodingResponse
	if err := c.getJSON(ctx, c.GeocodingURL+"?"+values.Encode(), &payload); err != nil {
		return domain.ForecastLocation{}, fmt.Errorf("resolve site location: %w", err)
	}
	if len(payload.Results) == 0 {
		return domain.ForecastLocation{}, errors.New("resolve site location: Open-Meteo returned no matching location")
	}
	bestIndex, bestScore := 0, -1
	query = strings.ToLower(strings.TrimSpace(query))
	locationHint = strings.ToLower(locationHint)
	for index, candidate := range payload.Results {
		score := 0
		name := strings.ToLower(candidate.Name)
		if name == query {
			score += 4
		} else if strings.Contains(name, query) || strings.Contains(query, name) {
			score += 2
		}
		if candidate.Admin1 != "" && strings.Contains(locationHint, strings.ToLower(candidate.Admin1)) {
			score += 5
		}
		if candidate.Country != "" && strings.Contains(locationHint, strings.ToLower(candidate.Country)) {
			score += 3
		}
		if timezone != "" && candidate.Timezone == timezone {
			score += 2
		}
		if score > bestScore {
			bestIndex, bestScore = index, score
		}
	}
	if bestScore < 4 {
		return domain.ForecastLocation{}, errors.New("resolve site location: Open-Meteo returned no relevant location")
	}
	result := payload.Results[bestIndex]
	nameParts := []string{result.Name}
	if result.Admin1 != "" && result.Admin1 != result.Name {
		nameParts = append(nameParts, result.Admin1)
	}
	if result.Country != "" {
		nameParts = append(nameParts, result.Country)
	}
	if timezone == "" {
		timezone = result.Timezone
	}
	return domain.ForecastLocation{
		Name: strings.Join(nameParts, ", "), Latitude: result.Latitude,
		Longitude: result.Longitude, Timezone: timezone,
	}, nil
}

func countryCodeForHint(location string) string {
	lower := strings.ToLower(location)
	for country, code := range map[string]string{
		"india": "IN", "ghana": "GH", "mexico": "MX", "bangladesh": "BD",
	} {
		if strings.Contains(lower, country) {
			return code
		}
	}
	return ""
}

type forecastPayload struct {
	Timezone string `json:"timezone"`
	Current  struct {
		Time                string  `json:"time"`
		Temperature         float64 `json:"temperature_2m"`
		ApparentTemperature float64 `json:"apparent_temperature"`
		Precipitation       float64 `json:"precipitation"`
		CloudCover          float64 `json:"cloud_cover"`
		WindSpeed           float64 `json:"wind_speed_10m"`
		WindDirection       float64 `json:"wind_direction_10m"`
		WeatherCode         int     `json:"weather_code"`
		IsDay               int     `json:"is_day"`
	} `json:"current"`
	Hourly struct {
		Time                     []string  `json:"time"`
		Temperature              []float64 `json:"temperature_2m"`
		PrecipitationProbability []float64 `json:"precipitation_probability"`
		Precipitation            []float64 `json:"precipitation"`
		CloudCover               []float64 `json:"cloud_cover"`
		WindSpeed                []float64 `json:"wind_speed_10m"`
		WindGusts                []float64 `json:"wind_gusts_10m"`
		ShortwaveRadiation       []float64 `json:"shortwave_radiation"`
		WeatherCode              []int     `json:"weather_code"`
	} `json:"hourly"`
	Daily struct {
		Time                     []string  `json:"time"`
		TemperatureMax           []float64 `json:"temperature_2m_max"`
		TemperatureMin           []float64 `json:"temperature_2m_min"`
		Sunrise                  []string  `json:"sunrise"`
		Sunset                   []string  `json:"sunset"`
		PrecipitationSum         []float64 `json:"precipitation_sum"`
		PrecipitationProbability []float64 `json:"precipitation_probability_max"`
		WindSpeedMax             []float64 `json:"wind_speed_10m_max"`
		WindGustsMax             []float64 `json:"wind_gusts_10m_max"`
		ShortwaveRadiationSum    []float64 `json:"shortwave_radiation_sum"`
		WeatherCode              []int     `json:"weather_code"`
	} `json:"daily"`
}

func (c *Client) Forecast(ctx context.Context, siteID string, location domain.ForecastLocation) (domain.WeatherForecast, error) {
	values := url.Values{
		"latitude":  {strconv.FormatFloat(location.Latitude, 'f', -1, 64)},
		"longitude": {strconv.FormatFloat(location.Longitude, 'f', -1, 64)},
		"timezone":  {location.Timezone}, "forecast_days": {"7"},
		"current": {"temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code,is_day"},
		"hourly":  {"temperature_2m,precipitation_probability,precipitation,cloud_cover,wind_speed_10m,wind_gusts_10m,shortwave_radiation,weather_code"},
		"daily":   {"temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,shortwave_radiation_sum,weather_code"},
	}
	var payload forecastPayload
	if err := c.getJSON(ctx, c.ForecastURL+"?"+values.Encode(), &payload); err != nil {
		return domain.WeatherForecast{}, fmt.Errorf("load weather forecast: %w", err)
	}
	if len(payload.Hourly.Time) == 0 || len(payload.Daily.Time) == 0 || payload.Current.Time == "" {
		return domain.WeatherForecast{}, errors.New("load weather forecast: Open-Meteo returned incomplete weather data")
	}
	fetchedAt := c.Now().UTC()
	result := domain.WeatherForecast{
		SiteID: siteID, Location: location,
		Provider: domain.ForecastProvider{Name: "Open-Meteo", URL: "https://open-meteo.com/", FetchedAt: fetchedAt, CacheStatus: domain.CacheStatusLive},
		Current: domain.CurrentWeather{
			Time: payload.Current.Time, TemperatureC: payload.Current.Temperature,
			ApparentTemperatureC: payload.Current.ApparentTemperature, PrecipitationMM: payload.Current.Precipitation,
			CloudCoverPercent: payload.Current.CloudCover, WindSpeedKPH: payload.Current.WindSpeed,
			WindDirectionDegrees: payload.Current.WindDirection, WeatherCode: payload.Current.WeatherCode,
			Condition: WeatherCondition(payload.Current.WeatherCode), IsDay: payload.Current.IsDay == 1,
		},
		Hourly: make([]domain.HourlyWeather, 0, len(payload.Hourly.Time)),
		Daily:  make([]domain.DailyWeather, 0, len(payload.Daily.Time)),
	}
	for index, value := range payload.Hourly.Time {
		if !hourlyIndexValid(payload, index) {
			break
		}
		result.Hourly = append(result.Hourly, domain.HourlyWeather{
			Time: value, TemperatureC: payload.Hourly.Temperature[index],
			PrecipitationProbabilityPercent: payload.Hourly.PrecipitationProbability[index],
			PrecipitationMM:                 payload.Hourly.Precipitation[index], CloudCoverPercent: payload.Hourly.CloudCover[index],
			WindSpeedKPH: payload.Hourly.WindSpeed[index], WindGustsKPH: payload.Hourly.WindGusts[index],
			ShortwaveRadiationWM2: payload.Hourly.ShortwaveRadiation[index], WeatherCode: payload.Hourly.WeatherCode[index],
			Condition: WeatherCondition(payload.Hourly.WeatherCode[index]),
		})
	}
	for index, value := range payload.Daily.Time {
		if !dailyIndexValid(payload, index) {
			break
		}
		result.Daily = append(result.Daily, domain.DailyWeather{
			Date: value, TemperatureMaxC: payload.Daily.TemperatureMax[index], TemperatureMinC: payload.Daily.TemperatureMin[index],
			Sunrise: payload.Daily.Sunrise[index], Sunset: payload.Daily.Sunset[index], PrecipitationSumMM: payload.Daily.PrecipitationSum[index],
			PrecipitationProbabilityMaxPercent: payload.Daily.PrecipitationProbability[index], WindSpeedMaxKPH: payload.Daily.WindSpeedMax[index],
			WindGustsMaxKPH: payload.Daily.WindGustsMax[index], ShortwaveRadiationSumMJM2: payload.Daily.ShortwaveRadiationSum[index],
			WeatherCode: payload.Daily.WeatherCode[index], Condition: WeatherCondition(payload.Daily.WeatherCode[index]),
		})
	}
	if len(result.Hourly) == 0 || len(result.Daily) == 0 {
		return domain.WeatherForecast{}, errors.New("load weather forecast: Open-Meteo returned inconsistent weather data")
	}
	return result, nil
}

func hourlyIndexValid(payload forecastPayload, index int) bool {
	return index < len(payload.Hourly.Temperature) && index < len(payload.Hourly.PrecipitationProbability) &&
		index < len(payload.Hourly.Precipitation) && index < len(payload.Hourly.CloudCover) && index < len(payload.Hourly.WindSpeed) &&
		index < len(payload.Hourly.WindGusts) && index < len(payload.Hourly.ShortwaveRadiation) && index < len(payload.Hourly.WeatherCode)
}

func dailyIndexValid(payload forecastPayload, index int) bool {
	return index < len(payload.Daily.TemperatureMax) && index < len(payload.Daily.TemperatureMin) && index < len(payload.Daily.Sunrise) &&
		index < len(payload.Daily.Sunset) && index < len(payload.Daily.PrecipitationSum) && index < len(payload.Daily.PrecipitationProbability) &&
		index < len(payload.Daily.WindSpeedMax) && index < len(payload.Daily.WindGustsMax) && index < len(payload.Daily.ShortwaveRadiationSum) &&
		index < len(payload.Daily.WeatherCode)
}

func (c *Client) getJSON(ctx context.Context, endpoint string, destination any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.HTTPClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Open-Meteo returned HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(destination); err != nil {
		return fmt.Errorf("decode Open-Meteo response: %w", err)
	}
	return nil
}

func WeatherCondition(code int) string {
	switch {
	case code == 0:
		return "Clear sky"
	case code == 1:
		return "Mainly clear"
	case code == 2:
		return "Partly cloudy"
	case code == 3:
		return "Overcast"
	case code == 45 || code == 48:
		return "Fog"
	case code >= 51 && code <= 57:
		return "Drizzle"
	case code >= 61 && code <= 67:
		return "Rain"
	case code >= 71 && code <= 77:
		return "Snow"
	case code >= 80 && code <= 82:
		return "Rain showers"
	case code >= 85 && code <= 86:
		return "Snow showers"
	case code >= 95:
		return "Thunderstorm"
	default:
		return "Unknown"
	}
}
