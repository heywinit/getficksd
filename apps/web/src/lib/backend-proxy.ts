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
