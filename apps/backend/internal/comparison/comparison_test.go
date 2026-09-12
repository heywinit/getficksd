package comparison

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/heywinit/wattson/backend/internal/domain"
)

func TestCompareReportsImprovementAndRegression(t *testing.T) {
	baseline, candidate := exampleRuns()

	result, err := Compare(baseline, candidate)
	if err != nil {
		t.Fatalf("Compare() error = %v", err)
	}
	if got, want := result.Summary.RenewableEnergyKWH.Delta, 3.0; got != want {
		t.Fatalf("renewable delta = %v, want %v", got, want)
	}
	if got, want := result.Summary.DieselEnergyKWH.Delta, -1.0; got != want {
		t.Fatalf("diesel delta = %v, want %v", got, want)
	}
	if got, want := result.Summary.TotalDieselCost.Delta, -0.5; got != want {
		t.Fatalf("cost delta = %v, want %v", got, want)
	}
	if got, want := result.Summary.ContractsMet.Delta, 0; got != want {
		t.Fatalf("contracts met delta = %v, want %v", got, want)
	}
	if got, want := result.Summary.ContractsBreached.Delta, -1; got != want {
		t.Fatalf("contracts breached delta = %v, want %v", got, want)
	}

	water := contractByID(t, result.Contracts, "water")
	if water.StatusChange != "improved" || water.Shortfall.Delta != -2 {
		t.Fatalf("water comparison = %#v", water)
	}
	clinic := contractByID(t, result.Contracts, "clinic")
	if clinic.StatusChange != "regressed" {
		t.Fatalf("clinic comparison = %#v", clinic)
	}
	pump := serviceByID(t, result.Services, "pump")
	if got, want := pump.DeliveredEnergy.Delta, 2.0; got != want {
		t.Fatalf("pump delivery delta = %v, want %v", got, want)
	}
	if got, want := pump.UnservedEnergy.Delta, -2.0; got != want {
		t.Fatalf("pump unserved delta = %v, want %v", got, want)
	}
	solar := renewableByID(t, result.Renewables, "solar")
	if solar.UsedEnergy.Delta != 3 || solar.CurtailedEnergy.Delta != -3 {
		t.Fatalf("solar comparison = %#v", solar)
	}
	battery := batteryByID(t, result.Batteries, "battery")
	if battery.DischargeEnergy.Delta != -1 || battery.EndingEnergy.Delta != 1 {
		t.Fatalf("battery comparison = %#v", battery)
	}
	generator := generatorByID(t, result.Generators, "diesel")
	if generator.OutputEnergy.Delta != -1 || generator.FuelUsed.Delta != -0.5 || generator.DieselCost.Delta != -0.5 {
		t.Fatalf("generator comparison = %#v", generator)
	}
	if got, want := result.Intervals[0].SupplyKW.Delta, 0.0; got != want {
		t.Fatalf("interval supply delta = %v, want %v", got, want)
	}
	intervalWater := statusByID(t, result.Intervals[0].ContractChanges, "water")
	if intervalWater.StatusChange != "improved" {
		t.Fatalf("interval water status = %#v", intervalWater)
	}
}

func TestCompareHandlesMissingEntitiesAndSortsThem(t *testing.T) {
	baseline, candidate := exampleRuns()
	candidate.Intervals[0].Services = append(candidate.Intervals[0].Services, domain.ServiceDelivery{ServiceID: "added-service", RequestedKW: 1, DeliveredKW: 1})
	candidate.Intervals[0].Renewables = append(candidate.Intervals[0].Renewables, domain.RenewableDispatch{AssetID: "added-wind", AvailableKW: 1, UsedKW: 1})
	candidate.ContractOutcomes = append(candidate.ContractOutcomes, domain.ContractOutcome{ContractID: "added-contract", Status: domain.ContractSafe})

	result, err := Compare(baseline, candidate)
	if err != nil {
		t.Fatalf("Compare() error = %v", err)
	}
	service := serviceByID(t, result.Services, "added-service")
	if service.BaselinePresent || !service.CandidatePresent || service.DeliveredEnergy.Delta != 1 {
		t.Fatalf("missing service comparison = %#v", service)
	}
	renewable := renewableByID(t, result.Renewables, "added-wind")
	if renewable.BaselinePresent || !renewable.CandidatePresent || renewable.UsedEnergy.Delta != 1 {
		t.Fatalf("missing renewable comparison = %#v", renewable)
	}
	contract := contractByID(t, result.Contracts, "added-contract")
	if contract.StatusChange != "added" || contract.BaselinePresent || !contract.CandidatePresent {
		t.Fatalf("missing contract comparison = %#v", contract)
	}
	if result.Contracts[0].ContractID != "added-contract" {
		t.Fatalf("contracts are not sorted: %#v", result.Contracts)
	}
}

