import { useEffect, useState } from "react";

export type EventStreamStatus = "connecting" | "open" | "closed" | "error";

type UseEventStreamOptions<T> = {
  enabled?: boolean;
  parse?: (data: string) => T;
};

export function useEventStream<T = unknown>(url: string, options: UseEventStreamOptions<T> = {}) {
  const { enabled = true, parse = JSON.parse as (data: string) => T } = options;
  const [status, setStatus] = useState<EventStreamStatus>(enabled ? "connecting" : "closed");
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Event>();

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }

    const source = new EventSource(url, { withCredentials: true });
    setStatus("connecting");
    setError(undefined);

    source.onopen = () => setStatus("open");
    source.onmessage = (event) => {
      try {
        setData(parse(event.data));
      } catch (parseError) {
        setError(parseError instanceof Event ? parseError : new Event("parse-error"));
        setStatus("error");
      }
    };
    source.onerror = (event) => {
      setError(event);
      setStatus(source.readyState === EventSource.CLOSED ? "closed" : "error");
    };

    return () => {
      source.close();
      setStatus("closed");
    };
  }, [enabled, parse, url]);

  return { data, error, status };
}
