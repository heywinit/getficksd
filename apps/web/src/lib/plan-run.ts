export type ContractPriority = "critical" | "essential" | "flexible";
export type ContractStatus = "safe" | "at_risk" | "met" | "breached";

export const defaultScenarioId = "spiti-valley-default";

export type Scenario = {
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
    type: "renewable_shortfall" | "fuel_delivery_delay" | "demand_surge";
    signal_id: string;
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
    fuel_used_liters: number;
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
  diesel_cost: number;
  emissions_kg_co2: number;
  unserved_energy_kwh: number;
  decision_ids: string[];
};

export type PlanRun = {
  id: string;
  scenario_id: string;
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
};

export type PlanningRequest = {
  scenario_id: string;
  planner: "baseline" | "wattson";
  active_event_ids: string[];
  parent_run_id?: string;
};
