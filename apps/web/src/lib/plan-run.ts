export type ContractPriority = "critical" | "essential" | "flexible";
export type ContractStatus = "safe" | "at_risk" | "met" | "breached";

export type GridConnection = {
  id: string;
  source_id: string;
  target_id: string;
};

export const defaultScenarioId = "spiti-valley-community-v2";

export type ScenarioSummary = {
  id: string;
  name: string;
  site_name: string;
  location: string;
  revision: number;
  horizon: {
    starts_at: string;
    interval_minutes: number;
    interval_count: number;
  };
  contract_count: number;
  event_count: number;
};

export type Scenario = {
  schema_version: "1";
  revision: number;
  id: string;
  name: string;
  description: string;
  site: {
    id: string;
    name: string;
    location: string;
    timezone: string;
    currency: string;
    assets: Array<{
      id: string;
      name: string;
      type: "solar" | "wind" | "battery" | "diesel";
      capacity_kw?: number;
      capacity_kwh?: number;
      minimum_stored_energy_kwh?: number;
      max_charge_kw?: number;
      max_discharge_kw?: number;
      charge_efficiency?: number;
      discharge_efficiency?: number;
      minimum_output_kw?: number;
      maximum_output_kw?: number;
      liters_per_kwh?: number;
      startup_fuel_liters?: number;
      minimum_runtime_minutes?: number;
      ramp_rate_kw_per_minute?: number;
      fuel_cost_per_liter?: number;
      emissions_kg_co2_per_liter?: number;
    }>;
    services: Array<{
      id: string;
      name: string;
      description: string;
      control_mode: "fixed" | "curtailable" | "shiftable";
      rated_power_kw: number;
    }>;
    connections?: GridConnection[];
  };
  horizon: {
    starts_at: string;
    interval_minutes: number;
    interval_count: number;
  };
  initial_state: {
    assets: Array<{
      asset_id: string;
      type: "battery" | "diesel";
      stored_energy_kwh?: number;
      fuel_available_liters?: number;
      running?: boolean;
    }>;
  };
  signals: Array<{
    id: string;
    kind: "renewable_availability" | "service_demand" | "fuel_delivery";
    asset_id?: string;
    service_id?: string;
    unit: "kW" | "liters";
    values: number[];
  }>;
  contracts: Array<{
    id: string;
    name: string;
    service_id: string;
    kind: "continuous_power" | "runtime_by_deadline" | "energy_by_deadline";
    priority: ContractPriority;
    window_start: string;
    deadline: string;
    minimum_power_kw?: number;
    required_runtime_minutes?: number;
    required_energy_kwh?: number;
  }>;
  events: Array<{
    id: string;
    name: string;
    type: "asset_outage" | "renewable_shortfall" | "fuel_delivery_delay" | "demand_surge";
    signal_id?: string;
    asset_id?: string;
    start?: string;
    end?: string;
    availability_multiplier?: number;
    demand_multiplier?: number;
    scheduled_at?: string;
    delayed_until?: string;
  }>;
  operating_policy: {
    reserve_energy_kwh: number;
    assumed_loss_percent: number;
  };
};

export type PlanInterval = {
  index: number;
  start: string;
  end: string;
  renewables: Array<{
    asset_id: string;
    available_kw: number;
    used_kw: number;
    curtailed_kw: number;
  }>;
  batteries: Array<{
    asset_id: string;
    starting_energy_kwh: number;
    charge_kw: number;
    discharge_kw: number;
    ending_energy_kwh: number;
    reserve_energy_kwh: number;
  }>;
  generators: Array<{
    asset_id: string;
    output_kw: number;
    running: boolean;
    started: boolean;
    fuel_used_liters: number;
    startup_fuel_liters: number;
    fuel_remaining_liters: number;
  }>;
  services: Array<{
    service_id: string;
    requested_kw: number;
    delivered_kw: number;
    deferred_kw: number;
    unserved_kw: number;
  }>;
  contracts: Array<{
    contract_id: string;
    status: ContractStatus;
    delivered_energy_kwh: number;
    delivered_runtime_minutes: number;
    remaining_energy_kwh?: number;
    remaining_runtime_minutes?: number;
  }>;
  losses_kw: number;
  dumped_power_kw: number;
  diesel_cost: number;
  emissions_kg_co2: number;
  unserved_energy_kwh: number;
  decision_ids: string[];
};

export type ComparisonMetric = {
  baseline: number;
  candidate: number;
  delta: number;
};

export type ComparisonCount = {
  baseline: number;
  candidate: number;
  delta: number;
};

