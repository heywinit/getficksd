import { Button } from "@getficksd/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  ChartLineIcon,
  FileTextIcon,
  Grid2X2Icon,
  LoaderCircleIcon,
  PlayIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";

import { type CanvasView, DeploymentCanvas } from "@/components/deployment-canvas";
import { createPlanRun } from "@/lib/backend";
import { planRunsQueryOptions, scenarioQueryOptions } from "@/lib/plan-queries";
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

      const existingBaseline = runsQuery.data?.find(
        (run) => run.planner === "baseline" && run.active_event_ids.length === 0,
      );
      const baseline =
        existingBaseline ??
        (await createPlanRun({
          scenario_id: scenario.id,
          planner: "baseline",
          active_event_ids: [],
        }));
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
  const latestRun = runsQuery.data?.find((run) => run.planner === "wattson") ?? runsQuery.data?.[0];
  const pageError = scenarioQuery.error ?? runsQuery.error ?? planMutation.error;
  const scenarioName = scenarioQuery.data?.site.name ?? "Spiti Valley Community Grid";

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <Link className="flex shrink-0 items-center gap-2 font-semibold tracking-tight" to="/">
            <span className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">
              <ZapIcon className="size-4" />
            </span>
            <span className="hidden sm:inline">Wattson</span>
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="min-w-0 truncate font-medium text-foreground">{scenarioName}</span>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <span className="hidden text-muted-foreground sm:inline">Control Table</span>
        </div>

        <div className="flex h-full items-center">
          <TopbarView
            active={view === "architecture"}
            icon={Grid2X2Icon}
            label="Architecture"
            onClick={() => setView("architecture")}
          />
          <TopbarView
            active={view === "forecast"}
            icon={ChartLineIcon}
            label="Forecast"
            onClick={() => setView("forecast")}
          />
          <TopbarView
            active={view === "activity"}
            icon={ActivityIcon}
            label="Activity"
            onClick={() => setView("activity")}
          />
          <Button
            size="sm"
            variant="outline"
            className="ml-1 h-8 gap-2 sm:ml-3"
            disabled={!scenarioQuery.data || planMutation.isPending}
            onClick={() => planMutation.mutate()}
          >
            {planMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
            <span className="hidden lg:inline">{latestRun ? "Run new plan" : "Run schedule"}</span>
            <span className="lg:hidden">Run</span>
          </Button>
          {latestRun ? (
            <Link
              className="ml-1 flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:ml-3"
              to="/reports/$runId"
              params={{ runId: latestRun.id }}
              aria-label="Open reliability brief"
            >
              <FileTextIcon className="size-3.5" />
              <span className="hidden lg:inline">Open reliability brief</span>
              <span className="lg:hidden">Reports</span>
            </Link>
          ) : null}
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
      <DeploymentCanvas view={view} scenario={scenarioQuery.data} run={latestRun} />
    </div>
  );
}

function TopbarView({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Grid2X2Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-full items-center gap-2 border-b-2 px-3 text-sm transition-colors sm:px-4 ${
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-4 md:hidden" />
      <span className="hidden md:inline">{label}</span>
      <span className="sr-only md:hidden">{label}</span>
    </button>
  );
}
