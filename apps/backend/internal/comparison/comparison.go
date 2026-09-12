// Package comparison derives an auditable difference between two completed plan runs.
package comparison

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

// Error values returned when the two runs cannot be compared safely.
var (
	ErrIntervalCountMismatch = errors.New("plan runs have different interval counts")
	ErrIntervalTimeMismatch  = errors.New("plan runs have different interval timestamps")
)

// Result is the JSON-ready, deterministic comparison of a baseline and candidate run.
type Result struct {
	BaselineRunID  string                `json:"baseline_run_id"`
	CandidateRunID string                `json:"candidate_run_id"`
	Summary        Summary               `json:"summary"`
	Contracts      []ContractComparison  `json:"contracts"`
	Services       []ServiceComparison   `json:"services"`
	Renewables     []RenewableComparison `json:"renewables"`
	Batteries      []BatteryComparison   `json:"batteries"`
	Generators     []GeneratorComparison `json:"generators"`
	Intervals      []IntervalComparison  `json:"intervals"`
}

// Metric compares a numeric value. Delta is candidate minus baseline.
type Metric struct {
	Baseline  float64 `json:"baseline"`
	Candidate float64 `json:"candidate"`
	Delta     float64 `json:"delta"`
}

// Count compares a whole-number value. Delta is candidate minus baseline.
type Count struct {
	Baseline  int `json:"baseline"`
	Candidate int `json:"candidate"`
	Delta     int `json:"delta"`
}

// Summary contains energy, cost, emissions, and contract results for both runs.
type Summary struct {
	ContractsMet            Count  `json:"contracts_met"`
	ContractsBreached       Count  `json:"contracts_breached"`
	ContractShortfall       Metric `json:"contract_shortfall"`
	RenewableEnergyKWH      Metric `json:"renewable_energy_kwh"`
	DieselEnergyKWH         Metric `json:"diesel_energy_kwh"`
	DeliveredEnergyKWH      Metric `json:"delivered_energy_kwh"`
	DeferredEnergyKWH       Metric `json:"deferred_energy_kwh"`
	UnservedEnergyKWH       Metric `json:"unserved_energy_kwh"`
	TotalDieselCost         Metric `json:"total_diesel_cost"`
	TotalEmissionsKGCO2     Metric `json:"total_emissions_kg_co2"`
	MinimumBatteryEnergyKWH Metric `json:"minimum_battery_energy_kwh"`
}

// ContractComparison reports outcome movement for one contract.
type ContractComparison struct {
	ContractID              string                `json:"contract_id"`
	BaselinePresent         bool                  `json:"baseline_present"`
	CandidatePresent        bool                  `json:"candidate_present"`
	BaselineStatus          domain.ContractStatus `json:"baseline_status,omitempty"`
	CandidateStatus         domain.ContractStatus `json:"candidate_status,omitempty"`
	StatusChange            string                `json:"status_change"`
	DeliveredEnergyKWH      Metric                `json:"delivered_energy_kwh"`
	DeliveredRuntimeMinutes Count                 `json:"delivered_runtime_minutes"`
	Shortfall               Metric                `json:"shortfall"`
	BaselineFirstRisk       *int                  `json:"baseline_first_risk_interval,omitempty"`
	CandidateFirstRisk      *int                  `json:"candidate_first_risk_interval,omitempty"`
}

// ServiceComparison reports requested, delivered, deferred, and unserved energy.
type ServiceComparison struct {
	ServiceID        string `json:"service_id"`
	BaselinePresent  bool   `json:"baseline_present"`
	CandidatePresent bool   `json:"candidate_present"`
	RequestedEnergy  Metric `json:"requested_energy_kwh"`
	DeliveredEnergy  Metric `json:"delivered_energy_kwh"`
	DeferredEnergy   Metric `json:"deferred_energy_kwh"`
	UnservedEnergy   Metric `json:"unserved_energy_kwh"`
}

// RenewableComparison reports energy available, used, and curtailed for one renewable asset.
type RenewableComparison struct {
	AssetID          string `json:"asset_id"`
	BaselinePresent  bool   `json:"baseline_present"`
	CandidatePresent bool   `json:"candidate_present"`
	AvailableEnergy  Metric `json:"available_energy_kwh"`
	UsedEnergy       Metric `json:"used_energy_kwh"`
	CurtailedEnergy  Metric `json:"curtailed_energy_kwh"`
}

