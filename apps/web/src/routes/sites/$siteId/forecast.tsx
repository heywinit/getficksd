import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BatteryChargingIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  DropletsIcon,
  ExternalLinkIcon,
  FuelIcon,
  GaugeIcon,
  RefreshCwIcon,
  SunIcon,
  WindIcon,
  type LucideIcon,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import {
  siteForecastQueryOptions,
  type ForecastAction,
  type HourlyWeather,
  type SiteForecast,
} from "@/lib/weather";

export const Route = createFileRoute("/sites/$siteId/forecast")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(siteForecastQueryOptions(params.siteId)),
  pendingComponent: ForecastPending,
  errorComponent: ({ error, reset }) => <ForecastError error={error} onRetry={reset} />,
  component: SiteForecastPage,
});

function SiteForecastPage() {
  const { siteId } = Route.useParams();
  const {
    data: forecast,
    refetch,
    isFetching,
  } = useSuspenseQuery(siteForecastQueryOptions(siteId));

  if (!forecast.current || (forecast.hourly.length === 0 && forecast.daily.length === 0)) {
    return (
      <PageShell siteId={siteId} location={forecast.location.name}>
        <EmptyState
          icon={CloudIcon}
          title="No forecast is available"
          description="The weather provider returned no forecast periods for this site."
          action={
            <Button type="button" variant="outline" onClick={() => void refetch()}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh forecast
            </Button>
          }
        />
      </PageShell>
    );
  }

  const nextHours = futureHours(forecast).slice(0, 24);
  const priorityActions = [...forecast.operational_impact.actions]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3);

  return (
    <PageShell siteId={siteId} location={forecast.location.name}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{forecast.location.name}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Forecast</h1>
        </div>
        <div className="flex items-center gap-2">
          <CacheStatus status={forecast.provider.cache_status} />
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
            aria-label="Refresh forecast"
          >
            <RefreshCwIcon className={isFetching ? "animate-spin" : undefined} />
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
        <WeatherNow forecast={forecast} />
        <ActionList actions={priorityActions} total={forecast.operational_impact.actions.length} />
      </section>

      <SupplyOutlook hours={nextHours} />

      {forecast.daily.length > 0 ? <DailyStrip forecast={forecast} /> : null}

      <footer className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Updated {formatDateTime(forecast.provider.fetched_at)}</p>
        <a
          href={forecast.provider.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground hover:underline"
        >
          Weather by {forecast.provider.name} <ExternalLinkIcon className="size-3" />
        </a>
      </footer>
    </PageShell>
  );
}

function PageShell({
  siteId,
  location,
  children,
}: {
  siteId: string;
  location?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader siteId={siteId} siteName="Forecast" location={location} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <Link
          to="/sites/$siteId"
          params={{ siteId }}
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Site overview
        </Link>
        {children}
      </main>
    </div>
  );
}

