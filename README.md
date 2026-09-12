# Wattson

Wattson uses TanStack Start for the web application and Go for the backend.

The repository contains the clean application foundation and the first version of Wattson's energy domain. The optimizer will be added later.

The demo uses four seeded operators. Each operator owns a complete, validated 24-hour community-grid scenario. The selected operator stays in local browser storage.

## Structure

```text
apps/
├── backend/    # Go HTTP service
└── web/        # TanStack Start application
packages/
├── config/     # Shared TypeScript configuration
├── infra/      # Cloudflare deployment
└── ui/         # Shared React components
```

## Local development

Install the JavaScript dependencies:

```bash
bun install
```

Copy the web environment file:

```bash
cp apps/web/.env.example apps/web/.env
```

Start both applications:

```bash
bun run dev
```

The web application uses port `3001`. The Go backend uses port `8080`.

The TanStack server proxies these same-origin routes to Go:

- `/api/backend/health`
- `/api/backend/events`
- `/api/backend/demo/operators`
- `/api/backend/demo/sites/:siteId/scenario`

Set `BACKEND_URL` to the private or public URL of the Go service.

## Scenario data

The seeds live in `apps/backend/seeddata`. They contain each site, its assets, services, contracts, signals, disruptions, and all 96 fifteen-minute values.

Regenerate it after changing its source model:

```bash
cd apps/backend
go run ./cmd/generate-seeds
```

The backend validates every embedded scenario when it starts.

## Checks

```bash
bun run check
```

## Deployment

The web application deploys to Cloudflare through Alchemy.

The Go backend deploys to a VPS. See `apps/backend/README.md` and `deploy/wattson-backend.service`.

## Template archive

Removed template features remain under `.template-archive` during the migration. Remove this archive after the new structure is accepted.
