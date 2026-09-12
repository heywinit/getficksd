package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func main() {
	output := flag.String("output", "seeddata/spiti-valley-default.json", "path for the generated scenario")
	flag.Parse()

	scenario := spitiValleyScenario()
	domain.NormalizeScenarioConnections(&scenario)
	if err := domain.ValidateScenario(scenario); err != nil {
		panic(fmt.Errorf("validate seed scenario: %w", err))
	}

	data, err := json.MarshalIndent(scenario, "", "  ")
	if err != nil {
		panic(fmt.Errorf("encode seed scenario: %w", err))
	}
	data = append(data, '\n')
	if err := os.WriteFile(*output, data, 0o644); err != nil {
		panic(fmt.Errorf("write seed scenario: %w", err))
	}
}

func spitiValleyScenario() domain.Scenario {
	startsAt := mustTime("2026-10-18T00:00:00+05:30")
	endsAt := startsAt.Add(24 * time.Hour)
	solarCapacity := 220.0
	windCapacity := 60.0
	batteryCapacity := 900.0
	batteryMinimum := 90.0
	batteryChargeLimit := 180.0
	batteryDischargeLimit := 180.0
	chargeEfficiency := 0.95
	dischargeEfficiency := 0.94
	dieselMinimum := 35.0
	dieselMaximum := 160.0
	litersPerKWH := 0.265
	startupFuelLiters := 1.2
	minimumRuntimeMinutes := 45
	rampRateKWPerMinute := 5.0
	fuelCost := 95.0
	emissions := 2.68
	storedEnergy := 540.0
	fuelAvailable := 320.0
	dieselRunning := false
	healthCenterPower := 10.0
	telecomPower := 4.0
	coldStoragePower := 18.0
	streetLightPower := 12.0
	pumpRuntimeMinutes := 240
	schoolEnergyKWH := 90.0
	businessEnergyKWH := 200.0
	cloudStart := atHour(startsAt, 10.5)
	cloudEnd := atHour(startsAt, 15.5)
	cloudMultiplier := 0.35
	surgeStart := atHour(startsAt, 17.5)
	surgeEnd := atHour(startsAt, 20.5)
	surgeMultiplier := 1.15
	fuelScheduledAt := atHour(startsAt, 18)
	fuelDelayedUntil := atHour(startsAt, 22)
	waterWindowStart := atHour(startsAt, 6)
	waterDeadline := atHour(startsAt, 20)
	schoolWindowStart := atHour(startsAt, 8)
	schoolDeadline := atHour(startsAt, 17)
	businessWindowStart := atHour(startsAt, 8)
	businessDeadline := atHour(startsAt, 20)
	lightingWindowStart := atHour(startsAt, 18)

	return domain.Scenario{
		SchemaVersion: "1",
		Revision:      1,
		ID:            "spiti-valley-community-v2",
		Name:          "Spiti Valley community operations",
		Description:   "A full operating day for village homes, health care, communications, water, education, businesses, lighting, and food storage during an autumn supply disruption.",
		Site: domain.Site{
			ID:       "spiti-valley",
			Name:     "Spiti Valley Community Grid",
			Location: "Himachal Pradesh, India",
			Timezone: "Asia/Kolkata",
			Currency: "INR",
			Assets: []domain.Asset{
				{ID: "spiti-solar", Name: "Village solar plant", Type: domain.AssetSolar, CapacityKW: &solarCapacity},
				{ID: "spiti-wind", Name: "Ridge wind plant", Type: domain.AssetWind, CapacityKW: &windCapacity},
				{
					ID: "spiti-battery", Name: "Battery energy system", Type: domain.AssetBattery,
					CapacityKWH: &batteryCapacity, MinimumStoredEnergyKWH: &batteryMinimum,
					MaxChargeKW: &batteryChargeLimit, MaxDischargeKW: &batteryDischargeLimit,
					ChargeEfficiency: &chargeEfficiency, DischargeEfficiency: &dischargeEfficiency,
				},
				{
					ID: "spiti-diesel", Name: "Community diesel generator", Type: domain.AssetDiesel,
					MinimumOutputKW: &dieselMinimum, MaximumOutputKW: &dieselMaximum,
					LitersPerKWH: &litersPerKWH, StartupFuelLiters: &startupFuelLiters,
					MinimumRuntimeMinutes: &minimumRuntimeMinutes, RampRateKWPerMinute: &rampRateKWPerMinute,
					FuelCostPerLiter:       &fuelCost,
					EmissionsKGCO2PerLiter: &emissions,
				},
			},
			Services: []domain.Service{
				{ID: "health-center", Name: "Health center", Description: "Clinical equipment, refrigeration, heating controls, lighting, and emergency treatment rooms.", ControlMode: domain.ControlFixed, RatedPowerKW: 18},
				{ID: "telecom-network", Name: "Telecom network", Description: "Mobile towers, radio links, and emergency communications.", ControlMode: domain.ControlFixed, RatedPowerKW: 6},
				{ID: "drinking-water", Name: "Drinking water system", Description: "Well pumps, treatment equipment, and the elevated storage tank.", ControlMode: domain.ControlShiftable, RatedPowerKW: 32},
				{ID: "school-campus", Name: "School and community center", Description: "Classrooms, computers, kitchen equipment, and the public meeting hall.", ControlMode: domain.ControlShiftable, RatedPowerKW: 30},
				{ID: "small-businesses", Name: "Shops and workshops", Description: "Food preparation, tools, retail refrigeration, and local services.", ControlMode: domain.ControlCurtailable, RatedPowerKW: 70},
				{ID: "households", Name: "Village households", Description: "Lighting, cooking, heating circulation, appliances, and device charging.", ControlMode: domain.ControlCurtailable, RatedPowerKW: 140},
				{ID: "street-lighting", Name: "Street lighting", Description: "Road, footpath, and public safety lighting after sunset.", ControlMode: domain.ControlFixed, RatedPowerKW: 18},
				{ID: "food-cold-storage", Name: "Food cold storage", Description: "Community produce, dairy, and winter food preservation.", ControlMode: domain.ControlFixed, RatedPowerKW: 28},
			},
		},
		Horizon: domain.PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		InitialState: domain.InitialState{Assets: []domain.AssetState{
			{AssetID: "spiti-battery", Type: domain.AssetBattery, StoredEnergyKWH: &storedEnergy},
			{AssetID: "spiti-diesel", Type: domain.AssetDiesel, FuelAvailableLiters: &fuelAvailable, Running: &dieselRunning},
		}},
		Signals: []domain.Signal{
			{ID: "spiti-solar-forecast", Kind: domain.SignalRenewableAvailability, AssetID: "spiti-solar", Unit: "kW", Values: solarForecast(startsAt, 96, solarCapacity)},
			{ID: "spiti-wind-forecast", Kind: domain.SignalRenewableAvailability, AssetID: "spiti-wind", Unit: "kW", Values: windForecast(96, windCapacity)},
			{ID: "health-center-demand", Kind: domain.SignalServiceDemand, ServiceID: "health-center", Unit: "kW", Values: healthCenterDemand(96)},
			{ID: "telecom-demand", Kind: domain.SignalServiceDemand, ServiceID: "telecom-network", Unit: "kW", Values: constantValues(96, 4.5)},
			{ID: "water-demand", Kind: domain.SignalServiceDemand, ServiceID: "drinking-water", Unit: "kW", Values: constantValues(96, 32)},
			{ID: "school-demand", Kind: domain.SignalServiceDemand, ServiceID: "school-campus", Unit: "kW", Values: constantValues(96, 30)},
			{ID: "business-demand", Kind: domain.SignalServiceDemand, ServiceID: "small-businesses", Unit: "kW", Values: businessDemand(96)},
			{ID: "household-demand", Kind: domain.SignalServiceDemand, ServiceID: "households", Unit: "kW", Values: householdDemand(96)},
			{ID: "street-lighting-demand", Kind: domain.SignalServiceDemand, ServiceID: "street-lighting", Unit: "kW", Values: streetLightingDemand(96)},
			{ID: "cold-storage-demand", Kind: domain.SignalServiceDemand, ServiceID: "food-cold-storage", Unit: "kW", Values: coldStorageDemand(96)},
			{ID: "diesel-delivery", Kind: domain.SignalFuelDelivery, AssetID: "spiti-diesel", Unit: "liters", Values: fuelDelivery(96, 72, 220)},
		},
		Contracts: []domain.Contract{
			{ID: "health-center-continuity", Name: "Keep the health center operational", ServiceID: "health-center", Kind: domain.ContractContinuousPower, Priority: domain.PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &healthCenterPower},
			{ID: "telecom-continuity", Name: "Keep emergency communications online", ServiceID: "telecom-network", Kind: domain.ContractContinuousPower, Priority: domain.PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &telecomPower},
			{ID: "cold-storage-continuity", Name: "Protect community food storage", ServiceID: "food-cold-storage", Kind: domain.ContractContinuousPower, Priority: domain.PriorityEssential, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &coldStoragePower},
			{ID: "water-storage-daily", Name: "Fill drinking water storage before evening", ServiceID: "drinking-water", Kind: domain.ContractRuntimeDeadline, Priority: domain.PriorityEssential, WindowStart: waterWindowStart, Deadline: waterDeadline, RequiredRuntimeMinutes: &pumpRuntimeMinutes},
			{ID: "school-day-energy", Name: "Supply the school day", ServiceID: "school-campus", Kind: domain.ContractEnergyDeadline, Priority: domain.PriorityEssential, WindowStart: schoolWindowStart, Deadline: schoolDeadline, RequiredEnergyKWH: &schoolEnergyKWH},
			{ID: "street-lighting-safety", Name: "Keep public lighting on after sunset", ServiceID: "street-lighting", Kind: domain.ContractContinuousPower, Priority: domain.PriorityEssential, WindowStart: lightingWindowStart, Deadline: endsAt, MinimumPowerKW: &streetLightPower},
			{ID: "business-energy-window", Name: "Provide a productive business window", ServiceID: "small-businesses", Kind: domain.ContractEnergyDeadline, Priority: domain.PriorityFlexible, WindowStart: businessWindowStart, Deadline: businessDeadline, RequiredEnergyKWH: &businessEnergyKWH},
		},
		Events: []domain.ScenarioEvent{
			{ID: "midday-cloud-cover", Name: "Dense midday cloud cover", Type: domain.EventRenewableShortfall, SignalID: "spiti-solar-forecast", Start: &cloudStart, End: &cloudEnd, AvailabilityMultiplier: &cloudMultiplier},
			{ID: "evening-household-surge", Name: "Evening household demand surge", Type: domain.EventDemandSurge, SignalID: "household-demand", Start: &surgeStart, End: &surgeEnd, DemandMultiplier: &surgeMultiplier},
			{ID: "evening-fuel-delay", Name: "Diesel delivery arrives late", Type: domain.EventFuelDeliveryDelay, SignalID: "diesel-delivery", ScheduledAt: &fuelScheduledAt, DelayedUntil: &fuelDelayedUntil},
		},
		OperatingPolicy: domain.OperatingPolicy{ReserveEnergyKWH: 180, AssumedLossPercent: 0.05},
	}
}

