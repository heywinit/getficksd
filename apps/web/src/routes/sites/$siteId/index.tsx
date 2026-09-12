import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BatteryChargingIcon,
  CalendarClockIcon,
  CloudSunIcon,
  FactoryIcon,
  GaugeIcon,
  SunIcon,
  UsersIcon,
  WindIcon,
  ZapIcon,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { ErrorState, LoadingState } from "@/components/page-state";
import { siteQueryOptions } from "@/lib/site-queries";
import type { Scenario } from "@/lib/plan-run";

export const Route = createFileRoute("/sites/$siteId/")({
  component: SiteOverview,
});

function SiteOverview() {
  const { siteId } = Route.useParams();
  const siteQuery = useQuery(siteQueryOptions(siteId));

  if (siteQuery.isPending) {
    return (
      <div className="min-h-svh bg-background">
        <AppHeader />
        <LoadingState label="Loading site" rows={5} />
      </div>
    );
  }
  if (siteQuery.isError) {
    return (
      <div className="min-h-svh bg-background">
        <AppHeader />
        <ErrorState error={siteQuery.error} onRetry={() => siteQuery.refetch()} />
      </div>
    );
  }

  const detail = siteQuery.data;
  const capacity = totalCapacity(detail.site.assets);
  const latestRun = detail.latest_run;
  const breached = latestRun?.summary.contracts_breached ?? 0;

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader siteId={siteId} siteName={detail.site.name} location={detail.site.location} />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Site overview
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {detail.site.name}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {detail.current_scenario.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              render={<Link to="/sites/$siteId/forecast" params={{ siteId }} />}
            >
              <CloudSunIcon /> Forecast
            </Button>
            <Button render={<Link to="/sites/$siteId/operate" params={{ siteId }} />}>
              Open operations <ArrowRightIcon />
            </Button>
          </div>
        </section>

        <section
          className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Site capacity"
        >
          <Metric
            icon={SunIcon}
            label="Solar capacity"
            value={`${formatNumber(capacity.solar)} kW`}
            accent="bg-chart-1/15 text-chart-1"
          />
          <Metric
            icon={WindIcon}
            label="Wind capacity"
            value={`${formatNumber(capacity.wind)} kW`}
            accent="bg-chart-2/15 text-chart-2"
          />
          <Metric
            icon={BatteryChargingIcon}
            label="Battery storage"
            value={`${formatNumber(capacity.battery)} kWh`}
            accent="bg-chart-3/15 text-chart-3"
          />
          <Metric
            icon={FactoryIcon}
            label="Diesel capacity"
            value={`${formatNumber(capacity.diesel)} kW`}
            accent="bg-chart-4/15 text-chart-4"
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Current operating picture</CardTitle>
              <CardDescription>Latest persisted plan results for this site.</CardDescription>
            </CardHeader>
            <CardContent>
              {latestRun ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <RunMetric label="Plan status" value={latestRun.status} icon={GaugeIcon} />
                  <RunMetric
                    label="Commitments protected"
                    value={`${latestRun.summary.contracts_met} of ${latestRun.summary.contracts_met + latestRun.summary.contracts_breached}`}
                    icon={ZapIcon}
                  />
                  <RunMetric
                    label="Unserved energy"
                    value={`${formatNumber(latestRun.summary.unserved_energy_kwh)} kWh`}
                    icon={CalendarClockIcon}
                  />
                  <RunMetric
                    label="Renewable energy"
                    value={`${formatNumber(latestRun.summary.renewable_energy_kwh)} kWh`}
                    icon={CloudSunIcon}
                  />
                  <div
                    className={`sm:col-span-2 rounded-lg border p-3 ${breached > 0 ? "border-destructive/30 bg-destructive/10" : "border-primary/30 bg-primary/10"}`}
                  >
                    <p
                      className={`text-sm font-medium ${breached > 0 ? "text-destructive" : "text-primary"}`}
                    >
                      {breached > 0
                        ? `${breached} commitments need attention`
                        : "All commitments are protected"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Plan created {formatDate(latestRun.created_at, detail.site.timezone)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-6 text-center">
                  <p className="text-sm font-medium">No plan run yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Open operations to create the first site plan.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Scenario</CardTitle>
                <CardDescription>{detail.current_scenario.name}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <Detail label="Revision" value={`${detail.current_scenario.revision}`} />
                <Detail
                  label="Plan interval"
                  value={`${detail.current_scenario.horizon.interval_minutes} min`}
                />
                <Detail label="Commitments" value={`${detail.commitment_count}`} />
                <Detail
                  label="Active events"
                  value={`${detail.active_event_count} of ${detail.event_count}`}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Services</CardTitle>
                <CardDescription>
                  {detail.site.services.length} connected demand groups
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.site.services.length > 0 ? (
                  detail.site.services.map((service) => (
                    <div
                      key={service.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{service.name}</span>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatNumber(service.rated_power_kw)} kW
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    This site has no connected services.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof SunIcon;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg ${accent}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RunMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GaugeIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold capitalize tabular-nums">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
    </div>
  );
}

function totalCapacity(assets: Scenario["site"]["assets"]) {
  return assets.reduce(
    (total, asset) => {
      if (asset.type === "solar") total.solar += asset.capacity_kw ?? 0;
      if (asset.type === "wind") total.wind += asset.capacity_kw ?? 0;
      if (asset.type === "battery") total.battery += asset.capacity_kwh ?? 0;
      if (asset.type === "diesel") total.diesel += asset.maximum_output_kw ?? 0;
      return total;
    },
    { solar: 0, wind: 0, battery: 0, diesel: 0 },
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
