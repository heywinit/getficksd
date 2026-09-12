package scheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os/exec"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

const maxOptimizerDiagnosticBytes = 2048

type pythonOptimizer struct {
	pythonPath string
	scriptPath string
	timeout    time.Duration
}

// NewPythonOptimizer constructs a no-shell JSON subprocess adapter. A positive
// timeout is required so a stuck solver cannot hold an HTTP request forever.
func NewPythonOptimizer(pythonPath, scriptPath string, timeout time.Duration) (Optimizer, error) {
	pythonPath = strings.TrimSpace(pythonPath)
	scriptPath = strings.TrimSpace(scriptPath)
	if pythonPath == "" {
		return nil, errors.New("optimizer Python path is required")
	}
	if scriptPath == "" {
		return nil, errors.New("optimizer script path is required")
	}
	if timeout <= 0 {
		return nil, errors.New("optimizer timeout must be positive")
	}
	return &pythonOptimizer{pythonPath: pythonPath, scriptPath: scriptPath, timeout: timeout}, nil
}

func (o *pythonOptimizer) Optimize(ctx context.Context, input optimizerInput) (optimizerSolution, error) {
	if err := validateOptimizerInput(input); err != nil {
		return optimizerSolution{}, fmt.Errorf("validate optimizer input: %w", err)
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return optimizerSolution{}, fmt.Errorf("encode optimizer input: %w", err)
	}

	solveContext, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()
	command := exec.CommandContext(solveContext, o.pythonPath, o.scriptPath)
	command.Stdin = bytes.NewReader(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(solveContext.Err(), context.DeadlineExceeded) {
			return optimizerSolution{}, fmt.Errorf("optimizer exceeded %s timeout: %w", o.timeout, context.DeadlineExceeded)
		}
		if errors.Is(solveContext.Err(), context.Canceled) {
			return optimizerSolution{}, context.Canceled
		}
		diagnostic := boundedDiagnostic(stderr.String())
		if diagnostic != "" {
			return optimizerSolution{}, fmt.Errorf("optimizer process failed: %w: %s", err, diagnostic)
		}
		return optimizerSolution{}, fmt.Errorf("optimizer process failed: %w", err)
	}

	var solution optimizerSolution
	decoder := json.NewDecoder(&stdout)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&solution); err != nil {
		return optimizerSolution{}, fmt.Errorf("decode optimizer output: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return optimizerSolution{}, fmt.Errorf("decode optimizer output: %w", err)
	}
	if err := validateOptimizerSolutionShape(input, solution); err != nil {
		return optimizerSolution{}, fmt.Errorf("validate optimizer output: %w", err)
	}
	return solution, nil
}

func validateOptimizerInput(input optimizerInput) error {
	if input.IntervalCount <= 0 {
		return errors.New("interval_count must be positive")
	}
	if input.IntervalMinutes <= 0 {
		return errors.New("interval_minutes must be positive")
	}
	if !finite(input.LossFactor) || input.LossFactor <= 0 || input.LossFactor > 1 {
		return errors.New("loss_factor must be finite and in (0, 1]")
	}
	if err := validateExpectedNumericSeriesMap("renewable_availability_kw", input.RenewableAvailabilityKW, idsForAssetKind(input, "renewable"), input.IntervalCount); err != nil {
		return err
	}
	if err := validateExpectedNumericSeriesMap("service_demand_kw", input.ServiceDemandKW, idsForAssetKind(input, "service"), input.IntervalCount); err != nil {
		return err
	}
	if err := validateExpectedNumericSeriesMap("fuel_delivery_liters", input.FuelDeliveryLiters, idsForAssetKind(input, "generator"), input.IntervalCount); err != nil {
		return err
	}
	return nil
}

