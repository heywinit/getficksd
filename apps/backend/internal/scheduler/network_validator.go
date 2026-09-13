package scheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

const networkValidationEngine = "pandapower"

var syntheticNetworkAssumptions = []string{
	"Electrical line parameters are synthetic defaults, not measured site data.",
	"The controller is modeled as the slack bus for a radial low-voltage network.",
}

type NetworkValidator interface {
	Validate(ctx context.Context, input optimizerInput, solution optimizerSolution) (domain.NetworkValidation, error)
}

type pythonNetworkValidator struct {
	pythonPath string
	scriptPath string
	timeout    time.Duration
}

type networkValidationRequest struct {
	OptimizerInput    optimizerInput    `json:"optimizer_input"`
	OptimizerSolution optimizerSolution `json:"optimizer_solution"`
}

type networkValidationResponse struct {
	Status                    string                    `json:"status"`
	ModelName                 string                    `json:"model_name"`
	Source                    string                    `json:"source"`
	Assumptions               []string                  `json:"assumptions"`
	CheckedIntervals          int                       `json:"checked_intervals"`
	ConvergedIntervals        int                       `json:"converged_intervals"`
	CheckedBuses              int                       `json:"checked_buses"`
	CheckedLines              int                       `json:"checked_lines"`
	ComponentsChecked         int                       `json:"components_checked"`
	MinimumVoltagePU          float64                   `json:"min_voltage_pu"`
	MinimumVoltageBusID       string                    `json:"min_voltage_bus_id"`
	MinimumVoltageInterval    int                       `json:"min_voltage_interval"`
	MaximumVoltagePU          float64                   `json:"max_voltage_pu"`
	MaximumLineLoadingPercent float64                   `json:"max_line_loading_percent"`
	MaximumLoadedLineID       string                    `json:"max_loaded_line_id"`
	MaximumLineLoadInterval   int                       `json:"max_line_loading_interval"`
	CalculatedLossKWH         float64                   `json:"calculated_loss_kwh"`
	ValidationMS              int64                     `json:"validation_ms"`
	Violations                []domain.NetworkViolation `json:"violations"`
	Error                     string                    `json:"error,omitempty"`
}

func NewPythonNetworkValidator(pythonPath, scriptPath string, timeout time.Duration) (NetworkValidator, error) {
	pythonPath = strings.TrimSpace(pythonPath)
	scriptPath = strings.TrimSpace(scriptPath)
	if pythonPath == "" {
		return nil, errors.New("network validator Python path is required")
	}
	if scriptPath == "" {
		return nil, errors.New("network validator script path is required")
	}
	if timeout <= 0 {
		return nil, errors.New("network validator timeout must be positive")
	}
	return &pythonNetworkValidator{pythonPath: pythonPath, scriptPath: scriptPath, timeout: timeout}, nil
}

func (v *pythonNetworkValidator) Validate(ctx context.Context, input optimizerInput, solution optimizerSolution) (domain.NetworkValidation, error) {
	payload, err := json.Marshal(networkValidationRequest{OptimizerInput: input, OptimizerSolution: solution})
	if err != nil {
		return domain.NetworkValidation{}, fmt.Errorf("encode network validation input: %w", err)
	}

	validationContext, cancel := context.WithTimeout(ctx, v.timeout)
	defer cancel()
	command := exec.CommandContext(validationContext, v.pythonPath, v.scriptPath)
	command.Stdin = bytes.NewReader(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(validationContext.Err(), context.DeadlineExceeded) {
			return domain.NetworkValidation{}, fmt.Errorf("network validator exceeded %s timeout: %w", v.timeout, context.DeadlineExceeded)
		}
		if errors.Is(validationContext.Err(), context.Canceled) {
			return domain.NetworkValidation{}, context.Canceled
		}
		diagnostic := boundedDiagnostic(stderr.String())
		if diagnostic != "" {
			return domain.NetworkValidation{}, fmt.Errorf("network validator process failed: %w: %s", err, diagnostic)
		}
		return domain.NetworkValidation{}, fmt.Errorf("network validator process failed: %w", err)
	}

	var response networkValidationResponse
	decoder := json.NewDecoder(&stdout)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&response); err != nil {
		return domain.NetworkValidation{}, fmt.Errorf("decode network validation output: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return domain.NetworkValidation{}, fmt.Errorf("decode network validation output: %w", err)
	}
	if err := validateNetworkValidationResponse(input.IntervalCount, response); err != nil {
		return domain.NetworkValidation{}, fmt.Errorf("validate network validation output: %w", err)
	}

	status := domain.NetworkValidationStatus(response.Status)
	if response.Status == "error" {
		status = domain.NetworkValidationUnavailable
	}
	return domain.NetworkValidation{
		Engine: networkValidationEngine, ModelName: response.ModelName, Status: status,
		Source: response.Source, Assumptions: append([]string(nil), response.Assumptions...),
		CheckedIntervals: response.CheckedIntervals, ConvergedIntervals: response.ConvergedIntervals,
		CheckedBuses: response.CheckedBuses, CheckedLines: response.CheckedLines, ComponentsChecked: response.ComponentsChecked,
		MinimumVoltagePU: response.MinimumVoltagePU, MinimumVoltageBusID: response.MinimumVoltageBusID,
		MinimumVoltageInterval: response.MinimumVoltageInterval, MaximumVoltagePU: response.MaximumVoltagePU,
		MaximumLineLoadingPercent: response.MaximumLineLoadingPercent, MaximumLoadedLineID: response.MaximumLoadedLineID,
		MaximumLineLoadInterval: response.MaximumLineLoadInterval, CalculatedLossKWH: response.CalculatedLossKWH,
		ValidationMS: response.ValidationMS, Violations: append([]domain.NetworkViolation(nil), response.Violations...),
		Error: response.Error,
	}, nil
}