func TestCompareReconstructsContractOutcomesFromIntervals(t *testing.T) {
	baseline, candidate := exampleRuns()
	baseline.ContractOutcomes = nil
	candidate.ContractOutcomes = nil

	result, err := Compare(baseline, candidate)
	if err != nil {
		t.Fatalf("Compare() error = %v", err)
	}
	water := contractByID(t, result.Contracts, "water")
	if !water.BaselinePresent || !water.CandidatePresent || water.StatusChange != "improved" {
		t.Fatalf("reconstructed contract comparison = %#v", water)
	}
	if water.BaselineFirstRisk == nil || *water.BaselineFirstRisk != 0 {
		t.Fatalf("first risk interval = %#v, want 0", water.BaselineFirstRisk)
	}
}

func TestCompareHasZeroDeltaForSameRun(t *testing.T) {
	baseline, _ := exampleRuns()
	result, err := Compare(baseline, baseline)
	if err != nil {
		t.Fatalf("Compare() error = %v", err)
	}
	if result.Summary.DeliveredEnergyKWH.Delta != 0 || result.Summary.TotalDieselCost.Delta != 0 {
		t.Fatalf("summary has a nonzero delta: %#v", result.Summary)
	}
	for _, interval := range result.Intervals {
		if interval.SupplyKW.Delta != 0 || interval.DemandKW.Delta != 0 || interval.DieselFuelUsed.Delta != 0 {
			t.Fatalf("interval has a nonzero delta: %#v", interval)
		}
		for _, change := range interval.ContractChanges {
			if change.StatusChange != "unchanged" {
				t.Fatalf("status is not unchanged: %#v", change)
			}
		}
	}
}

func TestCompareRejectsMismatchedHorizons(t *testing.T) {
	baseline, candidate := exampleRuns()
	candidate.Intervals = candidate.Intervals[:1]
	_, err := Compare(baseline, candidate)
	if !errors.Is(err, ErrIntervalCountMismatch) {
		t.Fatalf("error = %v, want interval count mismatch", err)
	}

	_, candidate = exampleRuns()
	candidate.Intervals[1].Start = candidate.Intervals[1].Start.Add(time.Minute)
	_, err = Compare(baseline, candidate)
	if !errors.Is(err, ErrIntervalTimeMismatch) {
		t.Fatalf("error = %v, want interval timestamp mismatch", err)
	}
}

func TestBaselineDifferenceForDecisionUsesIntervalEvidence(t *testing.T) {
	baseline, candidate := exampleRuns()
	decision := domain.Decision{ID: "decision-1", IntervalIndex: 0, AffectedServiceIDs: []string{"pump"}, AffectedContractIDs: []string{"water"}}

	message, err := BaselineDifferenceForDecision(decision, baseline, candidate)
	if err != nil {
		t.Fatalf("BaselineDifferenceForDecision() error = %v", err)
	}
	for _, expected := range []string{"service pump delivery +2.00 kW", "service pump unserved load -2.00 kW", "contract water changed from breached to met"} {
		if !strings.Contains(message, expected) {
			t.Fatalf("message %q does not contain %q", message, expected)
		}
	}
}

