package scheduler

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestSeedScenarioMeetsEveryContractDuringActiveEvents(t *testing.T) {
	scenario := loadSeedScenario(t)
	planner := deterministicScheduler()
	run, err := planner.Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID:     scenario.ID,
		Planner:        domain.PlannerWattson,
		ActiveEventIDs: []string{"midday-cloud-cover", "evening-household-surge", "evening-fuel-delay"},
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}

	if run.Status != domain.PlanComplete {
		t.Fatalf("expected a complete plan, got %q", run.Status)
	}
	if len(run.Intervals) != scenario.Horizon.IntervalCount {
		t.Fatalf("expected %d intervals, got %d", scenario.Horizon.IntervalCount, len(run.Intervals))
	}
	if run.Summary.ContractsMet != len(scenario.Contracts) || run.Summary.ContractsBreached != 0 {
		t.Fatalf("unexpected contract summary: %#v", run.Summary)
	}
	for _, outcome := range run.ContractOutcomes {
		if outcome.Status != domain.ContractMet || outcome.Shortfall > epsilon {
			t.Fatalf("contract %q was not met: %#v", outcome.ContractID, outcome)
		}
	}

	healthCenter := outcomeByID(t, run, "health-center-continuity")
	if healthCenter.DeliveredRuntimeMinutes != 24*60 {
		t.Fatalf("expected full-day health center runtime, got %d minutes", healthCenter.DeliveredRuntimeMinutes)
	}
	water := outcomeByID(t, run, "water-storage-daily")
	if water.DeliveredRuntimeMinutes < 240 {
		t.Fatalf("expected at least 240 water-pump minutes, got %d", water.DeliveredRuntimeMinutes)
	}
	if run.Summary.MinimumBatteryEnergyKWH < 90-epsilon {
		t.Fatalf("battery crossed its physical minimum: %.3f kWh", run.Summary.MinimumBatteryEnergyKWH)
	}
	if len(run.Decisions) == 0 {
		t.Fatal("expected explainable scheduling decisions")
	}

	forecast := signalByID(t, scenario, "spiti-solar-forecast")
	if run.Intervals[44].Renewables[0].AvailableKW >= forecast.Values[44] {
		t.Fatal("active solar-shortfall event did not reduce renewable availability")
	}
}

func TestActiveEventsTransformTheirSignals(t *testing.T) {
	scenario := loadSeedScenario(t)
	prepared, err := prepareScenario(scenario, []string{"midday-cloud-cover", "evening-fuel-delay"})
	if err != nil {
		t.Fatalf("prepare active events: %v", err)
	}
	solar := signalByID(t, scenario, "spiti-solar-forecast")
	if difference := prepared.renewableSignals["spiti-solar"][44] - solar.Values[44]*0.35; math.Abs(difference) > epsilon {
		t.Fatalf("solar event multiplier was not applied: difference %.6f", difference)
	}
	if prepared.fuelSignals["spiti-diesel"][72] != 0 || prepared.fuelSignals["spiti-diesel"][88] != 220 {
		t.Fatalf("fuel delivery was not moved to the delayed interval: %#v", prepared.fuelSignals["spiti-diesel"][72:89])
	}

	multiplier := 1.5
	start := scenario.Horizon.StartsAt
	end := start.Add(15 * time.Minute)
	scenario.Events = append(scenario.Events, domain.ScenarioEvent{
		ID: "test-demand-surge", Name: "Demand surge", Type: domain.EventDemandSurge, SignalID: "household-demand",
		Start: &start, End: &end, DemandMultiplier: &multiplier,
	})
	prepared, err = prepareScenario(scenario, []string{"test-demand-surge"})
	if err != nil {
		t.Fatalf("prepare demand event: %v", err)
	}
	homes := signalByID(t, scenario, "household-demand")
	if difference := prepared.demandSignals["households"][0] - homes.Values[0]*multiplier; math.Abs(difference) > epsilon {
		t.Fatalf("demand multiplier was not applied: difference %.6f", difference)
	}
}

