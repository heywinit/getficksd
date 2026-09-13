import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@getficksd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { NetworkValidationPanel } from "@/components/network-validation";
import { OperationsAnalytics } from "@/components/operations-analytics";
import { PlanBrief } from "@/components/plan-brief";
import { ReplayNotifications } from "@/components/replay-notifications";
import { ContractsWorkspace } from "@/components/contracts-workspace";
import { PlanComparisonPanel } from "@/components/plan-comparison";
import { GridActions, type GridEditTarget } from "@/components/grid-actions";
import { ScenarioRunner } from "@/components/scenario-runner";
import {
  type CanvasResourceTarget,
  type CanvasView,
  DeploymentCanvas,
} from "@/components/deployment-canvas";
import {
  createPlanRun,
  deleteScenario,
  updateScenario,
  updateScenarioConnections,
} from "@/lib/backend";
import {
  planRunQueryOptions,
  planRunsQueryOptions,
  scenarioQueryOptions,
  scenariosQueryOptions,
} from "@/lib/plan-queries";
import { type GridConnection, type PlanRun, type Scenario } from "@/lib/plan-run";
import { siteQueryOptions } from "@/lib/site-queries";

export const Route = createFileRoute("/sites/$siteId/operate")({
  component: HomeComponent,
});

function HomeComponent() {
  const { siteId } = Route.useParams();
  const [view, setView] = useState<CanvasView>("architecture");
  const [editRequest, setEditRequest] = useState<GridEditTarget | null>(null);
  const [selectedScenarioID, setSelectedScenarioID] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayToken, setReplayToken] = useState(0);
  const [currentHour, setCurrentHour] = useState(10.5);
  const [configurationDialogOpen, setConfigurationDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const siteQuery = useQuery(siteQueryOptions(siteId));
  const effectiveScenarioID = selectedScenarioID || siteQuery.data?.current_scenario.id || "";
  const scenariosQuery = useQuery(scenariosQueryOptions());
  const scenarioQuery = useQuery({
    ...scenarioQueryOptions(effectiveScenarioID),
    enabled: Boolean(effectiveScenarioID),
  });
  const runsQuery = useQuery({
    ...planRunsQueryOptions(effectiveScenarioID),
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
      queryClient.setQueryData<PlanRun[]>(["plan-runs", run.scenario_id], (current = []) => [
        run,
        ...current.filter((item) => item.id !== run.id && item.id !== baseline.id),
        baseline,
      ]);
      setReplayToken((current) => current + 1);
      setIsPlaying(true);
      toast.success("Response plan ready", {
        description: `${run.summary.contracts_met} commitments protected. The 24-hour replay is starting.`,
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const removeMutation = useMutation({
    mutationFn: async (target: CanvasResourceTarget) => {
      const scenario = scenarioQuery.data;
      if (!scenario) throw new Error("The grid is not available.");
      const next = structuredClone(scenario);
      removeResource(next, target);
      return updateScenario(next);
    },
    onSuccess: (savedScenario) => {
      queryClient.setQueryData(["scenario", savedScenario.id], savedScenario);
      queryClient.setQueryData(["plan-runs", savedScenario.id], []);
      setIsPlaying(false);
      setReplayToken(0);
      const issues = gridConfigurationIssues(savedScenario);
      if (issues.length > 0) {
        setConfigurationDialogOpen(true);
      } else {
        toast.success("Grid item removed. The previous plan is halted.");
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const disruptionMutation = useMutation({
    mutationFn: (next: Scenario) => updateScenario(next),
    onSuccess: (savedScenario) => {
      queryClient.setQueryData(["scenario", savedScenario.id], savedScenario);
      queryClient.setQueryData(["plan-runs", savedScenario.id], []);
      queryClient.removeQueries({ queryKey: ["plan-run"] });
      void queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
      setIsPlaying(false);
      setReplayToken(0);
      setCurrentHour(0);
      toast.success("Disruption saved. Create a new plan before operation.");
    },
    onError: (error) => toast.error(error.message),
  });
  const connectionMutation = useMutation({
    mutationFn: async (connections: GridConnection[]) => {
      const scenario = scenarioQuery.data;
      if (!scenario) throw new Error("The grid is not available.");
      return updateScenarioConnections(scenario.id, connections);
    },
    onSuccess: (savedScenario, connections) => {
      const previousCount = scenarioQuery.data?.site.connections?.length ?? 0;
      queryClient.setQueryData(["scenario", savedScenario.id], savedScenario);
      queryClient.setQueryData(["plan-runs", savedScenario.id], []);
      queryClient.removeQueries({ queryKey: ["plan-run"] });
      void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
      setIsPlaying(false);
      setReplayToken(0);
      toast.success(
        connections.length < previousCount
          ? "Connection removed. Create a new plan before operation."
          : "Connection saved. Create a new plan before operation.",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const scenarioDeleteMutation = useMutation({
    mutationFn: (scenarioID: string) => deleteScenario(scenarioID),
    onSuccess: (_, deletedScenarioID) => {
      const remaining = (scenariosQuery.data ?? []).filter((item) => item.id !== deletedScenarioID);
      const remainingForSite = remaining.filter(
        (item) =>
          item.site_name === siteQuery.data?.site.name &&
          item.location === siteQuery.data.site.location,
      );
      queryClient.setQueryData(["scenarios"], remaining);
      queryClient.removeQueries({ queryKey: ["scenario", deletedScenarioID] });
      queryClient.removeQueries({ queryKey: ["plan-runs", deletedScenarioID] });
      const nextScenario = remainingForSite[0];
      if (nextScenario) setSelectedScenarioID(nextScenario.id);
      setIsPlaying(false);
      setReplayToken(0);
      setCurrentHour(0);
      toast.success("Scenario deleted");
    },
    onError: (error) => toast.error(error.message),
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
    siteQuery.error ??
    scenariosQuery.error ??
    scenarioQuery.error ??
    runsQuery.error ??
    latestRunQuery.error ??
    planMutation.error;
  const scenarioName = scenarioQuery.data?.site.name ?? siteQuery.data?.site.name ?? "Loading site";
  const scenarioLocation = scenarioQuery.data?.site.location ?? siteQuery.data?.site.location;
  const eventCount = scenarioQuery.data?.events.length ?? 0;
  const breachedCount = latestRun?.summary.contracts_breached ?? 0;
  const totalContracts = latestRun
    ? latestRun.summary.contracts_met + latestRun.summary.contracts_breached
    : scenarioQuery.data?.contracts.length;
  const configurationIssues = gridConfigurationIssues(scenarioQuery.data);
  const siteScenarios = (scenariosQuery.data ?? []).filter(
    (scenario) =>
      scenario.id === siteQuery.data?.current_scenario.id ||
      (scenario.site_name === siteQuery.data?.site.name &&
        scenario.location === siteQuery.data.site.location),
  );

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        siteId={siteId}
        siteName={scenarioName}
        location={scenarioLocation}
        trailing={
          <div className="flex shrink-0 items-center gap-2">
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
        }
      />
      {pageError ? (
        <div
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {pageError.message} Start the Go backend, then try again.
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-10 xl:px-16 2xl:px-24">
        <section
          className="relative h-[68svh] overflow-hidden rounded-xl border border-border bg-card"
          aria-label="Grid architecture"
        >
          <DeploymentCanvas
            view={view}
            scenario={scenarioQuery.data}
            run={latestRun}
            onViewChange={setView}
            playing={isPlaying}
            replayToken={replayToken}
            onPlayingChange={setIsPlaying}
            currentHour={currentHour}
            onCurrentHourChange={setCurrentHour}
            onEditResource={setEditRequest}
            onRemoveResource={(target) => removeMutation.mutate(target)}
            onConnectionsChange={(connections) => connectionMutation.mutate(connections)}
            connectionsUpdating={connectionMutation.isPending}
          />
          <GridActions
            scenario={scenarioQuery.data}
            hasRun={Boolean(latestRun)}
            isPlanning={planMutation.isPending}
            onPlan={() => planMutation.mutate()}
            editRequest={editRequest}
            onEditRequestHandled={() => setEditRequest(null)}
          />
        </section>
        <div className="mt-4 grid gap-4 xl:grid-cols-2 xl:items-stretch">
          <ScenarioRunner
            scenarios={siteScenarios}
            scenario={scenarioQuery.data}
            selectedScenarioID={effectiveScenarioID}
            run={latestRun}
            isPlanning={planMutation.isPending}
            isDeleting={scenarioDeleteMutation.isPending}
            isPlaying={isPlaying}
            onSelectScenario={(scenarioID) => {
              setSelectedScenarioID(scenarioID);
              setIsPlaying(false);
              setReplayToken(0);
              setCurrentHour(0);
            }}
            onRun={() => {
              if (latestRun) setIsPlaying(true);
              else planMutation.mutate();
            }}
            onPause={() => setIsPlaying(false)}
            onRepeat={() => {
              setReplayToken((current) => current + 1);
              setIsPlaying(true);
            }}
            onDeleteScenario={(scenarioID) => scenarioDeleteMutation.mutateAsync(scenarioID)}
            onUpdateScenario={(next) => disruptionMutation.mutateAsync(next)}
            isUpdatingScenario={disruptionMutation.isPending}
          />
          <PlanBrief
            scenario={scenarioQuery.data}
            run={latestRun}
            currentHour={currentHour}
            isPlaying={isPlaying}
            onSelectHour={(hour) => {
              setCurrentHour(hour);
              setIsPlaying(false);
            }}
          />
        </div>
        <ReplayNotifications
          scenario={scenarioQuery.data}
          run={latestRun}
          currentHour={currentHour}
          isPlaying={isPlaying}
          replayToken={replayToken}
        />
        <OperationsAnalytics
          scenario={scenarioQuery.data}
          run={latestRun}
          currentHour={currentHour}
        />
        <NetworkValidationPanel
          scenario={scenarioQuery.data}
          run={latestRun}
          isRecalculating={planMutation.isPending}
          onRecalculate={() => planMutation.mutate()}
        />
        <ContractsWorkspace scenario={scenarioQuery.data} run={latestRun} />
        <PlanComparisonPanel scenario={scenarioQuery.data} run={latestRun} />
      </main>
      {configurationIssues.length > 0 ? (
        <Button
          className="fixed right-5 bottom-5 z-40 shadow-lg"
          variant="destructive"
          onClick={() => setConfigurationDialogOpen(true)}
        >
          <AlertTriangleIcon />
          Plan halted · {configurationIssues.length} required
        </Button>
      ) : null}
      <Dialog open={configurationDialogOpen} onOpenChange={setConfigurationDialogOpen}>
        <DialogContent className="border border-destructive/50 shadow-2xl shadow-destructive/10 ring-destructive/20 sm:max-w-lg">
          <DialogHeader>
            <div className="mb-1 grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-5" />
            </div>
            <DialogTitle className="text-destructive">The plan is halted</DialogTitle>
            <DialogDescription>
              The grid design is saved, but it cannot safely meet the requested output. Make these
              changes before live operation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {configurationIssues.map((issue) => (
              <div
                key={issue.title}
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
              >
                <p className="text-sm font-medium text-foreground">{issue.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{issue.detail}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={() => setConfigurationDialogOpen(false)}>
              I understand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function removeResource(scenario: Scenario, target: CanvasResourceTarget) {
  if (target.kind === "asset") {
    if (scenario.site.assets.length <= 1) {
      throw new Error("The grid must keep at least one supply or storage asset.");
    }
    const previousBatteryCapacity = scenario.site.assets
      .filter((asset) => asset.type === "battery")
      .reduce((total, asset) => total + (asset.capacity_kwh ?? 0), 0);
    const reserveRatio =
      previousBatteryCapacity > 0
        ? scenario.operating_policy.reserve_energy_kwh / previousBatteryCapacity
        : 0;
    const signalIds = new Set(
      scenario.signals.filter((signal) => signal.asset_id === target.id).map((signal) => signal.id),
    );
    scenario.site.assets = scenario.site.assets.filter((asset) => asset.id !== target.id);
    scenario.site.connections = (scenario.site.connections ?? []).filter(
      (connection) => connection.source_id !== target.id && connection.target_id !== target.id,
    );
    scenario.initial_state.assets = scenario.initial_state.assets.filter(
      (state) => state.asset_id !== target.id,
    );
    scenario.signals = scenario.signals.filter((signal) => signal.asset_id !== target.id);
    scenario.events = scenario.events.filter(
      (event) =>
        event.asset_id !== target.id && (!event.signal_id || !signalIds.has(event.signal_id)),
    );
    const remainingBatteries = scenario.site.assets.filter((asset) => asset.type === "battery");
    const remainingCapacity = remainingBatteries.reduce(
      (total, asset) => total + (asset.capacity_kwh ?? 0),
      0,
    );
    const physicalMinimum = remainingBatteries.reduce(
      (total, asset) => total + (asset.minimum_stored_energy_kwh ?? 0),
      0,
    );
    scenario.operating_policy.reserve_energy_kwh =
      remainingCapacity === 0
        ? 0
        : Math.max(physicalMinimum, Math.min(remainingCapacity, remainingCapacity * reserveRatio));
    return;
  }

  if (scenario.site.services.length <= 1) {
    throw new Error("The grid must keep at least one consumer.");
  }
  const signalIds = new Set(
    scenario.signals.filter((signal) => signal.service_id === target.id).map((signal) => signal.id),
  );
  const remainingContracts = scenario.contracts.filter(
    (contract) => contract.service_id !== target.id,
  );
  if (remainingContracts.length === 0) {
    throw new Error("Reassign this consumer's contract before you remove it.");
  }
  scenario.site.services = scenario.site.services.filter((service) => service.id !== target.id);
  scenario.site.connections = (scenario.site.connections ?? []).filter(
    (connection) => connection.source_id !== target.id && connection.target_id !== target.id,
  );
  scenario.signals = scenario.signals.filter((signal) => signal.service_id !== target.id);
  scenario.contracts = remainingContracts;
  scenario.events = scenario.events.filter(
    (event) => !event.signal_id || !signalIds.has(event.signal_id),
  );
}

type GridConfigurationIssue = { title: string; detail: string };

function gridConfigurationIssues(scenario?: Scenario): GridConfigurationIssue[] {
  if (!scenario) return [];
  const issues: GridConfigurationIssue[] = [];
  const connections = scenario.site.connections ?? [];
  const disconnectedServices = scenario.site.services.filter(
    (service) =>
      !connections.some(
        (connection) =>
          connection.source_id === "controller" && connection.target_id === service.id,
      ),
  );
  if (disconnectedServices.length > 0) {
    issues.push({
      title: `${disconnectedServices.length} consumer${disconnectedServices.length === 1 ? " is" : "s are"} disconnected`,
      detail: `Reconnect ${disconnectedServices.map((service) => service.name).join(", ")} to the grid controller before operation.`,
    });
  }
  const unreachableAssets = scenario.site.assets.filter(
    (asset) => !connectionReachesController(asset.id, connections),
  );
  if (unreachableAssets.length > 0) {
    issues.push({
      title: `${unreachableAssets.length} asset${unreachableAssets.length === 1 ? " cannot" : "s cannot"} reach the controller`,
      detail: `Reconnect ${unreachableAssets.map((asset) => asset.name).join(", ")} directly or through a battery.`,
    });
  }
  const batteries = scenario.site.assets.filter((asset) => asset.type === "battery");
  const generators = scenario.site.assets.filter((asset) => asset.type === "diesel");
  if (batteries.length === 0) {
    issues.push({
      title: "No battery storage",
      detail:
        generators.length > 0
          ? "The grid now depends on renewable output and diesel response. Add storage or review a generator-only feasibility plan."
          : "The grid has no stored energy or dispatchable backup. Add storage or generation before live operation.",
    });
  }

  const batteryPower = batteries.reduce((total, asset) => total + (asset.max_discharge_kw ?? 0), 0);
  const generatorPower = generators.reduce(
    (total, asset) => total + (asset.maximum_output_kw ?? 0),
    0,
  );
  const renewableSignals = scenario.signals.filter(
    (signal) => signal.kind === "renewable_availability",
  );
  const demandSignals = scenario.signals.filter((signal) => signal.kind === "service_demand");
  let largestDeficit = 0;
  let deficitDemand = 0;
  let deficitSupply = 0;
  for (let index = 0; index < scenario.horizon.interval_count; index += 1) {
    const demand = demandSignals.reduce((total, signal) => total + (signal.values[index] ?? 0), 0);
    const renewable = renewableSignals.reduce(
      (total, signal) => total + (signal.values[index] ?? 0),
      0,
    );
    const supply = renewable + batteryPower + generatorPower;
    if (demand - supply > largestDeficit) {
      largestDeficit = demand - supply;
      deficitDemand = demand;
      deficitSupply = supply;
    }
  }
  if (largestDeficit > 0.01) {
    issues.push({
      title: "Demand exceeds available power",
      detail: `${formatPower(deficitDemand)} kW is requested when at most ${formatPower(deficitSupply)} kW is available. Add at least ${formatPower(largestDeficit)} kW or reduce demand.`,
    });
  }
  return issues;
}

function connectionReachesController(sourceId: string, connections: GridConnection[]) {
  const pending = [sourceId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === "controller") return true;
    visited.add(current);
    for (const connection of connections) {
      if (connection.source_id === current) pending.push(connection.target_id);
    }
  }
  return false;
}

function formatPower(value: number) {
  return Math.round(value * 10) / 10;
}

function formatRunTime(timestamp: string, timezone?: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
