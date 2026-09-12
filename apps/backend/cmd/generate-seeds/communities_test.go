package main

import (
	"context"
	"testing"

	"github.com/heywinit/wattson/backend/internal/domain"
	"github.com/heywinit/wattson/backend/internal/scheduler"
)

func TestCommunitySeedsProduceCompletePlansDuringAllEvents(t *testing.T) {
	for _, seed := range communityScenarios() {
		t.Run(seed.Scenario.Site.ID, func(t *testing.T) {
			scenario := seed.Scenario
			domain.NormalizeScenarioConnections(&scenario)
			if err := domain.ValidateScenario(scenario); err != nil {
				t.Fatalf("validate scenario: %v", err)
			}

			eventIDs := make([]string, len(scenario.Events))
			for index, event := range scenario.Events {
				eventIDs[index] = event.ID
			}
			run, err := scheduler.New().Plan(context.Background(), scenario, domain.PlanningRequest{
				ScenarioID: scenario.ID, Planner: domain.PlannerWattson, ActiveEventIDs: eventIDs,
			})
			if err != nil {
				t.Fatalf("plan scenario: %v", err)
			}
			if run.Status != domain.PlanComplete || run.Summary.ContractsBreached != 0 {
				t.Fatalf("expected every commitment to be protected: %#v", run.Summary)
			}
		})
	}
}
