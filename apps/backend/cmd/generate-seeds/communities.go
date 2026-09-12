package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

type communitySeed struct {
	Filename string
	Scenario domain.Scenario
}

type communitySpec struct {
	Filename           string
	ScenarioID         string
	ScenarioName       string
	Description        string
	SiteID             string
	SiteName           string
	Location           string
	Timezone           string
	Currency           string
	StartsAt           string
	SolarCapacityKW    float64
	WindCapacityKW     float64
	BatteryCapacityKWH float64
	DieselCapacityKW   float64
	PeakDemandKW       float64
	FuelCostPerLiter   float64
	ServiceNames       [8]string
	EventNames         [3]string
}

func communityScenarios() []communitySeed {
	spiti := spitiValleyScenario()
	return []communitySeed{
		{Filename: "spiti-valley-default.json", Scenario: spiti},
		regionalCommunitySeed(spiti, communitySpec{
			Filename: "ada-foah-default.json", ScenarioID: "ada-foah-community-v1",
			ScenarioName: "Ada Foah coastal operations",
			Description:  "A full operating day for homes, health care, fishing, water, communications, and cold storage during a coastal storm.",
			SiteID:       "ada-foah", SiteName: "Ada Foah Coastal Grid", Location: "Greater Accra, Ghana",
			Timezone: "Africa/Accra", Currency: "GHS", StartsAt: "2026-10-18T00:00:00Z",
			SolarCapacityKW: 95, WindCapacityKW: 80, BatteryCapacityKWH: 420, DieselCapacityKW: 120,
			PeakDemandKW: 130, FuelCostPerLiter: 15.5,
			ServiceNames: [8]string{"Community health center", "Emergency communications", "Drinking water pumps", "School and shelter", "Fishing businesses", "Coastal households", "Harbor lighting", "Fish cold storage"},
			EventNames:   [3]string{"Storm cloud cover", "Evening household surge", "Storm-delayed fuel delivery"},
		}),
		regionalCommunitySeed(spiti, communitySpec{
			Filename: "sierra-verde-default.json", ScenarioID: "sierra-verde-community-v1",
			ScenarioName: "Sierra Verde health operations",
			Description:  "A full operating day for a mountain health network, homes, water, education, and local commerce during heavy cloud cover.",
			SiteID:       "sierra-verde", SiteName: "Sierra Verde Health Grid", Location: "Oaxaca, Mexico",
			Timezone: "America/Mexico_City", Currency: "MXN", StartsAt: "2026-10-18T00:00:00-06:00",
			SolarCapacityKW: 88, WindCapacityKW: 0, BatteryCapacityKWH: 280, DieselCapacityKW: 55,
			PeakDemandKW: 58, FuelCostPerLiter: 25.5,
			ServiceNames: [8]string{"Rural health center", "Emergency radio network", "Mountain water pumps", "Village school", "Local workshops", "Mountain households", "Path lighting", "Medicine cold storage"},
			EventNames:   [3]string{"Mountain cloud cover", "Evening household surge", "Road-delayed fuel delivery"},
		}),
		regionalCommunitySeed(spiti, communitySpec{
			Filename: "char-kukri-mukri-default.json", ScenarioID: "char-kukri-mukri-community-v1",
			ScenarioName: "Char Kukri Mukri island operations",
			Description:  "A full operating day for island homes, health care, water, communications, markets, and shelters during severe monsoon weather.",
			SiteID:       "char-kukri-mukri", SiteName: "Char Kukri Mukri Grid", Location: "Bhola, Bangladesh",
			Timezone: "Asia/Dhaka", Currency: "BDT", StartsAt: "2026-10-18T00:00:00+06:00",
			SolarCapacityKW: 110, WindCapacityKW: 25, BatteryCapacityKWH: 310, DieselCapacityKW: 70,
			PeakDemandKW: 74, FuelCostPerLiter: 110,
			ServiceNames: [8]string{"Island health center", "Cyclone communications", "Freshwater pumps", "School and cyclone shelter", "Market and workshops", "Island households", "Jetty lighting", "Food and medicine storage"},
			EventNames:   [3]string{"Monsoon cloud cover", "Shelter demand surge", "Ferry-delayed fuel delivery"},
		}),
	}
}

