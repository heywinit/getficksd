package domain

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	_ "time/tzdata"
)

func ValidateScenario(scenario Scenario) error {
	validation := &scenarioValidation{}

	validation.require(scenario.SchemaVersion == "1", "schema_version must be 1")
	validation.require(scenario.ID != "", "scenario id is required")
	validation.require(scenario.Name != "", "scenario name is required")
	validation.validateHorizon(scenario.Horizon)

	assets := validation.validateSite(scenario.Site)
	services := make(map[string]Service, len(scenario.Site.Services))
	for _, service := range scenario.Site.Services {
		services[service.ID] = service
	}
	validation.validateConnections(scenario.Site, assets, services)

	validation.validateInitialState(scenario.InitialState, assets)
	signals := validation.validateSignals(scenario.Signals, scenario.Horizon.IntervalCount, assets, services)
	validation.validateContracts(scenario.Contracts, scenario.Horizon, services)
	validation.validateEvents(scenario.Events, scenario.Horizon, signals)
	validation.validateOperatingPolicy(scenario.OperatingPolicy, assets)

	return validation.err()
}

type scenarioValidation struct {
	errors []string
}

func (v *scenarioValidation) require(condition bool, message string) {
	if !condition {
		v.errors = append(v.errors, message)
	}
}

func (v *scenarioValidation) err() error {
	if len(v.errors) == 0 {
		return nil
	}

	return errors.New(strings.Join(v.errors, "; "))
}

func (v *scenarioValidation) validateHorizon(horizon PlanningHorizon) {
	v.require(!horizon.StartsAt.IsZero(), "horizon starts_at is required")
	v.require(horizon.IntervalMinutes == 15, "horizon interval_minutes must be 15")
	v.require(horizon.IntervalCount == 96, "horizon interval_count must be 96")
}

func (v *scenarioValidation) validateSite(site Site) map[string]Asset {
	v.require(site.ID != "", "site id is required")
	v.require(site.Name != "", "site name is required")
	v.require(site.Location != "", "site location is required")
	v.require(site.Timezone != "", "site timezone is required")
	v.require(site.Currency != "", "site currency is required")
	if site.Timezone != "" {
		_, err := time.LoadLocation(site.Timezone)
		v.require(err == nil, fmt.Sprintf("site timezone %q is invalid", site.Timezone))
	}
	v.require(len(site.Assets) > 0, "site must contain at least one asset")
	v.require(len(site.Services) > 0, "site must contain at least one service")

	assets := make(map[string]Asset, len(site.Assets))
	for index, asset := range site.Assets {
		path := fmt.Sprintf("site.assets[%d]", index)
		v.require(asset.ID != "", path+" id is required")
		v.require(asset.Name != "", path+" name is required")
		v.require(asset.ID != ControllerNodeID, path+" id is reserved for the controller")
		if _, exists := assets[asset.ID]; asset.ID != "" && exists {
			v.errors = append(v.errors, path+" id must be unique")
		}
		assets[asset.ID] = asset
		v.validateAsset(path, asset)
	}

	serviceIDs := make(map[string]struct{}, len(site.Services))
	for index, service := range site.Services {
		path := fmt.Sprintf("site.services[%d]", index)
		v.require(service.ID != "", path+" id is required")
		v.require(service.Name != "", path+" name is required")
		v.require(service.ID != ControllerNodeID, path+" id is reserved for the controller")
		if _, exists := assets[service.ID]; service.ID != "" && exists {
			v.errors = append(v.errors, path+" id must not match an asset id")
		}
		v.require(service.Description != "", path+" description is required")
		v.require(isPositive(service.RatedPowerKW), path+" rated_power_kw must be positive")
		v.require(
			service.ControlMode == ControlFixed || service.ControlMode == ControlCurtailable || service.ControlMode == ControlShiftable,
			path+" control_mode is invalid",
		)
		if _, exists := serviceIDs[service.ID]; service.ID != "" && exists {
			v.errors = append(v.errors, path+" id must be unique")
		}
		serviceIDs[service.ID] = struct{}{}
	}

	return assets
}

