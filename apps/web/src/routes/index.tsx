import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangleIcon, CheckCircle2Icon, MapPinIcon, ZapIcon } from "lucide-react";
import { useState } from "react";

import { OperationsAnalytics } from "@/components/operations-analytics";
import { PlanComparisonPanel } from "@/components/plan-comparison";
import { GridActions } from "@/components/grid-actions";
import { type CanvasView, DeploymentCanvas } from "@/components/deployment-canvas";
import { createPlanRun } from "@/lib/backend";
import {
  planRunQueryOptions,
  planRunsQueryOptions,
  scenarioQueryOptions,
} from "@/lib/plan-queries";
import { defaultScenarioId, type PlanRun } from "@/lib/plan-run";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const [view, setView] = useState<CanvasView>("architecture");
  const queryClient = useQueryClient();
  const scenarioQuery = useQuery(scenarioQueryOptions(defaultScenarioId));
  const runsQuery = useQuery({
    ...planRunsQueryOptions(defaultScenarioId),
    enabled: scenarioQuery.isSuccess,
  });
  const planMutation = useMutation({
    mutationFn: async () => {
      const scenario = scenarioQuery.data;
      if (!scenario) throw new Error("The scenario is not available.");

      // Always produce a fresh baseline from the same scenario snapshot. Reusing
      // an older run after a grid edit would make the comparison misleading.
      const baseline = await createPlanRun({
        scenario_id: scenario.id,
        planner: "baseline",
        active_event_ids: [],
      });
      const run = await createPlanRun({
        scenario_id: scenario.id,
        planner: "wattson",
        active_event_ids: scenario.events.map((event) => event.id),
        parent_run_id: baseline.id,
      });
      return { baseline, run };
    },
    onSuccess: ({ baseline, run }) => {
      queryClient.setQueryData(["plan-run", baseline.id], baseline);
      queryClient.setQueryData(["plan-run", run.id], run);
      queryClient.setQueryData<PlanRun[]>(["plan-runs", defaultScenarioId], (current = []) => [
        run,
        ...current.filter((item) => item.id !== run.id && item.id !== baseline.id),
        baseline,
      ]);
    },
  });
  const currentRuns = runsQuery.data?.filter(
    (run) => run.scenario_revision === scenarioQuery.data?.revision,
  );
  const latestRunSummary =
    currentRuns?.find((run) => run.planner === "wattson") ?? currentRuns?.[0];
  const latestRunQuery = useQuery({
    ...planRunQueryOptions(latestRunSummary?.id ?? ""),
    enabled: Boolean(latestRunSummary),
  });
  const latestRun = latestRunQuery.data ?? latestRunSummary;
  const pageError =
    scenarioQuery.error ?? runsQuery.error ?? latestRunQuery.error ?? planMutation.error;
  const scenarioName = scenarioQuery.data?.site.name ?? "Spiti Valley Community Grid";
  const scenarioLocation = scenarioQuery.data?.site.location;
  const eventCount = scenarioQuery.data?.events.length ?? 0;
  const breachedCount = latestRun?.summary.contracts_breached ?? 0;
  const totalContracts = latestRun
    ? latestRun.summary.contracts_met + latestRun.summary.contracts_breached
    : scenarioQuery.data?.contracts.length;

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <header className="z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
            to="/"
            aria-label="Wattson home"
          >
            <ZapIcon className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">{scenarioName}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              {scenarioLocation ? (
                <>
                  <MapPinIcon className="size-3 shrink-0" />
                  <span className="truncate">{scenarioLocation}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span>{formatPlanningWindow(scenarioQuery.data?.horizon.starts_at)}</span>
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {latestRun ? (
            breachedCount > 0 ? (
              <AlertTriangleIcon className="size-4 text-destructive" />
            ) : (
              <CheckCircle2Icon className="size-4 text-primary" />
            )
          ) : (
            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          )}
          <div className="text-right">
            <p className="text-xs font-medium">
              {latestRun
                ? breachedCount > 0
                  ? `${breachedCount} commitment${breachedCount === 1 ? "" : "s"} at risk`
                  : `All ${totalContracts ?? ""} commitments protected`
                : `${eventCount} disruption${eventCount === 1 ? "" : "s"} ready`}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {latestRun
                ? `Planned ${formatRunTime(latestRun.created_at, scenarioQuery.data?.site.timezone)}`
                : "No response plan yet"}
            </p>
          </div>
        </div>
      </header>
      {pageError ? (
        <div
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {pageError.message} Start the Go backend, then try again.
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-16 py-4 sm:px-24 lg:px-40 xl:px-48 2xl:px-64">
        <section
          className="relative h-[60svh] overflow-hidden rounded-xl border border-border bg-card"
          aria-label="Grid architecture"
        >
          <DeploymentCanvas
            view={view}
            scenario={scenarioQuery.data}
            run={latestRun}
            onViewChange={setView}
          />
          <GridActions
            scenario={scenarioQuery.data}
            hasRun={Boolean(latestRun)}
            isPlanning={planMutation.isPending}
            onPlan={() => planMutation.mutate()}
          />
        </section>
        <OperationsAnalytics scenario={scenarioQuery.data} run={latestRun} />
        <PlanComparisonPanel scenario={scenarioQuery.data} run={latestRun} />
      </main>
    </div>
  );
}

function formatPlanningWindow(timestamp?: string) {
  if (!timestamp) return "Loading planning window";
  return `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp))} · 24-hour plan`;
}

function formatRunTime(timestamp: string, timezone?: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
