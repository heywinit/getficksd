# Wattson Go backend

This service owns Wattson's scenario model, scheduler, SQLite data, and HTTP API.

The scheduler uses 15-minute intervals. It applies active scenario events before it creates a plan. It then:

- reserves service capacity for critical, essential, and flexible contracts in that order;
- schedules runtime and energy commitments in the best forecast intervals before each deadline;
- uses renewable power, battery energy above the operating reserve, and diesel in that order;
- permits emergency battery use down to the physical minimum only for committed service;
- uses diesel for remaining community demand instead of treating all uncontracted demand as disposable;
- enforces generator startup fuel, minimum runtime, ramp rate, stable output, and available fuel;
- records deferrals, generator starts, dumped power, contract state, costs, emissions, and final shortfalls;
- preserves AC power balance and battery energy balance in every interval.

## Local development

```bash
go run .
```

The service listens on port `8080` by default.

Available endpoints:

- `GET /health`
- `GET /v1/demo/operators`
- `GET /v1/demo/sites/{siteID}/scenario`
- `GET /v1/scenarios`
- `POST /v1/scenarios`
- `GET /v1/scenarios/{scenarioID}`
- `PUT /v1/scenarios/{scenarioID}`
- `DELETE /v1/scenarios/{scenarioID}`
- `PUT /v1/scenarios/{scenarioID}/signals/{signalID}`
- `PUT /v1/scenarios/{scenarioID}/initial-state`
- `POST /v1/scenarios/{scenarioID}/events`
- `DELETE /v1/scenarios/{scenarioID}/events/{eventID}`
- `POST /v1/plan-runs`
- `GET /v1/plan-runs/{runID}`
- `GET /v1/plan-runs/{runID}/comparison`
- `GET /v1/scenarios/{scenarioID}/plan-runs`
- `GET /v1/events`

A Wattson run can reference a baseline through `parent_run_id`. Its response includes measured summary, contract, service, asset, and interval differences. Each run stores its scenario revision and a canonical SHA-256 scenario snapshot hash. A comparison requires both to match, so an edit cannot silently invalidate the result.

The canonical domain types are in `internal/domain`. Each checked-in community scenario models eight services, seven commitments, and three disruptions. The backend inserts each scenario only when it is absent. It does not overwrite user edits at startup.

Scenario writes validate the complete scenario before the backend saves it. `POST /v1/scenarios` returns `409` for a duplicate ID. `PUT /v1/scenarios/{scenarioID}` replaces the full document, and its body ID must match the path. The signal, initial-state, and event routes return the full updated scenario.

SQLite migrations are in `internal/database/migrations`. SQL source queries are in `internal/database/queries.sql`. The generated query layer is checked in under `internal/database/db`.

Regenerate the query layer after a schema or query change:

```bash
sqlc generate
```

## Environment variables

- `PORT` sets the HTTP port.
- `WEB_ORIGINS` contains a comma-separated list of allowed browser origins.
- `DATABASE_PATH` sets the SQLite file path. Its default value is `local.db`.
- `MILP_ENABLED=false` disables the Python optimizer and uses the deterministic scheduler.
- `MILP_PYTHON_PATH` sets the optimizer Python executable. Its default value is `optimizer/.venv/bin/python`.
- `MILP_SCRIPT_PATH` sets the optimizer entrypoint. Its default value is `optimizer/solve.py`.
- `MILP_TIMEOUT` sets the process timeout. Its default value is `8s`.

Install the optimizer environment:

```bash
cd optimizer
uv sync --python 3.13
```

The `baseline` planner uses the deterministic scheduler. The `wattson` planner uses the MILP first and falls back if the solver fails verification.

## VPS build

```bash
go test ./...
go build -o wattson-backend .
```

Copy the binary to the VPS. Then use the systemd unit in `deploy/wattson-backend.service`.

Place a TLS reverse proxy in front of the service before public deployment.
