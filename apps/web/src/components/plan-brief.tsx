import { Button } from "@getficksd/ui/components/button";
import {
  ActivityIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardIcon,
  Clock3Icon,
  PauseIcon,
  PlayIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { PlanRun, Scenario } from "@/lib/plan-run";

export function PlanBrief({
  scenario,
  run,
  currentHour,
  isPlaying,
  onSelectHour,
}: {
  scenario?: Scenario;
  run?: PlanRun;
  currentHour: number;
  isPlaying: boolean;
  onSelectHour: (hour: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const deferredEnergy = useMemo(() => totalDeferredEnergy(run, scenario), [run, scenario]);
  const decisions = run?.decisions ?? [];
  const totalContracts = run
    ? run.summary.contracts_met + run.summary.contracts_breached
    : (scenario?.contracts.length ?? 0);
  const safe = Boolean(
    run && run.summary.contracts_breached === 0 && run.summary.unserved_energy_kwh < 0.0001,
  );
  const currentIndex = scenario
    ? Math.floor((currentHour * 60) / scenario.horizon.interval_minutes)
    : 0;
  const nextDecision = decisions.find((decision) => decision.interval_index >= currentIndex);

  const copyBrief = async () => {
    if (!run || !scenario) return;
    await navigator.clipboard.writeText(createBrief(scenario, run, deferredEnergy));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <section
      className="mt-4 rounded-xl border border-border bg-card"
      aria-labelledby="plan-brief-title"
    >
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="flex min-w-0 gap-3">
          <div
            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${
              run
                ? safe
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {run ? (
              safe ? (
                <ShieldCheckIcon className="size-4.5" />
              ) : (
                <ShieldAlertIcon className="size-4.5" />
              )
            ) : (
              <Clock3Icon className="size-4.5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="plan-brief-title" className="text-base font-semibold tracking-tight">
                {run ? (safe ? "Stress test passed" : "Operator action required") : "Plan preview"}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {isPlaying ? <PlayIcon className="size-2.5" /> : <PauseIcon className="size-2.5" />}
                {run
                  ? isPlaying
                    ? "Simulation playing"
                    : "Simulation paused"
                  : "Forecast snapshot"}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              {run
                ? safe
                  ? `Wattson protects all ${totalContracts} commitments through the 24-hour disruption scenario.`
                  : `${run.summary.contracts_breached} commitments breach during this 24-hour scenario.`
                : "The grid shows one forecast moment. Calculate a plan to animate the full operating day."}
            </p>
            {nextDecision ? (
              <button
                type="button"
                className="mt-2 inline-flex max-w-full items-center gap-1 text-left text-xs font-medium text-foreground hover:text-primary"
                onClick={() => onSelectHour(decisionHour(nextDecision.interval_index, scenario))}
              >
                <span className="truncate">
                  Next at {formatDecisionTime(nextDecision.interval_index, scenario)} ·{" "}
                  {nextDecision.title}
                </span>
                <ChevronRightIcon className="size-3 shrink-0" />
              </button>
            ) : null}
          </div>
        </div>

        {run ? (
          <Button size="sm" variant="outline" onClick={() => void copyBrief()}>
            {copied ? <CheckIcon /> : <ClipboardIcon />}
            {copied ? "Copied" : "Copy plan brief"}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 border-t border-border lg:grid-cols-4">
        <BriefMetric
          label="Commitments"
          value={run ? `${run.summary.contracts_met}/${totalContracts}` : `—/${totalContracts}`}
          detail={run ? "protected" : "awaiting plan"}
        />
        <BriefMetric
          label="Unserved energy"
          value={run ? `${formatNumber(run.summary.unserved_energy_kwh)} kWh` : "—"}
          detail={run && run.summary.unserved_energy_kwh < 0.0001 ? "no outages" : "across the day"}
        />
        <BriefMetric
          label="Flexible load"
          value={run ? `${formatNumber(deferredEnergy)} kWh` : "—"}
          detail="deferred"
        />
        <BriefMetric
          label="Operator decisions"
          value={run ? String(decisions.length) : "—"}
          detail="explained actions"
        />
      </div>

      {decisions.length > 0 ? (
        <div className="border-t border-border p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold">Decision feed</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Select a decision to inspect that moment on the grid.
              </p>
            </div>
            <ActivityIcon className="size-3.5 text-muted-foreground" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {decisions.slice(0, 8).map((decision) => {
              const active = Math.abs(decision.interval_index - currentIndex) <= 1;
              return (
                <button
                  key={decision.id}
                  type="button"
                  className={`min-w-56 flex-1 rounded-lg border p-2.5 text-left transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-background hover:bg-muted/60"
                  }`}
                  onClick={() => onSelectHour(decisionHour(decision.interval_index, scenario))}
                >
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {formatDecisionTime(decision.interval_index, scenario)}
                  </p>
                  <p className="mt-1 truncate text-xs font-medium">{decision.title}</p>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                    {decision.reason}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BriefMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border-r border-border p-3 last:border-r-0 even:border-r-0 lg:even:border-r lg:last:border-r-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-card-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function totalDeferredEnergy(run?: PlanRun, scenario?: Scenario) {
  if (!run || !scenario) return 0;
  const intervalHours = scenario.horizon.interval_minutes / 60;
  return run.intervals.reduce(
    (total, interval) =>
      total +
      interval.services.reduce((intervalTotal, service) => intervalTotal + service.deferred_kw, 0) *
        intervalHours,
    0,
  );
}

function decisionHour(intervalIndex: number, scenario?: Scenario) {
  return intervalIndex * ((scenario?.horizon.interval_minutes ?? 15) / 60);
}

function formatDecisionTime(intervalIndex: number, scenario?: Scenario) {
  if (!scenario) return `Interval ${intervalIndex + 1}`;
  const start = new Date(scenario.horizon.starts_at).getTime();
  const timestamp = new Date(start + intervalIndex * scenario.horizon.interval_minutes * 60_000);
  return new Intl.DateTimeFormat("en", {
    timeZone: scenario.site.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function createBrief(scenario: Scenario, run: PlanRun, deferredEnergy: number) {
  const totalContracts = run.summary.contracts_met + run.summary.contracts_breached;
  const lines = [
    `${scenario.site.name} — Wattson plan brief`,
    `Scenario: ${scenario.name}`,
    `Result: ${run.summary.contracts_met}/${totalContracts} commitments protected`,
    `Unserved energy: ${formatNumber(run.summary.unserved_energy_kwh)} kWh`,
    `Flexible energy deferred: ${formatNumber(deferredEnergy)} kWh`,
    `Diesel generation: ${formatNumber(run.summary.diesel_energy_kwh)} kWh`,
    "",
    "Operator decisions:",
    ...run.decisions.map(
      (decision) =>
        `${formatDecisionTime(decision.interval_index, scenario)} — ${decision.title}: ${decision.reason}`,
    ),
  ];
  return lines.join("\n");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
