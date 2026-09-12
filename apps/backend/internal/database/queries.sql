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

-- name: ListScenarios :many
SELECT id, site_id, name, schema_version, document, created_at
FROM scenarios
ORDER BY created_at DESC, id DESC
LIMIT ? OFFSET ?;

-- name: DeletePlanRunsByScenario :exec
DELETE FROM plan_runs
WHERE scenario_id = ?;

-- name: DeleteScenario :execrows
DELETE FROM scenarios
WHERE id = ?;

-- name: RecordDeletedScenario :exec
INSERT INTO deleted_scenarios (id, deleted_at)
VALUES (?, ?)
ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at;

-- name: ScenarioWasDeleted :one
SELECT EXISTS(
    SELECT 1
    FROM deleted_scenarios
    WHERE id = ?
);

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
