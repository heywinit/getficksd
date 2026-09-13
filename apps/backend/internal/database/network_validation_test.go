package database

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestPlanRunNetworkValidationRoundTrip(t *testing.T) {
	ctx := context.Background()
	connection, err := Open(ctx, filepath.Join(t.TempDir(), "network-validation.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { connection.Close() })
	store := NewStore(connection)
	scenario := loadScenario(t)
	if err := store.CreateScenario(ctx, scenario); err != nil {
		t.Fatalf("create scenario: %v", err)
	}

	run := domain.PlanRun{
		ID: "network-validated-run", ScenarioID: scenario.ID, Planner: domain.PlannerWattson,
		Status: domain.PlanComplete, CreatedAt: time.Now().UTC(), ActiveEventIDs: []string{},
		Intervals: []domain.PlanInterval{}, ContractOutcomes: []domain.ContractOutcome{}, Decisions: []domain.Decision{},
		NetworkValidation: &domain.NetworkValidation{
			Engine: "pandapower", ModelName: "wattson-synthetic-radial-lv-v1",
			Status: domain.NetworkValidationViolations, Source: "synthetic_default",
			Assumptions: []string{"Synthetic line lengths."}, CheckedIntervals: 96,
			ConvergedIntervals: 96, CheckedBuses: 12, CheckedLines: 11, ComponentsChecked: 23,
			MinimumVoltagePU: 0.94, MinimumVoltageBusID: "clinic", MinimumVoltageInterval: 72,
			MaximumVoltagePU: 1, MaximumLineLoadingPercent: 51, MaximumLoadedLineID: "line-1",
			MaximumLineLoadInterval: 72, CalculatedLossKWH: 80, AssumedLossKWH: 158,
			ValidationMS: 2100, Violations: []domain.NetworkViolation{{
				IntervalIndex: 72, Kind: "undervoltage", ElementID: "clinic", Value: 0.94,
				Limit: 0.95, Message: "Bus voltage is below the minimum limit.",
			}},
		},
	}
	if err := store.SavePlanRun(ctx, run); err != nil {
		t.Fatalf("save run: %v", err)
	}
	loaded, err := store.PlanRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("load run: %v", err)
	}
	if loaded.NetworkValidation == nil || loaded.NetworkValidation.MinimumVoltageBusID != "clinic" || len(loaded.NetworkValidation.Violations) != 1 {
		t.Fatalf("network validation did not round-trip: %#v", loaded.NetworkValidation)
	}
}
