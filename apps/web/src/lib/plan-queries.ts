import { queryOptions } from "@tanstack/react-query";

import { getPlanRun, getPlanRuns, getScenario, getScenarios } from "@/lib/backend";

export function scenariosQueryOptions() {
  return queryOptions({
    queryKey: ["scenarios"],
    queryFn: ({ signal }) => getScenarios(signal),
  });
}

export function scenarioQueryOptions(scenarioId: string) {
  return queryOptions({
    queryKey: ["scenario", scenarioId],
    queryFn: ({ signal }) => getScenario(scenarioId, signal),
  });
}

export function planRunQueryOptions(runId: string) {
  return queryOptions({
    queryKey: ["plan-run", runId],
    queryFn: ({ signal }) => getPlanRun(runId, signal),
  });
}

export function planRunsQueryOptions(scenarioId: string) {
  return queryOptions({
    queryKey: ["plan-runs", scenarioId],
    queryFn: ({ signal }) => getPlanRuns(scenarioId, signal),
  });
}
