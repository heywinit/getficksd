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
	startsAt := mustTime("2026-09-12T06:00:00+05:30")
	endsAt := startsAt.Add(24 * time.Hour)
	solarCapacity := 120.0
	windCapacity := 35.0
	batteryCapacity := 360.0
	batteryMinimum := 36.0
	batteryChargeLimit := 90.0
	batteryDischargeLimit := 90.0
	chargeEfficiency := 0.95
	dischargeEfficiency := 0.94
	dieselMinimum := 10.0
	dieselMaximum := 80.0
	litersPerKWH := 0.27
	fuelCost := 95.0
	emissions := 2.68
	storedEnergy := 234.0
	fuelAvailable := 60.0
	dieselRunning := false
	clinicPower := 0.8
	pumpRuntimeMinutes := 120
	shortfallStart := mustTime("2026-09-12T10:30:00+05:30")
	shortfallEnd := mustTime("2026-09-12T15:30:00+05:30")
	shortfallMultiplier := 0.45
	fuelScheduledAt := mustTime("2026-09-12T18:00:00+05:30")
	fuelDelayedUntil := mustTime("2026-09-12T23:00:00+05:30")

	return domain.Scenario{
		SchemaVersion: "1",
		Revision:      1,
		ID:            "spiti-valley-default",
		Name:          "Spiti Valley operating day",
		Description:   "A clear autumn day with a possible midday solar shortfall and a delayed evening fuel delivery.",
		Site: domain.Site{
			ID:       "spiti-valley",
			Name:     "Spiti Valley Community Grid",
			Location: "Himachal Pradesh, India",
			Timezone: "Asia/Kolkata",
			Currency: "INR",
			Assets: []domain.Asset{
				{ID: "spiti-solar", Name: "Community solar array", Type: domain.AssetSolar, CapacityKW: &solarCapacity},
				{ID: "spiti-wind", Name: "Ridge wind turbines", Type: domain.AssetWind, CapacityKW: &windCapacity},
				{
					ID: "spiti-battery", Name: "Community battery", Type: domain.AssetBattery,
					CapacityKWH: &batteryCapacity, MinimumStoredEnergyKWH: &batteryMinimum,
					MaxChargeKW: &batteryChargeLimit, MaxDischargeKW: &batteryDischargeLimit,
					ChargeEfficiency: &chargeEfficiency, DischargeEfficiency: &dischargeEfficiency,
				},
				{
					ID: "spiti-diesel", Name: "Backup diesel generator", Type: domain.AssetDiesel,
					MinimumOutputKW: &dieselMinimum, MaximumOutputKW: &dieselMaximum,
					LitersPerKWH: &litersPerKWH, FuelCostPerLiter: &fuelCost,
					EmissionsKGCO2PerLiter: &emissions,
				},
			},
			Services: []domain.Service{
				{ID: "clinic-cold-chain", Name: "Clinic cold chain", Description: "Keeps vaccines and medicine refrigerated.", ControlMode: domain.ControlFixed, RatedPowerKW: 0.8},
				{ID: "water-supply", Name: "Water supply", Description: "Pumps water into the village storage tank.", ControlMode: domain.ControlShiftable, RatedPowerKW: 8},
				{ID: "flexible-homes", Name: "Flexible homes", Description: "Household demand that can be reduced briefly when supply is tight.", ControlMode: domain.ControlCurtailable, RatedPowerKW: 85},
			},
		},
		Horizon: domain.PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		InitialState: domain.InitialState{Assets: []domain.AssetState{
			{AssetID: "spiti-battery", Type: domain.AssetBattery, StoredEnergyKWH: &storedEnergy},
			{AssetID: "spiti-diesel", Type: domain.AssetDiesel, FuelAvailableLiters: &fuelAvailable, Running: &dieselRunning},
		}},
		Signals: []domain.Signal{
			{ID: "spiti-solar-forecast", Kind: domain.SignalRenewableAvailability, AssetID: "spiti-solar", Unit: "kW", Values: solarForecast(startsAt, 96, solarCapacity)},
			{ID: "spiti-wind-forecast", Kind: domain.SignalRenewableAvailability, AssetID: "spiti-wind", Unit: "kW", Values: windForecast(96)},
			{ID: "clinic-demand", Kind: domain.SignalServiceDemand, ServiceID: "clinic-cold-chain", Unit: "kW", Values: constantValues(96, 0.8)},
			{ID: "water-demand", Kind: domain.SignalServiceDemand, ServiceID: "water-supply", Unit: "kW", Values: constantValues(96, 8)},
			{ID: "homes-demand", Kind: domain.SignalServiceDemand, ServiceID: "flexible-homes", Unit: "kW", Values: homesDemand(startsAt, 96)},
			{ID: "diesel-delivery", Kind: domain.SignalFuelDelivery, AssetID: "spiti-diesel", Unit: "liters", Values: fuelDelivery(96, 48, 80)},
		},
		Contracts: []domain.Contract{
			{ID: "clinic-always-on", Name: "Keep the clinic cold chain powered", ServiceID: "clinic-cold-chain", Kind: domain.ContractContinuousPower, Priority: domain.PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &clinicPower},
			{ID: "water-before-morning", Name: "Fill the water tank before morning", ServiceID: "water-supply", Kind: domain.ContractRuntimeDeadline, Priority: domain.PriorityEssential, WindowStart: fuelScheduledAt, Deadline: endsAt, RequiredRuntimeMinutes: &pumpRuntimeMinutes},
		},
		Events: []domain.ScenarioEvent{
			{ID: "midday-solar-shortfall", Name: "Midday solar output falls", Type: domain.EventRenewableShortfall, SignalID: "spiti-solar-forecast", Start: &shortfallStart, End: &shortfallEnd, AvailabilityMultiplier: &shortfallMultiplier},
			{ID: "evening-fuel-delay", Name: "Diesel delivery arrives late", Type: domain.EventFuelDeliveryDelay, SignalID: "diesel-delivery", ScheduledAt: &fuelScheduledAt, DelayedUntil: &fuelDelayedUntil},
		},
		OperatingPolicy: domain.OperatingPolicy{ReserveEnergyKWH: 72, AssumedLossPercent: 0.03},
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

func windForecast(count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		value := 18 + 7*math.Sin(2*math.Pi*float64(index+8)/96) + 4*math.Sin(2*math.Pi*float64(index)/24)
		values[index] = round2(math.Max(0, math.Min(35, value)))
	}
	return values
}

func homesDemand(startsAt time.Time, count int) []float64 {
	values := make([]float64, count)
	for index := range values {
		at := startsAt.Add(time.Duration(index*15) * time.Minute)
		hour := float64(at.Hour()) + float64(at.Minute())/60
		value := 18 + 24*gaussian(hour, 8, 1.5) + 10*gaussian(hour, 13, 2.8) + 52*gaussian(hour, 19, 2)
		values[index] = round2(math.Min(85, value))
	}
	return values
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