func TestAssetOutageLimitsRenewableBatteryAndDieselDispatch(t *testing.T) {
	tests := []struct {
		name       string
		assetID    string
		multiplier float64
		scenario   func() domain.Scenario
		assert     func(*testing.T, domain.PlanInterval)
	}{
		{
			name: "renewable", assetID: "solar", multiplier: 0,
			scenario: func() domain.Scenario { return scarceSupplyScenario(5) },
			assert: func(t *testing.T, interval domain.PlanInterval) {
				if got := interval.Renewables[0].AvailableKW; got != 0 {
					t.Fatalf("renewable availability = %.3f, want 0", got)
				}
			},
		},
		{
			name: "battery discharge", assetID: "battery", multiplier: 0.25,
			scenario: func() domain.Scenario {
				scenario := scarceSupplyScenario(0)
				capacity, minimum, limit, efficiency, stored := 10.0, 0.0, 4.0, 1.0, 10.0
				scenario.Site.Assets = append(scenario.Site.Assets, domain.Asset{
					ID: "battery", Name: "Battery", Type: domain.AssetBattery,
					CapacityKWH: &capacity, MinimumStoredEnergyKWH: &minimum,
					MaxChargeKW: &limit, MaxDischargeKW: &limit,
					ChargeEfficiency: &efficiency, DischargeEfficiency: &efficiency,
				})
				scenario.InitialState.Assets = []domain.AssetState{{AssetID: "battery", Type: domain.AssetBattery, StoredEnergyKWH: &stored}}
				return scenario
			},
			assert: func(t *testing.T, interval domain.PlanInterval) {
				if got := interval.Batteries[0].DischargeKW; got > 1+epsilon {
					t.Fatalf("battery discharge = %.3f kW, want at most 1 kW", got)
				}
			},
		},
		{
			name: "diesel", assetID: "generator", multiplier: 0.25,
			scenario: generatorScenario,
			assert: func(t *testing.T, interval domain.PlanInterval) {
				if got := interval.Generators[0].OutputKW; got > 0.5+epsilon {
					t.Fatalf("diesel output = %.3f kW, want at most 0.5 kW", got)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			scenario := test.scenario()
			start := scenario.Horizon.StartsAt
			end := start.Add(15 * time.Minute)
			scenario.Events = []domain.ScenarioEvent{{
				ID: "outage", Name: "Reduced capacity", Type: domain.EventAssetOutage,
				AssetID: test.assetID, Start: &start, End: &end, AvailabilityMultiplier: &test.multiplier,
			}}
			run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
				ScenarioID: scenario.ID, Planner: domain.PlannerWattson, ActiveEventIDs: []string{"outage"},
			})
			if err != nil {
				t.Fatalf("plan outage scenario: %v", err)
			}
			test.assert(t, run.Intervals[0])
		})
	}
}

func TestAssetOutageLimitsBatteryCharging(t *testing.T) {
	scenario := scarceSupplyScenario(5)
	for index := range scenario.Signals[2].Values {
		scenario.Signals[2].Values[index] = 0
	}
	capacity, minimum, limit, efficiency, stored := 10.0, 0.0, 4.0, 1.0, 0.0
	scenario.Site.Assets = append(scenario.Site.Assets, domain.Asset{
		ID: "battery", Name: "Battery", Type: domain.AssetBattery,
		CapacityKWH: &capacity, MinimumStoredEnergyKWH: &minimum,
		MaxChargeKW: &limit, MaxDischargeKW: &limit,
		ChargeEfficiency: &efficiency, DischargeEfficiency: &efficiency,
	})
	scenario.InitialState.Assets = []domain.AssetState{{AssetID: "battery", Type: domain.AssetBattery, StoredEnergyKWH: &stored}}
	start := scenario.Horizon.StartsAt
	end := start.Add(15 * time.Minute)
	multiplier := 0.25
	scenario.Events = []domain.ScenarioEvent{{
		ID: "outage", Name: "Battery derating", Type: domain.EventAssetOutage,
		AssetID: "battery", Start: &start, End: &end, AvailabilityMultiplier: &multiplier,
	}}

	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID, Planner: domain.PlannerWattson, ActiveEventIDs: []string{"outage"},
	})
	if err != nil {
		t.Fatalf("plan battery charge outage: %v", err)
	}
	if got := run.Intervals[0].Batteries[0].ChargeKW; got > 1+epsilon {
		t.Fatalf("battery charge = %.3f kW, want at most 1 kW", got)
	}
}