func regionalCommunitySeed(base domain.Scenario, spec communitySpec) communitySeed {
	scenario := cloneScenario(base)
	oldStart := scenario.Horizon.StartsAt
	start := mustTime(spec.StartsAt)
	shift := start.Sub(oldStart)
	scale := spec.PeakDemandKW / 206

	scenario.ID = spec.ScenarioID
	scenario.Name = spec.ScenarioName
	scenario.Description = spec.Description
	scenario.Site.ID = spec.SiteID
	scenario.Site.Name = spec.SiteName
	scenario.Site.Location = spec.Location
	scenario.Site.Timezone = spec.Timezone
	scenario.Site.Currency = spec.Currency
	scenario.Horizon.StartsAt = start

	assetIDs := map[string]string{
		"spiti-solar":   spec.SiteID + "-solar",
		"spiti-wind":    spec.SiteID + "-wind",
		"spiti-battery": spec.SiteID + "-battery",
		"spiti-diesel":  spec.SiteID + "-diesel",
	}
	for index := range scenario.Site.Assets {
		asset := &scenario.Site.Assets[index]
		asset.ID = assetIDs[asset.ID]
		switch asset.Type {
		case domain.AssetSolar:
			asset.Name = "Community solar plant"
			asset.CapacityKW = floatPointer(spec.SolarCapacityKW)
		case domain.AssetWind:
			asset.Name = "Community wind plant"
			asset.CapacityKW = floatPointer(spec.WindCapacityKW)
		case domain.AssetBattery:
			asset.Name = "Community battery system"
			asset.CapacityKWH = floatPointer(spec.BatteryCapacityKWH)
			asset.MinimumStoredEnergyKWH = floatPointer(spec.BatteryCapacityKWH * 0.1)
			power := min(spec.BatteryCapacityKWH*0.25, spec.PeakDemandKW)
			asset.MaxChargeKW = floatPointer(power)
			asset.MaxDischargeKW = floatPointer(power)
		case domain.AssetDiesel:
			asset.Name = "Backup diesel generator"
			asset.MinimumOutputKW = floatPointer(spec.DieselCapacityKW * 0.2)
			asset.MaximumOutputKW = floatPointer(spec.DieselCapacityKW)
			asset.RampRateKWPerMinute = floatPointer(max(2, spec.DieselCapacityKW/32))
			asset.FuelCostPerLiter = floatPointer(spec.FuelCostPerLiter)
		}
	}
	if spec.WindCapacityKW == 0 {
		scenario.Site.Assets = removeAsset(scenario.Site.Assets, assetIDs["spiti-wind"])
	}

	for index := range scenario.Site.Services {
		scenario.Site.Services[index].Name = spec.ServiceNames[index]
		scenario.Site.Services[index].RatedPowerKW = round2(scenario.Site.Services[index].RatedPowerKW * scale)
	}

	for index := range scenario.InitialState.Assets {
		state := &scenario.InitialState.Assets[index]
		state.AssetID = assetIDs[state.AssetID]
		if state.Type == domain.AssetBattery {
			state.StoredEnergyKWH = floatPointer(spec.BatteryCapacityKWH * 0.6)
		} else if state.Type == domain.AssetDiesel {
			state.FuelAvailableLiters = floatPointer(spec.DieselCapacityKW * 2)
		}
	}

	for index := range scenario.Signals {
		signal := &scenario.Signals[index]
		if signal.AssetID != "" {
			signal.AssetID = assetIDs[signal.AssetID]
		}
		signal.ID = regionalSignalID(spec.SiteID, signal.ID)
		switch signal.Kind {
		case domain.SignalRenewableAvailability:
			if signal.AssetID == assetIDs["spiti-solar"] {
				signal.Values = solarForecast(start, 96, spec.SolarCapacityKW)
			} else {
				signal.Values = windForecast(96, spec.WindCapacityKW)
			}
		case domain.SignalServiceDemand:
			for valueIndex := range signal.Values {
				signal.Values[valueIndex] = round2(signal.Values[valueIndex] * scale)
			}
		case domain.SignalFuelDelivery:
			signal.Values = fuelDelivery(96, 72, spec.DieselCapacityKW*1.4)
		}
	}
	if spec.WindCapacityKW == 0 {
		scenario.Signals = removeAssetSignal(scenario.Signals, assetIDs["spiti-wind"])
	}

	for index := range scenario.Contracts {
		contract := &scenario.Contracts[index]
		contract.WindowStart = contract.WindowStart.Add(shift)
		contract.Deadline = contract.Deadline.Add(shift)
		if contract.MinimumPowerKW != nil {
			contract.MinimumPowerKW = floatPointer(round2(*contract.MinimumPowerKW * scale))
		}
		if contract.RequiredEnergyKWH != nil {
			contract.RequiredEnergyKWH = floatPointer(round2(*contract.RequiredEnergyKWH * scale))
		}
	}

	for index := range scenario.Events {
		event := &scenario.Events[index]
		event.Name = spec.EventNames[index]
		event.SignalID = regionalSignalID(spec.SiteID, event.SignalID)
		shiftTimePointer(event.Start, shift)
		shiftTimePointer(event.End, shift)
		shiftTimePointer(event.ScheduledAt, shift)
		shiftTimePointer(event.DelayedUntil, shift)
	}

	scenario.OperatingPolicy.ReserveEnergyKWH = spec.BatteryCapacityKWH * 0.2
	scenario.Site.Connections = regionalConnections(scenario)
	return communitySeed{Filename: spec.Filename, Scenario: scenario}
}