export type PlanComparison = {
  baseline_run_id: string;
  candidate_run_id: string;
  summary: {
    contracts_met: ComparisonCount;
    contracts_breached: ComparisonCount;
    contract_shortfall: ComparisonMetric;
    renewable_energy_kwh: ComparisonMetric;
    diesel_energy_kwh: ComparisonMetric;
    delivered_energy_kwh: ComparisonMetric;
    deferred_energy_kwh: ComparisonMetric;
    unserved_energy_kwh: ComparisonMetric;
    total_diesel_cost: ComparisonMetric;
    total_emissions_kg_co2: ComparisonMetric;
    minimum_battery_energy_kwh: ComparisonMetric;
  };
  contracts: Array<{
    contract_id: string;
    baseline_present: boolean;
    candidate_present: boolean;
    baseline_status?: ContractStatus;
    candidate_status?: ContractStatus;
    status_change: string;
    delivered_energy_kwh: ComparisonMetric;
    delivered_runtime_minutes: ComparisonCount;
    shortfall: ComparisonMetric;
    baseline_first_risk_interval?: number;
    candidate_first_risk_interval?: number;
  }>;
  services: Array<{
    service_id: string;
    baseline_present: boolean;
    candidate_present: boolean;
    requested_energy_kwh: ComparisonMetric;
    delivered_energy_kwh: ComparisonMetric;
    deferred_energy_kwh: ComparisonMetric;
    unserved_energy_kwh: ComparisonMetric;
  }>;
  renewables: Array<{
    asset_id: string;
    baseline_present: boolean;
    candidate_present: boolean;
    available_energy_kwh: ComparisonMetric;
    used_energy_kwh: ComparisonMetric;
    curtailed_energy_kwh: ComparisonMetric;
  }>;
  batteries: Array<{
    asset_id: string;
    baseline_present: boolean;
    candidate_present: boolean;
    charge_energy_kwh: ComparisonMetric;
    discharge_energy_kwh: ComparisonMetric;
    minimum_energy_kwh: ComparisonMetric;
    ending_energy_kwh: ComparisonMetric;
  }>;
  generators: Array<{
    asset_id: string;
    baseline_present: boolean;
    candidate_present: boolean;
    output_energy_kwh: ComparisonMetric;
    fuel_used_liters: ComparisonMetric;
    fuel_remaining_liters: ComparisonMetric;
    diesel_cost: ComparisonMetric;
    emissions_kg_co2: ComparisonMetric;
  }>;
  intervals: Array<{
    index: number;
    start: string;
    end: string;
    supply_kw: ComparisonMetric;
    demand_kw: ComparisonMetric;
    delivered_kw: ComparisonMetric;
    deferred_kw: ComparisonMetric;
    unserved_kw: ComparisonMetric;
    renewable_kw: ComparisonMetric;
    renewable_used_kw: ComparisonMetric;
    curtailed_kw: ComparisonMetric;
    battery_charge_kw: ComparisonMetric;
    battery_output_kw: ComparisonMetric;
    battery_ending_energy_kwh: ComparisonMetric;
    diesel_output_kw: ComparisonMetric;
    diesel_fuel_used_liters: ComparisonMetric;
    contract_changes: Array<{
      contract_id: string;
      baseline_present: boolean;
      candidate_present: boolean;
      baseline_status?: ContractStatus;
      candidate_status?: ContractStatus;
      status_change: string;
    }>;
  }>;
};

export type PlanRun = {
  id: string;
  scenario_id: string;
  scenario_revision: number;
  scenario_snapshot_hash: string;
  parent_run_id?: string;
  planner: "baseline" | "wattson";
  status: "computing" | "complete" | "infeasible" | "failed";
  created_at: string;
  active_event_ids: string[];
  intervals: PlanInterval[];
  contract_outcomes: Array<{
    contract_id: string;
    status: ContractStatus;
    delivered_energy_kwh: number;
    delivered_runtime_minutes: number;
    shortfall: number;
    first_risk_interval?: number;
  }>;
  decisions: Array<{
    id: string;
    interval_index: number;
    kind: string;
    title: string;
    reason: string;
    affected_service_ids: string[];
    affected_contract_ids: string[];
    baseline_difference: string;
  }>;
  summary: {
    contracts_met: number;
    contracts_breached: number;
    renewable_energy_kwh: number;
    diesel_energy_kwh: number;
    unserved_energy_kwh: number;
    total_diesel_cost: number;
    total_emissions_kg_co2: number;
    minimum_battery_energy_kwh: number;
  };
  optimization?: {
    engine: string;
    termination: string;
    objective_value: number;
    mip_gap: number;
    solve_ms: number;
    used_fallback: boolean;
    fallback_reason?: string;
  };
  comparison?: PlanComparison;
};

export type PlanningRequest = {
  scenario_id: string;
  planner: "baseline" | "wattson";
  active_event_ids: string[];
  parent_run_id?: string;
};
