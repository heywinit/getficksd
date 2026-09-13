package scheduler

import (
	"context"
	"fmt"
	"math"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func buildOptimizerInput(p *preparedScenario) optimizerInput {
	input := optimizerInput{
		StartsAt:                p.scenario.Horizon.StartsAt,
		IntervalMinutes:         p.scenario.Horizon.IntervalMinutes,
		IntervalCount:           p.scenario.Horizon.IntervalCount,
		LossFactor:              1 - p.scenario.OperatingPolicy.AssumedLossPercent,
		Assets:                  append([]domain.Asset(nil), p.scenario.Site.Assets...),
		Services:                append([]domain.Service(nil), p.scenario.Site.Services...),
		Contracts:               append([]domain.Contract(nil), p.scenario.Contracts...),
		RenewableAvailabilityKW: cloneSeriesMap(p.renewableSignals),
		ServiceDemandKW:         cloneSeriesMap(p.demandSignals),
		FuelDeliveryLiters:      cloneSeriesMap(p.fuelSignals),
		InitialEnergyKWH:        cloneFloatMap(p.initialEnergy),
		InitialFuelLiters:       cloneFloatMap(p.initialFuel),
		InitialRunning:          cloneBoolMap(p.initialRunning),
		ConnectedAssets:         cloneBoolMap(p.connectedAssets),
		ChargeableBatteries:     cloneBoolMap(p.chargeableBatteries),
		ConnectedServices:       cloneBoolMap(p.connectedServices),
		PolicyMinimumKWH:        cloneFloatMap(p.policyMinimum),
		PhysicalMinimumKWH:      cloneFloatMap(p.physicalMinimum),
	}
	for _, asset := range input.Assets {
		switch asset.Type {
		case domain.AssetSolar, domain.AssetWind:
			if _, exists := input.RenewableAvailabilityKW[asset.ID]; !exists {
				input.RenewableAvailabilityKW[asset.ID] = make([]float64, input.IntervalCount)
			}
		case domain.AssetDiesel:
			if _, exists := input.FuelDeliveryLiters[asset.ID]; !exists {
				input.FuelDeliveryLiters[asset.ID] = make([]float64, input.IntervalCount)
			}
		}
	}
	for _, service := range input.Services {
		if _, exists := input.ServiceDemandKW[service.ID]; !exists {
			input.ServiceDemandKW[service.ID] = make([]float64, input.IntervalCount)
		}
	}
	return input
}

func cloneSeriesMap(source map[string][]float64) map[string][]float64 {
	result := make(map[string][]float64, len(source))
	for id, values := range source {
		result[id] = append([]float64(nil), values...)
	}
	return result
}

func (s *Scheduler) planOptimized(ctx context.Context, p *preparedScenario, run domain.PlanRun) (domain.PlanRun, error) {
	if p.hasActiveAssetOutage {
		return domain.PlanRun{}, fmt.Errorf("MILP optimizer does not support asset outage events")
	}
	input := buildOptimizerInput(p)
	solution, err := s.optimizer.Optimize(ctx, input)
	if err != nil {
		return domain.PlanRun{}, err
	}
	if err := verifyOptimizerSolution(input, solution); err != nil {
		return domain.PlanRun{}, fmt.Errorf("verify optimizer solution: %w", err)
	}
	result := buildOptimizedRun(p, run, solution)
	return s.attachNetworkValidation(ctx, input, solution, result), nil
}

func (s *Scheduler) attachNetworkValidation(ctx context.Context, input optimizerInput, solution optimizerSolution, result domain.PlanRun) domain.PlanRun {
	if s.networkValidator != nil {
		validation, validationErr := s.networkValidator.Validate(ctx, input, solution)
		if validationErr != nil {
			validation = unavailableNetworkValidation(validationErr)
		}
		validation.AssumedLossKWH = assumedNetworkLossKWH(result)
		result.NetworkValidation = &validation
	}
	return result
}

func assumedNetworkLossKWH(run domain.PlanRun) float64 {
	total := 0.0
	for _, interval := range run.Intervals {
		total += interval.LossesKW * interval.End.Sub(interval.Start).Hours()
	}
	return round6(total)
}

func buildOptimizedRun(p *preparedScenario, run domain.PlanRun, solution optimizerSolution) domain.PlanRun {
	progress := newContractProgress(p.scenario.Contracts)
	remainingFuel := cloneFloatMap(p.initialFuel)
	decisions := newDecisionState()
	plan := buildServicePlan(p)

	for index := 0; index < p.scenario.Horizon.IntervalCount; index++ {
		start := intervalStart(p.scenario.Horizon, index)
		interval := domain.PlanInterval{
			Index:         index,
			Start:         start,
			End:           start.Add(timeDurationMinutes(p.scenario.Horizon.IntervalMinutes)),
			Renewables:    make([]domain.RenewableDispatch, 0),
			Batteries:     make([]domain.BatteryDispatch, 0),
			Generators:    make([]domain.GeneratorDispatch, 0),
			Services:      make([]domain.ServiceDelivery, 0, len(p.scenario.Site.Services)),
			Contracts:     make([]domain.ContractState, 0, len(p.scenario.Contracts)),
			DecisionIDs:   make([]string, 0),
			DumpedPowerKW: round6(solution.DumpedPowerKW[index]),
		}

		for _, asset := range p.scenario.Site.Assets {
			switch asset.Type {
			case domain.AssetSolar, domain.AssetWind:
				available := seriesValue(p.renewableSignals, asset.ID, index)
				used := solution.RenewableUsedKW[asset.ID][index]
				interval.Renewables = append(interval.Renewables, domain.RenewableDispatch{
					AssetID: asset.ID, AvailableKW: round6(available), UsedKW: round6(used),
					CurtailedKW: round6(math.Max(0, available-used)),
				})
			case domain.AssetBattery:
				starting := p.initialEnergy[asset.ID]
				if index > 0 {
					starting = solution.BatteryEnergyKWH[asset.ID][index-1]
				}
				interval.Batteries = append(interval.Batteries, domain.BatteryDispatch{
					AssetID: asset.ID, StartingEnergyKWH: round6(starting),
					ChargeKW:         round6(solution.BatteryChargeKW[asset.ID][index]),
					DischargeKW:      round6(solution.BatteryDischargeKW[asset.ID][index]),
					EndingEnergyKWH:  round6(solution.BatteryEnergyKWH[asset.ID][index]),
					ReserveEnergyKWH: round6(p.policyMinimum[asset.ID]),
				})
			case domain.AssetDiesel:
				remainingFuel[asset.ID] += seriesValue(p.fuelSignals, asset.ID, index)
				output := solution.GeneratorOutputKW[asset.ID][index]
				started := solution.GeneratorStarted[asset.ID][index]
				startupFuel := 0.0
				if started {
					startupFuel = pointerValue(asset.StartupFuelLiters)
				}
				fuelUsed := output*p.intervalHours*pointerValue(asset.LitersPerKWH) + startupFuel
				remainingFuel[asset.ID] = math.Max(0, remainingFuel[asset.ID]-fuelUsed)
				interval.Generators = append(interval.Generators, domain.GeneratorDispatch{
					AssetID: asset.ID, OutputKW: round6(output), Running: solution.GeneratorRunning[asset.ID][index],
					Started: started, FuelUsedLiters: round6(fuelUsed), StartupFuelLiters: round6(startupFuel),
					FuelRemainingLiters: round6(remainingFuel[asset.ID]),
				})
				interval.DieselCost += fuelUsed * pointerValue(asset.FuelCostPerLiter)
				interval.EmissionsKGCO2 += fuelUsed * pointerValue(asset.EmissionsKGCO2PerLiter)
			}
		}

		totalDelivered := 0.0
		for _, service := range p.scenario.Site.Services {
			requested := solution.ServiceRequestedKW[service.ID][index]
			delivered := solution.ServiceDeliveredKW[service.ID][index]
			shortfall := math.Max(0, requested-delivered)
			item := domain.ServiceDelivery{ServiceID: service.ID, RequestedKW: round6(requested), DeliveredKW: round6(delivered)}
			if service.ControlMode == domain.ControlCurtailable || service.ControlMode == domain.ControlShiftable {
				item.DeferredKW = round6(shortfall)
			} else {
				item.UnservedKW = round6(shortfall)
			}
			interval.Services = append(interval.Services, item)
			totalDelivered += delivered
		}
		interval.LossesKW = round6(totalDelivered/inputLossFactor(p) - totalDelivered)
		interval.UnservedEnergyKWH = round6(sumUnserved(interval.Services) * p.intervalHours)
		interval.DieselCost = round6(interval.DieselCost)
		interval.EmissionsKGCO2 = round6(interval.EmissionsKGCO2)
		interval.Contracts = progress.update(p, interval)

		generated := collectOptimizedDecisions(p, plan, index, interval, decisions)
		for _, decision := range generated {
			interval.DecisionIDs = append(interval.DecisionIDs, decision.ID)
			run.Decisions = append(run.Decisions, decision)
		}
		run.Intervals = append(run.Intervals, interval)
	}

	run.ContractOutcomes = progress.outcomes(p.scenario.Contracts)
	run.Summary = summarize(run)
	run.Status = domain.PlanComplete
	if run.Summary.ContractsBreached > 0 {
		run.Status = domain.PlanInfeasible
	}
	run.Optimization = &domain.OptimizationInfo{
		Engine: "pyomo-highs", Termination: solution.Status, ObjectiveValue: round6(solution.ObjectiveValue),
		MIPGap: solution.MIPGap, SolveMS: solution.SolveMS,
	}
	return run
}

func seriesValue(values map[string][]float64, id string, index int) float64 {
	series := values[id]
	if index < 0 || index >= len(series) {
		return 0
	}
	return series[index]
}

func inputLossFactor(p *preparedScenario) float64 {
	return 1 - p.scenario.OperatingPolicy.AssumedLossPercent
}

func collectOptimizedDecisions(p *preparedScenario, plan servicePlan, index int, interval domain.PlanInterval, state *decisionState) []domain.Decision {
	result := make([]domain.Decision, 0)
	if index == 0 {
		result = append(result, domain.Decision{
			ID: "decision-optimize-energy-mix-0", IntervalIndex: 0, Kind: "optimize_energy_mix",
			Title:              "MILP energy mix selected",
			Reason:             "Minimized service shortfall first, then diesel cost and renewable curtailment across the full planning horizon.",
			AffectedServiceIDs: activeServiceIDs(plan, index), AffectedContractIDs: activeContractIDs(plan, index),
			BaselineDifference: "The complete horizon was optimized as one constrained problem.",
		})
	}
	for _, delivery := range interval.Services {
		deferred := delivery.DeferredKW > epsilon
		if deferred && !state.curtailed[delivery.ServiceID] {
			result = append(result, domain.Decision{
				ID: fmt.Sprintf("decision-defer-%s-%d", delivery.ServiceID, index), IntervalIndex: index,
				Kind: "defer_flexible_demand", Title: p.services[delivery.ServiceID].Name + " demand deferred",
				Reason:             "The optimization protected higher-priority service and reduced total operating cost.",
				AffectedServiceIDs: []string{delivery.ServiceID}, AffectedContractIDs: activeContractIDs(plan, index),
				BaselineDifference: fmt.Sprintf("Deferred %.1f kW at %s.", delivery.DeferredKW, interval.Start.Format("15:04")),
			})
		}
		state.curtailed[delivery.ServiceID] = deferred
	}
	for _, generator := range interval.Generators {
		if generator.Started {
			result = append(result, domain.Decision{
				ID: fmt.Sprintf("decision-start-%s-%d", generator.AssetID, index), IntervalIndex: index,
				Kind: "start_generator", Title: p.assets[generator.AssetID].Name + " started",
				Reason:             "The optimization started this generator to satisfy the least-cost feasible horizon plan.",
				AffectedServiceIDs: activeServiceIDs(plan, index), AffectedContractIDs: activeContractIDs(plan, index),
				BaselineDifference: fmt.Sprintf("Generated %.1f kW at %s.", generator.OutputKW, interval.Start.Format("15:04")),
			})
		}
	}
	return result
}
