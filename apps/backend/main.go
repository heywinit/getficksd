package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/heywinit/wattson/backend/internal/database"
	"github.com/heywinit/wattson/backend/internal/scheduler"
	"github.com/heywinit/wattson/backend/internal/weather"
)

const version = "0.1.0"

type config struct {
	port                     string
	databasePath             string
	allowedOrigins           map[string]struct{}
	optimizerEnabled         bool
	optimizerPython          string
	optimizerScript          string
	optimizerTimeout         time.Duration
	networkValidationEnabled bool
	networkValidationScript  string
	networkValidationTimeout time.Duration
}

type app struct {
	config    config
	store     *database.Store
	scheduler *scheduler.Scheduler
	weather   *weather.Client
}

type healthResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
	Version string `json:"version"`
}

type streamEvent struct {
	Type      string    `json:"type"`
	Service   string    `json:"service"`
	Timestamp time.Time `json:"timestamp"`
}

func main() {
	cfg := loadConfig()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	databaseConnection, err := database.Open(ctx, cfg.databasePath)
	if err != nil {
		log.Fatalf("Database startup failed: %v", err)
	}
	defer databaseConnection.Close()
	store := database.NewStore(databaseConnection)
	if err := seedDemoScenarios(ctx, store); err != nil {
		log.Fatalf("Scenario seed failed: %v", err)
	}

	plannerOptions := make([]scheduler.Option, 0, 2)
	if cfg.optimizerEnabled {
		optimizer, optimizerErr := scheduler.NewPythonOptimizer(cfg.optimizerPython, cfg.optimizerScript, cfg.optimizerTimeout)
		if optimizerErr != nil {
			log.Printf("MILP optimizer configuration failed; Wattson will use its heuristic: %v", optimizerErr)
		} else {
			plannerOptions = append(plannerOptions, scheduler.WithOptimizer(optimizer))
			log.Printf("MILP optimizer enabled with %s", cfg.optimizerScript)
		}
	}
	if cfg.networkValidationEnabled {
		validator, validatorErr := scheduler.NewPythonNetworkValidator(cfg.optimizerPython, cfg.networkValidationScript, cfg.networkValidationTimeout)
		if validatorErr != nil {
			log.Printf("AC network validator configuration failed; plans will omit network validation: %v", validatorErr)
		} else {
			plannerOptions = append(plannerOptions, scheduler.WithNetworkValidator(validator))
			log.Printf("AC network validator enabled with %s", cfg.networkValidationScript)
		}
	}
	planner := scheduler.New(plannerOptions...)

	server := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           newApp(cfg, store, planner).routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errorsChannel := make(chan error, 1)
	go func() {
		log.Printf("Wattson backend listening on :%s", cfg.port)
		errorsChannel <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			log.Printf("Backend shutdown failed: %v", err)
		}
	case err := <-errorsChannel:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Backend stopped: %v", err)
		}
	}
}

func loadConfig() config {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}

	origins := strings.TrimSpace(os.Getenv("WEB_ORIGINS"))
	if origins == "" {
		origins = "http://localhost:3001"
	}
	databasePath := strings.TrimSpace(os.Getenv("DATABASE_PATH"))
	if databasePath == "" {
		databasePath = "local.db"
	}

	allowedOrigins := make(map[string]struct{})
	for origin := range strings.SplitSeq(origins, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			allowedOrigins[origin] = struct{}{}
		}
	}
	optimizerEnabled := !strings.EqualFold(strings.TrimSpace(os.Getenv("MILP_ENABLED")), "false")
	optimizerPython := strings.TrimSpace(os.Getenv("MILP_PYTHON_PATH"))
	if optimizerPython == "" {
		optimizerPython = "optimizer/.venv/bin/python"
	}
	optimizerScript := strings.TrimSpace(os.Getenv("MILP_SCRIPT_PATH"))
	if optimizerScript == "" {
		optimizerScript = "optimizer/solve.py"
	}
	optimizerTimeout := 8 * time.Second
	if value := strings.TrimSpace(os.Getenv("MILP_TIMEOUT")); value != "" {
		parsed, err := time.ParseDuration(value)
		if err != nil || parsed <= 0 {
			log.Fatalf("MILP_TIMEOUT must be a positive duration")
		}
		optimizerTimeout = parsed
	}
	networkValidationEnabled := optimizerEnabled && !strings.EqualFold(strings.TrimSpace(os.Getenv("AC_VALIDATION_ENABLED")), "false")
	networkValidationScript := strings.TrimSpace(os.Getenv("AC_VALIDATION_SCRIPT_PATH"))
	if networkValidationScript == "" {
		networkValidationScript = "optimizer/validate_ac.py"
	}
	// Local cold-start validation takes about five seconds including the Python
	// and pandapower imports. Leave headroom for a smaller VPS.
	networkValidationTimeout := 12 * time.Second
	if value := strings.TrimSpace(os.Getenv("AC_VALIDATION_TIMEOUT")); value != "" {
		parsed, err := time.ParseDuration(value)
		if err != nil || parsed <= 0 {
			log.Fatalf("AC_VALIDATION_TIMEOUT must be a positive duration")
		}
		networkValidationTimeout = parsed
	}

	return config{
		port: port, databasePath: databasePath, allowedOrigins: allowedOrigins,
		optimizerEnabled: optimizerEnabled, optimizerPython: optimizerPython,
		optimizerScript: optimizerScript, optimizerTimeout: optimizerTimeout,
		networkValidationEnabled: networkValidationEnabled, networkValidationScript: networkValidationScript,
		networkValidationTimeout: networkValidationTimeout,
	}
}

