package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/domain"
)

//go:embed seeddata/*.json
var scenarioFiles embed.FS

var demoScenarios = mustLoadDemoScenarios()

func mustLoadDemoScenarios() map[string]domain.Scenario {
	files, err := scenarioFiles.ReadDir("seeddata")
	if err != nil {
		panic(fmt.Errorf("read embedded scenarios: %w", err))
	}

	scenarios := make(map[string]domain.Scenario, len(files))
	for _, file := range files {
		if file.IsDir() {
			continue
		}

		data, err := scenarioFiles.ReadFile("seeddata/" + file.Name())
		if err != nil {
			panic(fmt.Errorf("read embedded scenario %q: %w", file.Name(), err))
		}

		var scenario domain.Scenario
		if err := json.Unmarshal(data, &scenario); err != nil {
			panic(fmt.Errorf("decode embedded scenario %q: %w", file.Name(), err))
		}
		if err := domain.ValidateScenario(scenario); err != nil {
			panic(fmt.Errorf("validate embedded scenario %q: %w", file.Name(), err))
		}
		if _, exists := scenarios[scenario.Site.ID]; exists {
			panic(fmt.Errorf("multiple embedded scenarios use site %q", scenario.Site.ID))
		}
		scenarios[scenario.Site.ID] = scenario
	}

	return scenarios
}

func (a *app) getDemoScenario(response http.ResponseWriter, request *http.Request) {
	siteID := request.PathValue("siteID")
	scenario, err := a.store.ScenarioBySite(request.Context(), siteID)
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{
			"message": "No seeded scenario exists for this site.",
		})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be loaded."})
		return
	}

	writeJSON(response, http.StatusOK, scenario)
}

func (a *app) getScenario(response http.ResponseWriter, request *http.Request) {
	scenario, err := a.store.Scenario(request.Context(), request.PathValue("scenarioID"))
	if errors.Is(err, database.ErrNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"message": "The scenario does not exist."})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"message": "The scenario could not be loaded."})
		return
	}
	writeJSON(response, http.StatusOK, scenario)
}

func seedDemoScenarios(ctx context.Context, store *database.Store) error {
	for _, scenario := range demoScenarios {
		if err := store.SaveScenario(ctx, scenario); err != nil {
			return err
		}
	}
	return nil
}
