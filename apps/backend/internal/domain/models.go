package domain

import "time"

type AssetType string

const (
	AssetSolar   AssetType = "solar"
	AssetWind    AssetType = "wind"
	AssetBattery AssetType = "battery"
	AssetDiesel  AssetType = "diesel"
)

type Asset struct {
	ID   string    `json:"id"`
	Name string    `json:"name"`
	Type AssetType `json:"type"`

	CapacityKW             *float64 `json:"capacity_kw,omitempty"`
	CapacityKWH            *float64 `json:"capacity_kwh,omitempty"`
	MinimumStoredEnergyKWH *float64 `json:"minimum_stored_energy_kwh,omitempty"`
	MaxChargeKW            *float64 `json:"max_charge_kw,omitempty"`
	MaxDischargeKW         *float64 `json:"max_discharge_kw,omitempty"`
	ChargeEfficiency       *float64 `json:"charge_efficiency,omitempty"`
	DischargeEfficiency    *float64 `json:"discharge_efficiency,omitempty"`
	MinimumOutputKW        *float64 `json:"minimum_output_kw,omitempty"`
	MaximumOutputKW        *float64 `json:"maximum_output_kw,omitempty"`
	LitersPerKWH           *float64 `json:"liters_per_kwh,omitempty"`
	FuelCostPerLiter       *float64 `json:"fuel_cost_per_liter,omitempty"`
	EmissionsKGCO2PerLiter *float64 `json:"emissions_kg_co2_per_liter,omitempty"`
}

type ControlMode string

const (
	ControlFixed       ControlMode = "fixed"
	ControlCurtailable ControlMode = "curtailable"
	ControlShiftable   ControlMode = "shiftable"
)

type Service struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Description  string      `json:"description"`
	ControlMode  ControlMode `json:"control_mode"`
	RatedPowerKW float64     `json:"rated_power_kw"`
}

type Site struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Location string    `json:"location"`
	Timezone string    `json:"timezone"`
	Currency string    `json:"currency"`
	Assets   []Asset   `json:"assets"`
	Services []Service `json:"services"`
}

type PlanningHorizon struct {
	StartsAt        time.Time `json:"starts_at"`
	IntervalMinutes int       `json:"interval_minutes"`
	IntervalCount   int       `json:"interval_count"`
}

func (h PlanningHorizon) EndsAt() time.Time {
	return h.StartsAt.Add(time.Duration(h.IntervalMinutes*h.IntervalCount) * time.Minute)
}

type AssetState struct {
	AssetID             string    `json:"asset_id"`
	Type                AssetType `json:"type"`
	StoredEnergyKWH     *float64  `json:"stored_energy_kwh,omitempty"`
	FuelAvailableLiters *float64  `json:"fuel_available_liters,omitempty"`
	Running             *bool     `json:"running,omitempty"`
}

type InitialState struct {
	Assets []AssetState `json:"assets"`
}

type SignalKind string

const (
	SignalRenewableAvailability SignalKind = "renewable_availability"
	SignalServiceDemand         SignalKind = "service_demand"
	SignalFuelDelivery          SignalKind = "fuel_delivery"
)

type Signal struct {
	ID        string     `json:"id"`
	Kind      SignalKind `json:"kind"`
	AssetID   string     `json:"asset_id,omitempty"`
	ServiceID string     `json:"service_id,omitempty"`
	Unit      string     `json:"unit"`
	Values    []float64  `json:"values"`
}

type ContractKind string

const (
	ContractContinuousPower ContractKind = "continuous_power"
	ContractRuntimeDeadline ContractKind = "runtime_by_deadline"
	ContractEnergyDeadline  ContractKind = "energy_by_deadline"
)

type ContractPriority string

const (
	PriorityCritical  ContractPriority = "critical"
	PriorityEssential ContractPriority = "essential"
	PriorityFlexible  ContractPriority = "flexible"
)