func TestDisconnectedTopologyDoesNotDispatchOrServeLoad(t *testing.T) {
	scenario := loadSeedScenario(t)
	scenario.Site.Connections = []domain.Connection{}
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan disconnected scenario: %v", err)
	}
	for _, interval := range run.Intervals {
		for _, renewable := range interval.Renewables {
			if renewable.UsedKW > epsilon {
				t.Fatalf("disconnected renewable %q dispatched %.3f kW", renewable.AssetID, renewable.UsedKW)
			}
		}
		for _, battery := range interval.Batteries {
			if battery.ChargeKW > epsilon || battery.DischargeKW > epsilon {
				t.Fatalf("disconnected battery %q dispatched: %#v", battery.AssetID, battery)
			}
		}
		for _, generator := range interval.Generators {
			if generator.OutputKW > epsilon {
				t.Fatalf("disconnected generator %q dispatched %.3f kW", generator.AssetID, generator.OutputKW)
			}
		}
		for _, service := range interval.Services {
			if service.DeliveredKW > epsilon {
				t.Fatalf("disconnected service %q received %.3f kW", service.ServiceID, service.DeliveredKW)
			}
		}
	}
}

func TestRenewableCanDispatchThroughBatteryPath(t *testing.T) {
	scenario := scarceSupplyScenario(2)
	scenario.Site.Assets = append(scenario.Site.Assets, domain.Asset{
		ID: "battery", Name: "Battery", Type: domain.AssetBattery,
		CapacityKWH: floatPointer(10), MinimumStoredEnergyKWH: floatPointer(0),
		MaxChargeKW: floatPointer(2), MaxDischargeKW: floatPointer(2),
		ChargeEfficiency: floatPointer(1), DischargeEfficiency: floatPointer(1),
	})
	scenario.InitialState.Assets = append(scenario.InitialState.Assets, domain.AssetState{
		AssetID: "battery", Type: domain.AssetBattery, StoredEnergyKWH: floatPointer(0),
	})
	scenario.Site.Connections = []domain.Connection{
		{ID: "solar-battery", SourceID: "solar", TargetID: "battery"},
		{ID: "battery-controller", SourceID: "battery", TargetID: domain.ControllerNodeID},
		{ID: "controller-critical", SourceID: domain.ControllerNodeID, TargetID: "critical"},
		{ID: "controller-flexible", SourceID: domain.ControllerNodeID, TargetID: "flexible"},
	}
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan battery-path scenario: %v", err)
	}
	if run.Intervals[0].Renewables[0].UsedKW <= epsilon {
		t.Fatal("expected solar to dispatch through the battery path")
	}
}

func TestAllContractKindsAreSatisfiedBeforeTheirDeadlines(t *testing.T) {
	scenario := contractKindsScenario()
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}
	if run.Status != domain.PlanComplete || run.Summary.ContractsMet != 3 {
		t.Fatalf("expected all three contract kinds to be met: %#v", run.ContractOutcomes)
	}
	if run.ActiveEventIDs == nil {
		t.Fatal("expected an empty event list, not null")
	}
	if outcomeByID(t, run, "runtime").DeliveredRuntimeMinutes < 30 {
		t.Fatal("runtime contract did not receive its promised runtime")
	}
	if outcomeByID(t, run, "energy").DeliveredEnergyKWH+epsilon < 1 {
		t.Fatal("energy contract did not receive its promised energy")
	}
}

func TestCriticalContractWinsWhenSupplyIsScarce(t *testing.T) {
	scenario := scarceSupplyScenario(2)
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}
	if outcomeByID(t, run, "critical-power").Status != domain.ContractMet {
		t.Fatal("critical contract was not protected")
	}
	first := run.Intervals[0]
	if deliveredPower(first.Services, "critical") < 1-epsilon {
		t.Fatal("critical service did not receive its required power")
	}
	flexible := deliveryByID(t, first, "flexible")
	if flexible.DeferredKW < 3-epsilon {
		t.Fatalf("expected flexible load to be deferred, got %#v", flexible)
	}
}