func validateOptimizerSolutionShape(input optimizerInput, solution optimizerSolution) error {
	if solution.Status != "optimal" && solution.Status != "feasible" {
		return fmt.Errorf("status must be optimal or feasible, got %q", solution.Status)
	}
	if !finite(solution.ObjectiveValue) {
		return errors.New("objective_value must be finite")
	}
	if !finite(solution.MIPGap) || solution.MIPGap < 0 {
		return errors.New("mip_gap must be finite and non-negative")
	}
	if solution.SolveMS < 0 {
		return errors.New("solve_ms must be non-negative")
	}

	serviceIDs := idsForAssetKind(input, "service")
	renewableIDs := idsForAssetKind(input, "renewable")
	batteryIDs := idsForAssetKind(input, "battery")
	generatorIDs := idsForAssetKind(input, "generator")
	n := input.IntervalCount

	checks := []struct {
		name     string
		values   map[string][]float64
		expected map[string]struct{}
	}{
		{"service_requested_kw", solution.ServiceRequestedKW, serviceIDs},
		{"service_delivered_kw", solution.ServiceDeliveredKW, serviceIDs},
		{"renewable_used_kw", solution.RenewableUsedKW, renewableIDs},
		{"battery_charge_kw", solution.BatteryChargeKW, batteryIDs},
		{"battery_discharge_kw", solution.BatteryDischargeKW, batteryIDs},
		{"battery_energy_kwh", solution.BatteryEnergyKWH, batteryIDs},
		{"generator_output_kw", solution.GeneratorOutputKW, generatorIDs},
	}
	for _, check := range checks {
		if err := validateExpectedNumericSeriesMap(check.name, check.values, check.expected, n); err != nil {
			return err
		}
	}
	if err := validateExpectedBoolSeriesMap("generator_running", solution.GeneratorRunning, generatorIDs, n); err != nil {
		return err
	}
	if err := validateExpectedBoolSeriesMap("generator_started", solution.GeneratorStarted, generatorIDs, n); err != nil {
		return err
	}
	if len(solution.DumpedPowerKW) != n {
		return fmt.Errorf("dumped_power_kw has %d values; expected %d", len(solution.DumpedPowerKW), n)
	}
	for index, value := range solution.DumpedPowerKW {
		if !finite(value) || value < 0 {
			return fmt.Errorf("dumped_power_kw[%d] must be finite and non-negative", index)
		}
	}
	return nil
}

func idsForAssetKind(input optimizerInput, kind string) map[string]struct{} {
	result := make(map[string]struct{})
	if kind == "service" {
		for _, service := range input.Services {
			result[service.ID] = struct{}{}
		}
		return result
	}
	for _, asset := range input.Assets {
		switch kind {
		case "renewable":
			if asset.Type == domain.AssetSolar || asset.Type == domain.AssetWind {
				result[asset.ID] = struct{}{}
			}
		case "battery":
			if asset.Type == domain.AssetBattery {
				result[asset.ID] = struct{}{}
			}
		case "generator":
			if asset.Type == domain.AssetDiesel {
				result[asset.ID] = struct{}{}
			}
		}
	}
	return result
}

func validateExpectedNumericSeriesMap(name string, values map[string][]float64, expected map[string]struct{}, count int) error {
	if len(values) != len(expected) {
		return fmt.Errorf("%s has %d entries; expected %d", name, len(values), len(expected))
	}
	for id := range expected {
		series, exists := values[id]
		if !exists {
			return fmt.Errorf("%s is missing %q", name, id)
		}
		if len(series) != count {
			return fmt.Errorf("%s[%q] has %d values; expected %d", name, id, len(series), count)
		}
		for index, value := range series {
			if !finite(value) || value < 0 {
				return fmt.Errorf("%s[%q][%d] must be finite and non-negative", name, id, index)
			}
		}
	}
	for id := range values {
		if _, exists := expected[id]; !exists {
			return fmt.Errorf("%s contains unknown id %q", name, id)
		}
	}
	return nil
}

func validateExpectedBoolSeriesMap(name string, values map[string][]bool, expected map[string]struct{}, count int) error {
	if len(values) != len(expected) {
		return fmt.Errorf("%s has %d entries; expected %d", name, len(values), len(expected))
	}
	for id := range expected {
		series, exists := values[id]
		if !exists {
			return fmt.Errorf("%s is missing %q", name, id)
		}
		if len(series) != count {
			return fmt.Errorf("%s[%q] has %d values; expected %d", name, id, len(series), count)
		}
	}
	for id := range values {
		if _, exists := expected[id]; !exists {
			return fmt.Errorf("%s contains unknown id %q", name, id)
		}
	}
	return nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return err
	}
	return errors.New("optimizer output contains more than one JSON value")
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func boundedDiagnostic(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= maxOptimizerDiagnosticBytes {
		return value
	}
	return value[:maxOptimizerDiagnosticBytes] + "..."
}
