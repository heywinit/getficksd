import { queryOptions } from "@tanstack/react-query";

export type WeatherLocation = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type WeatherProvider = {
  name: string;
  url: string;
  fetched_at: string;
  cache_status: "live" | "fresh_cache" | "stale_cache";
};

export type CurrentWeather = {
  time: string;
  temperature_c: number;
  apparent_temperature_c: number;
  precipitation_mm: number;
  cloud_cover_percent: number;
  wind_speed_kph: number;
  wind_direction_degrees: number;
  weather_code: number;
  condition: string;
  is_day: boolean;
};

export type HourlyWeather = {
  time: string;
  temperature_c: number;
  precipitation_probability_percent: number;
  precipitation_mm: number;
  cloud_cover_percent: number;
  wind_speed_kph: number;
  wind_gusts_kph: number;
  shortwave_radiation_wm2: number;
  weather_code: number;
  condition: string;
};

export type DailyWeather = {
  date: string;
  temperature_max_c: number;
  temperature_min_c: number;
  sunrise: string;
  sunset: string;
  precipitation_sum_mm: number;
  precipitation_probability_max_percent: number;
  wind_speed_max_kph: number;
  wind_gusts_max_kph: number;
  shortwave_radiation_sum_mj_m2: number;
  weather_code: number;
  condition: string;
};

export type ForecastAction = {
  severity: "info" | "warning" | "critical";
  category: "solar" | "wind" | "battery" | "diesel" | string;
  title: string;
  reason: string;
  timeframe: string;
  asset_ids: string[];
};

export type OperationalImpact = {
  summary: string;
  solar_capacity_kw: number;
  wind_capacity_kw: number;
  battery_capacity_kwh: number;
  diesel_capacity_kw: number;
  actions: ForecastAction[];
};

export type SiteForecast = {
  site_id: string;
  location: WeatherLocation;
  provider: WeatherProvider;
  current: CurrentWeather;
  hourly: HourlyWeather[];
  daily: DailyWeather[];
  operational_impact: OperationalImpact;
};

type ErrorBody = {
  message?: string;
  error?: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  let body: ErrorBody | undefined;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // The status text remains useful when the backend does not return JSON.
  }

  throw new Error(body?.message ?? body?.error ?? response.statusText ?? "Request failed");
}

export async function getSiteForecast(siteId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/backend/sites/${encodeURIComponent(siteId)}/forecast`, {
    headers: { Accept: "application/json" },
    signal,
  });

  return parseResponse<SiteForecast>(response);
}

export function siteForecastQueryOptions(siteId: string) {
  return queryOptions({
    queryKey: ["site-forecast", siteId],
    queryFn: ({ signal }) => getSiteForecast(siteId, signal),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