func TestInfeasibleContinuousContractIsReported(t *testing.T) {
	scenario := scarceSupplyScenario(0.5)
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}
	outcome := outcomeByID(t, run, "critical-power")
	if run.Status != domain.PlanInfeasible || outcome.Status != domain.ContractBreached {
		t.Fatalf("expected an infeasible breached plan, got %q and %#v", run.Status, outcome)
	}
	if outcome.FirstRiskInterval == nil || *outcome.FirstRiskInterval != 0 {
		t.Fatalf("expected risk at interval zero, got %#v", outcome.FirstRiskInterval)
	}
	if outcome.Shortfall <= 0 {
		t.Fatal("expected a positive contract shortfall")
	}
}

func TestGeneratorProtectsAContractWhenRenewablesAreUnavailable(t *testing.T) {
	scenario := generatorScenario()
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}
	if run.Status != domain.PlanComplete || outcomeByID(t, run, "critical-power").Status != domain.ContractMet {
		t.Fatalf("generator did not protect the contract: %#v", run.ContractOutcomes)
	}
	if run.Summary.DieselEnergyKWH < 24-epsilon {
		t.Fatalf("expected 24 kWh of diesel generation, got %.3f", run.Summary.DieselEnergyKWH)
	}
	if len(run.Decisions) == 0 || run.Decisions[0].Kind != "start_generator" {
		t.Fatalf("expected a generator-start decision, got %#v", run.Decisions)
	}
	if run.Intervals[len(run.Intervals)-1].Generators[0].FuelRemainingLiters < 4-epsilon {
		t.Fatalf("unexpected fuel use: %#v", run.Intervals[len(run.Intervals)-1].Generators[0])
	}
}

func TestGeneratorServesCurtailableDemandAfterBatteryReserve(t *testing.T) {
	scenario := generatorScenario()
	scenario.Site.Services = append(scenario.Site.Services, domain.Service{
		ID: "homes", Name: "Homes", Description: "Curtailable household demand",
		ControlMode: domain.ControlCurtailable, RatedPowerKW: 0.8,
	})
	scenario.Signals = append(scenario.Signals, domain.Signal{
		ID: "homes-demand", Kind: domain.SignalServiceDemand, ServiceID: "homes", Unit: "kW",
		Values: constant(96, 0.8),
	})

	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}
	first := run.Intervals[0]
	if delivered := deliveryByID(t, first, "homes").DeliveredKW; delivered < 0.8-epsilon {
		t.Fatalf("diesel did not serve curtailable demand: delivered %.3f kW", delivered)
	}
	if output := first.Generators[0].OutputKW; output < 1.8-epsilon {
		t.Fatalf("expected the generator to cover total demand, got %.3f kW", output)
	}
}

func TestGeneratorHonorsStartupFuelAndMinimumRuntime(t *testing.T) {
	scenario := generatorScenario()
	minimumOutput := 1.0
	startupFuel := 0.2
	minimumRuntime := 45
	rampRate := 10.0
	scenario.Site.Assets[0].MinimumOutputKW = &minimumOutput
	scenario.Site.Assets[0].StartupFuelLiters = &startupFuel
	scenario.Site.Assets[0].MinimumRuntimeMinutes = &minimumRuntime
	scenario.Site.Assets[0].RampRateKWPerMinute = &rampRate
	scenario.Site.Services[0].ControlMode = domain.ControlShiftable
	scenario.Signals[0].Values = constant(96, 1)
	requiredRuntime := 15
	scenario.Contracts[0] = domain.Contract{
		ID: "one-interval", Name: "One interval", ServiceID: "critical",
		Kind: domain.ContractRuntimeDeadline, Priority: domain.PriorityCritical,
		WindowStart:            scenario.Horizon.StartsAt,
		Deadline:               scenario.Horizon.StartsAt.Add(15 * time.Minute),
		RequiredRuntimeMinutes: &requiredRuntime,
	}

	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID,
		Planner:    domain.PlannerWattson,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}
	for index := 0; index < 3; index++ {
		if !run.Intervals[index].Generators[0].Running {
			t.Fatalf("generator stopped before its 45-minute minimum runtime at interval %d", index)
		}
	}
	if run.Intervals[3].Generators[0].Running {
		t.Fatal("generator continued after its minimum runtime without demand")
	}
	first := run.Intervals[0].Generators[0]
	if !first.Started || math.Abs(first.StartupFuelLiters-startupFuel) > epsilon {
		t.Fatalf("startup fuel was not recorded: %#v", first)
	}
	if run.Intervals[1].DumpedPowerKW < minimumOutput-epsilon {
		t.Fatalf("minimum stable output was not recorded as dumped power: %#v", run.Intervals[1])
	}
}