// BatteryComparison reports battery throughput and stored energy for one battery.
type BatteryComparison struct {
	AssetID          string `json:"asset_id"`
	BaselinePresent  bool   `json:"baseline_present"`
	CandidatePresent bool   `json:"candidate_present"`
	ChargeEnergy     Metric `json:"charge_energy_kwh"`
	DischargeEnergy  Metric `json:"discharge_energy_kwh"`
	MinimumEnergy    Metric `json:"minimum_energy_kwh"`
	EndingEnergy     Metric `json:"ending_energy_kwh"`
}

// GeneratorComparison reports output, fuel, cost, and emissions for one generator.
type GeneratorComparison struct {
	AssetID          string `json:"asset_id"`
	BaselinePresent  bool   `json:"baseline_present"`
	CandidatePresent bool   `json:"candidate_present"`
	OutputEnergy     Metric `json:"output_energy_kwh"`
	FuelUsed         Metric `json:"fuel_used_liters"`
	FuelRemaining    Metric `json:"fuel_remaining_liters"`
	DieselCost       Metric `json:"diesel_cost"`
	EmissionsKGCO2   Metric `json:"emissions_kg_co2"`
}

// ContractStatusChange gives the status movement for one contract at one interval.
type ContractStatusChange struct {
	ContractID       string                `json:"contract_id"`
	BaselinePresent  bool                  `json:"baseline_present"`
	CandidatePresent bool                  `json:"candidate_present"`
	BaselineStatus   domain.ContractStatus `json:"baseline_status,omitempty"`
	CandidateStatus  domain.ContractStatus `json:"candidate_status,omitempty"`
	StatusChange     string                `json:"status_change"`
}

// IntervalComparison reports dispatch changes at one aligned interval.
type IntervalComparison struct {
	Index           int                    `json:"index"`
	Start           time.Time              `json:"start"`
	End             time.Time              `json:"end"`
	SupplyKW        Metric                 `json:"supply_kw"`
	DemandKW        Metric                 `json:"demand_kw"`
	DeliveredKW     Metric                 `json:"delivered_kw"`
	DeferredKW      Metric                 `json:"deferred_kw"`
	UnservedKW      Metric                 `json:"unserved_kw"`
	RenewableKW     Metric                 `json:"renewable_kw"`
	RenewableUsedKW Metric                 `json:"renewable_used_kw"`
	CurtailedKW     Metric                 `json:"curtailed_kw"`
	BatteryChargeKW Metric                 `json:"battery_charge_kw"`
	BatteryOutputKW Metric                 `json:"battery_output_kw"`
	BatteryEnergy   Metric                 `json:"battery_ending_energy_kwh"`
	DieselOutputKW  Metric                 `json:"diesel_output_kw"`
	DieselFuelUsed  Metric                 `json:"diesel_fuel_used_liters"`
	ContractChanges []ContractStatusChange `json:"contract_changes"`
}

type totals struct {
	contractsMet      int
	contractsBreached int
	renewableEnergy   float64
	dieselEnergy      float64
	deliveredEnergy   float64
	deferredEnergy    float64
	unservedEnergy    float64
	contractShortfall float64
	dieselCost        float64
	emissions         float64
	minimumBattery    float64
	hasBattery        bool
}

type serviceTotals struct {
	requested float64
	delivered float64
	deferred  float64
	unserved  float64
	present   bool
}

type renewableTotals struct {
	available float64
	used      float64
	curtailed float64
	present   bool
}

type batteryTotals struct {
	charge    float64
	discharge float64
	minimum   float64
	ending    float64
	present   bool
}

type generatorTotals struct {
	output        float64
	fuelUsed      float64
	fuelRemaining float64
	cost          float64
	emissions     float64
	present       bool
}

