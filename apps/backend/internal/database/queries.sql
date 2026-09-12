-- name: UpsertScenario :exec
INSERT INTO scenarios (id, site_id, name, schema_version, document, created_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    site_id = excluded.site_id,
    name = excluded.name,
    schema_version = excluded.schema_version,
    document = excluded.document;

-- name: GetScenario :one
SELECT id, site_id, name, schema_version, document, created_at
FROM scenarios
WHERE id = ?;

-- name: GetScenarioBySite :one
SELECT id, site_id, name, schema_version, document, created_at
FROM scenarios
WHERE site_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: InsertPlanRun :exec
INSERT INTO plan_runs (
    id, scenario_id, planner, status, created_at, parent_run_id, active_event_ids, document
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetPlanRun :one
SELECT id, scenario_id, planner, status, created_at, parent_run_id, active_event_ids, document
FROM plan_runs
WHERE id = ?;

-- name: ListPlanRunsByScenario :many
SELECT id, scenario_id, planner, status, created_at, parent_run_id, active_event_ids, document
FROM plan_runs
WHERE scenario_id = ?
ORDER BY created_at DESC, id DESC
LIMIT ? OFFSET ?;
