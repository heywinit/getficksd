import { createFileRoute } from "@tanstack/react-router";

import { backendUnavailable, getBackendUrl } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/demo/operators")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const response = await fetch(getBackendUrl("/v1/demo/operators"), {
            headers: { Accept: "application/json" },
            signal: request.signal,
          });

          return new Response(response.body, {
            status: response.status,
            headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
          });
        } catch (error) {
          return backendUnavailable(error);
        }
      },
    },
  },
});
