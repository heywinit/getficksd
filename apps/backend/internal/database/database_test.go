package database

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestMigrationsAndStoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "wattson.db")
	connection, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}

	var migrationCount int
	if err := connection.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations").Scan(&migrationCount); err != nil {
		t.Fatalf("read migration count: %v", err)
	}
	if migrationCount != 3 {
		t.Fatalf("expected three applied migrations, got %d", migrationCount)
	}

	store := NewStore(connection)
	scenario := loadScenario(t)
	if err := store.CreateScenario(ctx, scenario); err != nil {
		t.Fatalf("create scenario: %v", err)
	}
	loadedScenario, err := store.Scenario(ctx, scenario.ID)
	if err != nil {
		t.Fatalf("load scenario: %v", err)
	}
	if loadedScenario.Site.ID != scenario.Site.ID || len(loadedScenario.Signals) != len(scenario.Signals) {
		t.Fatalf("stored scenario changed: %#v", loadedScenario)
	}
	if len(loadedScenario.Site.Connections) != len(scenario.Site.Assets)+len(scenario.Site.Services) {
		t.Fatalf("legacy scenario did not receive a persisted default topology: %#v", loadedScenario.Site.Connections)
	}
	if err := store.CreateScenario(ctx, scenario); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected duplicate scenario conflict, got %v", err)
	}
	scenario.Name = "Updated scenario"
	if err := store.ReplaceScenario(ctx, scenario); err != nil {
		t.Fatalf("replace scenario: %v", err)
	}
	loadedScenario, err = store.Scenario(ctx, scenario.ID)
	if err != nil {
		t.Fatalf("load replaced scenario: %v", err)
	}
	if loadedScenario.Name != "Updated scenario" {
		t.Fatalf("scenario was not replaced: %#v", loadedScenario)
	}
	scenarios, err := store.Scenarios(ctx, 20, 0)
	if err != nil {
		t.Fatalf("list scenarios: %v", err)
	}
	if len(scenarios) != 1 || scenarios[0].ID != scenario.ID {
		t.Fatalf("unexpected scenario list: %#v", scenarios)
	}

	run := domain.PlanRun{
		ID: "run-one", ScenarioID: scenario.ID, Planner: domain.PlannerWattson,
		Status: domain.PlanComplete, CreatedAt: time.Date(2026, 9, 12, 7, 0, 0, 0, time.UTC),
		ActiveEventIDs: []string{"midday-solar-shortfall"}, Intervals: []domain.PlanInterval{},
		ContractOutcomes: []domain.ContractOutcome{}, Decisions: []domain.Decision{},
	}
	if err := store.SavePlanRun(ctx, run); err != nil {
		t.Fatalf("save plan run: %v", err)
	}
	loadedRun, err := store.PlanRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("load plan run: %v", err)
	}
	if loadedRun.ID != run.ID || len(loadedRun.ActiveEventIDs) != 1 {
		t.Fatalf("stored plan run changed: %#v", loadedRun)
	}
	runs, err := store.PlanRuns(ctx, scenario.ID, 20, 0)
	if err != nil {
		t.Fatalf("list plan runs: %v", err)
	}
	if len(runs) != 1 || runs[0].ID != run.ID {
		t.Fatalf("unexpected plan run list: %#v", runs)
	}

	if err := connection.Close(); err != nil {
		t.Fatalf("close database: %v", err)
	}
	connection, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen migrated database: %v", err)
	}
	t.Cleanup(func() { connection.Close() })
	if err := connection.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations").Scan(&migrationCount); err != nil {
		t.Fatalf("read migration count after reopen: %v", err)
	}
	if migrationCount != 3 {
		t.Fatalf("migration was applied more than once: %d", migrationCount)
	}
	store = NewStore(connection)
	if err := store.DeleteScenario(ctx, scenario.ID); err != nil {
		t.Fatalf("delete scenario: %v", err)
	}
	if _, err := store.Scenario(ctx, scenario.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted scenario to be missing, got %v", err)
	}
	if _, err := store.PlanRun(ctx, run.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected plan runs to be deleted with the scenario, got %v", err)
	}
	deleted, err := store.ScenarioWasDeleted(ctx, scenario.ID)
	if err != nil || !deleted {
		t.Fatalf("expected scenario deletion to be recorded, deleted=%v err=%v", deleted, err)
	}
}

func TestStoreReturnsNotFound(t *testing.T) {
	connection, err := Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { connection.Close() })
	_, err = NewStore(connection).Scenario(context.Background(), "missing")
	if err == nil || !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func loadScenario(t *testing.T) domain.Scenario {
	t.Helper()
	contents, err := os.ReadFile("../../seeddata/spiti-valley-default.json")
	if err != nil {
		t.Fatalf("read scenario: %v", err)
	}
	var scenario domain.Scenario
	if err := json.Unmarshal(contents, &scenario); err != nil {
		t.Fatalf("decode scenario: %v", err)
	}
	return scenario
}