func validateNetworkValidationResponse(intervalCount int, response networkValidationResponse) error {
	if response.Status != "pass" && response.Status != "violations" && response.Status != "error" {
		return fmt.Errorf("status must be pass, violations, or error, got %q", response.Status)
	}
	if strings.TrimSpace(response.ModelName) == "" {
		return errors.New("model_name is required")
	}
	if response.Source != "synthetic_default" && response.Source != "provided_network" {
		return fmt.Errorf("source must identify synthetic_default or provided_network, got %q", response.Source)
	}
	if len(response.Assumptions) == 0 {
		return errors.New("assumptions must identify the electrical model inputs")
	}
	if response.ValidationMS < 0 {
		return errors.New("validation_ms must be non-negative")
	}
	if response.Status == "error" {
		if strings.TrimSpace(response.Error) == "" {
			return errors.New("error status requires an error message")
		}
		return nil
	}
	if response.CheckedIntervals < 0 || response.CheckedIntervals > intervalCount {
		return fmt.Errorf("checked_intervals must be between 0 and %d", intervalCount)
	}
	if response.ConvergedIntervals < 0 || response.ConvergedIntervals > response.CheckedIntervals {
		return errors.New("converged_intervals must be between 0 and checked_intervals")
	}
	if response.CheckedBuses < 0 || response.CheckedLines < 0 || response.ComponentsChecked < 0 {
		return errors.New("component counts must be non-negative")
	}
	if !finite(response.MinimumVoltagePU) || response.MinimumVoltagePU <= 0 ||
		!finite(response.MaximumVoltagePU) || response.MaximumVoltagePU <= 0 ||
		!finite(response.MaximumLineLoadingPercent) || response.MaximumLineLoadingPercent < 0 ||
		!finite(response.CalculatedLossKWH) || response.CalculatedLossKWH < 0 {
		return errors.New("network metrics must be finite and non-negative")
	}
	if response.MinimumVoltageInterval < 0 || response.MinimumVoltageInterval >= intervalCount ||
		response.MaximumLineLoadInterval < 0 || response.MaximumLineLoadInterval >= intervalCount {
		return errors.New("extreme metric interval is outside the planning horizon")
	}
	if response.Status == "pass" && len(response.Violations) != 0 {
		return errors.New("pass status cannot contain violations")
	}
	if response.Status == "violations" && len(response.Violations) == 0 {
		return errors.New("violations status requires at least one violation")
	}
	for index, violation := range response.Violations {
		if violation.IntervalIndex < 0 || violation.IntervalIndex >= intervalCount {
			return fmt.Errorf("violations[%d] interval is outside the planning horizon", index)
		}
		if strings.TrimSpace(violation.Kind) == "" || strings.TrimSpace(violation.Message) == "" {
			return fmt.Errorf("violations[%d] requires kind and message", index)
		}
		if !finite(violation.Value) || !finite(violation.Limit) {
			return fmt.Errorf("violations[%d] value and limit must be finite", index)
		}
	}
	return nil
}

func unavailableNetworkValidation(err error) domain.NetworkValidation {
	return domain.NetworkValidation{
		Engine:      networkValidationEngine,
		ModelName:   "radial-low-voltage-default",
		Status:      domain.NetworkValidationUnavailable,
		Source:      "synthetic_default",
		Assumptions: append([]string(nil), syntheticNetworkAssumptions...),
		Violations:  make([]domain.NetworkViolation, 0),
		Error:       err.Error(),
	}
}
