# Wattson Go backend

This service owns Wattson's scenario model, scheduler, SQLite data, and HTTP API.

The scheduler uses 15-minute intervals. It applies active scenario events before it creates a plan. It then:

- reserves service capacity for critical, essential, and flexible contracts in that order;
- schedules runtime and energy commitments in the best forecast intervals before each deadline;
- uses renewable power, battery energy above the operating reserve, and diesel in that order;
- permits emergency battery use down to the physical minimum only for committed service;
- records deferrals, generator starts, contract state, costs, emissions, and final shortfalls.

## Local development

```bash
go run .
```

The service listens on port `8080` by default.

Available endpoints:

- `GET /health`
- `GET /v1/demo/operators`
- `GET /v1/demo/sites/{siteID}/scenario`
- `GET /v1/scenarios/{scenarioID}`
- `POST /v1/plan-runs`
- `GET /v1/plan-runs/{runID}`
- `GET /v1/scenarios/{scenarioID}/plan-runs`
- `GET /v1/events`

The canonical domain types are in `internal/domain`. The checked-in Spiti Valley scenario matches the current frontend data. The backend validates and inserts it during startup.

SQLite migrations are in `internal/database/migrations`. SQL source queries are in `internal/database/queries.sql`. The generated query layer is checked in under `internal/database/db`.

Regenerate the query layer after a schema or query change:

```bash
sqlc generate
```

## Environment variables

- `PORT` sets the HTTP port.
- `WEB_ORIGINS` contains a comma-separated list of allowed browser origins.
- `DATABASE_PATH` sets the SQLite file path. Its default value is `local.db`.

## VPS build

```bash
go test ./...
go build -o wattson-backend .
```

Copy the binary to the VPS. Then use the systemd unit in `deploy/wattson-backend.service`.

Place a TLS reverse proxy in front of the service before public deployment.
