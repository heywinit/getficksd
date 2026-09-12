package scheduler

import (
	"math"
	"strings"
	"testing"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestVerifyOptimizerSolutionAcceptsPhysicalPlan(t *testing.T) {
	input, solution := validOptimizerVerificationFixture()
	if err := verifyOptimizerSolution(input, solution); err != nil {
		t.Fatalf("verify physical optimizer solution: %v", err)
	}
}

func TestVerifyOptimizerSolutionRejectsMalformedAndImpossiblePlans(t *testing.T) {
	tests := []struct {
		name   string
		want   string
		mutate func(*optimizerInput, *optimizerSolution)
	}{
		{name: "unusable status", want: "termination status", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.Status = "infeasible" }},
		{name: "non-finite value", want: "invalid value", mutate: func(_ *optimizerInput, solution *optimizerSolution) {
			solution.ServiceDeliveredKW["load"][0] = math.NaN()
		}},
		{name: "unknown ID", want: "IDs", mutate: func(_ *optimizerInput, solution *optimizerSolution) {
			solution.RenewableUsedKW["unknown"] = []float64{0, 0}
		}},
		{name: "wrong vector length", want: "intervals", mutate: func(_ *optimizerInput, solution *optimizerSolution) {
			solution.BatteryChargeKW["battery"] = []float64{0}
		}},
		{name: "renewable over availability", want: "exceeds availability", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.RenewableUsedKW["solar"][0] = 3 }},
		{name: "service over request", want: "delivery exceeds", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.ServiceDeliveredKW["load"][0] = 3 }},
		{name: "fixed request below demand", want: "less than demand", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.ServiceRequestedKW["load"][0] = 1 }},
		{name: "AC imbalance", want: "AC power does not balance", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.DumpedPowerKW[0] = 0.5 }},
		{name: "battery transition", want: "energy does not balance", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.BatteryChargeKW["battery"][0] = 1 }},
		{name: "battery simultaneous modes", want: "charges and discharges", mutate: func(_ *optimizerInput, solution *optimizerSolution) {
			solution.BatteryChargeKW["battery"][0] = 1
			solution.BatteryDischargeKW["battery"][0] = 1
		}},
		{name: "battery below reserve", want: "outside bounds", mutate: func(input *optimizerInput, solution *optimizerSolution) {
			input.InitialEnergyKWH["battery"] = 0
			solution.BatteryEnergyKWH["battery"][0] = 0
			solution.BatteryEnergyKWH["battery"][1] = 0
		}},
		{name: "generator running mismatch", want: "while stopped", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.GeneratorRunning["diesel"][0] = false }},
		{name: "generator startup mismatch", want: "startup flag", mutate: func(_ *optimizerInput, solution *optimizerSolution) { solution.GeneratorStarted["diesel"][0] = false }},
		{name: "generator ramp", want: "ramp limit", mutate: func(input *optimizerInput, solution *optimizerSolution) {
			*input.Assets[2].RampRateKWPerMinute = 0.01
			solution.GeneratorOutputKW["diesel"][0] = 1
		}},
		{name: "generator fuel", want: "exhausts its fuel", mutate: func(input *optimizerInput, _ *optimizerSolution) { input.InitialFuelLiters["diesel"] = 0.1 }},
		{name: "generator minimum runtime", want: "minimum runtime", mutate: func(input *optimizerInput, solution *optimizerSolution) {
			minimumRuntime := 30
			input.Assets[2].MinimumRuntimeMinutes = &minimumRuntime
			solution.GeneratorOutputKW["diesel"][1] = 0
			solution.GeneratorRunning["diesel"][1] = false
		}},
		{name: "renewable topology", want: "disconnected renewable", mutate: func(input *optimizerInput, _ *optimizerSolution) { input.ConnectedAssets["solar"] = false }},
		{name: "battery topology", want: "unchargeable battery", mutate: func(input *optimizerInput, solution *optimizerSolution) {
			input.ChargeableBatteries["battery"] = false
			solution.BatteryChargeKW["battery"][0] = 1
		}},
		{name: "service topology", want: "disconnected service", mutate: func(input *optimizerInput, _ *optimizerSolution) { input.ConnectedServices["load"] = false }},
		{name: "generator topology", want: "disconnected generator", mutate: func(input *optimizerInput, _ *optimizerSolution) { input.ConnectedAssets["diesel"] = false }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input, solution := validOptimizerVerificationFixture()
			test.mutate(&input, &solution)
			err := verifyOptimizerSolution(input, solution)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want one containing %q", err, test.want)
			}
		})
	}
}

