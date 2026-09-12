import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/scenarios/$scenarioId")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        forwardBackendJSON(request, `/v1/scenarios/${encodeURIComponent(params.scenarioId)}`),
    },
  },
});
