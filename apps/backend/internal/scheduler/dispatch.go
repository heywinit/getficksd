package scheduler

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

type dispatchState struct {
	batteryEnergy map[string]float64
	fuel          map[string]float64
	running       map[string]bool
}

func newDispatchState(p *preparedScenario) *dispatchState {
	return &dispatchState{
		batteryEnergy: cloneFloatMap(p.initialEnergy),
		fuel:          cloneFloatMap(p.initialFuel),
		running:       cloneBoolMap(p.initialRunning),
	}
}

type decisionState struct {
	curtailed         map[string]bool
	scheduledContract map[string]bool
}

func newDecisionState() *decisionState {
	return &decisionState{
		curtailed:         make(map[string]bool),
		scheduledContract: make(map[string]bool),
	}
}

func dispatchInterval(
	p *preparedScenario,
	plan servicePlan,
	state *dispatchState,
	index int,
	decisions *decisionState,
) (domain.PlanInterval, []domain.Decision) {
	start := intervalStart(p.scenario.Horizon, index)
	interval := domain.PlanInterval{
		Index:       index,
		Start:       start,
		End:         start.Add(timeDurationMinutes(p.scenario.Horizon.IntervalMinutes)),
		Renewables:  make([]domain.RenewableDispatch, 0),
		Batteries:   make([]domain.BatteryDispatch, 0),
		Generators:  make([]domain.GeneratorDispatch, 0),
		Services:    make([]domain.ServiceDelivery, 0, len(p.scenario.Site.Services)),
		Contracts:   make([]domain.ContractState, 0, len(p.scenario.Contracts)),
		DecisionIDs: make([]string, 0),
	}

	for assetID, values := range p.fuelSignals {
		state.fuel[assetID] += values[index]
	}

	renewableAvailable := 0.0
	for _, asset := range p.scenario.Site.Assets {
		if asset.Type != domain.AssetSolar && asset.Type != domain.AssetWind {
			continue
		}
		available := p.renewableSignals[asset.ID][index]
		renewableAvailable += available
		interval.Renewables = append(interval.Renewables, domain.RenewableDispatch{
			AssetID:     asset.ID,
			AvailableKW: round6(available),
		})
	}

	normalBattery, emergencyBattery := batteryDischargeCapacity(p, state)
	generatorCapacity := generatorCapacity(p, state)
	normalGrossCapacity := renewableAvailable + sumValues(normalBattery) + sumValues(generatorCapacity)
	totalGrossCapacity := normalGrossCapacity + sumValues(emergencyBattery)
	lossFactor := 1 - p.scenario.OperatingPolicy.AssumedLossPercent
	discretionaryServiceCapacity := (renewableAvailable + sumValues(normalBattery)) * lossFactor
	totalServiceCapacity := totalGrossCapacity * lossFactor

	delivered := make(map[string]float64, len(p.services))
	remainingRequiredCapacity := totalServiceCapacity
	requiredServices := orderedServices(p, plan, index, true)
	for _, service := range requiredServices {
		required := plan.required[service.ID][index]
		amount := math.Min(required, remainingRequiredCapacity)
		delivered[service.ID] += amount
		remainingRequiredCapacity -= amount
	}

	requiredDelivered := sumValues(delivered)
	remainingNormalCapacity := math.Max(0, discretionaryServiceCapacity-requiredDelivered)
	for _, service := range orderedServices(p, plan, index, false) {
		remaining := math.Max(0, plan.requested[service.ID][index]-delivered[service.ID])
		amount := math.Min(remaining, remainingNormalCapacity)
		delivered[service.ID] += amount
		remainingNormalCapacity -= amount
	}

	for _, service := range p.scenario.Site.Services {
		requested := plan.requested[service.ID][index]
		provided := math.Min(requested, delivered[service.ID])
		shortfall := math.Max(0, requested-provided)
		item := domain.ServiceDelivery{
			ServiceID:   service.ID,
			RequestedKW: round6(requested),
			DeliveredKW: round6(provided),
		}
		if service.ControlMode == domain.ControlCurtailable {
			item.DeferredKW = round6(shortfall)
		} else {
			item.UnservedKW = round6(shortfall)
		}
		interval.Services = append(interval.Services, item)
	}

	totalDelivered := sumValues(delivered)
	grossLoad := totalDelivered / lossFactor
	interval.LossesKW = round6(grossLoad - totalDelivered)
	interval.UnservedEnergyKWH = round6(sumUnserved(interval.Services) * p.intervalHours)

	renewableForLoad := math.Min(renewableAvailable, grossLoad)
	remainingLoad := math.Max(0, grossLoad-renewableForLoad)
	remainingLoad, batteryDischarge := dischargeBatteries(p, state, normalBattery, remainingLoad)
	loadBeforeGenerators := remainingLoad
	remainingLoad, generatorOutput := runGenerators(p, state, generatorCapacity, remainingLoad)
	remainingLoad, emergencyDischarge := dischargeBatteries(p, state, emergencyBattery, remainingLoad)
	for assetID, value := range emergencyDischarge {
		batteryDischarge[assetID] += value
	}

	generatorTotal := sumValues(generatorOutput)
	generatorForLoad := math.Min(generatorTotal, loadBeforeGenerators)
	generatorExcess := math.Max(0, generatorTotal-generatorForLoad)
	renewableExcess := math.Max(0, renewableAvailable-renewableForLoad)
	chargeInput := chargeBatteries(p, state, batteryDischarge, renewableExcess+generatorExcess)
	renewableForCharge := math.Min(renewableExcess, sumValues(chargeInput))
	assignRenewableUse(interval.Renewables, renewableForLoad+renewableForCharge)

	for _, asset := range p.scenario.Site.Assets {
		switch asset.Type {
		case domain.AssetBattery:
			starting := state.batteryEnergy[asset.ID] + batteryDischarge[asset.ID]*p.intervalHours/pointerValue(asset.DischargeEfficiency) - chargeInput[asset.ID]*p.intervalHours*pointerValue(asset.ChargeEfficiency)
			interval.Batteries = append(interval.Batteries, domain.BatteryDispatch{
				AssetID:           asset.ID,
				StartingEnergyKWH: round6(starting),
				ChargeKW:          round6(chargeInput[asset.ID]),
				DischargeKW:       round6(batteryDischarge[asset.ID]),
				EndingEnergyKWH:   round6(state.batteryEnergy[asset.ID]),
				ReserveEnergyKWH:  round6(p.policyMinimum[asset.ID]),
			})
		case domain.AssetDiesel:
			output := generatorOutput[asset.ID]
			fuelUsed := output * p.intervalHours * pointerValue(asset.LitersPerKWH)
			interval.Generators = append(interval.Generators, domain.GeneratorDispatch{
				AssetID:             asset.ID,
				OutputKW:            round6(output),
				Running:             output > epsilon,
				FuelUsedLiters:      round6(fuelUsed),
				FuelRemainingLiters: round6(state.fuel[asset.ID]),
			})
			interval.DieselCost += fuelUsed * pointerValue(asset.FuelCostPerLiter)
			interval.EmissionsKGCO2 += fuelUsed * pointerValue(asset.EmissionsKGCO2PerLiter)
		}
	}
	interval.DieselCost = round6(interval.DieselCost)
	interval.EmissionsKGCO2 = round6(interval.EmissionsKGCO2)

	if remainingLoad > epsilon {
		// The service allocator uses the same capacity bounds. This guard only absorbs floating-point drift.
		interval.UnservedEnergyKWH = round6(interval.UnservedEnergyKWH + remainingLoad*lossFactor*p.intervalHours)
	}

	return interval, collectDecisions(p, plan, state, index, interval, decisions)
}

