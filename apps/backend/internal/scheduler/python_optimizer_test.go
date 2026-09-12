package scheduler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestPythonOptimizerRoundTrip(t *testing.T) {
	script := writeOptimizerScript(t, `
input=$(cat)
case "$input" in
  *'"interval_count":2'*) ;;
  *) echo "missing input" >&2; exit 9 ;;
esac
printf '%s' '{"status":"optimal","objective_value":12.5,"mip_gap":0,"solve_ms":7,"service_requested_kw":{"service":[3,4]},"service_delivered_kw":{"service":[3,4]},"renewable_used_kw":{"solar":[3,4]},"battery_charge_kw":{"battery":[0,0]},"battery_discharge_kw":{"battery":[0,0]},"battery_energy_kwh":{"battery":[5,5]},"generator_output_kw":{"diesel":[0,0]},"generator_running":{"diesel":[false,false]},"generator_started":{"diesel":[false,false]},"dumped_power_kw":[0,0]}'
`)
	optimizer, err := NewPythonOptimizer("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}

	solution, err := optimizer.Optimize(context.Background(), exampleOptimizerInput())
	if err != nil {
		t.Fatalf("optimize: %v", err)
	}
	if solution.Status != "optimal" || solution.ObjectiveValue != 12.5 || solution.SolveMS != 7 {
		t.Fatalf("unexpected solution metadata: %#v", solution)
	}
	if got := solution.ServiceDeliveredKW["service"]; len(got) != 2 || got[1] != 4 {
		t.Fatalf("unexpected service delivery: %#v", got)
	}
}

func TestPythonOptimizerTimesOut(t *testing.T) {
	script := writeOptimizerScript(t, "exec sleep 1\n")
	optimizer, err := NewPythonOptimizer("/bin/sh", script, 20*time.Millisecond)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}

	_, err = optimizer.Optimize(context.Background(), exampleOptimizerInput())
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got %v", err)
	}
}

func TestPythonOptimizerRejectsUnknownOutputField(t *testing.T) {
	script := writeOptimizerScript(t, `printf '%s' '{"status":"optimal","unexpected":true}'`)
	optimizer, err := NewPythonOptimizer("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}

	_, err = optimizer.Optimize(context.Background(), exampleOptimizerInput())
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown-field error, got %v", err)
	}
}

func TestPythonOptimizerRejectsMalformedShape(t *testing.T) {
	script := writeOptimizerScript(t, `printf '%s' '{"status":"feasible","objective_value":1,"mip_gap":0.1,"solve_ms":2,"service_requested_kw":{},"service_delivered_kw":{},"renewable_used_kw":{},"battery_charge_kw":{},"battery_discharge_kw":{},"battery_energy_kwh":{},"generator_output_kw":{},"generator_running":{},"generator_started":{},"dumped_power_kw":[]}'`)
	optimizer, err := NewPythonOptimizer("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}

	_, err = optimizer.Optimize(context.Background(), exampleOptimizerInput())
	if err == nil || !strings.Contains(err.Error(), "service_requested_kw") {
		t.Fatalf("expected shape error, got %v", err)
	}
}

func TestPythonOptimizerReportsBoundedStderr(t *testing.T) {
	script := writeOptimizerScript(t, `echo "solver unavailable" >&2; exit 3`)
	optimizer, err := NewPythonOptimizer("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatalf("construct optimizer: %v", err)
	}

	_, err = optimizer.Optimize(context.Background(), exampleOptimizerInput())
	if err == nil || !strings.Contains(err.Error(), "solver unavailable") {
		t.Fatalf("expected solver diagnostic, got %v", err)
	}
}

func TestNewPythonOptimizerValidatesConfiguration(t *testing.T) {
	if _, err := NewPythonOptimizer("", "solver.py", time.Second); err == nil {
		t.Fatal("expected an empty Python path to fail")
	}
	if _, err := NewPythonOptimizer("python", "", time.Second); err == nil {
		t.Fatal("expected an empty script path to fail")
	}
	if _, err := NewPythonOptimizer("python", "solver.py", 0); err == nil {
		t.Fatal("expected a non-positive timeout to fail")
	}
}

func exampleOptimizerInput() optimizerInput {
	capacity := 10.0
	minimum := 1.0
	chargeLimit := 5.0
	dischargeLimit := 5.0
	efficiency := 1.0
	minimumOutput := 1.0
	maximumOutput := 8.0
	litersPerKWH := 0.25
	startupFuel := 0.1
	minimumRuntime := 15
	rampRate := 1.0
	fuelCost := 80.0
	emissions := 2.6
	return optimizerInput{
		IntervalMinutes: 15,
		IntervalCount:   2,
		LossFactor:      1,
		Assets: []domain.Asset{
			{ID: "solar", Type: domain.AssetSolar, CapacityKW: &capacity},
			{ID: "battery", Type: domain.AssetBattery, CapacityKWH: &capacity, MinimumStoredEnergyKWH: &minimum, MaxChargeKW: &chargeLimit, MaxDischargeKW: &dischargeLimit, ChargeEfficiency: &efficiency, DischargeEfficiency: &efficiency},
			{ID: "diesel", Type: domain.AssetDiesel, MinimumOutputKW: &minimumOutput, MaximumOutputKW: &maximumOutput, LitersPerKWH: &litersPerKWH, StartupFuelLiters: &startupFuel, MinimumRuntimeMinutes: &minimumRuntime, RampRateKWPerMinute: &rampRate, FuelCostPerLiter: &fuelCost, EmissionsKGCO2PerLiter: &emissions},
		},
		Services:                []domain.Service{{ID: "service", ControlMode: domain.ControlFixed, RatedPowerKW: 5}},
		RenewableAvailabilityKW: map[string][]float64{"solar": {5, 5}},
		ServiceDemandKW:         map[string][]float64{"service": {3, 4}},
		FuelDeliveryLiters:      map[string][]float64{"diesel": {0, 0}},
		InitialEnergyKWH:        map[string]float64{"battery": 5},
		InitialFuelLiters:       map[string]float64{"diesel": 10},
		InitialRunning:          map[string]bool{"diesel": false},
		ConnectedAssets:         map[string]bool{"solar": true, "battery": true, "diesel": true},
		ChargeableBatteries:     map[string]bool{"battery": true},
		ConnectedServices:       map[string]bool{"service": true},
		PolicyMinimumKWH:        map[string]float64{"battery": 1},
		PhysicalMinimumKWH:      map[string]float64{"battery": 1},
	}
}

func writeOptimizerScript(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "optimizer.sh")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write optimizer script: %v", err)
	}
	return path
}
