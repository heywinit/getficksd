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
