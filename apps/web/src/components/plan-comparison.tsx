import {
  ActivityIcon,
  ArrowRightIcon,
  BatteryChargingIcon,
  CircleDollarSignIcon,
  CloudIcon,
  FuelIcon,
  ShieldCheckIcon,
  SunIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { PlanComparison, PlanRun, Scenario } from "@/lib/plan-run";

type Direction = "higher" | "lower";

const summaryMetrics = [
  {
    key: "renewable_energy_kwh",
    label: "Renewable energy",
    unit: "kWh",
    direction: "higher",
    icon: SunIcon,
  },
  {
    key: "diesel_energy_kwh",
    label: "Diesel generation",
    unit: "kWh",
    direction: "lower",
    icon: FuelIcon,
  },
  {
    key: "total_diesel_cost",
    label: "Diesel cost",
    unit: "cost",
    direction: "lower",
    icon: CircleDollarSignIcon,
  },
  {
    key: "total_emissions_kg_co2",
    label: "Emissions",
    unit: "kg CO₂",
    direction: "lower",
    icon: CloudIcon,
  },
  {
    key: "unserved_energy_kwh",
    label: "Unserved energy",
    unit: "kWh",
    direction: "lower",
    icon: ActivityIcon,
  },
  {
    key: "minimum_battery_energy_kwh",
    label: "Minimum battery",
    unit: "kWh",
    direction: "higher",
    icon: BatteryChargingIcon,
  },
] as const;

export function PlanComparisonPanel({ scenario, run }: { scenario?: Scenario; run?: PlanRun }) {
  const comparison = run?.comparison;
  if (!scenario || !comparison) return null;

  const materialContracts = comparison.contracts.filter(
    (contract) =>
      contract.status_change !== "unchanged" || Math.abs(contract.shortfall.delta) > 0.0001,
  );
  const materialServices = comparison.services
    .filter(
      (service) =>
        Math.abs(service.delivered_energy_kwh.delta) > 0.0001 ||
        Math.abs(service.deferred_energy_kwh.delta) > 0.0001 ||
        Math.abs(service.unserved_energy_kwh.delta) > 0.0001,
    )
    .sort((left, right) => serviceMagnitude(right) - serviceMagnitude(left));
  const criticalIntervals = [...comparison.intervals]
    .filter((interval) => intervalMagnitude(interval) > 0.0001)
    .sort((left, right) => intervalMagnitude(right) - intervalMagnitude(left))
    .slice(0, 5);

  return (
    <section
      className="px-16 pb-12 sm:px-24 lg:px-40 xl:px-48 2xl:px-64"
      aria-labelledby="comparison-title"
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-primary" />
            <h2 id="comparison-title" className="text-lg font-semibold tracking-tight">
              Cost of disruption versus normal day
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Candidate minus the normal-day plan, calculated across every dispatch interval.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span>{shortID(comparison.baseline_run_id)}</span>
          <ArrowRightIcon className="size-3" aria-hidden="true" />
          <span>{shortID(comparison.candidate_run_id)}</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaryMetrics.map((item) => {
          const metric = comparison.summary[item.key];
          const Icon = item.icon;
          return (
            <article key={item.key} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">{item.label}</p>
                <Icon className="size-3.5 text-muted-foreground" />
              </div>
              <p
                className={`mt-2 text-xl font-medium tracking-[-0.04em] ${deltaTone(metric.delta, item.direction)}`}
              >
                {formatDelta(metric.delta)}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>
                  {item.unit} · {formatNumber(metric.baseline)}
                </span>
                <ArrowRightIcon className="size-2.5 shrink-0" aria-hidden="true" />
                <span>{formatNumber(metric.candidate)}</span>
              </p>
            </article>
          );
        })}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <ComparisonList
          title="Contract outcomes"
          empty="No contract status or shortfall changed."
          items={materialContracts.map((contract) => ({
            id: contract.contract_id,
            name:
              scenario.contracts.find((candidate) => candidate.id === contract.contract_id)?.name ??
              contract.contract_id,
            detail: (
              <span className="flex items-center gap-1">
                <span>{contract.baseline_status ?? "absent"}</span>
                <ArrowRightIcon className="size-2.5 shrink-0" aria-hidden="true" />
                <span>{contract.candidate_status ?? "absent"}</span>
              </span>
            ),
            value: `${formatDelta(contract.shortfall.delta)} shortfall`,
            tone: deltaTone(contract.shortfall.delta, "lower"),
          }))}
        />
        <ComparisonList
          title="Affected consumers"
          empty="No consumer delivery changed."
          items={materialServices.slice(0, 5).map((service) => ({
            id: service.service_id,
            name:
              scenario.site.services.find((candidate) => candidate.id === service.service_id)
                ?.name ?? service.service_id,
            detail: `${formatDelta(service.deferred_energy_kwh.delta)} kWh deferred`,
            value: `${formatDelta(service.unserved_energy_kwh.delta)} kWh unserved`,
            tone: deltaTone(service.unserved_energy_kwh.delta, "lower"),
          }))}
        />
        <ComparisonList
          title="Largest dispatch changes"
          empty="No material dispatch interval changed."
          items={criticalIntervals.map((interval) => ({
            id: String(interval.index),
            name: formatIntervalTime(interval.start, scenario.site.timezone),
            detail: `${formatDelta(interval.renewable_used_kw.delta)} kW renewable`,
            value: `${formatDelta(interval.diesel_output_kw.delta)} kW diesel`,
            tone: deltaTone(interval.diesel_output_kw.delta, "lower"),
          }))}
        />
      </div>
    </section>
  );
}

function ComparisonList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; name: string; detail: ReactNode; value: string; tone: string }>;
}) {
  return (
    <article className="min-h-40 rounded-xl border border-border bg-card p-3">
      <h3 className="text-xs font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-6 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">{item.detail}</p>
              </div>
              <span className={`shrink-0 font-mono text-[10px] ${item.tone}`}>{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function serviceMagnitude(service: PlanComparison["services"][number]) {
  return (
    Math.abs(service.delivered_energy_kwh.delta) +
    Math.abs(service.deferred_energy_kwh.delta) +
    Math.abs(service.unserved_energy_kwh.delta)
  );
}

function intervalMagnitude(interval: PlanComparison["intervals"][number]) {
  return (
    Math.abs(interval.renewable_used_kw.delta) +
    Math.abs(interval.battery_output_kw.delta) +
    Math.abs(interval.diesel_output_kw.delta) +
    Math.abs(interval.deferred_kw.delta) +
    Math.abs(interval.unserved_kw.delta)
  );
}

function deltaTone(delta: number, direction: Direction) {
  if (Math.abs(delta) < 0.0001) return "text-muted-foreground";
  return (direction === "higher" ? delta > 0 : delta < 0) ? "text-primary" : "text-destructive";
}

function formatDelta(value: number) {
  if (Math.abs(value) < 0.0001) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function formatIntervalTime(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function shortID(id: string) {
  return id.length > 12 ? id.slice(0, 12) : id;
}