func orderedServices(p *preparedScenario, plan servicePlan, index int, required bool) []domain.Service {
	services := append([]domain.Service(nil), p.scenario.Site.Services...)
	sort.SliceStable(services, func(i, j int) bool {
		if required {
			left := plan.priority[services[i].ID][index]
			right := plan.priority[services[j].ID][index]
			if left != right {
				return left < right
			}
		}
		left := controlRank(services[i].ControlMode)
		right := controlRank(services[j].ControlMode)
		if left != right {
			return left < right
		}
		return services[i].ID < services[j].ID
	})
	if !required {
		return services
	}
	result := services[:0]
	for _, service := range services {
		if plan.required[service.ID][index] > epsilon {
			result = append(result, service)
		}
	}
	return result
}

func controlRank(mode domain.ControlMode) int {
	switch mode {
	case domain.ControlFixed:
		return 0
	case domain.ControlCurtailable:
		return 1
	default:
		return 2
	}
}

func batteryDischargeCapacity(p *preparedScenario, state *dispatchState) (map[string]float64, map[string]float64) {
	normal := make(map[string]float64)
	emergency := make(map[string]float64)
	for _, asset := range p.scenario.Site.Assets {
		if asset.Type != domain.AssetBattery {
			continue
		}
		efficiency := pointerValue(asset.DischargeEfficiency)
		limit := pointerValue(asset.MaxDischargeKW)
		normal[asset.ID] = math.Min(limit, math.Max(0, state.batteryEnergy[asset.ID]-p.policyMinimum[asset.ID])*efficiency/p.intervalHours)
		physicalCapacity := math.Min(limit, math.Max(0, state.batteryEnergy[asset.ID]-p.physicalMinimum[asset.ID])*efficiency/p.intervalHours)
		emergency[asset.ID] = math.Max(0, physicalCapacity-normal[asset.ID])
	}
	return normal, emergency
}