func (v *scenarioValidation) validateConnections(site Site, assets map[string]Asset, services map[string]Service) {
	connectionIDs := make(map[string]struct{}, len(site.Connections))
	pairs := make(map[string]struct{}, len(site.Connections))
	for index, connection := range site.Connections {
		path := fmt.Sprintf("site.connections[%d]", index)
		v.require(connection.ID != "", path+" id is required")
		if _, exists := connectionIDs[connection.ID]; connection.ID != "" && exists {
			v.errors = append(v.errors, path+" id must be unique")
		}
		connectionIDs[connection.ID] = struct{}{}
		v.require(connection.SourceID != "", path+" source_id is required")
		v.require(connection.TargetID != "", path+" target_id is required")
		v.require(connection.SourceID != connection.TargetID, path+" must not connect a node to itself")
		pair := connection.SourceID + "\x00" + connection.TargetID
		if _, exists := pairs[pair]; exists {
			v.errors = append(v.errors, path+" source_id and target_id pair must be unique")
		}
		pairs[pair] = struct{}{}

		sourceAsset, sourceIsAsset := assets[connection.SourceID]
		_, sourceIsService := services[connection.SourceID]
		targetAsset, targetIsAsset := assets[connection.TargetID]
		_, targetIsService := services[connection.TargetID]
		sourceExists := sourceIsAsset || sourceIsService || connection.SourceID == ControllerNodeID
		targetExists := targetIsAsset || targetIsService || connection.TargetID == ControllerNodeID
		v.require(sourceExists, path+" source_id does not reference a node")
		v.require(targetExists, path+" target_id does not reference a node")
		if !sourceExists || !targetExists || connection.SourceID == connection.TargetID {
			continue
		}

		allowed := false
		if sourceIsAsset {
			switch sourceAsset.Type {
			case AssetSolar, AssetWind, AssetDiesel:
				allowed = connection.TargetID == ControllerNodeID || (targetIsAsset && targetAsset.Type == AssetBattery)
			case AssetBattery:
				allowed = connection.TargetID == ControllerNodeID
			}
		} else if connection.SourceID == ControllerNodeID {
			allowed = targetIsService || (targetIsAsset && targetAsset.Type == AssetBattery)
		}
		v.require(allowed, path+" direction is not allowed")
	}
}

func (v *scenarioValidation) validateAsset(path string, asset Asset) {
	switch asset.Type {
	case AssetSolar, AssetWind:
		v.require(positivePointer(asset.CapacityKW), path+" capacity_kw must be positive")
	case AssetBattery:
		v.require(positivePointer(asset.CapacityKWH), path+" capacity_kwh must be positive")
		v.require(nonnegativePointer(asset.MinimumStoredEnergyKWH), path+" minimum_stored_energy_kwh must be nonnegative")
		v.require(positivePointer(asset.MaxChargeKW), path+" max_charge_kw must be positive")
		v.require(positivePointer(asset.MaxDischargeKW), path+" max_discharge_kw must be positive")
		v.require(efficiencyPointer(asset.ChargeEfficiency), path+" charge_efficiency must be more than 0 and at most 1")
		v.require(efficiencyPointer(asset.DischargeEfficiency), path+" discharge_efficiency must be more than 0 and at most 1")
		if asset.CapacityKWH != nil && asset.MinimumStoredEnergyKWH != nil {
			v.require(*asset.MinimumStoredEnergyKWH < *asset.CapacityKWH, path+" minimum energy must be less than capacity")
		}
	case AssetDiesel:
		v.require(nonnegativePointer(asset.MinimumOutputKW), path+" minimum_output_kw must be nonnegative")
		v.require(positivePointer(asset.MaximumOutputKW), path+" maximum_output_kw must be positive")
		v.require(positivePointer(asset.LitersPerKWH), path+" liters_per_kwh must be positive")
		if asset.StartupFuelLiters != nil {
			v.require(isNonnegative(*asset.StartupFuelLiters), path+" startup_fuel_liters must be nonnegative")
		}
		if asset.MinimumRuntimeMinutes != nil {
			v.require(*asset.MinimumRuntimeMinutes >= 0, path+" minimum_runtime_minutes must be nonnegative")
		}
		if asset.RampRateKWPerMinute != nil {
			v.require(isPositive(*asset.RampRateKWPerMinute), path+" ramp_rate_kw_per_minute must be positive")
		}
		v.require(nonnegativePointer(asset.FuelCostPerLiter), path+" fuel_cost_per_liter must be nonnegative")
		v.require(positivePointer(asset.EmissionsKGCO2PerLiter), path+" emissions_kg_co2_per_liter must be positive")
		if asset.MinimumOutputKW != nil && asset.MaximumOutputKW != nil {
			v.require(*asset.MinimumOutputKW <= *asset.MaximumOutputKW, path+" minimum output must not exceed maximum output")
		}
	default:
		v.errors = append(v.errors, path+" type is invalid")
	}
}

