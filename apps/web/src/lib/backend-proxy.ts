export function getBackendUrl(path: string) {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8080";
  const baseUrl = backendUrl.endsWith("/") ? backendUrl : `${backendUrl}/`;
  return new URL(path.replace(/^\//, ""), baseUrl);
}

export function backendUnavailable(error: unknown) {
  const cause = error instanceof Error ? error.message : "Unknown backend error";

  return Response.json(
    {
      message: "The Go backend is unavailable.",
      cause,
    },
    { status: 502 },
  );
}

export async function forwardBackendJSON(
  request: Request,
  path: string,
  init: Omit<RequestInit, "signal"> = {},
) {
  try {
    const response = await fetch(getBackendUrl(path), {
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
      signal: request.signal,
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    return backendUnavailable(error);
  }
}
