import type { PlanRun, Scenario } from "@/lib/plan-run";

export type SiteCapacity = {
  solar_kw: number;
  wind_kw: number;
  battery_kwh: number;
  diesel_kw: number;
};

export type CurrentScenarioSummary = {
  id: string;
  name: string;
  revision: number;
};

export type SiteLatestRun = Pick<
  PlanRun,
  "id" | "scenario_id" | "planner" | "status" | "created_at" | "summary"
>;

export type SiteSummary = {
  id: string;
  name: string;
  location: string;
  timezone: string;
  currency: string;
  current_scenario: CurrentScenarioSummary;
  capacity: SiteCapacity;
  service_count: number;
  commitment_count: number;
  event_count: number;
  latest_run: SiteLatestRun | null;
};

export type SiteDetail = {
  site: Scenario["site"];
  current_scenario: CurrentScenarioSummary & {
    description: string;
    horizon: Scenario["horizon"];
  };
  commitment_count: number;
  event_count: number;
  active_event_count: number;
  latest_run: SiteLatestRun | null;
};

export type CreateSiteInput = {
  name: string;
  location: string;
  timezone: string;
  currency: string;
  solar_capacity_kw: number;
  peak_demand_kw: number;
};

export async function getSites(signal?: AbortSignal): Promise<SiteSummary[]> {
  return requestSiteJSON<SiteSummary[]>("/api/backend/sites", signal, "Sites");
}

export async function getSite(siteId: string, signal?: AbortSignal): Promise<SiteDetail> {
  return requestSiteJSON<SiteDetail>(
    `/api/backend/sites/${encodeURIComponent(siteId)}`,
    signal,
    "Site",
  );
}

export async function createSite(input: CreateSiteInput): Promise<SiteSummary> {
  const response = await fetch("/api/backend/sites", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Site creation returned ${response.status}.`);
  }
  return response.json() as Promise<SiteSummary>;
}

async function requestSiteJSON<T>(url: string, signal: AbortSignal | undefined, label: string) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `${label} returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
