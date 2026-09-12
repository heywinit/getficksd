package scheduler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

const epsilon = 0.000001

type Scheduler struct {
	now   func() time.Time
	newID func() (string, error)
}

func New() *Scheduler {
	return &Scheduler{
		now:   time.Now,
		newID: randomRunID,
	}
}

func (s *Scheduler) Plan(ctx context.Context, scenario domain.Scenario, request domain.PlanningRequest) (domain.PlanRun, error) {
	if err := domain.ValidateScenario(scenario); err != nil {
		return domain.PlanRun{}, fmt.Errorf("validate scenario: %w", err)
	}
	if request.ScenarioID != scenario.ID {
		return domain.PlanRun{}, errors.New("planning request scenario_id does not match the scenario")
	}
	if request.Planner != domain.PlannerBaseline && request.Planner != domain.PlannerWattson {
		return domain.PlanRun{}, errors.New("planner must be baseline or wattson")
	}

	prepared, err := prepareScenario(scenario, request.ActiveEventIDs)
	if err != nil {
		return domain.PlanRun{}, err
	}
	runID, err := s.newID()
	if err != nil {
		return domain.PlanRun{}, fmt.Errorf("create plan run id: %w", err)
	}

	run := domain.PlanRun{
		ID:             runID,
		ScenarioID:     scenario.ID,
		Planner:        request.Planner,
		Status:         domain.PlanComputing,
		CreatedAt:      s.now().UTC(),
		ActiveEventIDs: append([]string{}, request.ActiveEventIDs...),
		Intervals:      make([]domain.PlanInterval, 0, scenario.Horizon.IntervalCount),
		Decisions:      make([]domain.Decision, 0),
	}

	plan := buildServicePlan(prepared)
	state := newDispatchState(prepared)
	progress := newContractProgress(scenario.Contracts)
	decisionState := newDecisionState()

	for index := 0; index < scenario.Horizon.IntervalCount; index++ {
		if err := ctx.Err(); err != nil {
			return domain.PlanRun{}, err
		}

		interval, decisions := dispatchInterval(prepared, plan, state, index, decisionState)
		interval.Contracts = progress.update(prepared, interval)
		for _, decision := range decisions {
			interval.DecisionIDs = append(interval.DecisionIDs, decision.ID)
			run.Decisions = append(run.Decisions, decision)
		}
		run.Intervals = append(run.Intervals, interval)
	}

	run.ContractOutcomes = progress.outcomes(scenario.Contracts)
	run.Summary = summarize(run)
	run.Status = domain.PlanComplete
	if run.Summary.ContractsBreached > 0 {
		run.Status = domain.PlanInfeasible
	}

	return run, nil
}

type preparedScenario struct {
	scenario          domain.Scenario
	assets            map[string]domain.Asset
	services          map[string]domain.Service
	renewableSignals  map[string][]float64
	demandSignals     map[string][]float64
	fuelSignals       map[string][]float64
	intervalHours     float64
	physicalMinimum   map[string]float64
	policyMinimum     map[string]float64
	initialEnergy     map[string]float64
	initialFuel       map[string]float64
	initialRunning    map[string]bool
	totalBatteryLimit float64
}

