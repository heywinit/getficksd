package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/database/db"
	"github.com/heywinit/wattson/backend/internal/domain"
)

var (
	ErrConflict = errors.New("conflict")
	ErrNotFound = errors.New("not found")
)

type Store struct {
	queries *db.Queries
}

func NewStore(database *sql.DB) *Store {
	return &Store{queries: db.New(database)}
}

func (s *Store) CreateScenario(ctx context.Context, scenario domain.Scenario) error {
	parameters, err := scenarioParameters(scenario)
	if err != nil {
		return err
	}
	if err := s.queries.InsertScenario(ctx, parameters); err != nil {
		if isUniqueConstraint(err) {
			return fmt.Errorf("create scenario: %w", ErrConflict)
		}
		return fmt.Errorf("create scenario: %w", err)
	}
	return nil
}

func (s *Store) ReplaceScenario(ctx context.Context, scenario domain.Scenario) error {
	parameters, err := scenarioParameters(scenario)
	if err != nil {
		return err
	}
	updated, err := s.queries.UpdateScenario(ctx, db.UpdateScenarioParams{
		SiteID:        parameters.SiteID,
		Name:          parameters.Name,
		SchemaVersion: parameters.SchemaVersion,
		Document:      parameters.Document,
		ID:            parameters.ID,
	})
	if err != nil {
		return fmt.Errorf("replace scenario: %w", err)
	}
	if updated == 0 {
		return fmt.Errorf("replace scenario: %w", ErrNotFound)
	}
	return nil
}

func scenarioParameters(scenario domain.Scenario) (db.InsertScenarioParams, error) {
	if err := domain.ValidateScenario(scenario); err != nil {
		return db.InsertScenarioParams{}, fmt.Errorf("validate scenario: %w", err)
	}
	document, err := json.Marshal(scenario)
	if err != nil {
		return db.InsertScenarioParams{}, fmt.Errorf("encode scenario: %w", err)
	}
	return db.InsertScenarioParams{
		ID:            scenario.ID,
		SiteID:        scenario.Site.ID,
		Name:          scenario.Name,
		SchemaVersion: scenario.SchemaVersion,
		Document:      document,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func (s *Store) Scenario(ctx context.Context, id string) (domain.Scenario, error) {
	row, err := s.queries.GetScenario(ctx, id)
	if err != nil {
		return domain.Scenario{}, storeError("get scenario", err)
	}
	return decodeScenario(row.Document)
}

func (s *Store) ScenarioBySite(ctx context.Context, siteID string) (domain.Scenario, error) {
	row, err := s.queries.GetScenarioBySite(ctx, siteID)
	if err != nil {
		return domain.Scenario{}, storeError("get scenario by site", err)
	}
	return decodeScenario(row.Document)
}

func (s *Store) SavePlanRun(ctx context.Context, run domain.PlanRun) error {
	document, err := json.Marshal(run)
	if err != nil {
		return fmt.Errorf("encode plan run: %w", err)
	}
	activeEvents, err := json.Marshal(run.ActiveEventIDs)
	if err != nil {
		return fmt.Errorf("encode active events: %w", err)
	}
	parent := sql.NullString{}
	if run.ParentRunID != "" {
		parent = sql.NullString{String: run.ParentRunID, Valid: true}
	}
	if err := s.queries.InsertPlanRun(ctx, db.InsertPlanRunParams{
		ID:             run.ID,
		ScenarioID:     run.ScenarioID,
		Planner:        string(run.Planner),
		Status:         string(run.Status),
		CreatedAt:      run.CreatedAt.UTC().Format(time.RFC3339Nano),
		ParentRunID:    parent,
		ActiveEventIds: activeEvents,
		Document:       document,
	}); err != nil {
		return fmt.Errorf("save plan run: %w", err)
	}
	return nil
}

func (s *Store) PlanRun(ctx context.Context, id string) (domain.PlanRun, error) {
	row, err := s.queries.GetPlanRun(ctx, id)
	if err != nil {
		return domain.PlanRun{}, storeError("get plan run", err)
	}
	run, err := decodePlanRun(row.Document)
	if err != nil {
		return domain.PlanRun{}, err
	}
	if row.ParentRunID.Valid {
		run.ParentRunID = row.ParentRunID.String
	}
	return run, nil
}

func (s *Store) PlanRuns(ctx context.Context, scenarioID string, limit, offset int64) ([]domain.PlanRun, error) {
	rows, err := s.queries.ListPlanRunsByScenario(ctx, db.ListPlanRunsByScenarioParams{
		ScenarioID: scenarioID,
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		return nil, fmt.Errorf("list plan runs: %w", err)
	}
	runs := make([]domain.PlanRun, 0, len(rows))
	for _, row := range rows {
		run, err := decodePlanRun(row.Document)
		if err != nil {
			return nil, err
		}
		if row.ParentRunID.Valid {
			run.ParentRunID = row.ParentRunID.String
		}
		runs = append(runs, run)
	}
	return runs, nil
}

func decodeScenario(document []byte) (domain.Scenario, error) {
	var scenario domain.Scenario
	if err := json.Unmarshal(document, &scenario); err != nil {
		return domain.Scenario{}, fmt.Errorf("decode stored scenario: %w", err)
	}
	return scenario, nil
}

func decodePlanRun(document []byte) (domain.PlanRun, error) {
	var run domain.PlanRun
	if err := json.Unmarshal(document, &run); err != nil {
		return domain.PlanRun{}, fmt.Errorf("decode stored plan run: %w", err)
	}
	return run, nil
}

func storeError(operation string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", operation, ErrNotFound)
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func isUniqueConstraint(err error) bool {
	return strings.Contains(err.Error(), "UNIQUE constraint failed")
}