function WeatherNow({ forecast }: { forecast: SiteForecast }) {
  const Icon = weatherIcon(forecast.current.weather_code);
  const today = forecast.daily[0];
  const rainRisk = today
    ? today.precipitation_probability_max_percent
    : Math.max(
        ...futureHours(forecast)
          .slice(0, 24)
          .map((hour) => hour.precipitation_probability_percent),
        0,
      );

  return (
    <Card className="justify-between">
      <CardHeader>
        <CardDescription>Now · {formatTime(forecast.current.time)}</CardDescription>
        <CardTitle>{forecast.current.condition}</CardTitle>
        <CardAction>
          <Icon className="size-12 text-chart-1" strokeWidth={1.5} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <p className="text-6xl font-semibold tracking-tighter tabular-nums">
            {round(forecast.current.temperature_c)}°
          </p>
          <dl className="grid min-w-64 flex-1 grid-cols-3 gap-2 sm:max-w-md">
            <WeatherMetric
              label="Today"
              value={
                today
                  ? `${round(today.temperature_max_c)}° / ${round(today.temperature_min_c)}°`
                  : "—"
              }
            />
            <WeatherMetric label="Rain risk" value={`${round(rainRisk)}%`} />
            <WeatherMetric
              label="Wind now"
              value={`${round(forecast.current.wind_speed_kph)} km/h`}
            />
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

function WeatherMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SupplyOutlook({ hours }: { hours: HourlyWeather[] }) {
  const periods = hours.filter((_, index) => index % 3 === 0).slice(0, 8);
  const solarPeak = findPeak(hours, (hour) => hour.shortwave_radiation_wm2);
  const windPeak = findPeak(hours, (hour) => hour.wind_speed_kph);
  const maxRadiation = Math.max(solarPeak?.shortwave_radiation_wm2 ?? 0, 1);
  const maxWind = Math.max(windPeak?.wind_speed_kph ?? 0, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next 24 hours</CardTitle>
        <CardDescription>Solar and wind supply signals</CardDescription>
        <CardAction className="hidden gap-5 text-xs text-muted-foreground sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <SunIcon className="size-3.5 text-chart-1" />
            {solarPeak
              ? `${round(solarPeak.shortwave_radiation_wm2)} W/m² at ${formatTime(solarPeak.time)}`
              : "No solar data"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <WindIcon className="size-3.5 text-chart-2" />
            {windPeak
              ? `${round(windPeak.wind_speed_kph)} km/h at ${formatTime(windPeak.time)}`
              : "No wind data"}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" aria-label="Solar and wind outlook">
          {periods.map((hour) => (
            <div key={hour.time} className="space-y-2 text-center">
              <div className="flex h-20 items-end justify-center gap-1 rounded-md bg-muted/40 px-2 pt-2">
                <span
                  className="w-2.5 rounded-t-sm bg-chart-1"
                  style={{
                    height: `${Math.max((hour.shortwave_radiation_wm2 / maxRadiation) * 100, 2)}%`,
                  }}
                  title={`${round(hour.shortwave_radiation_wm2)} W/m² solar radiation`}
                />
                <span
                  className="w-2.5 rounded-t-sm bg-chart-2"
                  style={{ height: `${Math.max((hour.wind_speed_kph / maxWind) * 100, 2)}%` }}
                  title={`${round(hour.wind_speed_kph)} km/h wind`}
                />
              </div>
              <p className="text-xs text-muted-foreground">{formatTime(hour.time)}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-muted-foreground sm:hidden">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-chart-1" /> Solar
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-chart-2" /> Wind
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionList({ actions, total }: { actions: ForecastAction[]; total: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Priority actions</CardTitle>
        <CardDescription>
          {total > 3 ? `Top 3 of ${total} actions` : "From the live forecast"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {actions.length === 0 ? (
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            No operating changes are needed.
          </div>
        ) : (
          <ol className="space-y-3">
            {actions.map((action, index) => {
              const Icon = actionIcon(action.category);
              return (
                <li
                  key={`${action.title}-${index}`}
                  className="flex items-start gap-3 border-b pb-3 last:border-0 last:pb-0"
                >
                  <div className={actionIconClass(action.severity)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium">{action.title}</p>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                        {action.timeframe}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.reason}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DailyStrip({ forecast }: { forecast: SiteForecast }) {
  return (
    <section aria-labelledby="daily-heading" className="space-y-3">
      <h2 id="daily-heading" className="text-lg font-medium">
        7-day outlook
      </h2>
      <div className="grid grid-flow-col auto-cols-[9rem] gap-2 overflow-x-auto pb-2 lg:grid-flow-row lg:grid-cols-7">
        {forecast.daily.slice(0, 7).map((day, index) => {
          const Icon = weatherIcon(day.weather_code);
          return (
            <Card key={day.date} size="sm">
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {index === 0 ? "Today" : formatWeekday(day.date)}
                  </p>
                  <Icon className="size-5 text-chart-1" />
                </div>
                <p className="font-medium tabular-nums">
                  {round(day.temperature_max_c)}°{" "}
                  <span className="text-sm text-muted-foreground">
                    {round(day.temperature_min_c)}°
                  </span>
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <DropletsIcon className="size-3" />
                  {round(day.precipitation_probability_max_percent)}%
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function futureHours(forecast: SiteForecast) {
  const firstFutureIndex = forecast.hourly.findIndex((hour) => hour.time >= forecast.current.time);
  return firstFutureIndex < 0 ? forecast.hourly : forecast.hourly.slice(firstFutureIndex);
}

function findPeak(hours: HourlyWeather[], value: (hour: HourlyWeather) => number) {
  return hours.reduce<HourlyWeather | undefined>((peak, hour) => {
    if (!peak || value(hour) > value(peak)) return hour;
    return peak;
  }, undefined);
}

function severityRank(severity: ForecastAction["severity"]) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function CacheStatus({ status }: { status: SiteForecast["provider"]["cache_status"] }) {
  const labels = { live: "Live", fresh_cache: "Cached", stale_cache: "Stale" };
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-xs">
      <span
        className={
          status === "stale_cache"
            ? "size-2 rounded-full bg-destructive"
            : "size-2 rounded-full bg-primary"
        }
      />
      {labels[status]}
    </span>
  );
}

function ForecastError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    </main>
  );
}

function ForecastPending() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader siteName="Forecast" />
      <div className="mx-auto max-w-7xl">
        <LoadingState label="Loading the site forecast" rows={4} />
      </div>
    </div>
  );
}

function weatherIcon(code: number): LucideIcon {
  if (code === 0) return SunIcon;
  if ([1, 2, 3, 45, 48].includes(code)) return CloudIcon;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return CloudRainIcon;
  }
  if ([95, 96, 99].includes(code)) return CloudLightningIcon;
  return CloudIcon;
}

function actionIcon(category: string): LucideIcon {
  if (category === "solar") return SunIcon;
  if (category === "wind") return WindIcon;
  if (category === "battery") return BatteryChargingIcon;
  if (category === "diesel") return FuelIcon;
  return GaugeIcon;
}

function actionIconClass(severity: ForecastAction["severity"]) {
  const base = "flex size-8 shrink-0 items-center justify-center rounded-lg";
  if (severity === "critical") return `${base} bg-destructive/15 text-destructive`;
  if (severity === "warning") return `${base} bg-chart-4/15 text-chart-4`;
  return `${base} bg-primary/15 text-primary`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatWeekday(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function round(value: number) {
  return Math.round(value);
}