// Compare returns all material differences between two plan runs.
// The function rejects runs with unaligned time horizons because any interval comparison would be misleading.
func Compare(baseline, candidate domain.PlanRun) (Result, error) {
	if err := validateHorizon(baseline, candidate); err != nil {
		return Result{}, err
	}

	baseTotals := calculateTotals(baseline)
	candidateTotals := calculateTotals(candidate)
	result := Result{
		BaselineRunID:  baseline.ID,
		CandidateRunID: candidate.ID,
		Summary: Summary{
			ContractsMet:            countMetric(baseTotals.contractsMet, candidateTotals.contractsMet),
			ContractsBreached:       countMetric(baseTotals.contractsBreached, candidateTotals.contractsBreached),
			ContractShortfall:       metric(baseTotals.contractShortfall, candidateTotals.contractShortfall),
			RenewableEnergyKWH:      metric(baseTotals.renewableEnergy, candidateTotals.renewableEnergy),
			DieselEnergyKWH:         metric(baseTotals.dieselEnergy, candidateTotals.dieselEnergy),
			DeliveredEnergyKWH:      metric(baseTotals.deliveredEnergy, candidateTotals.deliveredEnergy),
			DeferredEnergyKWH:       metric(baseTotals.deferredEnergy, candidateTotals.deferredEnergy),
			UnservedEnergyKWH:       metric(baseTotals.unservedEnergy, candidateTotals.unservedEnergy),
			TotalDieselCost:         metric(baseTotals.dieselCost, candidateTotals.dieselCost),
			TotalEmissionsKGCO2:     metric(baseTotals.emissions, candidateTotals.emissions),
			MinimumBatteryEnergyKWH: metric(baseTotals.minimumBattery, candidateTotals.minimumBattery),
		},
	}
	result.Contracts = compareContracts(baseline, candidate)
	result.Services = compareServices(baseline, candidate)
	result.Renewables = compareRenewables(baseline, candidate)
	result.Batteries = compareBatteries(baseline, candidate)
	result.Generators = compareGenerators(baseline, candidate)
	result.Intervals = compareIntervals(baseline, candidate)
	return result, nil
}

// BaselineDifferenceForDecision creates concise, data-derived text for a candidate decision.
func BaselineDifferenceForDecision(decision domain.Decision, baseline, candidate domain.PlanRun) (string, error) {
	if err := validateHorizon(baseline, candidate); err != nil {
		return "", err
	}
	if decision.IntervalIndex < 0 || decision.IntervalIndex >= len(candidate.Intervals) {
		return "", fmt.Errorf("decision %q has interval index %d outside the plan horizon", decision.ID, decision.IntervalIndex)
	}

	base := baseline.Intervals[decision.IntervalIndex]
	current := candidate.Intervals[decision.IntervalIndex]
	parts := make([]string, 0)
	for _, serviceID := range sortedUnique(decision.AffectedServiceIDs) {
		baseDelivery, baseFound := findService(base.Services, serviceID)
		candidateDelivery, candidateFound := findService(current.Services, serviceID)
		if !baseFound && !candidateFound {
			continue
		}
		if baseDelivery.DeliveredKW != candidateDelivery.DeliveredKW {
			parts = append(parts, fmt.Sprintf("service %s delivery %s kW (%s to %s)", serviceID, signed(candidateDelivery.DeliveredKW-baseDelivery.DeliveredKW), number(baseDelivery.DeliveredKW), number(candidateDelivery.DeliveredKW)))
		}
		if baseDelivery.DeferredKW != candidateDelivery.DeferredKW {
			parts = append(parts, fmt.Sprintf("service %s deferral %s kW (%s to %s)", serviceID, signed(candidateDelivery.DeferredKW-baseDelivery.DeferredKW), number(baseDelivery.DeferredKW), number(candidateDelivery.DeferredKW)))
		}
		if baseDelivery.UnservedKW != candidateDelivery.UnservedKW {
			parts = append(parts, fmt.Sprintf("service %s unserved load %s kW (%s to %s)", serviceID, signed(candidateDelivery.UnservedKW-baseDelivery.UnservedKW), number(baseDelivery.UnservedKW), number(candidateDelivery.UnservedKW)))
		}
	}
	for _, contractID := range sortedUnique(decision.AffectedContractIDs) {
		baseState, baseFound := findContract(base.Contracts, contractID)
		candidateState, candidateFound := findContract(current.Contracts, contractID)
		if !baseFound && !candidateFound {
			continue
		}
		if baseState.Status != candidateState.Status || baseFound != candidateFound {
			parts = append(parts, fmt.Sprintf("contract %s changed from %s to %s", contractID, statusText(baseState.Status, baseFound), statusText(candidateState.Status, candidateFound)))
		}
	}
	if len(parts) == 0 {
		return fmt.Sprintf("At %s, this decision has no measured difference from the baseline.", base.Start.UTC().Format(time.RFC3339)), nil
	}
	return fmt.Sprintf("At %s, compared with the baseline, %s.", base.Start.UTC().Format(time.RFC3339), strings.Join(parts, "; ")), nil
}

