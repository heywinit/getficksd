import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/scenarios/$scenarioId/plan-runs")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const sourceURL = new URL(request.url);
        const query = sourceURL.search;
        return forwardBackendJSON(
          request,
          `/v1/scenarios/${encodeURIComponent(params.scenarioId)}/plan-runs${query}`,
        );
      },
    },
  },
});
