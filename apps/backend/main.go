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
)

const version = "0.1.0"

type config struct {
	port           string
	allowedOrigins map[string]struct{}
}

type app struct {
	config config
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
	server := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           newApp(cfg).routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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

	allowedOrigins := make(map[string]struct{})
	for origin := range strings.SplitSeq(origins, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			allowedOrigins[origin] = struct{}{}
		}
	}

	return config{port: port, allowedOrigins: allowedOrigins}
}

func newApp(cfg config) *app {
	return &app{config: cfg}
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /v1/demo/operators", a.listDemoOperators)
	mux.HandleFunc("GET /v1/demo/sites/{siteID}/scenario", a.getDemoScenario)
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
			response.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
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
