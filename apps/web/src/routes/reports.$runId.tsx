import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorState, LoadingState } from "@/components/page-state";
import { planRunLabel } from "@/lib/backend";
import {
  planRunQueryOptions,
  planRunsQueryOptions,
  scenarioQueryOptions,
} from "@/lib/plan-queries";
import { defaultScenarioId } from "@/lib/plan-run";
import { deriveReliabilityBrief, type ReliabilityBrief } from "@/lib/reliability-brief";

export const Route = createFileRoute("/reports/$runId")({
  head: () => ({
    meta: [{ title: "Reliability Brief · Wattson" }],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runQuery = useQuery(planRunQueryOptions(runId));
  const scenarioId = runQuery.data?.scenario_id ?? defaultScenarioId;
  const scenarioQuery = useQuery({
    ...scenarioQueryOptions(scenarioId),
    enabled: Boolean(runQuery.data),
  });
  const runsQuery = useQuery({
    ...planRunsQueryOptions(scenarioId),
    enabled: Boolean(runQuery.data),
  });
  const queryError = runQuery.error ?? scenarioQuery.error ?? runsQuery.error;

  if (queryError) {
    return (
      <ReportShell>
        <ErrorState
          error={queryError}
          onRetry={() => {
            void queryClient.invalidateQueries({ queryKey: ["plan-run", runId] });
            void queryClient.invalidateQueries({ queryKey: ["scenario", scenarioId] });
            void queryClient.invalidateQueries({ queryKey: ["plan-runs", scenarioId] });
          }}
        />
      </ReportShell>
    );
  }

  const run = runQuery.data;
  const scenario = scenarioQuery.data;
  if (!run || !scenario || !runsQuery.data) {
    return (
      <ReportShell>
        <LoadingState label="Loading reliability brief" rows={6} />
      </ReportShell>
    );
  }

  const baselineRun = runsQuery.data.find(
    (item) => item.planner === "baseline" && item.active_event_ids.length === 0,
  );
  const comparisonRun = baselineRun?.id === run.id ? undefined : baselineRun;
  const brief = deriveReliabilityBrief(run, scenario, comparisonRun);
  const complete = run.status === "complete";

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            to="/"
          >
            <ArrowLeftIcon className="size-3.5" />
            Control Table
          </Link>

          <select
            aria-label="Select report run"
            className="h-7 max-w-56 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none hover:bg-muted focus:border-ring focus:ring-2 focus:ring-ring/30"
            value={run.id}
            onChange={(event) => {
              void navigate({
                to: "/reports/$runId",
                params: { runId: event.target.value },
              });
            }}
          >
            {runsQuery.data.map((item) => (
              <option key={item.id} value={item.id}>
                {planRunLabel(item, scenario)} ·{" "}
                {formatRunTime(item.created_at, scenario.site.timezone)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-medium text-primary">Reports</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Reliability Brief</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {scenario.site.name} · {planRunLabel(run, scenario)}
            </p>
          </div>
          <span
            className={`flex w-fit items-center gap-1.5 text-xs font-medium ${complete ? "text-chart-5" : "text-destructive"}`}
          >
            {complete ? (
              <CheckCircle2Icon className="size-4" />
            ) : (
              <AlertTriangleIcon className="size-4" />
            )}
            {complete ? "Run complete" : "Plan infeasible"}
          </span>
        </div>

        <Conclusion brief={brief} />
        <CommitmentLedger commitments={brief.commitments} />
        <IncidentTimeline entries={brief.timeline} />
        <TradeoffRecord tradeoffs={brief.tradeoffs} />
        <ResilienceOutlook resilience={brief.resilience} />

        <footer className="mt-10 border-t border-border pt-4 font-mono text-[10px] text-muted-foreground">
          PlanRun {run.id} · {scenario.horizon.interval_minutes}-minute intervals
        </footer>
      </main>
    </div>
  );
}

function ReportShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-12 max-w-5xl items-center px-4 sm:px-6">
          <Link
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            to="/"
          >
            <ArrowLeftIcon className="size-3.5" />
            Control Table
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl">{children}</main>
    </div>
  );
}

function formatRunTime(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function Conclusion({ brief }: { brief: ReliabilityBrief }) {
  return (
    <section className="mt-8 border-y border-border py-6" aria-labelledby="report-conclusion">
      <h2 id="report-conclusion" className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
        {brief.conclusion.headline}
      </h2>
      <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
        {brief.conclusion.detail}
      </p>
    </section>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <h2 className="mb-4 text-lg font-semibold tracking-tight">{title}</h2>;
}

function CommitmentLedger({ commitments }: { commitments: ReliabilityBrief["commitments"] }) {
  return (
    <section className="border-b border-border py-8">
      <SectionHeading title="Commitment ledger" />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              <th className="w-[23%] px-2 py-2 font-medium">Commitment</th>
              <th className="w-[25%] px-2 py-2 font-medium">Promise</th>
              <th className="w-[14%] px-2 py-2 font-medium">Result</th>
              <th className="px-2 py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {commitments.map((commitment) => (
              <tr key={commitment.id} className="border-b border-border last:border-b-0">
                <td className="px-2 py-3 align-top text-sm font-medium">{commitment.commitment}</td>
                <td className="px-2 py-3 align-top text-sm text-muted-foreground">
                  {commitment.promise}
                </td>
                <td className="px-2 py-3 align-top">
                  <Status result={commitment.result} tone={commitment.tone} />
                </td>
                <td className="px-2 py-3 align-top text-sm leading-5 text-muted-foreground">
                  {commitment.why}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Status({
  result,
  tone,
}: {
  result: ReliabilityBrief["commitments"][number]["result"];
  tone: ReliabilityBrief["commitments"][number]["tone"];
}) {
  const className =
    tone === "warning"
      ? "bg-destructive/10 text-destructive"
      : tone === "positive"
        ? "bg-chart-5/10 text-chart-5"
        : "bg-muted text-muted-foreground";

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] " +
        className
      }
    >
      <span className="size-1.5 rounded-full bg-current" />
      {result}
    </span>
  );
}

function IncidentTimeline({ entries }: { entries: ReliabilityBrief["timeline"] }) {
  return (
    <section className="border-b border-border py-8">
      <SectionHeading title="Incident timeline" />

      <ol className="max-w-3xl">
        {entries.map((entry, index) => (
          <li key={entry.id} className="grid grid-cols-[4rem_1rem_1fr] gap-3">
            <time
              className="py-2 text-right font-mono text-xs text-muted-foreground"
              dateTime={entry.timestamp}
            >
              {entry.time}
            </time>
            <span className="relative flex justify-center">
              {index < entries.length - 1 ? (
                <span className="absolute bottom-0 top-3.5 w-px bg-border" />
              ) : null}
              <span
                className={
                  "relative mt-3 size-1.5 rounded-full ring-4 ring-background " +
                  timelineTone(entry.kind)
                }
              />
            </span>
            <p className="border-b border-border py-2 text-sm last:border-b-0">{entry.label}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function timelineTone(kind: ReliabilityBrief["timeline"][number]["kind"]) {
  if (kind === "risk") return "bg-destructive";
  if (kind === "decision") return "bg-chart-3";
  if (kind === "outcome") return "bg-chart-5";
  return "bg-chart-1";
}

function TradeoffRecord({ tradeoffs }: { tradeoffs: ReliabilityBrief["tradeoffs"] }) {
  return (
    <section className="border-b border-border py-8">
      <SectionHeading title="Trade-off record" />

      <dl className="grid border-y border-border sm:grid-cols-5">
        {tradeoffs.map((tradeoff) => (
          <div
            key={tradeoff.label}
            className="border-b border-border px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <dt className="text-[10px] leading-4 text-muted-foreground">{tradeoff.label}</dt>
            <dd className="mt-1.5 text-lg font-semibold tracking-tight">{tradeoff.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ResilienceOutlook({ resilience }: { resilience: ReliabilityBrief["resilience"] }) {
  return (
    <section className="py-8">
      <SectionHeading title="Resilience outlook" />
      <p className="max-w-3xl text-base leading-7">{resilience.statement}</p>

      <figure className="mt-5 grid gap-5 border-y border-border py-5 sm:grid-cols-2 sm:gap-8">
        {resilience.tests.map((test) => (
          <div key={test.label}>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{test.label}</span>
              <span className="font-mono text-sm font-medium">{test.displayValue}</span>
            </div>
            <div className="mt-2 h-2 bg-muted">
              <div
                className="h-full bg-chart-3"
                style={{ width: Math.min(100, (test.value / test.maximum) * 100) + "%" }}
              />
            </div>
          </div>
        ))}
      </figure>

      <p className="mt-4 text-xs text-muted-foreground">
        Tested points only. The failure threshold is unknown.
      </p>
      {resilience.recommendation ? (
        <p className="mt-2 text-sm font-medium">{resilience.recommendation}</p>
      ) : null}
    </section>
  );
}