func validateHorizon(baseline, candidate domain.PlanRun) error {
	if len(baseline.Intervals) != len(candidate.Intervals) {
		return ErrIntervalCountMismatch
	}
	for index := range baseline.Intervals {
		base := baseline.Intervals[index]
		current := candidate.Intervals[index]
		if !base.Start.Equal(current.Start) || !base.End.Equal(current.End) {
			return fmt.Errorf("%w at interval %d", ErrIntervalTimeMismatch, index)
		}
	}
	return nil
}

func compareContracts(baseline, candidate domain.PlanRun) []ContractComparison {
	baseByID := outcomesFor(baseline)
	candidateByID := outcomesFor(candidate)
	result := make([]ContractComparison, 0, len(baseByID)+len(candidateByID))
	for _, id := range sortedUnionKeys(baseByID, candidateByID) {
		base, basePresent := baseByID[id]
		current, candidatePresent := candidateByID[id]
		result = append(result, ContractComparison{
			ContractID: id, BaselinePresent: basePresent, CandidatePresent: candidatePresent,
			BaselineStatus: base.Status, CandidateStatus: current.Status,
			StatusChange:            statusChange(base.Status, basePresent, current.Status, candidatePresent),
			DeliveredEnergyKWH:      metric(base.DeliveredEnergyKWH, current.DeliveredEnergyKWH),
			DeliveredRuntimeMinutes: countMetric(base.DeliveredRuntimeMinutes, current.DeliveredRuntimeMinutes),
			Shortfall:               metric(base.Shortfall, current.Shortfall),
			BaselineFirstRisk:       base.FirstRiskInterval, CandidateFirstRisk: current.FirstRiskInterval,
		})
	}
	return result
}

// outcomesFor uses persisted outcomes when available. It reconstructs a final outcome from
// interval states when an incomplete historical run does not have an outcome record.
func outcomesFor(run domain.PlanRun) map[string]domain.ContractOutcome {
	result := make(map[string]domain.ContractOutcome, len(run.ContractOutcomes))
	for _, outcome := range run.ContractOutcomes {
		result[outcome.ContractID] = outcome
	}
	for index, interval := range run.Intervals {
		for _, state := range interval.Contracts {
			outcome, exists := result[state.ContractID]
			if !exists {
				outcome = domain.ContractOutcome{ContractID: state.ContractID}
			}
			outcome.Status = state.Status
			outcome.DeliveredEnergyKWH = state.DeliveredEnergyKWH
			outcome.DeliveredRuntimeMinutes = state.DeliveredRuntimeMinutes
			if (state.Status == domain.ContractAtRisk || state.Status == domain.ContractBreached) && outcome.FirstRiskInterval == nil {
				firstRisk := index
				outcome.FirstRiskInterval = &firstRisk
			}
			result[state.ContractID] = outcome
		}
	}
	return result
}

func compareServices(baseline, candidate domain.PlanRun) []ServiceComparison {
	baseByID := serviceTotalsFor(baseline)
	candidateByID := serviceTotalsFor(candidate)
	result := make([]ServiceComparison, 0, len(baseByID)+len(candidateByID))
	for _, id := range sortedUnionKeys(baseByID, candidateByID) {
		base := baseByID[id]
		current := candidateByID[id]
		result = append(result, ServiceComparison{ServiceID: id, BaselinePresent: base.present, CandidatePresent: current.present,
			RequestedEnergy: metric(base.requested, current.requested), DeliveredEnergy: metric(base.delivered, current.delivered),
			DeferredEnergy: metric(base.deferred, current.deferred), UnservedEnergy: metric(base.unserved, current.unserved)})
	}
	return result
}