func prepareScenario(scenario domain.Scenario, activeEventIDs []string) (*preparedScenario, error) {
	activeEvents := make(map[string]domain.ScenarioEvent, len(activeEventIDs))
	events := make(map[string]domain.ScenarioEvent, len(scenario.Events))
	for _, event := range scenario.Events {
		events[event.ID] = event
	}
	for _, eventID := range activeEventIDs {
		if _, duplicate := activeEvents[eventID]; duplicate {
			return nil, fmt.Errorf("active event %q appears more than once", eventID)
		}
		event, exists := events[eventID]
		if !exists {
			return nil, fmt.Errorf("active event %q does not exist", eventID)
		}
		activeEvents[eventID] = event
	}

	p := &preparedScenario{
		scenario:         scenario,
		assets:           make(map[string]domain.Asset, len(scenario.Site.Assets)),
		services:         make(map[string]domain.Service, len(scenario.Site.Services)),
		renewableSignals: make(map[string][]float64),
		demandSignals:    make(map[string][]float64),
		fuelSignals:      make(map[string][]float64),
		intervalHours:    float64(scenario.Horizon.IntervalMinutes) / 60,
		physicalMinimum:  make(map[string]float64),
		policyMinimum:    make(map[string]float64),
		initialEnergy:    make(map[string]float64),
		initialFuel:      make(map[string]float64),
		initialRunning:   make(map[string]bool),
	}
	for _, asset := range scenario.Site.Assets {
		p.assets[asset.ID] = asset
		if asset.Type == domain.AssetBattery && asset.CapacityKWH != nil {
			p.totalBatteryLimit += *asset.CapacityKWH
		}
	}
	for _, service := range scenario.Site.Services {
		p.services[service.ID] = service
	}
	for _, state := range scenario.InitialState.Assets {
		if state.StoredEnergyKWH != nil {
			p.initialEnergy[state.AssetID] = *state.StoredEnergyKWH
		}
		if state.FuelAvailableLiters != nil {
			p.initialFuel[state.AssetID] = *state.FuelAvailableLiters
		}
		if state.Running != nil {
			p.initialRunning[state.AssetID] = *state.Running
		}
	}

	for _, asset := range scenario.Site.Assets {
		if asset.Type != domain.AssetBattery || asset.CapacityKWH == nil {
			continue
		}
		physical := pointerValue(asset.MinimumStoredEnergyKWH)
		policy := physical
		if p.totalBatteryLimit > 0 {
			policy = math.Max(policy, scenario.OperatingPolicy.ReserveEnergyKWH**asset.CapacityKWH/p.totalBatteryLimit)
		}
		p.physicalMinimum[asset.ID] = physical
		p.policyMinimum[asset.ID] = policy
	}

	for _, signal := range scenario.Signals {
		values := append([]float64(nil), signal.Values...)
		switch signal.Kind {
		case domain.SignalRenewableAvailability:
			p.renewableSignals[signal.AssetID] = values
		case domain.SignalServiceDemand:
			p.demandSignals[signal.ServiceID] = values
		case domain.SignalFuelDelivery:
			p.fuelSignals[signal.AssetID] = values
		}
	}

	for _, eventID := range activeEventIDs {
		applyEvent(p, activeEvents[eventID])
	}
	return p, nil
}

func applyEvent(p *preparedScenario, event domain.ScenarioEvent) {
	switch event.Type {
	case domain.EventRenewableShortfall:
		values := signalValuesByID(p, event.SignalID)
		for index := range values {
			start := intervalStart(p.scenario.Horizon, index)
			if event.Start != nil && event.End != nil && !start.Before(*event.Start) && start.Before(*event.End) {
				values[index] *= pointerValue(event.AvailabilityMultiplier)
			}
		}
	case domain.EventDemandSurge:
		values := signalValuesByID(p, event.SignalID)
		for index := range values {
			start := intervalStart(p.scenario.Horizon, index)
			if event.Start != nil && event.End != nil && !start.Before(*event.Start) && start.Before(*event.End) {
				values[index] *= pointerValue(event.DemandMultiplier)
			}
		}
	case domain.EventFuelDeliveryDelay:
		values := signalValuesByID(p, event.SignalID)
		if event.ScheduledAt == nil || event.DelayedUntil == nil {
			return
		}
		scheduled := intervalIndex(p.scenario.Horizon, *event.ScheduledAt)
		delayed := intervalIndex(p.scenario.Horizon, *event.DelayedUntil)
		if scheduled >= 0 && scheduled < len(values) && delayed >= 0 && delayed < len(values) {
			values[delayed] += values[scheduled]
			values[scheduled] = 0
		}
	}
}

func signalValuesByID(p *preparedScenario, signalID string) []float64 {
	for _, signal := range p.scenario.Signals {
		if signal.ID != signalID {
			continue
		}
		switch signal.Kind {
		case domain.SignalRenewableAvailability:
			return p.renewableSignals[signal.AssetID]
		case domain.SignalServiceDemand:
			return p.demandSignals[signal.ServiceID]
		case domain.SignalFuelDelivery:
			return p.fuelSignals[signal.AssetID]
		}
	}
	return nil
}

type servicePlan struct {
	requested          map[string][]float64
	required           map[string][]float64
	priority           map[string][]int
	contractIDs        map[string][][]string
	contractStartIndex map[string]int
}

