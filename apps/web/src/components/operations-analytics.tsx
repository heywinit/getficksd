import { useMemo } from "react";

import {
  EChartsLineChart,
  type ChartConfig,
} from "@/components/evilcharts/charts/echarts-line-chart";
import type { PlanRun, Scenario } from "@/lib/plan-run";

type AnalyticsDatum = {
  time: string;
  demandKw: number;
  deliveredKw: number;
  batteryKwh: number;
  unservedKw: number;
};

type SeriesKey = Exclude<keyof AnalyticsDatum, "time">;

const analyticsConfig = {
  demandKw: {
    label: "Demand",
    colors: { light: ["var(--foreground)"], dark: ["var(--foreground)"] },
  },
  deliveredKw: {
    label: "Delivered",
    colors: {
      light: ["var(--muted-foreground)"],
      dark: ["var(--muted-foreground)"],
    },
  },
  batteryKwh: {
    label: "Battery energy",
    colors: {
      light: ["var(--muted-foreground)"],
      dark: ["var(--muted-foreground)"],
    },
  },
  unservedKw: {
    label: "Unserved demand",
    colors: { light: ["var(--destructive)"], dark: ["var(--destructive)"] },
  },
} satisfies ChartConfig;

export function OperationsAnalytics({ scenario, run }: { scenario?: Scenario; run?: PlanRun }) {
  const data = useMemo(() => createAnalyticsData(scenario, run), [run, scenario]);
  const metrics = useMemo(() => summarizeAnalytics(data, scenario, run), [data, run, scenario]);
  const isLoading = !scenario;

  return (
    <section
      className="px-16 pb-8 pt-6 sm:px-24 lg:px-40 xl:px-48 2xl:px-64"
      aria-labelledby="analytics-title"
    >
      <header className="mb-3">
        <h2 id="analytics-title" className="text-lg font-semibold tracking-tight">
          Key signals
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {run ? "Scheduled operation" : "Forecast operation"}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnalyticsCard
          className="md:col-span-2 xl:col-span-1"
          title="Power balance"
          metric={formatMetric(metrics.peakDemand)}
          unit="kW peak demand"
          data={data}
          series={["demandKw", "deliveredKw"]}
          axisUnit="kW"
          showAxis
          isLoading={isLoading}
        />
        <AnalyticsCard
          title="Unserved energy"
          metric={formatMetric(metrics.unservedEnergy, 1)}
          unit="kWh"
          data={data}
          series={["unservedKw"]}
          axisUnit="kW"
          isLoading={isLoading}
          alert={metrics.unservedEnergy > 0}
        />
        <AnalyticsCard
          title="Battery reserve"
          metric={formatMetric(metrics.minimumBattery)}
          unit="kWh minimum"
          data={data}
          series={["batteryKwh"]}
          axisUnit="kWh"
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}

function AnalyticsCard({
  title,
  metric,
  unit,
  data,
  series,
  axisUnit,
  showAxis = false,
  isLoading,
  alert = false,
  className = "",
}: {
  title: string;
  metric: string;
  unit: string;
  data: AnalyticsDatum[];
  series: SeriesKey[];
  axisUnit: string;
  showAxis?: boolean;
  isLoading: boolean;
  alert?: boolean;
  className?: string;
}) {
  return (
    <article
      className={`flex h-52 min-w-0 flex-col overflow-hidden rounded-xl border bg-card ${alert ? "border-destructive/50" : "border-border"} ${className}`}
    >
      <header className="flex items-start justify-between gap-3 px-3 pb-0.5 pt-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-medium tracking-[-0.04em] text-card-foreground">
              {isLoading ? "—" : metric}
            </span>
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 px-1.5 pb-1.5">
        <EChartsLineChart
          className="h-full"
          data={data}
          config={analyticsConfig}
          xDataKey="time"
          curveType="monotoneX"
          animationType="left-to-right"
          enableHoverHighlight={series.length > 1}
          isLoading={isLoading}
        >
          {series.map((dataKey) => (
            <EChartsLineChart.Line key={dataKey} dataKey={dataKey} strokeWidth={1.5}>
              <EChartsLineChart.ActiveDot variant="colored-border" />
            </EChartsLineChart.Line>
          ))}
          {showAxis ? (
            <>
              <EChartsLineChart.Grid />
              <EChartsLineChart.YAxis
                hideDots
                tickFormatter={(value) => `${formatMetric(value)} ${axisUnit}`}
              />
            </>
          ) : null}
          <EChartsLineChart.Tooltip variant="frosted-glass" roundness="lg" cursor />
        </EChartsLineChart>
      </div>
    </article>
  );
}

function createAnalyticsData(scenario?: Scenario, run?: PlanRun): AnalyticsDatum[] {
  if (!scenario) return [];

  const count = run?.intervals.length ?? scenario.horizon.interval_count;
  const intervalMinutes = scenario.horizon.interval_minutes;
  const startsAt = new Date(scenario.horizon.starts_at).getTime();
  const timeFormatter = new Intl.DateTimeFormat("en", {
    timeZone: scenario.site.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const initialBattery = scenario.initial_state.assets
    .filter((asset) => asset.type === "battery")
    .reduce((total, asset) => total + (asset.stored_energy_kwh ?? 0), 0);

  return Array.from({ length: count }, (_, index) => {
    const interval = run?.intervals[index];
    const demandKw = interval
      ? sum(interval.services.map((service) => service.requested_kw))
      : signalTotal(scenario, "service_demand", index);
    const deliveredKw = interval
      ? sum(interval.services.map((service) => service.delivered_kw))
      : demandKw;
    const batteryKwh = interval
      ? sum(interval.batteries.map((battery) => battery.ending_energy_kwh))
      : initialBattery;
    const unservedKw = interval ? sum(interval.services.map((service) => service.unserved_kw)) : 0;

    return {
      time: timeFormatter.format(new Date(startsAt + index * intervalMinutes * 60_000)),
      demandKw: round(demandKw),
      deliveredKw: round(deliveredKw),
      batteryKwh: round(batteryKwh),
      unservedKw: round(unservedKw),
    };
  });
}

function summarizeAnalytics(data: AnalyticsDatum[], scenario?: Scenario, run?: PlanRun) {
  return {
    peakDemand: Math.max(0, ...data.map((row) => row.demandKw)),
    unservedEnergy:
      run?.summary.unserved_energy_kwh ??
      sum(data.map((row) => row.unservedKw)) * ((scenario?.horizon.interval_minutes ?? 0) / 60),
    minimumBattery:
      run?.summary.minimum_battery_energy_kwh ??
      (data.length > 0 ? Math.min(...data.map((row) => row.batteryKwh)) : 0),
  };
}

function signalTotal(scenario: Scenario, kind: Scenario["signals"][number]["kind"], index: number) {
  return scenario.signals
    .filter((signal) => signal.kind === kind)
    .reduce((total, signal) => total + (signal.values[index] ?? 0), 0);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function formatMetric(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}
