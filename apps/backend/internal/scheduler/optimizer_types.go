package scheduler

import (
	"context"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

// Optimizer is the narrow boundary between the scheduler and an external
// mathematical optimizer. The input contains already-normalized, post-event
// values; implementations return only solver decisions, which Go must verify
// before turning them into a persisted plan run.
type Optimizer interface {
	Optimize(ctx context.Context, input optimizerInput) (optimizerSolution, error)
}

type optimizerInput struct {
	StartsAt        time.Time `json:"starts_at"`
	IntervalMinutes int       `json:"interval_minutes"`
	IntervalCount   int       `json:"interval_count"`
	LossFactor      float64   `json:"loss_factor"`

	Assets    []domain.Asset    `json:"assets"`
	Services  []domain.Service  `json:"services"`
	Contracts []domain.Contract `json:"contracts"`

	RenewableAvailabilityKW map[string][]float64 `json:"renewable_availability_kw"`
	ServiceDemandKW         map[string][]float64 `json:"service_demand_kw"`
	FuelDeliveryLiters      map[string][]float64 `json:"fuel_delivery_liters"`

	InitialEnergyKWH    map[string]float64 `json:"initial_energy_kwh"`
	InitialFuelLiters   map[string]float64 `json:"initial_fuel_liters"`
	InitialRunning      map[string]bool    `json:"initial_running"`
	ConnectedAssets     map[string]bool    `json:"connected_assets"`
	ChargeableBatteries map[string]bool    `json:"chargeable_batteries"`
	ConnectedServices   map[string]bool    `json:"connected_services"`
	PolicyMinimumKWH    map[string]float64 `json:"policy_minimum_kwh"`
	PhysicalMinimumKWH  map[string]float64 `json:"physical_minimum_kwh"`
}

type optimizerSolution struct {
	Status         string  `json:"status"`
	ObjectiveValue float64 `json:"objective_value"`
	MIPGap         float64 `json:"mip_gap"`
	SolveMS        int64   `json:"solve_ms"`

	ServiceRequestedKW map[string][]float64 `json:"service_requested_kw"`
	ServiceDeliveredKW map[string][]float64 `json:"service_delivered_kw"`
	RenewableUsedKW    map[string][]float64 `json:"renewable_used_kw"`
	BatteryChargeKW    map[string][]float64 `json:"battery_charge_kw"`
	BatteryDischargeKW map[string][]float64 `json:"battery_discharge_kw"`
	BatteryEnergyKWH   map[string][]float64 `json:"battery_energy_kwh"`
	GeneratorOutputKW  map[string][]float64 `json:"generator_output_kw"`
	GeneratorRunning   map[string][]bool    `json:"generator_running"`
	GeneratorStarted   map[string][]bool    `json:"generator_started"`
	DumpedPowerKW      []float64            `json:"dumped_power_kw"`
}