func generatorCapacity(p *preparedScenario, state *dispatchState) map[string]float64 {
	capacity := make(map[string]float64)
	for _, asset := range p.scenario.Site.Assets {
		if asset.Type != domain.AssetDiesel {
			continue
		}
		fuelBound := state.fuel[asset.ID] / pointerValue(asset.LitersPerKWH) / p.intervalHours
		capacity[asset.ID] = math.Min(pointerValue(asset.MaximumOutputKW), fuelBound)
	}
	return capacity
}

func dischargeBatteries(
	p *preparedScenario,
	state *dispatchState,
	capacity map[string]float64,
	load float64,
) (float64, map[string]float64) {
	output := make(map[string]float64)
	for _, asset := range p.scenario.Site.Assets {
		if asset.Type != domain.AssetBattery || load <= epsilon {
			continue
		}
		amount := math.Min(capacity[asset.ID], load)
		state.batteryEnergy[asset.ID] -= amount * p.intervalHours / pointerValue(asset.DischargeEfficiency)
		output[asset.ID] = amount
		load -= amount
	}
	return math.Max(0, load), output
}

func runGenerators(
	p *preparedScenario,
	state *dispatchState,
	capacity map[string]float64,
	load float64,
) (float64, map[string]float64) {
	output := make(map[string]float64)
	for _, asset := range p.scenario.Site.Assets {
		if asset.Type != domain.AssetDiesel || load <= epsilon {
			continue
		}
		amount := math.Min(capacity[asset.ID], math.Max(pointerValue(asset.MinimumOutputKW), load))
		fuelUsed := amount * p.intervalHours * pointerValue(asset.LitersPerKWH)
		state.fuel[asset.ID] = math.Max(0, state.fuel[asset.ID]-fuelUsed)
		output[asset.ID] = amount
		load -= math.Min(load, amount)
	}
	return math.Max(0, load), output
}

func chargeBatteries(
	p *preparedScenario,
	state *dispatchState,
	discharge map[string]float64,
	surplus float64,
) map[string]float64 {
	input := make(map[string]float64)
	for _, asset := range p.scenario.Site.Assets {
		if asset.Type != domain.AssetBattery || surplus <= epsilon || discharge[asset.ID] > epsilon {
			continue
		}
		energyRoomKW := (pointerValue(asset.CapacityKWH) - state.batteryEnergy[asset.ID]) / pointerValue(asset.ChargeEfficiency) / p.intervalHours
		amount := math.Min(surplus, math.Min(pointerValue(asset.MaxChargeKW), math.Max(0, energyRoomKW)))
		state.batteryEnergy[asset.ID] += amount * p.intervalHours * pointerValue(asset.ChargeEfficiency)
		input[asset.ID] = amount
		surplus -= amount
	}
	return input
}