func solarForecast(startsAt time.Time, count int, capacity float64) []float64 {
	values := make([]float64, count)
	for index := range values {
		at := startsAt.Add(time.Duration(index*15) * time.Minute)
		hour := float64(at.Hour()) + float64(at.Minute())/60
		if hour <= 6 || hour >= 18 {
			continue
		}
		sun := math.Pow(math.Sin(math.Pi*(hour-6)/12), 1.5)
		cloudFactor := 0.96 + 0.04*math.Sin(float64(index)*0.7)
		values[index] = round2(math.Min(capacity, capacity*sun*cloudFactor))
	}
	return values
}

func windForecast(count int, capacity float64) []float64 {
	values := make([]float64, count)
	for index := range values {
		value := 29 + 13*math.Sin(2*math.Pi*float64(index+8)/96) + 7*math.Sin(2*math.Pi*float64(index)/24)
		values[index] = round2(math.Max(0, math.Min(capacity, value)))
	}
	return values
}

func healthCenterDemand(count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		hour := intervalHour(index)
		value := 10 + 3*gaussian(hour, 8, 1.7) + 4*gaussian(hour, 18, 2.5)
		values[index] = round2(math.Min(18, value))
	}
	return values
}

func businessDemand(count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		hour := intervalHour(index)
		if hour < 7 || hour >= 20 {
			continue
		}
		value := 10 + 42*gaussian(hour, 13, 3.2) + 12*gaussian(hour, 18, 1.8)
		values[index] = round2(math.Min(70, value))
	}
	return values
}

func householdDemand(count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		hour := intervalHour(index)
		value := 22 + 36*gaussian(hour, 7.5, 1.6) + 98*gaussian(hour, 19.5, 2.2)
		values[index] = round2(math.Min(120, value))
	}
	return values
}

func streetLightingDemand(count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		hour := intervalHour(index)
		if hour < 6 {
			values[index] = 14
		} else if hour >= 18 {
			values[index] = 16
		}
	}
	return values
}

func coldStorageDemand(count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		hour := intervalHour(index)
		values[index] = round2(20 + 3*math.Sin(2*math.Pi*(hour-9)/24))
	}
	return values
}

func intervalHour(index int) float64 {
	return float64(index) * 0.25
}

func atHour(start time.Time, hour float64) time.Time {
	return start.Add(time.Duration(hour * float64(time.Hour)))
}

func gaussian(value, center, width float64) float64 {
	delta := value - center
	return math.Exp(-(delta * delta) / (2 * width * width))
}

func fuelDelivery(count, interval int, liters float64) []float64 {
	values := make([]float64, count)
	values[interval] = liters
	return values
}

func constantValues(count int, value float64) []float64 {
	values := make([]float64, count)
	for index := range values {
		values[index] = value
	}
	return values
}

func mustTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}
