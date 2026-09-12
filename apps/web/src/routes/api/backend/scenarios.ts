import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/scenarios")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sourceURL = new URL(request.url);
        return forwardBackendJSON(request, `/v1/scenarios${sourceURL.search}`);
      },
      POST: async ({ request }) =>
        forwardBackendJSON(request, "/v1/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: await request.text(),
        }),
    },
  },
});