func TestSeedScenarioPreservesPhysicalBalances(t *testing.T) {
	scenario := loadSeedScenario(t)
	events := []string{"midday-cloud-cover", "evening-household-surge", "evening-fuel-delay"}
	prepared, err := prepareScenario(scenario, events)
	if err != nil {
		t.Fatalf("prepare scenario: %v", err)
	}
	run, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID, Planner: domain.PlannerWattson, ActiveEventIDs: events,
	})
	if err != nil {
		t.Fatalf("plan scenario: %v", err)
	}

	previousFuel := cloneFloatMap(prepared.initialFuel)
	previousOutput := make(map[string]float64)
	for _, interval := range run.Intervals {
		supply := 0.0
		use := interval.LossesKW + interval.DumpedPowerKW
		for _, renewable := range interval.Renewables {
			supply += renewable.UsedKW
		}
		for _, service := range interval.Services {
			use += service.DeliveredKW
		}
		for _, battery := range interval.Batteries {
			asset := prepared.assets[battery.AssetID]
			supply += battery.DischargeKW
			use += battery.ChargeKW
			expectedEnd := battery.StartingEnergyKWH + battery.ChargeKW*pointerValue(asset.ChargeEfficiency)*prepared.intervalHours - battery.DischargeKW/preparedAssetEfficiency(asset)*prepared.intervalHours
			if math.Abs(expectedEnd-battery.EndingEnergyKWH) > 0.00001 {
				t.Fatalf("battery energy does not balance at interval %d: expected %.6f, got %.6f", interval.Index, expectedEnd, battery.EndingEnergyKWH)
			}
			if battery.ChargeKW > pointerValue(asset.MaxChargeKW)+epsilon || battery.DischargeKW > pointerValue(asset.MaxDischargeKW)+epsilon {
				t.Fatalf("battery power limit exceeded at interval %d: %#v", interval.Index, battery)
			}
			if battery.EndingEnergyKWH < pointerValue(asset.MinimumStoredEnergyKWH)-epsilon || battery.EndingEnergyKWH > pointerValue(asset.CapacityKWH)+epsilon {
				t.Fatalf("battery energy boundary exceeded at interval %d: %#v", interval.Index, battery)
			}
			if battery.ChargeKW > epsilon && battery.DischargeKW > epsilon {
				t.Fatalf("battery charged and discharged together at interval %d", interval.Index)
			}
		}
		for _, generator := range interval.Generators {
			asset := prepared.assets[generator.AssetID]
			supply += generator.OutputKW
			if generator.Running && (generator.OutputKW < pointerValue(asset.MinimumOutputKW)-epsilon || generator.OutputKW > pointerValue(asset.MaximumOutputKW)+epsilon) {
				t.Fatalf("generator output boundary exceeded at interval %d: %#v", interval.Index, generator)
			}
			if generator.Running && asset.RampRateKWPerMinute != nil {
				maximumChange := *asset.RampRateKWPerMinute * float64(scenario.Horizon.IntervalMinutes)
				if math.Abs(generator.OutputKW-previousOutput[generator.AssetID]) > maximumChange+epsilon {
					t.Fatalf("generator ramp limit exceeded at interval %d: previous %.6f, current %.6f", interval.Index, previousOutput[generator.AssetID], generator.OutputKW)
				}
			}
			expectedFuel := previousFuel[generator.AssetID] + prepared.fuelSignals[generator.AssetID][interval.Index] - generator.FuelUsedLiters
			if math.Abs(expectedFuel-generator.FuelRemainingLiters) > 0.00001 {
				t.Fatalf("generator fuel does not balance at interval %d: expected %.6f, got %.6f", interval.Index, expectedFuel, generator.FuelRemainingLiters)
			}
			previousFuel[generator.AssetID] = generator.FuelRemainingLiters
			previousOutput[generator.AssetID] = generator.OutputKW
		}
		if math.Abs(supply-use) > 0.00001 {
			t.Fatalf("AC power does not balance at interval %d: supply %.6f kW, use %.6f kW", interval.Index, supply, use)
		}
	}
}

func preparedAssetEfficiency(asset domain.Asset) float64 {
	return pointerValue(asset.DischargeEfficiency)
}

