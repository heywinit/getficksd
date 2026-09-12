package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
)

const forecastFreshness = 30 * time.Minute

func (a *app) getSiteForecast(response http.ResponseWriter, request *http.Request) {
	ctx := request.Context()
	scenario, err := a.store.ScenarioBySite(ctx, request.PathValue("siteID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The site does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The site could not be loaded."})
		return
	}

	now := a.weather.Now().UTC()
	cached, cacheErr := a.store.WeatherForecast(ctx, scenario.Site.ID)
	if cacheErr == nil && now.Before(cached.ExpiresAt) {
		cached.Forecast.Provider.CacheStatus = domain.CacheStatusFreshCache
		cached.Forecast.OperationalImpact = calculateOperationalImpact(scenario.Site.Assets, cached.Forecast)
		writeJSON(response, http.StatusOK, cached.Forecast)
		return
	}
	if cacheErr != nil && !errors.Is(cacheErr, database.ErrNotFound) {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The weather cache could not be loaded."})
		return
	}

	location, err := a.forecastLocation(ctx, scenario)
	if err == nil {
		var forecast domain.WeatherForecast
		forecast, err = a.weather.Forecast(ctx, scenario.Site.ID, location)
		if err == nil {
			forecast.OperationalImpact = calculateOperationalImpact(scenario.Site.Assets, forecast)
			if saveErr := a.store.SaveWeatherForecast(ctx, forecast, now.Add(forecastFreshness)); saveErr != nil {
				writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The weather forecast could not be cached."})
				return
			}
			writeJSON(response, http.StatusOK, forecast)
			return
		}
	}

	if cacheErr == nil {
		cached.Forecast.Provider.CacheStatus = domain.CacheStatusStaleCache
		cached.Forecast.OperationalImpact = calculateOperationalImpact(scenario.Site.Assets, cached.Forecast)
		writeJSON(response, http.StatusOK, cached.Forecast)
		return
	}
	writeJSON(response, http.StatusBadGateway, map[string]string{
		"message": "Open-Meteo could not provide weather data, and no cached forecast is available.",
	})
}

func (a *app) forecastLocation(ctx context.Context, scenario domain.Scenario) (domain.ForecastLocation, error) {
	location, err := a.store.WeatherLocation(ctx, scenario.Site.ID)
	if err == nil {
		return location.Location, nil
	}
	if !errors.Is(err, database.ErrNotFound) {
		return domain.ForecastLocation{}, err
	}
	var resolved domain.ForecastLocation
	var resolveErr error
	for _, query := range locationQueries(scenario.Site) {
		resolved, resolveErr = a.weather.Resolve(ctx, query, scenario.Site.Location, scenario.Site.Timezone)
		if resolveErr == nil {
			break
		}
	}
	if resolveErr != nil {
		return domain.ForecastLocation{}, resolveErr
	}
	if err := a.store.SaveWeatherLocation(ctx, scenario.Site.ID, resolved, a.weather.Now().UTC()); err != nil {
		return domain.ForecastLocation{}, err
	}
	return resolved, nil
}

func locationQueries(site domain.Site) []string {
	cleanName := strings.TrimSpace(site.Name)
	for _, suffix := range []string{" Community Grid", " Health Grid", " Coastal Grid", " Grid"} {
		cleanName = strings.TrimSuffix(cleanName, suffix)
	}
	candidates := []string{siteLocationQuery(site), cleanName, site.Location}
	if strings.Contains(strings.ToLower(cleanName), "spiti") {
		candidates = append(candidates, "Kaza")
	}
	if before, _, found := strings.Cut(cleanName, " "); found && strings.EqualFold(before, "char") {
		candidates = append(candidates, cleanName)
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		result = append(result, candidate)
	}
	return result
}

