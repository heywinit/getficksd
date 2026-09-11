export type ServerSentEvent = {
  data: unknown;
  event?: string;
  id?: string;
  retry?: number;
};

type EventStreamControls = {
  send: (event: ServerSentEvent) => void;
  close: () => void;
  signal: AbortSignal;
};

type EventStreamOptions = {
  onOpen: (controls: EventStreamControls) => void | (() => void) | Promise<void | (() => void)>;
  keepAliveMs?: number;
};

export function createEventStream(request: Request, options: EventStreamOptions) {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        cleanup?.();
        controller.close();
      };

      const send = (event: ServerSentEvent) => {
        if (!closed) {
          controller.enqueue(encoder.encode(formatServerSentEvent(event)));
        }
      };

      keepAlive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, options.keepAliveMs ?? 15_000);

      request.signal.addEventListener("abort", close, { once: true });
      Promise.resolve(options.onOpen({ send, close, signal: request.signal }))
        .then((result) => {
          if (typeof result === "function") {
            cleanup = result;
          }
        })
        .catch((error: unknown) => {
          send({
            event: "error",
            data: { message: error instanceof Error ? error.message : "Event stream failed." },
          });
          close();
        });
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

export function formatServerSentEvent(event: ServerSentEvent) {
  const lines: string[] = [];
  if (event.id) lines.push(`id: ${event.id}`);
  if (event.event) lines.push(`event: ${event.event}`);
  if (event.retry) lines.push(`retry: ${event.retry}`);

  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  for (const line of data.split("\n")) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}