func (v *scenarioValidation) validateInitialState(initialState InitialState, assets map[string]Asset) {
	stateByAsset := make(map[string]AssetState, len(initialState.Assets))
	for index, state := range initialState.Assets {
		path := fmt.Sprintf("initial_state.assets[%d]", index)
		asset, exists := assets[state.AssetID]
		v.require(exists, path+" asset_id does not reference an asset")
		v.require(state.Type == asset.Type, path+" type must match the asset")
		if _, duplicate := stateByAsset[state.AssetID]; state.AssetID != "" && duplicate {
			v.errors = append(v.errors, path+" asset_id must be unique")
		}
		stateByAsset[state.AssetID] = state

		if !exists {
			continue
		}
		switch state.Type {
		case AssetBattery:
			v.require(nonnegativePointer(state.StoredEnergyKWH), path+" stored_energy_kwh must be nonnegative")
			if state.StoredEnergyKWH != nil && asset.CapacityKWH != nil && asset.MinimumStoredEnergyKWH != nil {
				v.require(*state.StoredEnergyKWH >= *asset.MinimumStoredEnergyKWH, path+" stored energy is less than the battery minimum")
				v.require(*state.StoredEnergyKWH <= *asset.CapacityKWH, path+" stored energy exceeds battery capacity")
			}
		case AssetDiesel:
			v.require(nonnegativePointer(state.FuelAvailableLiters), path+" fuel_available_liters must be nonnegative")
			v.require(state.Running != nil, path+" running is required")
		}
	}

	for _, asset := range assets {
		if asset.Type != AssetBattery && asset.Type != AssetDiesel {
			continue
		}
		_, exists := stateByAsset[asset.ID]
		v.require(exists, fmt.Sprintf("initial state is required for asset %q", asset.ID))
	}
}

func (v *scenarioValidation) validateSignals(
	signals []Signal,
	intervalCount int,
	assets map[string]Asset,
	services map[string]Service,
) map[string]Signal {
	v.require(len(signals) > 0, "scenario must contain at least one signal")
	signalByID := make(map[string]Signal, len(signals))
	for index, signal := range signals {
		path := fmt.Sprintf("signals[%d]", index)
		v.require(signal.ID != "", path+" id is required")
		if _, exists := signalByID[signal.ID]; signal.ID != "" && exists {
			v.errors = append(v.errors, path+" id must be unique")
		}
		signalByID[signal.ID] = signal
		v.require(len(signal.Values) == intervalCount, fmt.Sprintf("%s must contain %d values", path, intervalCount))
		for valueIndex, value := range signal.Values {
			v.require(isNonnegative(value), fmt.Sprintf("%s values[%d] must be nonnegative", path, valueIndex))
		}

		switch signal.Kind {
		case SignalRenewableAvailability:
			asset, exists := assets[signal.AssetID]
			v.require(exists, path+" asset_id does not reference an asset")
			v.require(asset.Type == AssetSolar || asset.Type == AssetWind, path+" asset must be solar or wind")
			v.require(signal.ServiceID == "", path+" service_id must be empty")
			v.require(signal.Unit == "kW", path+" unit must be kW")
			if asset.CapacityKW != nil {
				for valueIndex, value := range signal.Values {
					v.require(value <= *asset.CapacityKW+0.001, fmt.Sprintf("%s values[%d] exceeds asset capacity", path, valueIndex))
				}
			}
		case SignalServiceDemand:
			service, exists := services[signal.ServiceID]
			v.require(exists, path+" service_id does not reference a service")
			v.require(signal.AssetID == "", path+" asset_id must be empty")
			v.require(signal.Unit == "kW", path+" unit must be kW")
			if exists {
				for valueIndex, value := range signal.Values {
					v.require(value <= service.RatedPowerKW+0.001, fmt.Sprintf("%s values[%d] exceeds service rated power", path, valueIndex))
				}
			}
		case SignalFuelDelivery:
			asset, exists := assets[signal.AssetID]
			v.require(exists, path+" asset_id does not reference an asset")
			v.require(asset.Type == AssetDiesel, path+" asset must be diesel")
			v.require(signal.ServiceID == "", path+" service_id must be empty")
			v.require(signal.Unit == "liters", path+" unit must be liters")
		default:
			v.errors = append(v.errors, path+" kind is invalid")
		}
	}

	return signalByID
}