func exampleRuns() (domain.PlanRun, domain.PlanRun) {
	start := time.Date(2026, time.January, 3, 0, 0, 0, 0, time.UTC)
	firstEnd := start.Add(time.Hour)
	end := firstEnd.Add(time.Hour)
	baseline := domain.PlanRun{
		ID: "baseline",
		Intervals: []domain.PlanInterval{
			{
				Index: 0, Start: start, End: firstEnd,
				Renewables: []domain.RenewableDispatch{{AssetID: "solar", AvailableKW: 6, UsedKW: 3, CurtailedKW: 3}},
				Batteries:  []domain.BatteryDispatch{{AssetID: "battery", StartingEnergyKWH: 5, DischargeKW: 2, EndingEnergyKWH: 3}},
				Generators: []domain.GeneratorDispatch{{AssetID: "diesel", OutputKW: 1, FuelUsedLiters: 0.5, FuelRemainingLiters: 9.5}},
				Services:   []domain.ServiceDelivery{{ServiceID: "pump", RequestedKW: 5, DeliveredKW: 3, UnservedKW: 2}, {ServiceID: "homes", RequestedKW: 1, DeliveredKW: 1}},
				Contracts:  []domain.ContractState{{ContractID: "water", Status: domain.ContractBreached}, {ContractID: "clinic", Status: domain.ContractMet}},
				DieselCost: 0.5, EmissionsKGCO2: 1,
			},
			{
				Index: 1, Start: firstEnd, End: end,
				Renewables: []domain.RenewableDispatch{{AssetID: "solar", AvailableKW: 6, UsedKW: 3, CurtailedKW: 3}},
				Batteries:  []domain.BatteryDispatch{{AssetID: "battery", StartingEnergyKWH: 3, ChargeKW: 1, EndingEnergyKWH: 4}},
				Services:   []domain.ServiceDelivery{{ServiceID: "pump", RequestedKW: 2, DeliveredKW: 2}, {ServiceID: "homes", RequestedKW: 1, DeliveredKW: 0, DeferredKW: 1}},
				Contracts:  []domain.ContractState{{ContractID: "water", Status: domain.ContractBreached}, {ContractID: "clinic", Status: domain.ContractMet}},
			},
		},
		ContractOutcomes: []domain.ContractOutcome{{ContractID: "water", Status: domain.ContractBreached, DeliveredEnergyKWH: 3, Shortfall: 2}, {ContractID: "clinic", Status: domain.ContractMet, DeliveredEnergyKWH: 1}},
	}
	candidate := domain.PlanRun{
		ID: "candidate",
		Intervals: []domain.PlanInterval{
			{
				Index: 0, Start: start, End: firstEnd,
				Renewables: []domain.RenewableDispatch{{AssetID: "solar", AvailableKW: 6, UsedKW: 5, CurtailedKW: 1}},
				Batteries:  []domain.BatteryDispatch{{AssetID: "battery", StartingEnergyKWH: 5, DischargeKW: 1, EndingEnergyKWH: 4}},
				Services:   []domain.ServiceDelivery{{ServiceID: "pump", RequestedKW: 5, DeliveredKW: 5}, {ServiceID: "homes", RequestedKW: 1, DeliveredKW: 1}},
				Contracts:  []domain.ContractState{{ContractID: "water", Status: domain.ContractMet}, {ContractID: "clinic", Status: domain.ContractAtRisk}},
			},
			{
				Index: 1, Start: firstEnd, End: end,
				Renewables: []domain.RenewableDispatch{{AssetID: "solar", AvailableKW: 6, UsedKW: 4, CurtailedKW: 2}},
				Batteries:  []domain.BatteryDispatch{{AssetID: "battery", StartingEnergyKWH: 4, ChargeKW: 1, EndingEnergyKWH: 5}},
				Services:   []domain.ServiceDelivery{{ServiceID: "pump", RequestedKW: 2, DeliveredKW: 2}, {ServiceID: "homes", RequestedKW: 1, DeliveredKW: 0, DeferredKW: 1}},
				Contracts:  []domain.ContractState{{ContractID: "water", Status: domain.ContractMet}, {ContractID: "clinic", Status: domain.ContractAtRisk}},
			},
		},
		ContractOutcomes: []domain.ContractOutcome{{ContractID: "water", Status: domain.ContractMet, DeliveredEnergyKWH: 5, Shortfall: 0}, {ContractID: "clinic", Status: domain.ContractAtRisk, DeliveredEnergyKWH: 1, Shortfall: 1}},
	}
	return baseline, candidate
}

func contractByID(t *testing.T, values []ContractComparison, id string) ContractComparison {
	t.Helper()
	for _, value := range values {
		if value.ContractID == id {
			return value
		}
	}
	t.Fatalf("contract %q was not found", id)
	return ContractComparison{}
}

func serviceByID(t *testing.T, values []ServiceComparison, id string) ServiceComparison {
	t.Helper()
	for _, value := range values {
		if value.ServiceID == id {
			return value
		}
	}
	t.Fatalf("service %q was not found", id)
	return ServiceComparison{}
}

func renewableByID(t *testing.T, values []RenewableComparison, id string) RenewableComparison {
	t.Helper()
	for _, value := range values {
		if value.AssetID == id {
			return value
		}
	}
	t.Fatalf("renewable %q was not found", id)
	return RenewableComparison{}
}

func batteryByID(t *testing.T, values []BatteryComparison, id string) BatteryComparison {
	t.Helper()
	for _, value := range values {
		if value.AssetID == id {
			return value
		}
	}
	t.Fatalf("battery %q was not found", id)
	return BatteryComparison{}
}

func generatorByID(t *testing.T, values []GeneratorComparison, id string) GeneratorComparison {
	t.Helper()
	for _, value := range values {
		if value.AssetID == id {
			return value
		}
	}
	t.Fatalf("generator %q was not found", id)
	return GeneratorComparison{}
}

func statusByID(t *testing.T, values []ContractStatusChange, id string) ContractStatusChange {
	t.Helper()
	for _, value := range values {
		if value.ContractID == id {
			return value
		}
	}
	t.Fatalf("contract state %q was not found", id)
	return ContractStatusChange{}
}
