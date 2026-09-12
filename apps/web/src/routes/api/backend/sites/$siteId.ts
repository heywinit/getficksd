import { createFileRoute } from "@tanstack/react-router";

import { forwardBackendJSON } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/sites/$siteId")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        forwardBackendJSON(request, `/v1/sites/${encodeURIComponent(params.siteId)}`),
    },
  },
});