func compareRenewables(baseline, candidate domain.PlanRun) []RenewableComparison {
	baseByID := renewableTotalsFor(baseline)
	candidateByID := renewableTotalsFor(candidate)
	result := make([]RenewableComparison, 0, len(baseByID)+len(candidateByID))
	for _, id := range sortedUnionKeys(baseByID, candidateByID) {
		base := baseByID[id]
		current := candidateByID[id]
		result = append(result, RenewableComparison{AssetID: id, BaselinePresent: base.present, CandidatePresent: current.present,
			AvailableEnergy: metric(base.available, current.available), UsedEnergy: metric(base.used, current.used), CurtailedEnergy: metric(base.curtailed, current.curtailed)})
	}
	return result
}

func compareBatteries(baseline, candidate domain.PlanRun) []BatteryComparison {
	baseByID := batteryTotalsFor(baseline)
	candidateByID := batteryTotalsFor(candidate)
	result := make([]BatteryComparison, 0, len(baseByID)+len(candidateByID))
	for _, id := range sortedUnionKeys(baseByID, candidateByID) {
		base := baseByID[id]
		current := candidateByID[id]
		result = append(result, BatteryComparison{AssetID: id, BaselinePresent: base.present, CandidatePresent: current.present,
			ChargeEnergy: metric(base.charge, current.charge), DischargeEnergy: metric(base.discharge, current.discharge),
			MinimumEnergy: metric(base.minimum, current.minimum), EndingEnergy: metric(base.ending, current.ending)})
	}
	return result
}

func compareGenerators(baseline, candidate domain.PlanRun) []GeneratorComparison {
	baseByID := generatorTotalsFor(baseline)
	candidateByID := generatorTotalsFor(candidate)
	result := make([]GeneratorComparison, 0, len(baseByID)+len(candidateByID))
	for _, id := range sortedUnionKeys(baseByID, candidateByID) {
		base := baseByID[id]
		current := candidateByID[id]
		result = append(result, GeneratorComparison{AssetID: id, BaselinePresent: base.present, CandidatePresent: current.present,
			OutputEnergy: metric(base.output, current.output), FuelUsed: metric(base.fuelUsed, current.fuelUsed),
			FuelRemaining: metric(base.fuelRemaining, current.fuelRemaining), DieselCost: metric(base.cost, current.cost), EmissionsKGCO2: metric(base.emissions, current.emissions)})
	}
	return result
}

func compareIntervals(baseline, candidate domain.PlanRun) []IntervalComparison {
	result := make([]IntervalComparison, len(baseline.Intervals))
	for index := range baseline.Intervals {
		base := intervalTotalsFor(baseline.Intervals[index])
		current := intervalTotalsFor(candidate.Intervals[index])
		result[index] = IntervalComparison{Index: baseline.Intervals[index].Index, Start: baseline.Intervals[index].Start, End: baseline.Intervals[index].End,
			SupplyKW: metric(base.supply, current.supply), DemandKW: metric(base.demand, current.demand), DeliveredKW: metric(base.delivered, current.delivered),
			DeferredKW: metric(base.deferred, current.deferred), UnservedKW: metric(base.unserved, current.unserved), RenewableKW: metric(base.renewableAvailable, current.renewableAvailable),
			RenewableUsedKW: metric(base.renewableUsed, current.renewableUsed), CurtailedKW: metric(base.curtailment, current.curtailment),
			BatteryChargeKW: metric(base.batteryCharge, current.batteryCharge), BatteryOutputKW: metric(base.batteryOutput, current.batteryOutput), BatteryEnergy: metric(base.batteryEnergy, current.batteryEnergy),
			DieselOutputKW: metric(base.dieselOutput, current.dieselOutput), DieselFuelUsed: metric(base.dieselFuel, current.dieselFuel), ContractChanges: compareContractStates(baseline.Intervals[index].Contracts, candidate.Intervals[index].Contracts)}
	}
	return result
}

type intervalTotals struct {
	supply, demand, delivered, deferred, unserved  float64
	renewableAvailable, renewableUsed, curtailment float64
	batteryCharge, batteryOutput, batteryEnergy    float64
	dieselOutput, dieselFuel                       float64
}