func (v *scenarioValidation) validateContracts(contracts []Contract, horizon PlanningHorizon, services map[string]Service) {
	v.require(len(contracts) > 0, "scenario must contain at least one contract")
	contractIDs := make(map[string]struct{}, len(contracts))
	for index, contract := range contracts {
		path := fmt.Sprintf("contracts[%d]", index)
		service, serviceExists := services[contract.ServiceID]
		v.require(contract.ID != "", path+" id is required")
		v.require(contract.Name != "", path+" name is required")
		v.require(serviceExists, path+" service_id does not reference a service")
		v.require(contract.WindowStart.Before(contract.Deadline), path+" window_start must be before deadline")
		v.require(!contract.WindowStart.Before(horizon.StartsAt), path+" window_start must be inside the horizon")
		v.require(!contract.Deadline.After(horizon.EndsAt()), path+" deadline must be inside the horizon")
		v.require(
			contract.Priority == PriorityCritical || contract.Priority == PriorityEssential || contract.Priority == PriorityFlexible,
			path+" priority is invalid",
		)
		if _, exists := contractIDs[contract.ID]; contract.ID != "" && exists {
			v.errors = append(v.errors, path+" id must be unique")
		}
		contractIDs[contract.ID] = struct{}{}

		switch contract.Kind {
		case ContractContinuousPower:
			v.require(positivePointer(contract.MinimumPowerKW), path+" minimum_power_kw must be positive")
			v.require(contract.RequiredRuntimeMinutes == nil, path+" required_runtime_minutes must be empty")
			v.require(contract.RequiredEnergyKWH == nil, path+" required_energy_kwh must be empty")
			if serviceExists && contract.MinimumPowerKW != nil {
				v.require(*contract.MinimumPowerKW <= service.RatedPowerKW, path+" minimum power exceeds service rated power")
			}
		case ContractRuntimeDeadline:
			v.require(contract.MinimumPowerKW == nil, path+" minimum_power_kw must be empty")
			v.require(contract.RequiredRuntimeMinutes != nil && *contract.RequiredRuntimeMinutes > 0, path+" required_runtime_minutes must be positive")
			v.require(contract.RequiredEnergyKWH == nil, path+" required_energy_kwh must be empty")
			if contract.RequiredRuntimeMinutes != nil {
				windowMinutes := int(contract.Deadline.Sub(contract.WindowStart).Minutes())
				v.require(*contract.RequiredRuntimeMinutes <= windowMinutes, path+" required runtime exceeds the contract window")
			}
		case ContractEnergyDeadline:
			v.require(contract.MinimumPowerKW == nil, path+" minimum_power_kw must be empty")
			v.require(contract.RequiredRuntimeMinutes == nil, path+" required_runtime_minutes must be empty")
			v.require(positivePointer(contract.RequiredEnergyKWH), path+" required_energy_kwh must be positive")
			if serviceExists && contract.RequiredEnergyKWH != nil {
				maximumEnergyKWH := service.RatedPowerKW * contract.Deadline.Sub(contract.WindowStart).Hours()
				v.require(*contract.RequiredEnergyKWH <= maximumEnergyKWH, path+" required energy exceeds service capacity in the contract window")
			}
		default:
			v.errors = append(v.errors, path+" kind is invalid")
		}
	}
}

