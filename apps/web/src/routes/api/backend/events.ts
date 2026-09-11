import { createFileRoute } from "@tanstack/react-router";

import { backendUnavailable, getBackendUrl } from "@/lib/backend-proxy";

export const Route = createFileRoute("/api/backend/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const response = await fetch(getBackendUrl("/v1/events"), {
            headers: { Accept: "text/event-stream" },
            signal: request.signal,
          });

          if (!response.ok || !response.body) {
            return Response.json(
              { message: "The Go event stream is unavailable." },
              { status: 502 },
            );
          }

          return new Response(response.body, {
            status: response.status,
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "Content-Type": "text/event-stream; charset=utf-8",
              "X-Accel-Buffering": "no",
            },
          });
        } catch (error) {
          return backendUnavailable(error);
        }
      },
    },
  },
});
