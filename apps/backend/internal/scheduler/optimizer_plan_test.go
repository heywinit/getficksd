package scheduler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

type failingOptimizer struct {
	calls int
}

func (optimizer *failingOptimizer) Optimize(context.Context, optimizerInput) (optimizerSolution, error) {
	optimizer.calls++
	return optimizerSolution{}, errors.New("solver unavailable")
}

func TestWattsonFallsBackWhenOptimizerFails(t *testing.T) {
	scenario := loadSeedScenario(t)
	optimizer := &failingOptimizer{}
	planner := deterministicScheduler()
	planner.optimizer = optimizer

	run, err := planner.Plan(context.Background(), scenario, domain.PlanningRequest{ScenarioID: scenario.ID, Planner: domain.PlannerWattson})
	if err != nil {
		t.Fatalf("plan with fallback: %v", err)
	}
	if optimizer.calls != 1 {
		t.Fatalf("optimizer calls = %d, want 1", optimizer.calls)
	}
	if run.Optimization == nil || !run.Optimization.UsedFallback {
		t.Fatalf("missing fallback metadata: %#v", run.Optimization)
	}
	if len(run.Intervals) != scenario.Horizon.IntervalCount {
		t.Fatalf("fallback intervals = %d, want %d", len(run.Intervals), scenario.Horizon.IntervalCount)
	}
}

func TestBaselineDoesNotCallOptimizer(t *testing.T) {
	scenario := loadSeedScenario(t)
	optimizer := &failingOptimizer{}
	planner := deterministicScheduler()
	planner.optimizer = optimizer

	if _, err := planner.Plan(context.Background(), scenario, domain.PlanningRequest{ScenarioID: scenario.ID, Planner: domain.PlannerBaseline}); err != nil {
		t.Fatalf("baseline plan: %v", err)
	}
	if optimizer.calls != 0 {
		t.Fatalf("baseline called optimizer %d times", optimizer.calls)
	}
}

func TestAssetOutageUsesSafeHeuristicFallback(t *testing.T) {
	scenario := generatorScenario()
	start := scenario.Horizon.StartsAt
	end := start.Add(15 * time.Minute)
	multiplier := 0.0
	scenario.Events = []domain.ScenarioEvent{{
		ID: "outage", Name: "Generator outage", Type: domain.EventAssetOutage,
		AssetID: "generator", Start: &start, End: &end, AvailabilityMultiplier: &multiplier,
	}}
	optimizer := &failingOptimizer{}
	planner := deterministicScheduler()
	planner.optimizer = optimizer

	run, err := planner.Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID, Planner: domain.PlannerWattson, ActiveEventIDs: []string{"outage"},
	})
	if err != nil {
		t.Fatalf("plan asset outage: %v", err)
	}
	if optimizer.calls != 0 {
		t.Fatalf("asset outage called an optimizer without dynamic outage limits %d times", optimizer.calls)
	}
	if run.Optimization == nil || !run.Optimization.UsedFallback {
		t.Fatalf("missing safe fallback metadata: %#v", run.Optimization)
	}
	if output := run.Intervals[0].Generators[0].OutputKW; output != 0 {
		t.Fatalf("generator output during outage = %.3f kW, want 0", output)
	}
}
