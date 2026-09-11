import { createAuth } from "@getficksd/auth";
import { createFileRoute } from "@tanstack/react-router";

import { createEventStream } from "@/lib/server-sent-events";

export const Route = createFileRoute("/api/events/$channel")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await createAuth().api.getSession({ headers: request.headers });
        if (!session) {
          return Response.json({ message: "Authentication required." }, { status: 401 });
        }

        return createEventStream(request, {
          onOpen({ send }) {
            send({
              data: {
                type: "connected",
                channel: params.channel,
                connectedAt: new Date().toISOString(),
              },
              retry: 3_000,
            });
          },
        });
      },
    },
  },
});
