import { useEffect, useRef, useState } from "react";

export type DraftStatus = "idle" | "saving" | "saved";

export function loadDraft<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const draft = window.localStorage.getItem(key);
  if (!draft) {
    return fallback;
  }

  try {
    return JSON.parse(draft) as T;
  } catch {
    return fallback;
  }
}

export function clearDraft(key: string) {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(key);
  }
}

export function useAutosaveDraft<T>(key: string, value: T, delay = 500) {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    setStatus("saving");
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(key, JSON.stringify(value));
      setStatus("saved");
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [delay, key, value]);

  return status;
}
