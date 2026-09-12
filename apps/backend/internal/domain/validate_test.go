package domain

import (
	"strings"
	"testing"
	"time"
)

func TestValidateScenarioAcceptsValidScenario(t *testing.T) {
	if err := ValidateScenario(validScenario()); err != nil {
		t.Fatalf("expected valid scenario, got %v", err)
	}
}

func TestValidateScenarioRejectsWrongPlanningGrid(t *testing.T) {
	scenario := validScenario()
	scenario.Horizon.IntervalCount = 95

	assertValidationError(t, scenario, "interval_count must be 96")
}

func TestValidateScenarioRejectsSignalWithMissingIntervals(t *testing.T) {
	scenario := validScenario()
	scenario.Signals[0].Values = scenario.Signals[0].Values[:95]

	assertValidationError(t, scenario, "must contain 96 values")
}

func TestValidateScenarioRejectsSignalWithUnknownAsset(t *testing.T) {
	scenario := validScenario()
	scenario.Signals[0].AssetID = "missing-solar"

	assertValidationError(t, scenario, "asset_id does not reference an asset")
}

func TestValidateScenarioRejectsContractWithoutItsTypedTarget(t *testing.T) {
	scenario := validScenario()
	scenario.Contracts[0].MinimumPowerKW = nil

	assertValidationError(t, scenario, "minimum_power_kw must be positive")
}

func TestValidateScenarioRejectsRenewableOutputAboveCapacity(t *testing.T) {
	scenario := validScenario()
	scenario.Signals[0].Values[20] = 51

	assertValidationError(t, scenario, "exceeds asset capacity")
}

func TestValidateScenarioRejectsBatteryStateOutsideBounds(t *testing.T) {
	scenario := validScenario()
	scenario.InitialState.Assets[0].StoredEnergyKWH = float64Pointer(101)

	assertValidationError(t, scenario, "exceeds battery capacity")
}

func assertValidationError(t *testing.T, scenario Scenario, expected string) {
	t.Helper()
	err := ValidateScenario(scenario)
	if err == nil {
		t.Fatalf("expected an error containing %q", expected)
	}
	if !strings.Contains(err.Error(), expected) {
		t.Fatalf("expected error containing %q, got %q", expected, err)
	}
}

func validScenario() Scenario {
	startsAt := time.Date(2026, 9, 12, 6, 0, 0, 0, time.FixedZone("IST", 5*60*60+30*60))
	endsAt := startsAt.Add(24 * time.Hour)
	capacity := 50.0
	batteryCapacity := 100.0
	batteryMinimum := 10.0
	chargeLimit := 30.0
	dischargeLimit := 30.0
	efficiency := 0.95
	dieselMinimum := 5.0
	dieselMaximum := 40.0
	litersPerKWH := 0.27
	fuelCost := 1.25
	emissions := 2.68
	storedEnergy := 60.0
	fuelAvailable := 40.0
	running := false
	minimumPower := 0.8

	return Scenario{
		SchemaVersion: "1",
		ID:            "valid-scenario",
		Name:          "Valid scenario",
		Description:   "A complete scenario used by validation tests.",
		Site: Site{
			ID:       "test-site",
			Name:     "Test Site",
			Location: "Himachal Pradesh, India",
			Timezone: "Asia/Kolkata",
			Currency: "INR",
			Assets: []Asset{
				{ID: "solar", Name: "Solar", Type: AssetSolar, CapacityKW: &capacity},
				{
					ID: "battery", Name: "Battery", Type: AssetBattery,
					CapacityKWH: &batteryCapacity, MinimumStoredEnergyKWH: &batteryMinimum,
					MaxChargeKW: &chargeLimit, MaxDischargeKW: &dischargeLimit,
					ChargeEfficiency: &efficiency, DischargeEfficiency: &efficiency,
				},
				{
					ID: "diesel", Name: "Diesel", Type: AssetDiesel,
					MinimumOutputKW: &dieselMinimum, MaximumOutputKW: &dieselMaximum,
					LitersPerKWH: &litersPerKWH, FuelCostPerLiter: &fuelCost,
					EmissionsKGCO2PerLiter: &emissions,
				},
			},
			Services: []Service{
				{ID: "clinic", Name: "Clinic", Description: "Vaccine cold chain", ControlMode: ControlFixed, RatedPowerKW: 0.8},
			},
		},
		Horizon: PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		InitialState: InitialState{Assets: []AssetState{
			{AssetID: "battery", Type: AssetBattery, StoredEnergyKWH: &storedEnergy},
			{AssetID: "diesel", Type: AssetDiesel, FuelAvailableLiters: &fuelAvailable, Running: &running},
		}},
		Signals: []Signal{
			{ID: "solar-forecast", Kind: SignalRenewableAvailability, AssetID: "solar", Unit: "kW", Values: repeatedValues(96, 25)},
			{ID: "clinic-demand", Kind: SignalServiceDemand, ServiceID: "clinic", Unit: "kW", Values: repeatedValues(96, 0.8)},
		},
		Contracts: []Contract{
			{ID: "clinic-always-on", Name: "Clinic always on", ServiceID: "clinic", Kind: ContractContinuousPower, Priority: PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &minimumPower},
		},
		OperatingPolicy: OperatingPolicy{ReserveEnergyKWH: 20, AssumedLossPercent: 0.03},
	}
}

func repeatedValues(count int, value float64) []float64 {
	values := make([]float64, count)
	for index := range values {
		values[index] = value
	}
	return values
}

func float64Pointer(value float64) *float64 {
	return &value
}