func buildServicePlan(p *preparedScenario) servicePlan {
	count := p.scenario.Horizon.IntervalCount
	plan := servicePlan{
		requested:          make(map[string][]float64, len(p.services)),
		required:           make(map[string][]float64, len(p.services)),
		priority:           make(map[string][]int, len(p.services)),
		contractIDs:        make(map[string][][]string, len(p.services)),
		contractStartIndex: make(map[string]int),
	}
	for _, service := range p.scenario.Site.Services {
		plan.requested[service.ID] = make([]float64, count)
		plan.required[service.ID] = make([]float64, count)
		plan.priority[service.ID] = filledInts(count, 99)
		plan.contractIDs[service.ID] = make([][]string, count)
		if service.ControlMode != domain.ControlShiftable {
			copy(plan.requested[service.ID], p.demandSignals[service.ID])
		}
	}

	for _, contract := range p.scenario.Contracts {
		service := p.services[contract.ServiceID]
		eligible := contractIntervals(p.scenario.Horizon, contract)
		selected := eligible
		switch contract.Kind {
		case domain.ContractRuntimeDeadline:
			intervalsNeeded := int(math.Ceil(float64(*contract.RequiredRuntimeMinutes) / float64(p.scenario.Horizon.IntervalMinutes)))
			selected = bestSupplyIntervals(p, eligible, intervalsNeeded)
		case domain.ContractEnergyDeadline:
			intervalsNeeded := int(math.Ceil(*contract.RequiredEnergyKWH / (service.RatedPowerKW * p.intervalHours)))
			selected = bestSupplyIntervals(p, eligible, intervalsNeeded)
		}

		remainingEnergy := pointerValue(contract.RequiredEnergyKWH)
		for _, index := range selected {
			required := 0.0
			switch contract.Kind {
			case domain.ContractContinuousPower:
				required = pointerValue(contract.MinimumPowerKW)
			case domain.ContractRuntimeDeadline:
				required = service.RatedPowerKW
			case domain.ContractEnergyDeadline:
				required = math.Min(service.RatedPowerKW, remainingEnergy/p.intervalHours)
				remainingEnergy -= required * p.intervalHours
			}
			plan.required[service.ID][index] = math.Max(plan.required[service.ID][index], required)
			plan.requested[service.ID][index] = math.Max(plan.requested[service.ID][index], required)
			plan.priority[service.ID][index] = min(plan.priority[service.ID][index], priorityRank(contract.Priority))
			plan.contractIDs[service.ID][index] = appendUnique(plan.contractIDs[service.ID][index], contract.ID)
			if first, exists := plan.contractStartIndex[contract.ID]; !exists || index < first {
				plan.contractStartIndex[contract.ID] = index
			}
		}
	}
	return plan
}

func bestSupplyIntervals(p *preparedScenario, eligible []int, count int) []int {
	result := append([]int(nil), eligible...)
	sort.SliceStable(result, func(i, j int) bool {
		left := forecastSurplus(p, result[i])
		right := forecastSurplus(p, result[j])
		if math.Abs(left-right) < epsilon {
			return result[i] > result[j]
		}
		return left > right
	})
	if count < len(result) {
		result = result[:count]
	}
	sort.Ints(result)
	return result
}

func forecastSurplus(p *preparedScenario, index int) float64 {
	total := 0.0
	for _, values := range p.renewableSignals {
		total += values[index]
	}
	for _, service := range p.scenario.Site.Services {
		if service.ControlMode == domain.ControlFixed {
			total -= p.demandSignals[service.ID][index] / (1 - p.scenario.OperatingPolicy.AssumedLossPercent)
		}
	}
	return total
}

func contractIntervals(horizon domain.PlanningHorizon, contract domain.Contract) []int {
	result := make([]int, 0)
	for index := 0; index < horizon.IntervalCount; index++ {
		start := intervalStart(horizon, index)
		end := start.Add(time.Duration(horizon.IntervalMinutes) * time.Minute)
		if !start.Before(contract.WindowStart) && !end.After(contract.Deadline) {
			result = append(result, index)
		}
	}
	return result
}

func priorityRank(priority domain.ContractPriority) int {
	switch priority {
	case domain.PriorityCritical:
		return 0
	case domain.PriorityEssential:
		return 1
	default:
		return 2
	}
}

func intervalStart(horizon domain.PlanningHorizon, index int) time.Time {
	return horizon.StartsAt.Add(time.Duration(index*horizon.IntervalMinutes) * time.Minute)
}

func intervalIndex(horizon domain.PlanningHorizon, timestamp time.Time) int {
	return int(timestamp.Sub(horizon.StartsAt) / (time.Duration(horizon.IntervalMinutes) * time.Minute))
}

func randomRunID() (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "run-" + hex.EncodeToString(buffer), nil
}

func pointerValue[T int | float64](value *T) T {
	if value == nil {
		return 0
	}
	return *value
}

func filledInts(count, value int) []int {
	values := make([]int, count)
	for index := range values {
		values[index] = value
	}
	return values
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func round6(value float64) float64 {
	if math.Abs(value) < epsilon {
		return 0
	}
	return math.Round(value*1_000_000) / 1_000_000
}
