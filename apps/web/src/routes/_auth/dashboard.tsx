import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  const trpc = useTRPC();
  const privateData = useQuery(trpc.privateData.queryOptions());

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {session.user.name}</h1>
        <p className="text-sm text-muted-foreground">
          Start from this dashboard after you choose the problem statement.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <section className="border p-4">
          <p className="text-xs text-muted-foreground">API status</p>
          <p className="mt-1 font-medium">
            {privateData.isLoading ? "Checking..." : (privateData.data?.message ?? "Unavailable")}
          </p>
        </section>
      </div>
    </div>
  );
}
