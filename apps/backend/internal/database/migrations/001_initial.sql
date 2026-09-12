CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    document BLOB NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX scenarios_site_created_idx ON scenarios(site_id, created_at DESC);

CREATE TABLE plan_runs (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id),
    planner TEXT NOT NULL CHECK (planner IN ('baseline', 'wattson')),
    status TEXT NOT NULL CHECK (status IN ('computing', 'complete', 'infeasible', 'failed')),
    created_at TEXT NOT NULL,
    parent_run_id TEXT REFERENCES plan_runs(id),
    active_event_ids BLOB NOT NULL,
    document BLOB NOT NULL
);

CREATE INDEX plan_runs_scenario_created_idx ON plan_runs(scenario_id, created_at DESC);
