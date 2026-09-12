# Wattson Go backend

This service owns Wattson's scenario model, seed data, and HTTP API. It does not run an optimizer yet.

## Local development

```bash
go run .
```

The service listens on port `8080` by default.

Available endpoints:

- `GET /health`
- `GET /v1/demo/operators`
- `GET /v1/demo/sites/{siteID}/scenario`
- `GET /v1/events`

The canonical domain types are in `internal/domain`. The checked-in Spiti Valley scenario is generated from `cmd/generate-seeds` and validated during tests and service startup.

## Environment variables

- `PORT` sets the HTTP port.
- `WEB_ORIGINS` contains a comma-separated list of allowed browser origins.

## VPS build

```bash
go test ./...
go build -o wattson-backend .
```

Copy the binary to the VPS. Then use the systemd unit in `deploy/wattson-backend.service`.

Place a TLS reverse proxy in front of the service before public deployment.
