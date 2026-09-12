package scheduler

import (
	"math"

	"github.com/heywinit/wattson/backend/internal/domain"
)

type contractProgress struct {
	byID map[string]*contractResult
}

type contractResult struct {
	status              domain.ContractStatus
	deliveredEnergy     float64
	deliveredRuntime    int
	continuousBreached  bool
	continuousShortfall float64
	firstRiskInterval   *int
}

func newContractProgress(contracts []domain.Contract) *contractProgress {
	progress := &contractProgress{byID: make(map[string]*contractResult, len(contracts))}
	for _, contract := range contracts {
		progress.byID[contract.ID] = &contractResult{status: domain.ContractSafe}
	}
	return progress
}

func (p *contractProgress) update(prepared *preparedScenario, interval domain.PlanInterval) []domain.ContractState {
	states := make([]domain.ContractState, 0, len(prepared.scenario.Contracts))
	for _, contract := range prepared.scenario.Contracts {
		result := p.byID[contract.ID]
		service := prepared.services[contract.ServiceID]
		delivered := deliveredPower(interval.Services, contract.ServiceID)
		inWindow := !interval.Start.Before(contract.WindowStart) && !interval.End.After(contract.Deadline)

		if inWindow {
			result.deliveredEnergy += delivered * prepared.intervalHours
			switch contract.Kind {
			case domain.ContractContinuousPower:
				if delivered+epsilon >= pointerValue(contract.MinimumPowerKW) {
					result.deliveredRuntime += prepared.scenario.Horizon.IntervalMinutes
				} else {
					result.continuousBreached = true
					result.continuousShortfall += (pointerValue(contract.MinimumPowerKW) - delivered) * prepared.intervalHours
				}
			case domain.ContractRuntimeDeadline:
				if delivered+epsilon >= service.RatedPowerKW {
					result.deliveredRuntime += prepared.scenario.Horizon.IntervalMinutes
				}
			}
		}

		deadlineReached := !interval.End.Before(contract.Deadline)
		result.status = contractStatus(prepared, contract, result, interval.Index, deadlineReached)
		if (result.status == domain.ContractAtRisk || result.status == domain.ContractBreached) && result.firstRiskInterval == nil {
			index := interval.Index
			result.firstRiskInterval = &index
		}

		state := domain.ContractState{
			ContractID:              contract.ID,
			Status:                  result.status,
			DeliveredEnergyKWH:      round6(result.deliveredEnergy),
			DeliveredRuntimeMinutes: result.deliveredRuntime,
		}
		switch contract.Kind {
		case domain.ContractRuntimeDeadline:
			remaining := max(0, pointerValue(contract.RequiredRuntimeMinutes)-result.deliveredRuntime)
			state.RemainingRuntimeMinutes = &remaining
		case domain.ContractEnergyDeadline:
			remaining := round6(math.Max(0, pointerValue(contract.RequiredEnergyKWH)-result.deliveredEnergy))
			state.RemainingEnergyKWH = &remaining
		}
		states = append(states, state)
	}
	return states
}

func contractStatus(
	p *preparedScenario,
	contract domain.Contract,
	result *contractResult,
	intervalIndex int,
	deadlineReached bool,
) domain.ContractStatus {
	switch contract.Kind {
	case domain.ContractContinuousPower:
		if result.continuousBreached {
			return domain.ContractBreached
		}
		if deadlineReached {
			return domain.ContractMet
		}
		return domain.ContractSafe
	case domain.ContractRuntimeDeadline:
		required := pointerValue(contract.RequiredRuntimeMinutes)
		if result.deliveredRuntime >= required {
			return domain.ContractMet
		}
		if deadlineReached {
			return domain.ContractBreached
		}
		remainingIntervals := remainingContractIntervals(p.scenario.Horizon, contract, intervalIndex+1)
		if result.deliveredRuntime+remainingIntervals*p.scenario.Horizon.IntervalMinutes < required {
			return domain.ContractAtRisk
		}
		return domain.ContractSafe
	case domain.ContractEnergyDeadline:
		required := pointerValue(contract.RequiredEnergyKWH)
		if result.deliveredEnergy+epsilon >= required {
			return domain.ContractMet
		}
		if deadlineReached {
			return domain.ContractBreached
		}
		service := p.services[contract.ServiceID]
		remainingIntervals := remainingContractIntervals(p.scenario.Horizon, contract, intervalIndex+1)
		maximumRemaining := float64(remainingIntervals) * service.RatedPowerKW * p.intervalHours
		if result.deliveredEnergy+maximumRemaining+epsilon < required {
			return domain.ContractAtRisk
		}
		return domain.ContractSafe
	default:
		return domain.ContractBreached
	}
}