func validOptimizerVerificationFixture() (optimizerInput, optimizerSolution) {
	capacity := 10.0
	minimumEnergy := 1.0
	maximumCharge := 2.0
	maximumDischarge := 2.0
	efficiency := 1.0
	minimumOutput := 1.0
	maximumOutput := 5.0
	litersPerKWH := 0.25
	startupFuel := 0.1
	minimumRuntime := 15
	rampRate := 10.0
	input := optimizerInput{
		IntervalMinutes: 15,
		IntervalCount:   2,
		LossFactor:      1,
		Assets: []domain.Asset{
			{ID: "solar", Type: domain.AssetSolar, CapacityKW: &capacity},
			{ID: "battery", Type: domain.AssetBattery, CapacityKWH: &capacity, MinimumStoredEnergyKWH: &minimumEnergy, MaxChargeKW: &maximumCharge, MaxDischargeKW: &maximumDischarge, ChargeEfficiency: &efficiency, DischargeEfficiency: &efficiency},
			{ID: "diesel", Type: domain.AssetDiesel, MinimumOutputKW: &minimumOutput, MaximumOutputKW: &maximumOutput, LitersPerKWH: &litersPerKWH, StartupFuelLiters: &startupFuel, MinimumRuntimeMinutes: &minimumRuntime, RampRateKWPerMinute: &rampRate},
		},
		Services:                []domain.Service{{ID: "load", ControlMode: domain.ControlFixed, RatedPowerKW: 5}},
		RenewableAvailabilityKW: map[string][]float64{"solar": {2, 2}},
		ServiceDemandKW:         map[string][]float64{"load": {2, 2}},
		FuelDeliveryLiters:      map[string][]float64{"diesel": {0, 0}},
		InitialEnergyKWH:        map[string]float64{"battery": 5},
		InitialFuelLiters:       map[string]float64{"diesel": 10},
		InitialRunning:          map[string]bool{"diesel": false},
		ConnectedAssets:         map[string]bool{"solar": true, "battery": true, "diesel": true},
		ChargeableBatteries:     map[string]bool{"battery": true},
		ConnectedServices:       map[string]bool{"load": true},
		PolicyMinimumKWH:        map[string]float64{"battery": 1},
		PhysicalMinimumKWH:      map[string]float64{"battery": 1},
	}
	solution := optimizerSolution{
		Status:             "optimal",
		ObjectiveValue:     1,
		MIPGap:             0,
		SolveMS:            5,
		ServiceRequestedKW: map[string][]float64{"load": {2, 2}},
		ServiceDeliveredKW: map[string][]float64{"load": {2, 2}},
		RenewableUsedKW:    map[string][]float64{"solar": {1, 1}},
		BatteryChargeKW:    map[string][]float64{"battery": {0, 0}},
		BatteryDischargeKW: map[string][]float64{"battery": {0, 0}},
		BatteryEnergyKWH:   map[string][]float64{"battery": {5, 5}},
		GeneratorOutputKW:  map[string][]float64{"diesel": {1, 1}},
		GeneratorRunning:   map[string][]bool{"diesel": {true, true}},
		GeneratorStarted:   map[string][]bool{"diesel": {true, false}},
		DumpedPowerKW:      []float64{0, 0},
	}
	return input, solution
}
