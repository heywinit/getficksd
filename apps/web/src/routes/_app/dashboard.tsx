import { Card, CardContent, CardHeader, CardTitle } from "@getficksd/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityIcon,
  BatteryChargingIcon,
  FuelIcon,
  GaugeIcon,
  MapPinIcon,
  RadioIcon,
  SunIcon,
  WindIcon,
} from "lucide-react";

import { useEventStream } from "@/hooks/use-event-stream";
import { type BackendEvent, getBackendHealth } from "@/lib/backend";
import { useDemoWorkspace } from "@/lib/demo-workspace";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { error: workspaceError, isLoading: workspaceLoading, operator } = useDemoWorkspace();
  const health = useQuery({
    queryKey: ["backend", "health"],
    queryFn: ({ signal }) => getBackendHealth(signal),
    refetchInterval: 30_000,
  });
  const events = useEventStream<BackendEvent>("/api/backend/events");

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <p className="text-sm font-medium text-primary">Demo workspace</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {operator ? operator.site.name : "Loading demo workspace"}
        </h1>
        {operator ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPinIcon className="size-3.5" />
            {operator.site.location} · {operator.name}, {operator.role.toLowerCase()}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {workspaceLoading ? "Loading seeded operator data" : workspaceError}
          </p>
        )}
      </div>

      {operator ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Grid summary">
          <MetricCard
            label="Peak demand"
            value={`${operator.site.peak_demand_kw} kW`}
            icon={GaugeIcon}
          />
          <MetricCard
            label="Solar"
            value={`${operator.site.solar_capacity_kw} kW`}
            icon={SunIcon}
          />
          <MetricCard label="Wind" value={`${operator.site.wind_capacity_kw} kW`} icon={WindIcon} />
          <MetricCard
            label="Battery"
            value={`${operator.site.battery_capacity_kwh} kWh`}
            icon={BatteryChargingIcon}
          />
          <MetricCard
            label="Diesel backup"
            value={`${operator.site.diesel_capacity_kw} kW`}
            icon={FuelIcon}
          />
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2" aria-label="System connection">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Go backend</CardTitle>
            <ActivityIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {health.isPending
                ? "Connecting"
                : health.data?.status === "ok"
                  ? "Online"
                  : "Offline"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {health.data
                ? `${health.data.service} ${health.data.version}`
                : (health.error?.message ?? "Waiting for the service")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Event stream</CardTitle>
            <RadioIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold capitalize">{events.status}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {events.data ? `Last event: ${events.data.type}` : "Waiting for the first event"}
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GaugeIcon;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          <Icon className="size-4" />
        </div>
        <p className="mt-3 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
