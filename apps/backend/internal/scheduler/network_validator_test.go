package scheduler

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

type failingNetworkValidator struct{}

func (failingNetworkValidator) Validate(context.Context, optimizerInput, optimizerSolution) (domain.NetworkValidation, error) {
	return domain.NetworkValidation{}, errors.New("pandapower unavailable")
}

func TestPythonNetworkValidatorRoundTrip(t *testing.T) {
	script := writeOptimizerScript(t, `
input=$(cat)
case "$input" in
  *'"optimizer_input"'*'"optimizer_solution"'*) ;;
  *) echo "missing wrapper" >&2; exit 9 ;;
esac
printf '%s' '{"status":"pass","model_name":"radial-low-voltage-default","source":"synthetic_default","assumptions":["synthetic line parameters"],"checked_intervals":2,"converged_intervals":2,"checked_buses":4,"checked_lines":3,"components_checked":7,"min_voltage_pu":0.98,"min_voltage_bus_id":"service","min_voltage_interval":1,"max_voltage_pu":1.01,"max_line_loading_percent":42,"max_loaded_line_id":"line-1","max_line_loading_interval":1,"calculated_loss_kwh":0.25,"validation_ms":8,"violations":[]}'
`)
	validator, err := NewPythonNetworkValidator("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct validator: %v", err)
	}
	input, solution := validOptimizerVerificationFixture()
	input.IntervalCount = 2
	trimOptimizerFixture(&input, &solution, 2)

	result, err := validator.Validate(context.Background(), input, solution)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if result.Status != domain.NetworkValidationPass || result.Engine != networkValidationEngine {
		t.Fatalf("unexpected status: %#v", result)
	}
	if result.CheckedIntervals != 2 || result.ComponentsChecked != 7 || result.MinimumVoltagePU != 0.98 {
		t.Fatalf("unexpected metrics: %#v", result)
	}
}

func TestPythonNetworkValidatorMapsReportedErrorToUnavailable(t *testing.T) {
	script := writeOptimizerScript(t, `printf '%s' '{"status":"error","model_name":"radial-low-voltage-default","source":"synthetic_default","assumptions":["synthetic line parameters"],"checked_intervals":0,"converged_intervals":0,"checked_buses":0,"checked_lines":0,"components_checked":0,"min_voltage_pu":0,"min_voltage_bus_id":"","min_voltage_interval":0,"max_voltage_pu":0,"max_line_loading_percent":0,"max_loaded_line_id":"","max_line_loading_interval":0,"calculated_loss_kwh":0,"validation_ms":3,"violations":[],"error":"power flow did not converge"}'`)
	validator, err := NewPythonNetworkValidator("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct validator: %v", err)
	}
	input, solution := validOptimizerVerificationFixture()

	result, err := validator.Validate(context.Background(), input, solution)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if result.Status != domain.NetworkValidationUnavailable || result.Error != "power flow did not converge" {
		t.Fatalf("unexpected unavailable result: %#v", result)
	}
}

func TestPythonNetworkValidatorRejectsUnlabeledSyntheticResult(t *testing.T) {
	script := writeOptimizerScript(t, `printf '%s' '{"status":"pass","model_name":"default","source":"synthetic_default","assumptions":[],"checked_intervals":1,"converged_intervals":1,"checked_buses":1,"checked_lines":0,"components_checked":1,"min_voltage_pu":1,"min_voltage_bus_id":"bus","min_voltage_interval":0,"max_voltage_pu":1,"max_line_loading_percent":0,"max_loaded_line_id":"","max_line_loading_interval":0,"calculated_loss_kwh":0,"validation_ms":1,"violations":[]}'`)
	validator, err := NewPythonNetworkValidator("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct validator: %v", err)
	}
	input, solution := validOptimizerVerificationFixture()

	_, err = validator.Validate(context.Background(), input, solution)
	if err == nil || !strings.Contains(err.Error(), "assumptions") {
		t.Fatalf("expected assumptions error, got %v", err)
	}
}

func TestPythonNetworkValidatorRejectsMalformedOutput(t *testing.T) {
	script := writeOptimizerScript(t, `printf '%s' '{"status":"pass","unknown":true}'`)
	validator, err := NewPythonNetworkValidator("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct validator: %v", err)
	}
	input, solution := validOptimizerVerificationFixture()

	_, err = validator.Validate(context.Background(), input, solution)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected strict JSON error, got %v", err)
	}
}

func TestPythonNetworkValidatorTimesOut(t *testing.T) {
	script := writeOptimizerScript(t, "exec sleep 1\n")
	validator, err := NewPythonNetworkValidator("/bin/sh", script, 20*time.Millisecond)
	if err != nil {
		t.Fatalf("construct validator: %v", err)
	}
	input, solution := validOptimizerVerificationFixture()

	_, err = validator.Validate(context.Background(), input, solution)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got %v", err)
	}
}

func TestUnavailableNetworkValidationIsExplicitlySynthetic(t *testing.T) {
	result := unavailableNetworkValidation(context.DeadlineExceeded)
	if result.Status != domain.NetworkValidationUnavailable || result.Source != "synthetic_default" || len(result.Assumptions) == 0 {
		t.Fatalf("fallback metadata is not explicit: %#v", result)
	}
}

func TestNetworkValidationFailurePreservesPlan(t *testing.T) {
	input, solution := validOptimizerVerificationFixture()
	run := domain.PlanRun{Intervals: []domain.PlanInterval{{
		Start: time.Unix(0, 0), End: time.Unix(900, 0), LossesKW: 2,
	}}}
	planner := &Scheduler{networkValidator: failingNetworkValidator{}}

	result := planner.attachNetworkValidation(context.Background(), input, solution, run)
	if len(result.Intervals) != 1 {
		t.Fatalf("dispatch plan was not preserved: %#v", result)
	}
	if result.NetworkValidation == nil || result.NetworkValidation.Status != domain.NetworkValidationUnavailable {
		t.Fatalf("missing unavailable metadata: %#v", result.NetworkValidation)
	}
	if result.NetworkValidation.AssumedLossKWH != 0.5 {
		t.Fatalf("assumed loss = %f, want 0.5", result.NetworkValidation.AssumedLossKWH)
	}
}

func trimOptimizerFixture(input *optimizerInput, solution *optimizerSolution, count int) {
	input.IntervalCount = count
	for _, values := range []map[string][]float64{
		input.RenewableAvailabilityKW, input.ServiceDemandKW, input.FuelDeliveryLiters,
		solution.ServiceRequestedKW, solution.ServiceDeliveredKW, solution.RenewableUsedKW,
		solution.BatteryChargeKW, solution.BatteryDischargeKW, solution.BatteryEnergyKWH,
		solution.GeneratorOutputKW,
	} {
		for id := range values {
			values[id] = values[id][:count]
		}
	}
	for _, values := range []map[string][]bool{solution.GeneratorRunning, solution.GeneratorStarted} {
		for id := range values {
			values[id] = values[id][:count]
		}
	}
	solution.DumpedPowerKW = solution.DumpedPowerKW[:count]
}