func assignRenewableUse(dispatches []domain.RenewableDispatch, total float64) {
	for index := range dispatches {
		used := math.Min(dispatches[index].AvailableKW, total)
		dispatches[index].UsedKW = round6(used)
		dispatches[index].CurtailedKW = round6(dispatches[index].AvailableKW - used)
		total -= used
	}
}

func collectDecisions(
	p *preparedScenario,
	plan servicePlan,
	state *dispatchState,
	index int,
	interval domain.PlanInterval,
	decisions *decisionState,
) []domain.Decision {
	result := make([]domain.Decision, 0)
	activeContracts := activeContractIDs(plan, index)

	for _, contract := range p.scenario.Contracts {
		if contract.Kind == domain.ContractContinuousPower || decisions.scheduledContract[contract.ID] {
			continue
		}
		if plan.contractStartIndex[contract.ID] != index {
			continue
		}
		decisions.scheduledContract[contract.ID] = true
		result = append(result, domain.Decision{
			ID:                  fmt.Sprintf("decision-schedule-%s-%d", contract.ID, index),
			IntervalIndex:       index,
			Kind:                "schedule_contract_work",
			Title:               contract.Name,
			Reason:              "Selected the forecast intervals with the most available renewable power before the deadline.",
			AffectedServiceIDs:  []string{contract.ServiceID},
			AffectedContractIDs: []string{contract.ID},
			BaselineDifference:  "The service runs only in the selected contract window.",
		})
	}

	for _, delivery := range interval.Services {
		curtailed := delivery.DeferredKW > epsilon
		if curtailed && !decisions.curtailed[delivery.ServiceID] {
			result = append(result, domain.Decision{
				ID:                  fmt.Sprintf("decision-defer-%s-%d", delivery.ServiceID, index),
				IntervalIndex:       index,
				Kind:                "defer_flexible_demand",
				Title:               p.services[delivery.ServiceID].Name + " demand deferred",
				Reason:              "Released capacity for higher-priority service and protected the battery reserve.",
				AffectedServiceIDs:  []string{delivery.ServiceID},
				AffectedContractIDs: activeContracts,
				BaselineDifference:  fmt.Sprintf("Deferred %.1f kW at %s.", delivery.DeferredKW, interval.Start.Format("15:04")),
			})
		}
		decisions.curtailed[delivery.ServiceID] = curtailed
	}

	for _, generator := range interval.Generators {
		wasRunning := state.running[generator.AssetID]
		if generator.Running && !wasRunning {
			result = append(result, domain.Decision{
				ID:                  fmt.Sprintf("decision-start-%s-%d", generator.AssetID, index),
				IntervalIndex:       index,
				Kind:                "start_generator",
				Title:               p.assets[generator.AssetID].Name + " started",
				Reason:              "Covered the supply deficit before committed service lost power.",
				AffectedServiceIDs:  activeServiceIDs(plan, index),
				AffectedContractIDs: activeContracts,
				BaselineDifference:  fmt.Sprintf("Generated %.1f kW at %s.", generator.OutputKW, interval.Start.Format("15:04")),
			})
		}
		state.running[generator.AssetID] = generator.Running
	}

	return result
}

func activeContractIDs(plan servicePlan, index int) []string {
	values := make([]string, 0)
	for serviceID := range plan.contractIDs {
		for _, contractID := range plan.contractIDs[serviceID][index] {
			values = appendUnique(values, contractID)
		}
	}
	sort.Strings(values)
	return values
}

func activeServiceIDs(plan servicePlan, index int) []string {
	values := make([]string, 0)
	for serviceID, required := range plan.required {
		if required[index] > epsilon {
			values = append(values, serviceID)
		}
	}
	sort.Strings(values)
	return values
}

func sumUnserved(deliveries []domain.ServiceDelivery) float64 {
	total := 0.0
	for _, delivery := range deliveries {
		total += delivery.UnservedKW
	}
	return total
}

func sumValues(values map[string]float64) float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total
}

func cloneFloatMap(source map[string]float64) map[string]float64 {
	result := make(map[string]float64, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func cloneBoolMap(source map[string]bool) map[string]bool {
	result := make(map[string]bool, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func timeDurationMinutes(minutes int) time.Duration {
	return time.Duration(minutes) * time.Minute
}
