package scheduler

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestPythonACValidatorChecksOptimizedSpitiPlan(t *testing.T) {
	pythonPath := "../../optimizer/.venv/bin/python"
	optimizerPath := "../../optimizer/solve.py"
	validatorPath := "../../optimizer/validate_ac.py"
	for _, path := range []string{pythonPath, optimizerPath, validatorPath} {
		if _, err := os.Stat(path); err != nil {
			t.Skipf("required optimizer file is not installed: %s", path)
		}
	}
	optimizer, err := NewPythonOptimizer(pythonPath, optimizerPath, 15*time.Second)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}
	validator, err := NewPythonNetworkValidator(pythonPath, validatorPath, 20*time.Second)
	if err != nil {
		t.Fatalf("construct network validator: %v", err)
	}
	planner := deterministicScheduler()
	planner.optimizer = optimizer
	planner.networkValidator = validator
	scenario := loadSeedScenario(t)

	run, err := planner.Plan(context.Background(), scenario, domain.PlanningRequest{
		ScenarioID: scenario.ID, Planner: domain.PlannerWattson,
		ActiveEventIDs: []string{"midday-cloud-cover", "evening-household-surge", "evening-fuel-delay"},
	})
	if err != nil {
		t.Fatalf("plan and validate Spiti: %v", err)
	}
	if run.Optimization == nil || run.Optimization.UsedFallback {
		t.Fatalf("MILP fell back: %#v", run.Optimization)
	}
	if run.NetworkValidation == nil {
		t.Fatal("network validation was omitted")
	}
	if run.NetworkValidation.Status == domain.NetworkValidationUnavailable {
		t.Fatalf("network validation unavailable: %s", run.NetworkValidation.Error)
	}
	if run.NetworkValidation.Source != "synthetic_default" || len(run.NetworkValidation.Assumptions) == 0 {
		t.Fatalf("synthetic model is not labeled: %#v", run.NetworkValidation)
	}
	if run.NetworkValidation.CheckedIntervals != scenario.Horizon.IntervalCount {
		t.Fatalf("checked intervals = %d, want %d", run.NetworkValidation.CheckedIntervals, scenario.Horizon.IntervalCount)
	}
	t.Logf("AC validation status=%s validation_ms=%d voltage=[%.4f, %.4f] max_loading=%.2f%% calculated_loss=%.3fkWh assumed_loss=%.3fkWh violations=%d",
		run.NetworkValidation.Status, run.NetworkValidation.ValidationMS,
		run.NetworkValidation.MinimumVoltagePU, run.NetworkValidation.MaximumVoltagePU,
		run.NetworkValidation.MaximumLineLoadingPercent, run.NetworkValidation.CalculatedLossKWH,
		run.NetworkValidation.AssumedLossKWH, len(run.NetworkValidation.Violations))
}