func deterministicScheduler() *Scheduler {
	return &Scheduler{
		now: func() time.Time { return time.Date(2026, 9, 12, 0, 31, 0, 0, time.UTC) },
		newID: func() (string, error) {
			return "run-test", nil
		},
	}
}

func loadSeedScenario(t *testing.T) domain.Scenario {
	t.Helper()
	contents, err := os.ReadFile("../../seeddata/spiti-valley-default.json")
	if err != nil {
		t.Fatalf("read seed scenario: %v", err)
	}
	var scenario domain.Scenario
	if err := json.Unmarshal(contents, &scenario); err != nil {
		t.Fatalf("decode seed scenario: %v", err)
	}
	return scenario
}

func contractKindsScenario() domain.Scenario {
	startsAt := time.Date(2026, 9, 12, 6, 0, 0, 0, time.UTC)
	endsAt := startsAt.Add(24 * time.Hour)
	capacity := 10.0
	continuousPower := 1.0
	runtimeMinutes := 30
	energyKWH := 1.0
	return domain.Scenario{
		SchemaVersion: "1",
		ID:            "all-contracts",
		Name:          "All contracts",
		Site: domain.Site{
			ID: "site", Name: "Site", Location: "Test", Timezone: "UTC", Currency: "USD",
			Assets: []domain.Asset{{ID: "solar", Name: "Solar", Type: domain.AssetSolar, CapacityKW: &capacity}},
			Services: []domain.Service{
				{ID: "continuous", Name: "Continuous", Description: "Continuous service", ControlMode: domain.ControlFixed, RatedPowerKW: 1},
				{ID: "runtime-service", Name: "Runtime", Description: "Runtime service", ControlMode: domain.ControlShiftable, RatedPowerKW: 2},
				{ID: "energy-service", Name: "Energy", Description: "Energy service", ControlMode: domain.ControlShiftable, RatedPowerKW: 2},
			},
		},
		Horizon: domain.PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		Signals: []domain.Signal{
			{ID: "solar-signal", Kind: domain.SignalRenewableAvailability, AssetID: "solar", Unit: "kW", Values: constant(96, 10)},
			{ID: "continuous-demand", Kind: domain.SignalServiceDemand, ServiceID: "continuous", Unit: "kW", Values: constant(96, 1)},
			{ID: "runtime-demand", Kind: domain.SignalServiceDemand, ServiceID: "runtime-service", Unit: "kW", Values: constant(96, 2)},
			{ID: "energy-demand", Kind: domain.SignalServiceDemand, ServiceID: "energy-service", Unit: "kW", Values: constant(96, 2)},
		},
		Contracts: []domain.Contract{
			{ID: "continuous", Name: "Continuous", ServiceID: "continuous", Kind: domain.ContractContinuousPower, Priority: domain.PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &continuousPower},
			{ID: "runtime", Name: "Runtime", ServiceID: "runtime-service", Kind: domain.ContractRuntimeDeadline, Priority: domain.PriorityEssential, WindowStart: startsAt, Deadline: endsAt, RequiredRuntimeMinutes: &runtimeMinutes},
			{ID: "energy", Name: "Energy", ServiceID: "energy-service", Kind: domain.ContractEnergyDeadline, Priority: domain.PriorityFlexible, WindowStart: startsAt, Deadline: endsAt, RequiredEnergyKWH: &energyKWH},
		},
		OperatingPolicy: domain.OperatingPolicy{},
	}
}

