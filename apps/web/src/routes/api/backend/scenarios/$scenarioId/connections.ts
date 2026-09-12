import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/scenarios/$scenarioId/connections")({
  server: {
    handlers: {
      PUT: async ({ params, request }) =>
        forwardBackendJSON(
          request,
          `/v1/scenarios/${encodeURIComponent(params.scenarioId)}/connections`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: await request.text(),
          },
        ),
    },
  },
});
