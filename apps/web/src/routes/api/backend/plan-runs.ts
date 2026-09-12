import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/plan-runs")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        forwardBackendJSON(request, "/v1/plan-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: await request.text(),
        }),
    },
  },
});