func remainingContractIntervals(horizon domain.PlanningHorizon, contract domain.Contract, from int) int {
	count := 0
	for index := from; index < horizon.IntervalCount; index++ {
		start := intervalStart(horizon, index)
		end := start.Add(timeDurationMinutes(horizon.IntervalMinutes))
		if !start.Before(contract.WindowStart) && !end.After(contract.Deadline) {
			count++
		}
	}
	return count
}

func (p *contractProgress) outcomes(contracts []domain.Contract) []domain.ContractOutcome {
	outcomes := make([]domain.ContractOutcome, 0, len(contracts))
	for _, contract := range contracts {
		result := p.byID[contract.ID]
		shortfall := 0.0
		switch contract.Kind {
		case domain.ContractContinuousPower:
			shortfall = result.continuousShortfall
		case domain.ContractRuntimeDeadline:
			shortfall = float64(max(0, pointerValue(contract.RequiredRuntimeMinutes)-result.deliveredRuntime))
		case domain.ContractEnergyDeadline:
			shortfall = math.Max(0, pointerValue(contract.RequiredEnergyKWH)-result.deliveredEnergy)
		}
		outcomes = append(outcomes, domain.ContractOutcome{
			ContractID:              contract.ID,
			Status:                  result.status,
			DeliveredEnergyKWH:      round6(result.deliveredEnergy),
			DeliveredRuntimeMinutes: result.deliveredRuntime,
			Shortfall:               round6(shortfall),
			FirstRiskInterval:       result.firstRiskInterval,
		})
	}
	return outcomes
}

func deliveredPower(deliveries []domain.ServiceDelivery, serviceID string) float64 {
	for _, delivery := range deliveries {
		if delivery.ServiceID == serviceID {
			return delivery.DeliveredKW
		}
	}
	return 0
}

func summarize(run domain.PlanRun) domain.PlanSummary {
	summary := domain.PlanSummary{}
	minimumBattery := math.Inf(1)
	for _, outcome := range run.ContractOutcomes {
		if outcome.Status == domain.ContractMet {
			summary.ContractsMet++
		} else if outcome.Status == domain.ContractBreached {
			summary.ContractsBreached++
		}
	}
	for _, interval := range run.Intervals {
		intervalHours := interval.End.Sub(interval.Start).Hours()
		for _, renewable := range interval.Renewables {
			summary.RenewableEnergyKWH += renewable.UsedKW * intervalHours
		}
		for _, generator := range interval.Generators {
			summary.DieselEnergyKWH += generator.OutputKW * intervalHours
		}
		for _, battery := range interval.Batteries {
			minimumBattery = math.Min(minimumBattery, battery.EndingEnergyKWH)
		}
		summary.UnservedEnergyKWH += interval.UnservedEnergyKWH
		summary.TotalDieselCost += interval.DieselCost
		summary.TotalEmissionsKGCO2 += interval.EmissionsKGCO2
	}
	if !math.IsInf(minimumBattery, 1) {
		summary.MinimumBatteryEnergyKWH = round6(minimumBattery)
	}
	summary.RenewableEnergyKWH = round6(summary.RenewableEnergyKWH)
	summary.DieselEnergyKWH = round6(summary.DieselEnergyKWH)
	summary.UnservedEnergyKWH = round6(summary.UnservedEnergyKWH)
	summary.TotalDieselCost = round6(summary.TotalDieselCost)
	summary.TotalEmissionsKGCO2 = round6(summary.TotalEmissionsKGCO2)
	return summary
}