func (v *scenarioValidation) validateEvents(events []ScenarioEvent, horizon PlanningHorizon, signals map[string]Signal) {
	eventIDs := make(map[string]struct{}, len(events))
	for index, event := range events {
		path := fmt.Sprintf("events[%d]", index)
		signal, signalExists := signals[event.SignalID]
		v.require(event.ID != "", path+" id is required")
		v.require(event.Name != "", path+" name is required")
		v.require(signalExists, path+" signal_id does not reference a signal")
		if _, exists := eventIDs[event.ID]; event.ID != "" && exists {
			v.errors = append(v.errors, path+" id must be unique")
		}
		eventIDs[event.ID] = struct{}{}

		switch event.Type {
		case EventRenewableShortfall:
			v.require(signal.Kind == SignalRenewableAvailability, path+" signal must contain renewable availability")
			v.validateEventWindow(path, event.Start, event.End, horizon)
			v.require(multiplierPointer(event.AvailabilityMultiplier, false), path+" availability_multiplier must be from 0 through 1")
		case EventDemandSurge:
			v.require(signal.Kind == SignalServiceDemand, path+" signal must contain service demand")
			v.validateEventWindow(path, event.Start, event.End, horizon)
			v.require(multiplierPointer(event.DemandMultiplier, true), path+" demand_multiplier must be at least 1")
		case EventFuelDeliveryDelay:
			v.require(signal.Kind == SignalFuelDelivery, path+" signal must contain a fuel delivery")
			v.require(event.ScheduledAt != nil, path+" scheduled_at is required")
			v.require(event.DelayedUntil != nil, path+" delayed_until is required")
			if event.ScheduledAt != nil && event.DelayedUntil != nil {
				v.require(event.ScheduledAt.Before(*event.DelayedUntil), path+" scheduled_at must be before delayed_until")
				v.require(!event.ScheduledAt.Before(horizon.StartsAt), path+" scheduled_at must be inside the horizon")
				v.require(!event.DelayedUntil.After(horizon.EndsAt()), path+" delayed_until must be inside the horizon")
			}
		default:
			v.errors = append(v.errors, path+" type is invalid")
		}
	}
}

func (v *scenarioValidation) validateEventWindow(path string, start, end *time.Time, horizon PlanningHorizon) {
	v.require(start != nil, path+" start is required")
	v.require(end != nil, path+" end is required")
	if start == nil || end == nil {
		return
	}

	v.require(start.Before(*end), path+" start must be before end")
	v.require(!start.Before(horizon.StartsAt), path+" start must be inside the horizon")
	v.require(!end.After(horizon.EndsAt()), path+" end must be inside the horizon")
}

func (v *scenarioValidation) validateOperatingPolicy(policy OperatingPolicy, assets map[string]Asset) {
	totalBatteryCapacity := 0.0
	totalBatteryMinimum := 0.0
	for _, asset := range assets {
		if asset.Type == AssetBattery && asset.CapacityKWH != nil {
			totalBatteryCapacity += *asset.CapacityKWH
			if asset.MinimumStoredEnergyKWH != nil {
				totalBatteryMinimum += *asset.MinimumStoredEnergyKWH
			}
		}
	}

	v.require(isNonnegative(policy.ReserveEnergyKWH), "operating_policy reserve_energy_kwh must be nonnegative")
	v.require(policy.ReserveEnergyKWH >= totalBatteryMinimum, "operating_policy reserve must not be below the physical battery minimum")
	v.require(policy.ReserveEnergyKWH <= totalBatteryCapacity, "operating_policy reserve exceeds battery capacity")
	v.require(isNonnegative(policy.AssumedLossPercent) && policy.AssumedLossPercent < 1, "operating_policy assumed_loss_percent must be at least 0 and less than 1")
}

func isPositive(value float64) bool {
	return value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}

func isNonnegative(value float64) bool {
	return value >= 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}

func positivePointer(value *float64) bool {
	return value != nil && isPositive(*value)
}

func nonnegativePointer(value *float64) bool {
	return value != nil && isNonnegative(*value)
}

func efficiencyPointer(value *float64) bool {
	return value != nil && *value > 0 && *value <= 1
}

func multiplierPointer(value *float64, atLeastOne bool) bool {
	if value == nil || math.IsInf(*value, 0) || math.IsNaN(*value) {
		return false
	}
	if atLeastOne {
		return *value >= 1
	}
	return *value >= 0 && *value <= 1
}
