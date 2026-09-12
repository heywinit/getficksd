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
	database *sql.DB
	queries  *db.Queries
}

func NewStore(database *sql.DB) *Store {
	return &Store{database: database, queries: db.New(database)}
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
	domain.NormalizeScenarioConnections(&scenario)
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

func (s *Store) Scenarios(ctx context.Context, limit, offset int64) ([]domain.Scenario, error) {
	rows, err := s.queries.ListScenarios(ctx, db.ListScenariosParams{Limit: limit, Offset: offset})
	if err != nil {
		return nil, fmt.Errorf("list scenarios: %w", err)
	}
	scenarios := make([]domain.Scenario, 0, len(rows))
	for _, row := range rows {
		scenario, err := decodeScenario(row.Document)
		if err != nil {
			return nil, err
		}
		scenarios = append(scenarios, scenario)
	}
	return scenarios, nil
}

func (s *Store) DeleteScenario(ctx context.Context, id string) error {
	transaction, err := s.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin scenario deletion: %w", err)
	}
	defer transaction.Rollback()
	queries := db.New(transaction)
	if _, err := queries.GetScenario(ctx, id); err != nil {
		return storeError("delete scenario", err)
	}
	if err := queries.DeletePlanRunsByScenario(ctx, id); err != nil {
		return fmt.Errorf("delete scenario plan runs: %w", err)
	}
	deleted, err := queries.DeleteScenario(ctx, id)
	if err != nil {
		return fmt.Errorf("delete scenario: %w", err)
	}
	if deleted == 0 {
		return fmt.Errorf("delete scenario: %w", ErrNotFound)
	}
	if err := queries.RecordDeletedScenario(ctx, db.RecordDeletedScenarioParams{
		ID:        id,
		DeletedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}); err != nil {
		return fmt.Errorf("record scenario deletion: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit scenario deletion: %w", err)
	}
	return nil
}

func (s *Store) ScenarioWasDeleted(ctx context.Context, id string) (bool, error) {
	deleted, err := s.queries.ScenarioWasDeleted(ctx, id)
	if err != nil {
		return false, fmt.Errorf("read scenario deletion: %w", err)
	}
	return deleted != 0, nil
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

func (s *Store) LatestPlanRun(ctx context.Context, scenarioID string) (*domain.PlanRun, error) {
	runs, err := s.PlanRuns(ctx, scenarioID, 1, 0)
	if err != nil {
		return nil, err
	}
	if len(runs) == 0 {
		return nil, nil
	}
	return &runs[0], nil
}

type StoredWeatherLocation struct {
	SiteID     string
	Location   domain.ForecastLocation
	ResolvedAt time.Time
}

func (s *Store) WeatherLocation(ctx context.Context, siteID string) (StoredWeatherLocation, error) {
	var row StoredWeatherLocation
	var resolvedAt string
	err := s.database.QueryRowContext(ctx, `
		SELECT site_id, location_name, latitude, longitude, timezone, resolved_at
		FROM site_weather_locations WHERE site_id = ?`, siteID).Scan(
		&row.SiteID, &row.Location.Name, &row.Location.Latitude, &row.Location.Longitude, &row.Location.Timezone, &resolvedAt,
	)
	if err != nil {
		return StoredWeatherLocation{}, storeError("get weather location", err)
	}
	row.ResolvedAt, err = time.Parse(time.RFC3339Nano, resolvedAt)
	if err != nil {
		return StoredWeatherLocation{}, fmt.Errorf("decode weather location time: %w", err)
	}
	return row, nil
}

func (s *Store) SaveWeatherLocation(ctx context.Context, siteID string, location domain.ForecastLocation, resolvedAt time.Time) error {
	_, err := s.database.ExecContext(ctx, `
		INSERT INTO site_weather_locations(site_id, location_name, latitude, longitude, timezone, resolved_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(site_id) DO UPDATE SET
			location_name = excluded.location_name,
			latitude = excluded.latitude,
			longitude = excluded.longitude,
			timezone = excluded.timezone,
			resolved_at = excluded.resolved_at`,
		siteID, location.Name, location.Latitude, location.Longitude, location.Timezone, resolvedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("save weather location: %w", err)
	}
	return nil
}

type StoredForecast struct {
	Forecast  domain.WeatherForecast
	FetchedAt time.Time
	ExpiresAt time.Time
}

func (s *Store) WeatherForecast(ctx context.Context, siteID string) (StoredForecast, error) {
	var document []byte
	var fetchedAt, expiresAt string
	if err := s.database.QueryRowContext(ctx, `
		SELECT document, fetched_at, expires_at FROM weather_forecasts WHERE site_id = ?`, siteID,
	).Scan(&document, &fetchedAt, &expiresAt); err != nil {
		return StoredForecast{}, storeError("get weather forecast", err)
	}
	var result StoredForecast
	if err := json.Unmarshal(document, &result.Forecast); err != nil {
		return StoredForecast{}, fmt.Errorf("decode weather forecast: %w", err)
	}
	var err error
	result.FetchedAt, err = time.Parse(time.RFC3339Nano, fetchedAt)
	if err != nil {
		return StoredForecast{}, fmt.Errorf("decode weather forecast fetch time: %w", err)
	}
	result.ExpiresAt, err = time.Parse(time.RFC3339Nano, expiresAt)
	if err != nil {
		return StoredForecast{}, fmt.Errorf("decode weather forecast expiry: %w", err)
	}
	return result, nil
}

func (s *Store) SaveWeatherForecast(ctx context.Context, forecast domain.WeatherForecast, expiresAt time.Time) error {
	document, err := json.Marshal(forecast)
	if err != nil {
		return fmt.Errorf("encode weather forecast: %w", err)
	}
	_, err = s.database.ExecContext(ctx, `
		INSERT INTO weather_forecasts(site_id, document, fetched_at, expires_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(site_id) DO UPDATE SET
			document = excluded.document,
			fetched_at = excluded.fetched_at,
			expires_at = excluded.expires_at`,
		forecast.SiteID, document, forecast.Provider.FetchedAt.UTC().Format(time.RFC3339Nano), expiresAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("save weather forecast: %w", err)
	}
	return nil
}

func decodeScenario(document []byte) (domain.Scenario, error) {
	var scenario domain.Scenario
	if err := json.Unmarshal(document, &scenario); err != nil {
		return domain.Scenario{}, fmt.Errorf("decode stored scenario: %w", err)
	}
	domain.NormalizeScenarioConnections(&scenario)
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