func intervalTotalsFor(interval domain.PlanInterval) intervalTotals {
	result := intervalTotals{}
	for _, value := range interval.Renewables {
		result.renewableAvailable += value.AvailableKW
		result.renewableUsed += value.UsedKW
		result.curtailment += value.CurtailedKW
	}
	for _, value := range interval.Batteries {
		result.batteryCharge += value.ChargeKW
		result.batteryOutput += value.DischargeKW
		result.batteryEnergy += value.EndingEnergyKWH
	}
	for _, value := range interval.Generators {
		result.dieselOutput += value.OutputKW
		result.dieselFuel += value.FuelUsedLiters
	}
	for _, value := range interval.Services {
		result.demand += value.RequestedKW
		result.delivered += value.DeliveredKW
		result.deferred += value.DeferredKW
		result.unserved += value.UnservedKW
	}
	result.supply = result.renewableUsed + result.batteryOutput + result.dieselOutput
	return result
}

func compareContractStates(baseline, candidate []domain.ContractState) []ContractStatusChange {
	baseByID := make(map[string]domain.ContractState, len(baseline))
	candidateByID := make(map[string]domain.ContractState, len(candidate))
	for _, value := range baseline {
		baseByID[value.ContractID] = value
	}
	for _, value := range candidate {
		candidateByID[value.ContractID] = value
	}
	result := make([]ContractStatusChange, 0, len(baseByID)+len(candidateByID))
	for _, id := range sortedUnionKeys(baseByID, candidateByID) {
		base, basePresent := baseByID[id]
		current, candidatePresent := candidateByID[id]
		result = append(result, ContractStatusChange{ContractID: id, BaselinePresent: basePresent, CandidatePresent: candidatePresent, BaselineStatus: base.Status, CandidateStatus: current.Status, StatusChange: statusChange(base.Status, basePresent, current.Status, candidatePresent)})
	}
	return result
}

func calculateTotals(run domain.PlanRun) totals {
	result := totals{}
	for _, interval := range run.Intervals {
		hours := intervalHours(interval)
		for _, renewable := range interval.Renewables {
			result.renewableEnergy += renewable.UsedKW * hours
		}
		for _, generator := range interval.Generators {
			result.dieselEnergy += generator.OutputKW * hours
		}
		for _, service := range interval.Services {
			result.deliveredEnergy += service.DeliveredKW * hours
			result.deferredEnergy += service.DeferredKW * hours
			result.unservedEnergy += service.UnservedKW * hours
		}
		result.dieselCost += interval.DieselCost
		result.emissions += interval.EmissionsKGCO2
		for _, battery := range interval.Batteries {
			if !result.hasBattery || battery.StartingEnergyKWH < result.minimumBattery {
				result.minimumBattery = battery.StartingEnergyKWH
			}
			if !result.hasBattery || battery.EndingEnergyKWH < result.minimumBattery {
				result.minimumBattery = battery.EndingEnergyKWH
			}
			result.hasBattery = true
		}
	}
	for _, outcome := range run.ContractOutcomes {
		result.contractShortfall += outcome.Shortfall
		if outcome.Status == domain.ContractMet {
			result.contractsMet++
		}
		if outcome.Status == domain.ContractBreached {
			result.contractsBreached++
		}
	}
	return result
}

func serviceTotalsFor(run domain.PlanRun) map[string]serviceTotals {
	result := make(map[string]serviceTotals)
	for _, interval := range run.Intervals {
		hours := intervalHours(interval)
		for _, service := range interval.Services {
			value := result[service.ServiceID]
			value.present = true
			value.requested += service.RequestedKW * hours
			value.delivered += service.DeliveredKW * hours
			value.deferred += service.DeferredKW * hours
			value.unserved += service.UnservedKW * hours
			result[service.ServiceID] = value
		}
	}
	return result
}

func renewableTotalsFor(run domain.PlanRun) map[string]renewableTotals {
	result := make(map[string]renewableTotals)
	for _, interval := range run.Intervals {
		hours := intervalHours(interval)
		for _, renewable := range interval.Renewables {
			value := result[renewable.AssetID]
			value.present = true
			value.available += renewable.AvailableKW * hours
			value.used += renewable.UsedKW * hours
			value.curtailed += renewable.CurtailedKW * hours
			result[renewable.AssetID] = value
		}
	}
	return result
}

func batteryTotalsFor(run domain.PlanRun) map[string]batteryTotals {
	result := make(map[string]batteryTotals)
	for _, interval := range run.Intervals {
		hours := intervalHours(interval)
		for _, battery := range interval.Batteries {
			value := result[battery.AssetID]
			if !value.present || battery.StartingEnergyKWH < value.minimum {
				value.minimum = battery.StartingEnergyKWH
			}
			if !value.present || battery.EndingEnergyKWH < value.minimum {
				value.minimum = battery.EndingEnergyKWH
			}
			value.present = true
			value.charge += battery.ChargeKW * hours
			value.discharge += battery.DischargeKW * hours
			value.ending = battery.EndingEnergyKWH
			result[battery.AssetID] = value
		}
	}
	return result
}

