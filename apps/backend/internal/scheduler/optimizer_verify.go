package scheduler

import (
	"fmt"
	"math"

	"github.com/heywinit/wattson/backend/internal/domain"
)

// Optimizers operate outside the trusted Go domain boundary. Keep this
// tolerance large enough for a MILP solver's feasibility tolerance, while
// still rejecting quantities that would be visible in the serialized plan.
const optimizerVerificationTolerance = 0.0001

// verifyOptimizerSolution independently checks the physical feasibility of a
// solver response before it is converted to a PlanRun and persisted.
func verifyOptimizerSolution(input optimizerInput, solution optimizerSolution) error {
	if solution.Status != "optimal" && solution.Status != "feasible" {
		return fmt.Errorf("optimizer termination status %q is not usable", solution.Status)
	}
	if !optimizerFinite(solution.ObjectiveValue) || solution.ObjectiveValue < -optimizerVerificationTolerance {
		return fmt.Errorf("optimizer objective value must be finite and nonnegative")
	}
	if !optimizerFinite(solution.MIPGap) || solution.MIPGap < -optimizerVerificationTolerance {
		return fmt.Errorf("optimizer MIP gap must be finite and nonnegative")
	}
	if solution.SolveMS < 0 {
		return fmt.Errorf("optimizer solve time must be nonnegative")
	}
	if input.IntervalCount <= 0 || input.IntervalMinutes <= 0 {
		return fmt.Errorf("optimizer input horizon must be positive")
	}
	if !optimizerFinite(input.LossFactor) || input.LossFactor <= 0 || input.LossFactor > 1 {
		return fmt.Errorf("optimizer input loss factor must be more than zero and at most one")
	}

	renewables := make(map[string]domain.Asset)
	batteries := make(map[string]domain.Asset)
	generators := make(map[string]domain.Asset)
	for _, asset := range input.Assets {
		switch asset.Type {
		case domain.AssetSolar, domain.AssetWind:
			renewables[asset.ID] = asset
		case domain.AssetBattery:
			batteries[asset.ID] = asset
		case domain.AssetDiesel:
			generators[asset.ID] = asset
		}
	}
	services := make(map[string]domain.Service, len(input.Services))
	for _, service := range input.Services {
		services[service.ID] = service
	}

	if err := verifyFloatVectors("service_requested_kw", solution.ServiceRequestedKW, services, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyFloatVectors("service_delivered_kw", solution.ServiceDeliveredKW, services, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyFloatVectors("renewable_used_kw", solution.RenewableUsedKW, renewables, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyFloatVectors("battery_charge_kw", solution.BatteryChargeKW, batteries, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyFloatVectors("battery_discharge_kw", solution.BatteryDischargeKW, batteries, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyFloatVectors("battery_energy_kwh", solution.BatteryEnergyKWH, batteries, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyFloatVectors("generator_output_kw", solution.GeneratorOutputKW, generators, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyBoolVectors("generator_running", solution.GeneratorRunning, generators, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyBoolVectors("generator_started", solution.GeneratorStarted, generators, input.IntervalCount); err != nil {
		return err
	}
	if err := verifyNonnegativeVector("dumped_power_kw", solution.DumpedPowerKW, input.IntervalCount); err != nil {
		return err
	}

	if err := verifyRenewables(input, solution, renewables); err != nil {
		return err
	}
	if err := verifyServices(input, solution, services); err != nil {
		return err
	}
	if err := verifyBatteries(input, solution, batteries); err != nil {
		return err
	}
	if err := verifyGenerators(input, solution, generators); err != nil {
		return err
	}
	return verifyACBalance(input, solution)
}

func verifyRenewables(input optimizerInput, solution optimizerSolution, assets map[string]domain.Asset) error {
	for id := range assets {
		available, ok := input.RenewableAvailabilityKW[id]
		if !ok || len(available) != input.IntervalCount {
			return fmt.Errorf("renewable availability for %q must contain %d intervals", id, input.IntervalCount)
		}
		for index, used := range solution.RenewableUsedKW[id] {
			if !optimizerFinite(available[index]) || available[index] < -optimizerVerificationTolerance {
				return fmt.Errorf("renewable availability for %q at interval %d is invalid", id, index)
			}
			if !input.ConnectedAssets[id] && used > optimizerVerificationTolerance {
				return fmt.Errorf("disconnected renewable %q dispatched at interval %d", id, index)
			}
			if used > available[index]+optimizerVerificationTolerance {
				return fmt.Errorf("renewable %q exceeds availability at interval %d", id, index)
			}
		}
	}
	return nil
}

func verifyServices(input optimizerInput, solution optimizerSolution, services map[string]domain.Service) error {
	for id, service := range services {
		requested := solution.ServiceRequestedKW[id]
		delivered := solution.ServiceDeliveredKW[id]
		demand, ok := input.ServiceDemandKW[id]
		if !ok || len(demand) != input.IntervalCount {
			return fmt.Errorf("service demand for %q must contain %d intervals", id, input.IntervalCount)
		}
		for index := 0; index < input.IntervalCount; index++ {
			if !optimizerFinite(demand[index]) || demand[index] < -optimizerVerificationTolerance {
				return fmt.Errorf("service demand for %q at interval %d is invalid", id, index)
			}
			if service.ControlMode != domain.ControlShiftable && requested[index] < demand[index]-optimizerVerificationTolerance {
				return fmt.Errorf("service %q request is less than demand at interval %d", id, index)
			}
			if requested[index] > service.RatedPowerKW+optimizerVerificationTolerance {
				return fmt.Errorf("service %q request exceeds rated power at interval %d", id, index)
			}
			if delivered[index] > requested[index]+optimizerVerificationTolerance {
				return fmt.Errorf("service %q delivery exceeds its request at interval %d", id, index)
			}
			if !input.ConnectedServices[id] && delivered[index] > optimizerVerificationTolerance {
				return fmt.Errorf("disconnected service %q receives power at interval %d", id, index)
			}
		}
	}
	return nil
}

func verifyBatteries(input optimizerInput, solution optimizerSolution, assets map[string]domain.Asset) error {
	hours := float64(input.IntervalMinutes) / 60
	for id, asset := range assets {
		energy := input.InitialEnergyKWH[id]
		if !optimizerFinite(energy) {
			return fmt.Errorf("battery %q initial energy is invalid", id)
		}
		minimum := math.Max(input.PhysicalMinimumKWH[id], input.PolicyMinimumKWH[id])
		if energy < minimum-optimizerVerificationTolerance || energy > pointerValue(asset.CapacityKWH)+optimizerVerificationTolerance {
			return fmt.Errorf("battery %q initial energy is outside bounds", id)
		}
		if energy < minimum-optimizerVerificationTolerance || energy > pointerValue(asset.CapacityKWH)+optimizerVerificationTolerance {
			return fmt.Errorf("battery %q initial energy is outside bounds", id)
		}
		for index := 0; index < input.IntervalCount; index++ {
			charge := solution.BatteryChargeKW[id][index]
			discharge := solution.BatteryDischargeKW[id][index]
			ending := solution.BatteryEnergyKWH[id][index]
			if !input.ChargeableBatteries[id] && charge > optimizerVerificationTolerance {
				return fmt.Errorf("unchargeable battery %q charges at interval %d", id, index)
			}
			if !input.ConnectedAssets[id] && discharge > optimizerVerificationTolerance {
				return fmt.Errorf("disconnected battery %q discharges at interval %d", id, index)
			}
			if charge > pointerValue(asset.MaxChargeKW)+optimizerVerificationTolerance || discharge > pointerValue(asset.MaxDischargeKW)+optimizerVerificationTolerance {
				return fmt.Errorf("battery %q exceeds a power limit at interval %d", id, index)
			}
			if charge > optimizerVerificationTolerance && discharge > optimizerVerificationTolerance {
				return fmt.Errorf("battery %q charges and discharges at interval %d", id, index)
			}
			expected := energy + charge*pointerValue(asset.ChargeEfficiency)*hours - discharge/pointerValue(asset.DischargeEfficiency)*hours
			if math.Abs(expected-ending) > optimizerVerificationTolerance {
				return fmt.Errorf("battery %q energy does not balance at interval %d: expected %.6f, got %.6f", id, index, expected, ending)
			}
			if ending < minimum-optimizerVerificationTolerance || ending > pointerValue(asset.CapacityKWH)+optimizerVerificationTolerance {
				return fmt.Errorf("battery %q energy is outside bounds at interval %d", id, index)
			}
			energy = ending
		}
	}
	return nil
}

func verifyGenerators(input optimizerInput, solution optimizerSolution, assets map[string]domain.Asset) error {
	hours := float64(input.IntervalMinutes) / 60
	for id, asset := range assets {
		fuel := input.InitialFuelLiters[id]
		if !optimizerFinite(fuel) || fuel < -optimizerVerificationTolerance {
			return fmt.Errorf("generator %q initial fuel is invalid", id)
		}
		previousRunning := input.InitialRunning[id]
		previousOutput := 0.0
		if previousRunning {
			previousOutput = pointerValue(asset.MinimumOutputKW)
		}
		deliveries, ok := input.FuelDeliveryLiters[id]
		if !ok {
			deliveries = make([]float64, input.IntervalCount)
		} else if len(deliveries) != input.IntervalCount {
			return fmt.Errorf("fuel deliveries for %q must contain %d intervals", id, input.IntervalCount)
		}
		for index := 0; index < input.IntervalCount; index++ {
			output := solution.GeneratorOutputKW[id][index]
			running := solution.GeneratorRunning[id][index]
			started := solution.GeneratorStarted[id][index]
			if !optimizerFinite(deliveries[index]) || deliveries[index] < -optimizerVerificationTolerance {
				return fmt.Errorf("fuel delivery for %q at interval %d is invalid", id, index)
			}
			fuel += deliveries[index]
			if !input.ConnectedAssets[id] && (output > optimizerVerificationTolerance || running || started) {
				return fmt.Errorf("disconnected generator %q operates at interval %d", id, index)
			}
			if running {
				if output < pointerValue(asset.MinimumOutputKW)-optimizerVerificationTolerance || output > pointerValue(asset.MaximumOutputKW)+optimizerVerificationTolerance {
					return fmt.Errorf("generator %q output is outside running bounds at interval %d", id, index)
				}
			} else if output > optimizerVerificationTolerance {
				return fmt.Errorf("generator %q produces power while stopped at interval %d", id, index)
			}
			expectedStarted := running && !previousRunning
			if started != expectedStarted {
				return fmt.Errorf("generator %q startup flag is inconsistent at interval %d", id, index)
			}
			if asset.RampRateKWPerMinute != nil {
				maximumChange := *asset.RampRateKWPerMinute * float64(input.IntervalMinutes)
				if math.Abs(output-previousOutput) > maximumChange+optimizerVerificationTolerance {
					return fmt.Errorf("generator %q exceeds its ramp limit at interval %d", id, index)
				}
			}
			fuelUsed := output * hours * pointerValue(asset.LitersPerKWH)
			if started {
				fuelUsed += pointerValue(asset.StartupFuelLiters)
			}
			fuel -= fuelUsed
			if fuel < -optimizerVerificationTolerance {
				return fmt.Errorf("generator %q exhausts its fuel at interval %d", id, index)
			}
			previousRunning = running
			previousOutput = output
		}

		minimumRunIntervals := int(math.Ceil(float64(pointerValue(asset.MinimumRuntimeMinutes)) / float64(input.IntervalMinutes)))
		for index, started := range solution.GeneratorStarted[id] {
			if !started {
				continue
			}
			end := min(input.IntervalCount, index+minimumRunIntervals)
			for runIndex := index; runIndex < end; runIndex++ {
				if !solution.GeneratorRunning[id][runIndex] {
					return fmt.Errorf("generator %q violates minimum runtime after interval %d", id, index)
				}
			}
		}
	}
	return nil
}

func verifyACBalance(input optimizerInput, solution optimizerSolution) error {
	for index := 0; index < input.IntervalCount; index++ {
		supply := 0.0
		use := solution.DumpedPowerKW[index]
		for _, values := range solution.RenewableUsedKW {
			supply += values[index]
		}
		for _, values := range solution.BatteryDischargeKW {
			supply += values[index]
		}
		for _, values := range solution.GeneratorOutputKW {
			supply += values[index]
		}
		for _, values := range solution.BatteryChargeKW {
			use += values[index]
		}
		for _, values := range solution.ServiceDeliveredKW {
			use += values[index] / input.LossFactor
		}
		if math.Abs(supply-use) > optimizerVerificationTolerance {
			return fmt.Errorf("AC power does not balance at interval %d: supply %.6f kW, use %.6f kW", index, supply, use)
		}
	}
	return nil
}

func verifyFloatVectors[T any](name string, values map[string][]float64, expected map[string]T, count int) error {
	if len(values) != len(expected) {
		return fmt.Errorf("%s has %d IDs, expected %d", name, len(values), len(expected))
	}
	for id := range values {
		if _, ok := expected[id]; !ok {
			return fmt.Errorf("%s contains unknown ID %q", name, id)
		}
	}
	for id := range expected {
		vector, ok := values[id]
		if !ok {
			return fmt.Errorf("%s is missing ID %q", name, id)
		}
		if err := verifyNonnegativeVector(name+"["+id+"]", vector, count); err != nil {
			return err
		}
	}
	return nil
}

func verifyBoolVectors[T any](name string, values map[string][]bool, expected map[string]T, count int) error {
	if len(values) != len(expected) {
		return fmt.Errorf("%s has %d IDs, expected %d", name, len(values), len(expected))
	}
	for id := range values {
		if _, ok := expected[id]; !ok {
			return fmt.Errorf("%s contains unknown ID %q", name, id)
		}
	}
	for id := range expected {
		vector, ok := values[id]
		if !ok {
			return fmt.Errorf("%s is missing ID %q", name, id)
		}
		if len(vector) != count {
			return fmt.Errorf("%s[%s] has %d intervals, expected %d", name, id, len(vector), count)
		}
	}
	return nil
}

func verifyNonnegativeVector(name string, values []float64, count int) error {
	if len(values) != count {
		return fmt.Errorf("%s has %d intervals, expected %d", name, len(values), count)
	}
	for index, value := range values {
		if !optimizerFinite(value) || value < -optimizerVerificationTolerance {
			return fmt.Errorf("%s contains an invalid value at interval %d", name, index)
		}
	}
	return nil
}

func optimizerFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
