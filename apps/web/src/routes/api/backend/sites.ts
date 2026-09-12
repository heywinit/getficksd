import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/sites")({
  server: {
    handlers: {
      GET: async ({ request }) => forwardBackendJSON(request, "/v1/sites"),
      POST: async ({ request }) =>
        forwardBackendJSON(request, "/v1/sites", {
          method: "POST",
          body: await request.text(),
        }),
    },
  },
});
