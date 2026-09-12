package scheduler

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestPythonMILPSolvesSpitiEvents(t *testing.T) {
	pythonPath := "../../optimizer/.venv/bin/python"
	scriptPath := "../../optimizer/solve.py"
	if _, err := os.Stat(pythonPath); err != nil {
		t.Skip("optimizer virtual environment is not installed")
	}
	optimizer, err := NewPythonOptimizer(pythonPath, scriptPath, 12*time.Second)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}
	planner := deterministicScheduler()
	planner.optimizer = optimizer
	scenario := loadSeedScenario(t)
	run, err := planner.Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID:     scenario.ID,
		Planner:        domain.PlannerWattson,
		ActiveEventIDs: []string{"midday-cloud-cover", "evening-household-surge", "evening-fuel-delay"},
	})
	if err != nil {
		t.Fatalf("solve Spiti MILP: %v", err)
	}
	if run.Optimization == nil || run.Optimization.UsedFallback || run.Optimization.Engine != "pyomo-highs" {
		t.Fatalf("MILP did not produce the plan: %#v", run.Optimization)
	}
	if len(run.Intervals) != 96 {
		t.Fatalf("intervals = %d, want 96", len(run.Intervals))
	}
	if run.Summary.ContractsMet != len(scenario.Contracts) || run.Summary.ContractsBreached != 0 {
		t.Fatalf("contract summary = %+v outcomes=%+v", run.Summary, run.ContractOutcomes)
	}
	if run.Summary.UnservedEnergyKWH > optimizerVerificationTolerance {
		t.Fatalf("unserved energy = %.6f kWh", run.Summary.UnservedEnergyKWH)
	}
	if run.Summary.MinimumBatteryEnergyKWH < scenario.OperatingPolicy.ReserveEnergyKWH-optimizerVerificationTolerance {
		t.Fatalf("minimum battery = %.6f kWh", run.Summary.MinimumBatteryEnergyKWH)
	}
	events := []string{"midday-cloud-cover", "evening-household-surge", "evening-fuel-delay"}
	heuristic, err := deterministicScheduler().Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID, Planner: domain.PlannerWattson, ActiveEventIDs: events,
	})
	if err != nil {
		t.Fatalf("solve heuristic comparison: %v", err)
	}
	if run.Summary.TotalDieselCost > heuristic.Summary.TotalDieselCost+optimizerVerificationTolerance {
		t.Fatalf("MILP cost %.6f exceeds heuristic cost %.6f", run.Summary.TotalDieselCost, heuristic.Summary.TotalDieselCost)
	}
	t.Logf(
		"MILP status=%s solve_ms=%d gap=%.6f cost=%.2f heuristic_cost=%.2f savings=%.2f",
		run.Optimization.Termination, run.Optimization.SolveMS, run.Optimization.MIPGap,
		run.Summary.TotalDieselCost, heuristic.Summary.TotalDieselCost,
		heuristic.Summary.TotalDieselCost-run.Summary.TotalDieselCost,
	)
}