func cloneScenario(scenario domain.Scenario) domain.Scenario {
	data, err := json.Marshal(scenario)
	if err != nil {
		panic(fmt.Errorf("encode base scenario: %w", err))
	}
	var clone domain.Scenario
	if err := json.Unmarshal(data, &clone); err != nil {
		panic(fmt.Errorf("decode base scenario: %w", err))
	}
	return clone
}

func regionalConnections(scenario domain.Scenario) []domain.Connection {
	connections := make([]domain.Connection, 0, len(scenario.Site.Assets)+len(scenario.Site.Services))
	batteryID := ""
	for _, asset := range scenario.Site.Assets {
		if asset.Type == domain.AssetBattery {
			batteryID = asset.ID
		}
	}
	for _, asset := range scenario.Site.Assets {
		target := domain.ControllerNodeID
		if (asset.Type == domain.AssetSolar || asset.Type == domain.AssetWind) && batteryID != "" {
			target = batteryID
		}
		connections = append(connections, domain.Connection{
			ID: "connection:" + asset.ID + ":" + target, SourceID: asset.ID, TargetID: target,
		})
	}
	for _, service := range scenario.Site.Services {
		connections = append(connections, domain.Connection{
			ID: "connection:controller:" + service.ID, SourceID: domain.ControllerNodeID, TargetID: service.ID,
		})
	}
	return connections
}

func removeAsset(assets []domain.Asset, id string) []domain.Asset {
	result := assets[:0]
	for _, asset := range assets {
		if asset.ID != id {
			result = append(result, asset)
		}
	}
	return result
}

func removeAssetSignal(signals []domain.Signal, assetID string) []domain.Signal {
	result := signals[:0]
	for _, signal := range signals {
		if signal.AssetID != assetID {
			result = append(result, signal)
		}
	}
	return result
}

func regionalSignalID(siteID, id string) string {
	return strings.Replace(id, "spiti-", siteID+"-", 1)
}

func shiftTimePointer(value *time.Time, shift time.Duration) {
	if value != nil {
		*value = value.Add(shift)
	}
}

func floatPointer(value float64) *float64 {
	return &value
}
