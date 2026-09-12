import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/plan-runs/$runId")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        forwardBackendJSON(request, `/v1/plan-runs/${encodeURIComponent(params.runId)}`),
    },
  },
});
