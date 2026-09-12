import type {
  GridConnection,
  PlanningRequest,
  PlanRun,
  Scenario,
  ScenarioSummary,
} from "@/lib/plan-run";

export type BackendHealth = {
  service: string;
  status: "ok";
  version: string;
};

export type BackendEvent = {
  type: string;
  service: string;
  timestamp: string;
};

export type DemoSiteSummary = {
  id: string;
  name: string;
  location: string;
  timezone: string;
  peak_demand_kw: number;
  solar_capacity_kw: number;
  wind_capacity_kw: number;
  battery_capacity_kwh: number;
  diesel_capacity_kw: number;
};

export type DemoOperator = {
  id: string;
  name: string;
  role: string;
  site: DemoSiteSummary;
};

export async function getBackendHealth(signal?: AbortSignal): Promise<BackendHealth> {
  const response = await fetch("/api/backend/health", { signal });

  if (!response.ok) {
    throw new Error(`Go backend returned ${response.status}.`);
  }

  return response.json() as Promise<BackendHealth>;
}

export async function getDemoOperators(signal?: AbortSignal): Promise<DemoOperator[]> {
  const response = await fetch("/api/backend/demo/operators", { signal });

  if (!response.ok) {
    throw new Error(`Demo operators returned ${response.status}.`);
  }

  return response.json() as Promise<DemoOperator[]>;
}

export async function getScenario(scenarioId: string, signal?: AbortSignal): Promise<Scenario> {
  return requestJSON<Scenario>(
    `/api/backend/scenarios/${encodeURIComponent(scenarioId)}`,
    { signal },
    "Scenario",
  );
}

export async function getScenarios(signal?: AbortSignal): Promise<ScenarioSummary[]> {
  return requestJSON<ScenarioSummary[]>(
    "/api/backend/scenarios?limit=100",
    { signal },
    "Scenarios",
  );
}

export async function createScenario(scenario: Scenario, signal?: AbortSignal): Promise<Scenario> {
  return requestJSON<Scenario>(
    "/api/backend/scenarios",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario),
      signal,
    },
    "Scenario creation",
  );
}

export async function updateScenario(scenario: Scenario, signal?: AbortSignal): Promise<Scenario> {
  return requestJSON<Scenario>(
    `/api/backend/scenarios/${encodeURIComponent(scenario.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario),
      signal,
    },
    "Scenario update",
  );
}

export async function updateScenarioConnections(
  scenarioId: string,
  connections: GridConnection[],
  signal?: AbortSignal,
): Promise<Scenario> {
  return requestJSON<Scenario>(
    `/api/backend/scenarios/${encodeURIComponent(scenarioId)}/connections`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections }),
      signal,
    },
    "Grid connection update",
  );
}

export async function deleteScenario(scenarioId: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/backend/scenarios/${encodeURIComponent(scenarioId)}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Scenario deletion returned ${response.status}.`);
  }
}

export async function createPlanRun(
  planningRequest: PlanningRequest,
  signal?: AbortSignal,
): Promise<PlanRun> {
  const run = await requestJSON<PlanRun>(
    "/api/backend/plan-runs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planningRequest),
      signal,
    },
    "Plan creation",
  );
  return normalizePlanRun(run);
}

export async function getPlanRun(runId: string, signal?: AbortSignal): Promise<PlanRun> {
  const run = await requestJSON<PlanRun>(
    `/api/backend/plan-runs/${encodeURIComponent(runId)}`,
    { signal },
    "Plan run",
  );
  return normalizePlanRun(run);
}

export async function getPlanRuns(scenarioId: string, signal?: AbortSignal): Promise<PlanRun[]> {
  const runs = await requestJSON<PlanRun[]>(
    `/api/backend/scenarios/${encodeURIComponent(scenarioId)}/plan-runs?limit=100`,
    { signal },
    "Plan runs",
  );
  return runs.map(normalizePlanRun);
}

export function planRunLabel(run: PlanRun, scenario?: Scenario) {
  if (run.planner === "baseline" && run.active_event_ids.length === 0) return "Normal day";
  const eventNames = run.active_event_ids
    .map((eventId) => scenario?.events.find((event) => event.id === eventId)?.name)
    .filter((name): name is string => Boolean(name));
  if (eventNames.length > 0) return eventNames.join(" + ");
  return run.active_event_ids.length > 0 ? "Event-aware plan" : "Operating plan";
}

async function requestJSON<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `${label} returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function normalizePlanRun(run: PlanRun): PlanRun {
  return {
    ...run,
    active_event_ids: run.active_event_ids ?? [],
    intervals: run.intervals ?? [],
    contract_outcomes: run.contract_outcomes ?? [],
    decisions: run.decisions ?? [],
  };
}
