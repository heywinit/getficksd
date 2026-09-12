-- name: InsertScenario :exec
INSERT INTO scenarios (id, site_id, name, schema_version, document, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: UpdateScenario :execrows
UPDATE scenarios
SET
    site_id = ?,
    name = ?,
    schema_version = ?,
    document = ?
WHERE id = ?;

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
