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
		ActiveEventIDs: []string{"midday-solar-shortfall", "evening-fuel-delay"},
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

	clinic := outcomeByID(t, run, "clinic-always-on")
	if clinic.DeliveredRuntimeMinutes != 24*60 {
		t.Fatalf("expected full-day clinic runtime, got %d minutes", clinic.DeliveredRuntimeMinutes)
	}
	water := outcomeByID(t, run, "water-before-morning")
	if water.DeliveredRuntimeMinutes < 120 {
		t.Fatalf("expected at least 120 water-pump minutes, got %d", water.DeliveredRuntimeMinutes)
	}
	if run.Summary.MinimumBatteryEnergyKWH < 36-epsilon {
		t.Fatalf("battery crossed its physical minimum: %.3f kWh", run.Summary.MinimumBatteryEnergyKWH)
	}
	if len(run.Decisions) == 0 {
		t.Fatal("expected explainable scheduling decisions")
	}

	forecast := signalByID(t, scenario, "spiti-solar-forecast")
	if run.Intervals[20].Renewables[0].AvailableKW >= forecast.Values[20] {
		t.Fatal("active solar-shortfall event did not reduce renewable availability")
	}
}

func TestActiveEventsTransformTheirSignals(t *testing.T) {
	scenario := loadSeedScenario(t)
	prepared, err := prepareScenario(scenario, []string{"midday-solar-shortfall", "evening-fuel-delay"})
	if err != nil {
		t.Fatalf("prepare active events: %v", err)
	}
	solar := signalByID(t, scenario, "spiti-solar-forecast")
	if difference := prepared.renewableSignals["spiti-solar"][20] - solar.Values[20]*0.45; math.Abs(difference) > epsilon {
		t.Fatalf("solar event multiplier was not applied: difference %.6f", difference)
	}
	if prepared.fuelSignals["spiti-diesel"][48] != 0 || prepared.fuelSignals["spiti-diesel"][68] != 80 {
		t.Fatalf("fuel delivery was not moved to the delayed interval: %#v", prepared.fuelSignals["spiti-diesel"][48:69])
	}

	multiplier := 1.5
	start := scenario.Horizon.StartsAt
	end := start.Add(15 * time.Minute)
	scenario.Events = append(scenario.Events, domain.ScenarioEvent{
		ID: "demand-surge", Name: "Demand surge", Type: domain.EventDemandSurge, SignalID: "homes-demand",
		Start: &start, End: &end, DemandMultiplier: &multiplier,
	})
	prepared, err = prepareScenario(scenario, []string{"demand-surge"})
	if err != nil {
		t.Fatalf("prepare demand event: %v", err)
	}
	homes := signalByID(t, scenario, "homes-demand")
	if difference := prepared.demandSignals["flexible-homes"][0] - homes.Values[0]*multiplier; math.Abs(difference) > epsilon {
		t.Fatalf("demand multiplier was not applied: difference %.6f", difference)
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