func generatorTotalsFor(run domain.PlanRun) map[string]generatorTotals {
	result := make(map[string]generatorTotals)
	for _, interval := range run.Intervals {
		hours := intervalHours(interval)
		totalFuel := 0.0
		for _, generator := range interval.Generators {
			totalFuel += generator.FuelUsedLiters
		}
		for _, generator := range interval.Generators {
			value := result[generator.AssetID]
			value.present = true
			value.output += generator.OutputKW * hours
			value.fuelUsed += generator.FuelUsedLiters
			value.fuelRemaining = generator.FuelRemainingLiters
			share := allocationShare(generator.FuelUsedLiters, generator.OutputKW, totalFuel, interval.Generators)
			value.cost += interval.DieselCost * share
			value.emissions += interval.EmissionsKGCO2 * share
			result[generator.AssetID] = value
		}
	}
	return result
}

func allocationShare(fuelUsed, outputKW, totalFuel float64, generators []domain.GeneratorDispatch) float64 {
	if totalFuel > 0 {
		return fuelUsed / totalFuel
	}
	totalOutput := 0.0
	for _, generator := range generators {
		totalOutput += generator.OutputKW
	}
	if totalOutput > 0 {
		return outputKW / totalOutput
	}
	if len(generators) == 0 {
		return 0
	}
	return 1 / float64(len(generators))
}

func intervalHours(interval domain.PlanInterval) float64 {
	hours := interval.End.Sub(interval.Start).Hours()
	if hours > 0 {
		return hours
	}
	return 0
}

func metric(baseline, candidate float64) Metric {
	return Metric{Baseline: clean(baseline), Candidate: clean(candidate), Delta: clean(candidate - baseline)}
}
func countMetric(baseline, candidate int) Count {
	return Count{Baseline: baseline, Candidate: candidate, Delta: candidate - baseline}
}
func clean(value float64) float64 {
	if math.Abs(value) < 1e-12 {
		return 0
	}
	return value
}

func sortedUnionKeys[T any, U any](left map[string]T, right map[string]U) []string {
	ids := make(map[string]struct{}, len(left)+len(right))
	for id := range left {
		ids[id] = struct{}{}
	}
	for id := range right {
		ids[id] = struct{}{}
	}
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func sortedUnique(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "" {
			set[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func findService(values []domain.ServiceDelivery, id string) (domain.ServiceDelivery, bool) {
	for _, value := range values {
		if value.ServiceID == id {
			return value, true
		}
	}
	return domain.ServiceDelivery{}, false
}

func findContract(values []domain.ContractState, id string) (domain.ContractState, bool) {
	for _, value := range values {
		if value.ContractID == id {
			return value, true
		}
	}
	return domain.ContractState{}, false
}

func statusChange(baseline domain.ContractStatus, baselinePresent bool, candidate domain.ContractStatus, candidatePresent bool) string {
	if !baselinePresent && candidatePresent {
		return "added"
	}
	if baselinePresent && !candidatePresent {
		return "removed"
	}
	if baseline == candidate {
		return "unchanged"
	}
	baseRank := statusRank(baseline)
	candidateRank := statusRank(candidate)
	if candidateRank > baseRank {
		return "improved"
	}
	if candidateRank < baseRank {
		return "regressed"
	}
	return "changed"
}

func statusRank(status domain.ContractStatus) int {
	switch status {
	case domain.ContractBreached:
		return 0
	case domain.ContractAtRisk:
		return 1
	case domain.ContractSafe:
		return 2
	case domain.ContractMet:
		return 3
	default:
		return -1
	}
}

func statusText(status domain.ContractStatus, present bool) string {
	if !present {
		return "missing"
	}
	if status == "" {
		return "unknown"
	}
	return string(status)
}

func signed(value float64) string {
	if value > 0 {
		return "+" + number(value)
	}
	return number(value)
}

func number(value float64) string { return fmt.Sprintf("%.2f", value) }