func newApp(cfg config, store *database.Store, planner *scheduler.Scheduler) *app {
	return &app{config: cfg, store: store, scheduler: planner, weather: weather.NewClient()}
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /v1/demo/operators", a.listDemoOperators)
	mux.HandleFunc("GET /v1/demo/sites/{siteID}/scenario", a.getDemoScenario)
	mux.HandleFunc("GET /v1/sites", a.listSites)
	mux.HandleFunc("POST /v1/sites", a.createSite)
	mux.HandleFunc("GET /v1/sites/{siteID}", a.getSite)
	mux.HandleFunc("GET /v1/sites/{siteID}/forecast", a.getSiteForecast)
	mux.HandleFunc("POST /v1/scenarios", a.createScenario)
	mux.HandleFunc("GET /v1/scenarios", a.listScenarios)
	mux.HandleFunc("GET /v1/scenarios/{scenarioID}", a.getScenario)
	mux.HandleFunc("PUT /v1/scenarios/{scenarioID}", a.replaceScenario)
	mux.HandleFunc("DELETE /v1/scenarios/{scenarioID}", a.deleteScenario)
	mux.HandleFunc("PUT /v1/scenarios/{scenarioID}/signals/{signalID}", a.replaceSignalValues)
	mux.HandleFunc("PUT /v1/scenarios/{scenarioID}/initial-state", a.replaceInitialState)
	mux.HandleFunc("PUT /v1/scenarios/{scenarioID}/connections", a.replaceConnections)
	mux.HandleFunc("POST /v1/scenarios/{scenarioID}/events", a.createScenarioEvent)
	mux.HandleFunc("DELETE /v1/scenarios/{scenarioID}/events/{eventID}", a.deleteScenarioEvent)
	mux.HandleFunc("POST /v1/plan-runs", a.createPlanRun)
	mux.HandleFunc("GET /v1/plan-runs/{runID}", a.getPlanRun)
	mux.HandleFunc("GET /v1/plan-runs/{runID}/comparison", a.getPlanRunComparison)
	mux.HandleFunc("GET /v1/scenarios/{scenarioID}/plan-runs", a.listPlanRuns)
	mux.HandleFunc("GET /v1/events", a.events)

	return a.cors(mux)
}

func (a *app) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, healthResponse{
		Service: "wattson-backend",
		Status:  "ok",
		Version: version,
	})
}

func (a *app) events(response http.ResponseWriter, request *http.Request) {
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"message": "Streaming is not supported.",
		})
		return
	}

	response.Header().Set("Cache-Control", "no-cache, no-transform")
	response.Header().Set("Connection", "keep-alive")
	response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	response.Header().Set("X-Accel-Buffering", "no")

	writeEvent(response, streamEvent{
		Type:      "connected",
		Service:   "wattson-backend",
		Timestamp: time.Now().UTC(),
	})
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-request.Context().Done():
			return
		case timestamp := <-heartbeat.C:
			writeEvent(response, streamEvent{
				Type:      "heartbeat",
				Service:   "wattson-backend",
				Timestamp: timestamp.UTC(),
			})
			flusher.Flush()
		}
	}
}

func (a *app) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		if _, allowed := a.config.allowedOrigins[origin]; allowed {
			response.Header().Set("Access-Control-Allow-Origin", origin)
			response.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
			response.Header().Set("Access-Control-Allow-Methods", "DELETE, GET, POST, PUT, OPTIONS")
			response.Header().Add("Vary", "Origin")
		}

		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(response, request)
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	if err := json.NewEncoder(response).Encode(value); err != nil {
		log.Printf("JSON response failed: %v", err)
	}
}

func writeEvent(response http.ResponseWriter, event streamEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("Event encoding failed: %v", err)
		return
	}

	_, _ = fmt.Fprintf(response, "data: %s\n\n", data)
}
