import {
  ActivityIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  GaugeIcon,
  LoaderCircleIcon,
  NetworkIcon,
  RefreshCwIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import { Button } from "@getficksd/ui/components/button";

import type { PlanRun, Scenario } from "@/lib/plan-run";

const minimumVoltagePU = 0.95;
const maximumVoltagePU = 1.05;
const maximumLineLoadingPercent = 100;
type NetworkValidationStatus = NonNullable<PlanRun["network_validation"]>["status"];

export const NetworkValidationPanel = memo(function NetworkValidationPanel({
  scenario,
  run,
  isRecalculating = false,
  onRecalculate,
}: {
  scenario?: Scenario;
  run?: PlanRun;
  isRecalculating?: boolean;
  onRecalculate?: () => void;
}) {
  if (!run) return null;

  const validation = run.network_validation;
  const status = validation?.status;
  const passed = status === "pass";
  const failed = status === "violations";
  const StatusIcon = passed ? CircleCheckIcon : failed ? CircleAlertIcon : ShieldQuestionIcon;
  const violations = validation?.violations ?? [];

  return (
    <section
      className="px-16 pb-8 sm:px-24 lg:px-40 xl:px-48 2xl:px-64"
      aria-labelledby="network-validation-title"
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <NetworkIcon className="size-4 text-primary" aria-hidden="true" />
            <h2 id="network-validation-title" className="text-lg font-semibold tracking-tight">
              AC Network Validation
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Independent AC power-flow checks test whether the optimized dispatch is feasible for the
            modeled network.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
            passed
              ? "border-primary/30 bg-primary/10 text-primary"
              : failed
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-muted text-muted-foreground"
          }`}
        >
          <StatusIcon className="size-3.5" aria-hidden="true" />
          {statusLabel(status)}
        </span>
      </header>

      {!validation || validation.status === "unavailable" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-medium text-card-foreground">Validation not available</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {validation?.error ??
                "This plan predates AC network checks. Recalculate it to validate voltage, loading, and losses."}
            </p>
          </div>
          {onRecalculate ? (
            <Button size="sm" onClick={onRecalculate} disabled={isRecalculating}>
              {isRecalculating ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
              {isRecalculating ? "Validating network" : "Recalculate with AC checks"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {validation.error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {validation.error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <ValidationMetric
              icon={<ActivityIcon className="size-3.5" />}
              label="Minimum voltage"
              value={`${formatNumber(validation.min_voltage_pu, 3)} pu`}
              detail={`${validation.min_voltage_bus_id ?? "Network"} at ${formatInterval(validation.min_voltage_interval, scenario)} · ${minimumVoltagePU.toFixed(2)}–${maximumVoltagePU.toFixed(2)} allowed`}
              alert={
                validation.min_voltage_pu < minimumVoltagePU ||
                validation.max_voltage_pu > maximumVoltagePU
              }
            />
            <ValidationMetric
              icon={<GaugeIcon className="size-3.5" />}
              label="Maximum line loading"
              value={`${formatNumber(validation.max_line_loading_percent, 1)}%`}
              detail={`${validation.max_loaded_line_id ?? "Network"} at ${formatInterval(validation.max_line_loading_interval, scenario)} · ≤ ${maximumLineLoadingPercent}%`}
              alert={validation.max_line_loading_percent > maximumLineLoadingPercent}
            />
            <ValidationMetric
              icon={<NetworkIcon className="size-3.5" />}
              label="Network losses"
              value={`${formatNumber(validation.calculated_loss_kwh, 1)} kWh`}
              detail={`${formatSigned(validation.calculated_loss_kwh - validation.assumed_loss_kwh)} kWh vs ${formatNumber(validation.assumed_loss_kwh, 1)} assumed`}
              alert={false}
            />
            <ValidationMetric
              icon={<CircleCheckIcon className="size-3.5" />}
              label="Coverage checked"
              value={`${validation.converged_intervals}/${validation.checked_intervals} intervals`}
              detail={`${validation.components_checked} components · ${validation.checked_buses} buses · ${validation.checked_lines} lines`}
              alert={validation.converged_intervals < validation.checked_intervals}
            />
          </div>

          <article className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <div>
                <h3 className="text-xs font-medium text-card-foreground">Detailed checks</h3>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {validation.engine} · {validation.model_name} · {validation.validation_ms} ms ·
                  voltage range {formatNumber(validation.min_voltage_pu, 3)}–
                  {formatNumber(validation.max_voltage_pu, 3)} pu
                </p>
              </div>
              <span className={violations.length > 0 ? "text-destructive" : "text-primary"}>
                <span className="font-mono text-xs font-semibold">{violations.length}</span>{" "}
                <span className="text-[10px]">violations</span>
              </span>
            </header>

            {violations.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <CircleCheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                All checked voltages and line loadings remain within operating bounds.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Interval</th>
                      <th className="px-3 py-2 font-medium">Check</th>
                      <th className="px-3 py-2 font-medium">Component</th>
                      <th className="px-3 py-2 text-right font-medium">Observed</th>
                      <th className="px-3 py-2 text-right font-medium">Limit</th>
                      <th className="px-3 py-2 font-medium">Finding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {violations.map((violation, index) => (
                      <tr
                        key={`${violation.interval_index}-${violation.kind}-${violation.element_id ?? "network"}-${index}`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-muted-foreground">
                          {formatInterval(violation.interval_index, scenario)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-card-foreground">
                          {formatKind(violation.kind)}
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                          {violation.element_id ?? "Network"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-destructive">
                          {formatViolationValue(violation.kind, violation.value)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground">
                          {formatViolationValue(violation.kind, violation.limit)}
                        </td>
                        <td className="max-w-md px-3 py-2 text-muted-foreground">
                          {violation.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          {validation.assumptions.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Assumptions · {validation.source}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {validation.assumptions.join(" · ")}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
});

function ValidationMetric({
  icon,
  label,
  value,
  detail,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  alert: boolean;
}) {
  return (
    <article
      className={`rounded-xl border bg-card p-3 ${alert ? "border-destructive/50" : "border-border"}`}
    >
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <p className="text-[11px] font-medium">{label}</p>
        <span className={alert ? "text-destructive" : "text-muted-foreground"}>{icon}</span>
      </div>
      <p
        className={`mt-2 text-xl font-medium tracking-[-0.04em] ${alert ? "text-destructive" : "text-card-foreground"}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>
    </article>
  );
}

function statusLabel(status?: NetworkValidationStatus) {
  if (status === "pass") return "Passed";
  if (status === "violations") return "Violations found";
  if (status === "unavailable") return "Unavailable";
  return "Not available";
}

function formatInterval(index: number, scenario?: Scenario) {
  if (!scenario) return `#${index + 1}`;
  const timestamp =
    new Date(scenario.horizon.starts_at).getTime() +
    index * scenario.horizon.interval_minutes * 60_000;
  return new Intl.DateTimeFormat("en", {
    timeZone: scenario.site.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatKind(kind: string) {
  return kind.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function formatViolationValue(kind: string, value: number) {
  if (kind.toLowerCase().includes("voltage")) return `${formatNumber(value, 3)} pu`;
  if (kind.toLowerCase().includes("loading")) return `${formatNumber(value, 1)}%`;
  return formatNumber(value, 2);
}

function formatSigned(value: number) {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value), 1)}`;
}

function formatNumber(value: number, maximumFractionDigits: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}
