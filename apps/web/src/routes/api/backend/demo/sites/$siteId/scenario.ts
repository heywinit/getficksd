import { createFileRoute } from "@tanstack/react-router";

import { backendUnavailable, getBackendUrl } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/demo/sites/$siteId/scenario")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const response = await fetch(
            getBackendUrl(`/v1/demo/sites/${encodeURIComponent(params.siteId)}/scenario`),
            {
              headers: { Accept: "application/json" },
              signal: request.signal,
            },
          );

          return new Response(response.body, {
            status: response.status,
            headers: {
              "Content-Type": response.headers.get("Content-Type") ?? "application/json",
            },
          });
        } catch (error) {
          return backendUnavailable(error);
        }
      },
    },
  },
});