type Contract struct {
	ID                     string           `json:"id"`
	Name                   string           `json:"name"`
	ServiceID              string           `json:"service_id"`
	Kind                   ContractKind     `json:"kind"`
	Priority               ContractPriority `json:"priority"`
	WindowStart            time.Time        `json:"window_start"`
	Deadline               time.Time        `json:"deadline"`
	MinimumPowerKW         *float64         `json:"minimum_power_kw,omitempty"`
	RequiredRuntimeMinutes *int             `json:"required_runtime_minutes,omitempty"`
	RequiredEnergyKWH      *float64         `json:"required_energy_kwh,omitempty"`
}

type EventType string

const (
	EventRenewableShortfall EventType = "renewable_shortfall"
	EventFuelDeliveryDelay  EventType = "fuel_delivery_delay"
	EventDemandSurge        EventType = "demand_surge"
)

type ScenarioEvent struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	Type                   EventType  `json:"type"`
	SignalID               string     `json:"signal_id"`
	Start                  *time.Time `json:"start,omitempty"`
	End                    *time.Time `json:"end,omitempty"`
	AvailabilityMultiplier *float64   `json:"availability_multiplier,omitempty"`
	DemandMultiplier       *float64   `json:"demand_multiplier,omitempty"`
	ScheduledAt            *time.Time `json:"scheduled_at,omitempty"`
	DelayedUntil           *time.Time `json:"delayed_until,omitempty"`
}

type OperatingPolicy struct {
	ReserveEnergyKWH   float64 `json:"reserve_energy_kwh"`
	AssumedLossPercent float64 `json:"assumed_loss_percent"`
}

type Scenario struct {
	SchemaVersion   string          `json:"schema_version"`
	Revision        int             `json:"revision"`
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Site            Site            `json:"site"`
	Horizon         PlanningHorizon `json:"horizon"`
	InitialState    InitialState    `json:"initial_state"`
	Signals         []Signal        `json:"signals"`
	Contracts       []Contract      `json:"contracts"`
	Events          []ScenarioEvent `json:"events"`
	OperatingPolicy OperatingPolicy `json:"operating_policy"`
}

type Planner string

const (
	PlannerBaseline Planner = "baseline"
	PlannerWattson  Planner = "wattson"
)

type PlanningRequest struct {
	ScenarioID     string   `json:"scenario_id"`
	Planner        Planner  `json:"planner"`
	ActiveEventIDs []string `json:"active_event_ids"`
	ParentRunID    string   `json:"parent_run_id,omitempty"`
}

type PlanStatus string

const (
	PlanComputing  PlanStatus = "computing"
	PlanComplete   PlanStatus = "complete"
	PlanInfeasible PlanStatus = "infeasible"
	PlanFailed     PlanStatus = "failed"
)

type RenewableDispatch struct {
	AssetID     string  `json:"asset_id"`
	AvailableKW float64 `json:"available_kw"`
	UsedKW      float64 `json:"used_kw"`
	CurtailedKW float64 `json:"curtailed_kw"`
}

type BatteryDispatch struct {
	AssetID           string  `json:"asset_id"`
	StartingEnergyKWH float64 `json:"starting_energy_kwh"`
	ChargeKW          float64 `json:"charge_kw"`
	DischargeKW       float64 `json:"discharge_kw"`
	EndingEnergyKWH   float64 `json:"ending_energy_kwh"`
	ReserveEnergyKWH  float64 `json:"reserve_energy_kwh"`
}

type GeneratorDispatch struct {
	AssetID             string  `json:"asset_id"`
	OutputKW            float64 `json:"output_kw"`
	Running             bool    `json:"running"`
	FuelUsedLiters      float64 `json:"fuel_used_liters"`
	FuelRemainingLiters float64 `json:"fuel_remaining_liters"`
}

type ServiceDelivery struct {
	ServiceID   string  `json:"service_id"`
	RequestedKW float64 `json:"requested_kw"`
	DeliveredKW float64 `json:"delivered_kw"`
	DeferredKW  float64 `json:"deferred_kw"`
	UnservedKW  float64 `json:"unserved_kw"`
}