func scarceSupplyScenario(supply float64) domain.Scenario {
	startsAt := time.Date(2026, 9, 12, 6, 0, 0, 0, time.UTC)
	endsAt := startsAt.Add(24 * time.Hour)
	capacity := 5.0
	minimum := 1.0
	return domain.Scenario{
		SchemaVersion: "1", ID: "scarce", Name: "Scarce supply",
		Site: domain.Site{
			ID: "site", Name: "Site", Location: "Test", Timezone: "UTC", Currency: "USD",
			Assets: []domain.Asset{{ID: "solar", Name: "Solar", Type: domain.AssetSolar, CapacityKW: &capacity}},
			Services: []domain.Service{
				{ID: "critical", Name: "Critical", Description: "Critical service", ControlMode: domain.ControlFixed, RatedPowerKW: 1},
				{ID: "flexible", Name: "Flexible", Description: "Flexible service", ControlMode: domain.ControlCurtailable, RatedPowerKW: 4},
			},
		},
		Horizon: domain.PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		Signals: []domain.Signal{
			{ID: "solar-signal", Kind: domain.SignalRenewableAvailability, AssetID: "solar", Unit: "kW", Values: constant(96, supply)},
			{ID: "critical-demand", Kind: domain.SignalServiceDemand, ServiceID: "critical", Unit: "kW", Values: constant(96, 1)},
			{ID: "flexible-demand", Kind: domain.SignalServiceDemand, ServiceID: "flexible", Unit: "kW", Values: constant(96, 4)},
		},
		Contracts: []domain.Contract{{
			ID: "critical-power", Name: "Critical power", ServiceID: "critical", Kind: domain.ContractContinuousPower,
			Priority: domain.PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &minimum,
		}},
		OperatingPolicy: domain.OperatingPolicy{},
	}
}

func generatorScenario() domain.Scenario {
	startsAt := time.Date(2026, 9, 12, 6, 0, 0, 0, time.UTC)
	endsAt := startsAt.Add(24 * time.Hour)
	minimumPower := 1.0
	minimumOutput := 0.5
	maximumOutput := 2.0
	litersPerKWH := 0.25
	fuelCost := 1.0
	emissions := 1.0
	fuelAvailable := 10.0
	running := false
	return domain.Scenario{
		SchemaVersion: "1", ID: "generator", Name: "Generator supply",
		Site: domain.Site{
			ID: "site", Name: "Site", Location: "Test", Timezone: "UTC", Currency: "USD",
			Assets: []domain.Asset{{
				ID: "generator", Name: "Generator", Type: domain.AssetDiesel,
				MinimumOutputKW: &minimumOutput, MaximumOutputKW: &maximumOutput, LitersPerKWH: &litersPerKWH,
				FuelCostPerLiter: &fuelCost, EmissionsKGCO2PerLiter: &emissions,
			}},
			Services: []domain.Service{{
				ID: "critical", Name: "Critical", Description: "Critical service", ControlMode: domain.ControlFixed, RatedPowerKW: 1,
			}},
		},
		Horizon: domain.PlanningHorizon{StartsAt: startsAt, IntervalMinutes: 15, IntervalCount: 96},
		InitialState: domain.InitialState{Assets: []domain.AssetState{{
			AssetID: "generator", Type: domain.AssetDiesel, FuelAvailableLiters: &fuelAvailable, Running: &running,
		}}},
		Signals: []domain.Signal{{
			ID: "critical-demand", Kind: domain.SignalServiceDemand, ServiceID: "critical", Unit: "kW", Values: constant(96, 1),
		}},
		Contracts: []domain.Contract{{
			ID: "critical-power", Name: "Critical power", ServiceID: "critical", Kind: domain.ContractContinuousPower,
			Priority: domain.PriorityCritical, WindowStart: startsAt, Deadline: endsAt, MinimumPowerKW: &minimumPower,
		}},
		OperatingPolicy: domain.OperatingPolicy{},
	}
}

func constant(count int, value float64) []float64 {
	values := make([]float64, count)
	for index := range values {
		values[index] = value
	}
	return values
}

func floatPointer(value float64) *float64 {
	return &value
}

func outcomeByID(t *testing.T, run domain.PlanRun, id string) domain.ContractOutcome {
	t.Helper()
	for _, outcome := range run.ContractOutcomes {
		if outcome.ContractID == id {
			return outcome
		}
	}
	t.Fatalf("contract outcome %q was not found", id)
	return domain.ContractOutcome{}
}

func deliveryByID(t *testing.T, interval domain.PlanInterval, id string) domain.ServiceDelivery {
	t.Helper()
	for _, delivery := range interval.Services {
		if delivery.ServiceID == id {
			return delivery
		}
	}
	t.Fatalf("service delivery %q was not found", id)
	return domain.ServiceDelivery{}
}

func signalByID(t *testing.T, scenario domain.Scenario, id string) domain.Signal {
	t.Helper()
	for _, signal := range scenario.Signals {
		if signal.ID == id {
			return signal
		}
	}
	t.Fatalf("signal %q was not found", id)
	return domain.Signal{}
}
