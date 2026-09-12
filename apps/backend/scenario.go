package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"net/http"

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
	scenario, exists := demoScenarios[siteID]
	if !exists {
		writeJSON(response, http.StatusNotFound, map[string]string{
			"message": "No seeded scenario exists for this site.",
		})
		return
	}

	writeJSON(response, http.StatusOK, scenario)
}