func calculateOperationalImpact(assets []domain.Asset, forecast domain.WeatherForecast) domain.OperationalImpact {
	capacity := capacities(assets)
	impact := domain.OperationalImpact{
		SolarCapacityKW: capacity.SolarKW, WindCapacityKW: capacity.WindKW,
		BatteryCapacityKWH: capacity.BatteryKWH, DieselCapacityKW: capacity.DieselKW,
		Actions: make([]domain.OperationalAction, 0),
	}
	solarIDs, windIDs, batteryIDs, dieselIDs := assetIDsByType(assets)
	startIndex := 0
	for index, hour := range forecast.Hourly {
		if hour.Time >= forecast.Current.Time {
			startIndex = index
			break
		}
	}
	endIndex := startIndex + 24
	if endIndex > len(forecast.Hourly) {
		endIndex = len(forecast.Hourly)
	}
	hours := forecast.Hourly[startIndex:endIndex]
	hourCount := len(hours)
	var radiation, cloud, wind, gust float64
	for _, hour := range hours {
		radiation += hour.ShortwaveRadiationWM2
		cloud += hour.CloudCoverPercent
		wind += hour.WindSpeedKPH
		if hour.WindGustsKPH > gust {
			gust = hour.WindGustsKPH
		}
	}
	if hourCount > 0 {
		radiation /= float64(hourCount)
		cloud /= float64(hourCount)
		wind /= float64(hourCount)
	}

	adverseRenewables := false
	if capacity.SolarKW > 0 && (radiation < 150 || cloud > 75) {
		adverseRenewables = true
		impact.Actions = append(impact.Actions, domain.OperationalAction{
			Severity: "warning", Category: "solar", Title: "Reduce the solar availability forecast",
			Reason:    fmt.Sprintf("The next 24 hours average %.0f W/m² of shortwave radiation and %.0f%% cloud cover.", radiation, cloud),
			Timeframe: "next_24_hours", AssetIDs: solarIDs,
		})
	} else if capacity.SolarKW > 0 {
		impact.Actions = append(impact.Actions, domain.OperationalAction{
			Severity: "info", Category: "solar", Title: "Align the solar input with the weather forecast",
			Reason:    fmt.Sprintf("The next 24 hours average %.0f W/m² of shortwave radiation.", radiation),
			Timeframe: "next_24_hours", AssetIDs: solarIDs,
		})
	}
	if capacity.WindKW > 0 && gust >= 50 {
		adverseRenewables = true
		impact.Actions = append(impact.Actions, domain.OperationalAction{
			Severity: "critical", Category: "wind", Title: "Review the wind turbine operating limit",
			Reason:    fmt.Sprintf("Forecast wind gusts reach %.0f km/h during the next 24 hours.", gust),
			Timeframe: "next_24_hours", AssetIDs: windIDs,
		})
	} else if capacity.WindKW > 0 {
		impact.Actions = append(impact.Actions, domain.OperationalAction{
			Severity: "info", Category: "wind", Title: "Align the wind input with the weather forecast",
			Reason:    fmt.Sprintf("The next 24 hours average %.0f km/h wind speed.", wind),
			Timeframe: "next_24_hours", AssetIDs: windIDs,
		})
	}
	if adverseRenewables && capacity.BatteryKWH > 0 {
		impact.Actions = append(impact.Actions, domain.OperationalAction{
			Severity: "warning", Category: "storage", Title: "Protect the battery reserve",
			Reason:    "The renewable forecast can reduce charging opportunities during the next planning horizon.",
			Timeframe: "before_next_plan", AssetIDs: batteryIDs,
		})
	}
	if adverseRenewables && capacity.DieselKW > 0 {
		impact.Actions = append(impact.Actions, domain.OperationalAction{
			Severity: "warning", Category: "backup", Title: "Confirm backup fuel availability",
			Reason:    "The renewable forecast can increase generator use during the next planning horizon.",
			Timeframe: "before_next_plan", AssetIDs: dieselIDs,
		})
	}
	if adverseRenewables {
		impact.Summary = "The weather forecast can reduce renewable supply. Update renewable signals and run the planner again."
	} else {
		impact.Summary = "No severe renewable constraint is visible. Align forecast signals before the next plan run."
	}
	return impact
}

func assetIDsByType(assets []domain.Asset) (solar, wind, battery, diesel []string) {
	for _, asset := range assets {
		switch asset.Type {
		case domain.AssetSolar:
			solar = append(solar, asset.ID)
		case domain.AssetWind:
			wind = append(wind, asset.ID)
		case domain.AssetBattery:
			battery = append(battery, asset.ID)
		case domain.AssetDiesel:
			diesel = append(diesel, asset.ID)
		}
	}
	return
}