type ContractStatus string

const (
	ContractSafe     ContractStatus = "safe"
	ContractAtRisk   ContractStatus = "at_risk"
	ContractMet      ContractStatus = "met"
	ContractBreached ContractStatus = "breached"
)

type ContractState struct {
	ContractID              string         `json:"contract_id"`
	Status                  ContractStatus `json:"status"`
	DeliveredEnergyKWH      float64        `json:"delivered_energy_kwh"`
	DeliveredRuntimeMinutes int            `json:"delivered_runtime_minutes"`
	RemainingEnergyKWH      *float64       `json:"remaining_energy_kwh,omitempty"`
	RemainingRuntimeMinutes *int           `json:"remaining_runtime_minutes,omitempty"`
}

type PlanInterval struct {
	Index             int                 `json:"index"`
	Start             time.Time           `json:"start"`
	End               time.Time           `json:"end"`
	Renewables        []RenewableDispatch `json:"renewables"`
	Batteries         []BatteryDispatch   `json:"batteries"`
	Generators        []GeneratorDispatch `json:"generators"`
	Services          []ServiceDelivery   `json:"services"`
	Contracts         []ContractState     `json:"contracts"`
	LossesKW          float64             `json:"losses_kw"`
	DieselCost        float64             `json:"diesel_cost"`
	EmissionsKGCO2    float64             `json:"emissions_kg_co2"`
	UnservedEnergyKWH float64             `json:"unserved_energy_kwh"`
	DecisionIDs       []string            `json:"decision_ids"`
}

type ContractOutcome struct {
	ContractID              string         `json:"contract_id"`
	Status                  ContractStatus `json:"status"`
	DeliveredEnergyKWH      float64        `json:"delivered_energy_kwh"`
	DeliveredRuntimeMinutes int            `json:"delivered_runtime_minutes"`
	Shortfall               float64        `json:"shortfall"`
	FirstRiskInterval       *int           `json:"first_risk_interval,omitempty"`
}

type Decision struct {
	ID                  string   `json:"id"`
	IntervalIndex       int      `json:"interval_index"`
	Kind                string   `json:"kind"`
	Title               string   `json:"title"`
	Reason              string   `json:"reason"`
	AffectedServiceIDs  []string `json:"affected_service_ids"`
	AffectedContractIDs []string `json:"affected_contract_ids"`
	BaselineDifference  string   `json:"baseline_difference"`
}

type PlanSummary struct {
	ContractsMet            int     `json:"contracts_met"`
	ContractsBreached       int     `json:"contracts_breached"`
	RenewableEnergyKWH      float64 `json:"renewable_energy_kwh"`
	DieselEnergyKWH         float64 `json:"diesel_energy_kwh"`
	UnservedEnergyKWH       float64 `json:"unserved_energy_kwh"`
	TotalDieselCost         float64 `json:"total_diesel_cost"`
	TotalEmissionsKGCO2     float64 `json:"total_emissions_kg_co2"`
	MinimumBatteryEnergyKWH float64 `json:"minimum_battery_energy_kwh"`
}

type PlanRun struct {
	ID               string            `json:"id"`
	ScenarioID       string            `json:"scenario_id"`
	ScenarioRevision int               `json:"scenario_revision"`
	ParentRunID      string            `json:"parent_run_id,omitempty"`
	Planner          Planner           `json:"planner"`
	Status           PlanStatus        `json:"status"`
	CreatedAt        time.Time         `json:"created_at"`
	ActiveEventIDs   []string          `json:"active_event_ids"`
	Intervals        []PlanInterval    `json:"intervals"`
	ContractOutcomes []ContractOutcome `json:"contract_outcomes"`
	Decisions        []Decision        `json:"decisions"`
	Summary          PlanSummary       `json:"summary"`
}
