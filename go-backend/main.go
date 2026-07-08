package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

// --- Standardized Data Models (shared contract) ---

type SystemStats struct {
	Temperature  float64 `json:"temperature"`
	GridLoad     float64 `json:"grid_load"`
	OutputKW     float64 `json:"output_kw"`
	FuelLevel    float64 `json:"fuel_level"`
	PressurePsi  float64 `json:"pressure_psi"`
	VibrationMM  float64 `json:"vibration_mm"`
	UptimeHours  float64 `json:"uptime_hours"`
	Efficiency   float64 `json:"efficiency"`
	IsLocked     bool    `json:"is_locked"`
}

type CommandRequest struct {
	Action    string `json:"action"`
	Context   string `json:"context"`
	Timestamp string `json:"timestamp"`
}

type CommandResponse struct {
	Success      bool                   `json:"success"`
	Action       string                 `json:"action"`
	Message      string                 `json:"message,omitempty"`
	AppliedDelta *PartialStats          `json:"appliedDelta,omitempty"`
}

type PartialStats struct {
	Temperature *float64 `json:"temperature,omitempty"`
	GridLoad    *float64 `json:"grid_load,omitempty"`
	OutputKW    *float64 `json:"output_kw,omitempty"`
	FuelLevel   *float64 `json:"fuel_level,omitempty"`
	PressurePsi *float64 `json:"pressure_psi,omitempty"`
	VibrationMM *float64 `json:"vibration_mm,omitempty"`
	Efficiency  *float64 `json:"efficiency,omitempty"`
	IsLocked    *bool    `json:"is_locked,omitempty"`
}

type AlertEvent struct {
	ID               int       `json:"id"`
	Level            string    `json:"level"`
	Text             string    `json:"text"`
	CreatedAt        time.Time `json:"createdAt"`
	RootCause        string    `json:"rootCause,omitempty"`
	SuggestedAction  string    `json:"suggestedAction,omitempty"`
	AssignedTo       string    `json:"assignedTo,omitempty"`
	ExpectedResolution time.Time `json:"expectedResolution,omitempty"`
}

type HistorySnapshot struct {
	Timestamp time.Time   `json:"timestamp"`
	Stats     SystemStats `json:"stats"`
}

type DashboardConfig struct {
	PinnedWidgets []string `json:"pinnedWidgets"`
	Theme         string   `json:"theme"`
}

// --- Global State ---

type SystemState struct {
	mu              sync.RWMutex
	stats           SystemStats
	history         []HistorySnapshot
	alerts          []AlertEvent
	isLocked        bool
	nextAlertID     int
	totalProcessed  int
	enginePower     int
	lastAlertTime   map[string]time.Time // dedup alerts by text
}

func NewSystemState() *SystemState {
	s := &SystemState{
		stats: SystemStats{
			Temperature:  79.0,
			GridLoad:     64.0,
			OutputKW:     452.0,
			FuelLevel:    68.0,
			PressurePsi:  121.0,
			VibrationMM:  2.1,
			UptimeHours:  160.0,
			Efficiency:   93.0,
			IsLocked:     false,
		},
		enginePower:   5,
		lastAlertTime: make(map[string]time.Time),
	}
	// Seed initial history with stable values
	for i := 0; i < 30; i++ {
		s.stats.UptimeHours = 160.0 + float64(i)*0.02
		s.history = append(s.history, HistorySnapshot{
			Timestamp: time.Now().Add(-time.Duration(30-i)*time.Second),
			Stats:     s.generateStableSnapshot(s.stats),
		})
	}
	return s
}

// generateStableSnapshot creates small, realistic variations around healthy values
func (s *SystemState) generateStableSnapshot(prev SystemStats) SystemStats {
	wobble := func(range_ float64) float64 {
		return (rand.Float64() - 0.5) * range_
	}
	return SystemStats{
		Temperature:  clamp(prev.Temperature+wobble(1.2), 72, 88),
		GridLoad:     clamp(prev.GridLoad+wobble(3.0), 45, 82),
		OutputKW:     clamp(prev.OutputKW+wobble(15), 380, 520),
		FuelLevel:    clamp(prev.FuelLevel-rand.Float64()*0.15, 10, 100),
		PressurePsi:  clamp(prev.PressurePsi+wobble(2.5), 100, 145),
		VibrationMM:  clamp(prev.VibrationMM+wobble(0.15), 1.0, 4.0),
		UptimeHours:  prev.UptimeHours + 0.003,
		Efficiency:   clamp(prev.Efficiency+wobble(0.8), 86, 98),
		IsLocked:     prev.IsLocked,
	}
}

func (s *SystemState) tick() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isLocked {
		// When locked, gradually cool down and reduce load
		s.stats.Temperature = clamp(s.stats.Temperature-0.5, 70, 100)
		s.stats.GridLoad = clamp(s.stats.GridLoad-0.3, 40, 100)
		s.stats.OutputKW = clamp(s.stats.OutputKW-1.0, 300, 750)
		// Auto-unlock when system stabilizes
		if s.stats.Temperature < 82 && s.stats.GridLoad < 75 {
			s.isLocked = false
			log.Printf("System auto-unlocked: temp=%.1f, load=%.1f", s.stats.Temperature, s.stats.GridLoad)
		}
		return
	}

	// Gentle natural drift - system tends to stay in healthy range
	s.stats.Temperature += (float64(s.enginePower)*0.3 - 0.8) // net cooling effect
	if s.stats.GridLoad > 80 {
		s.stats.GridLoad -= rand.Float64() * 1.5 // natural load reduction
	}

	// Generate new stats with natural variation
	s.stats = s.generateStableSnapshot(s.stats)

	// Record history
	s.history = append(s.history, HistorySnapshot{
		Timestamp: time.Now(),
		Stats:     s.stats,
	})
	// Keep last 120 snapshots (2 minutes at 1s intervals)
	if len(s.history) > 120 {
		s.history = s.history[len(s.history)-120:]
	}

	// Rare critical events (only ~1% chance per tick)
	if rand.Float64() < 0.008 {
		if s.stats.Temperature > 90 || s.stats.GridLoad > 90 {
			s.isLocked = true
			s.triggerAlert("critical", "Critical threshold crossed. Immediate intervention required.",
				"System overload - temperature/grid load exceeded safety limits",
				"Activate emergency cooldown and load shed protocols",
				"Shift Supervisor", 30*time.Minute)
		}
	}

	// Predictive alerts (only when conditions are actually concerning)
	if s.stats.Temperature > 85 && s.stats.VibrationMM > 3.5 {
		s.triggerAlert("warning", "Likely bearing failure detected; recommend maintenance within 48 hours.",
			"Bearing wear - correlated temperature and vibration rise",
			"Schedule bearing inspection and replacement",
			"Maintenance Team A", 48*time.Hour)
	}

	if s.stats.GridLoad > 88 {
		s.triggerAlert("critical", "Brownout risk detected. Immediate load shedding required.",
			"Grid overload - demand exceeds capacity",
			"Activate load-shed profile and reduce output",
			"Grid Operations", 15*time.Minute)
	}
}

func (s *SystemState) triggerAlert(level, text, rootCause, suggestedAction, assignedTo string, resolution time.Duration) {
	// Dedup: don't fire the same alert text more than once every 30 seconds
	if last, ok := s.lastAlertTime[text]; ok && time.Since(last) < 30*time.Second {
		return
	}
	s.lastAlertTime[text] = time.Now()

	alert := AlertEvent{
		ID:                s.nextAlertID,
		Level:             level,
		Text:              text,
		CreatedAt:         time.Now(),
		RootCause:         rootCause,
		SuggestedAction:   suggestedAction,
		AssignedTo:        assignedTo,
		ExpectedResolution: time.Now().Add(resolution),
	}
	s.nextAlertID++
	s.alerts = append(s.alerts, alert)
	if len(s.alerts) > 25 {
		s.alerts = s.alerts[len(s.alerts)-25:]
	}
}

func (s *SystemState) GetStats() SystemStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *SystemState) GetHistory(limit int) []HistorySnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 || limit > len(s.history) {
		limit = len(s.history)
	}
	result := make([]HistorySnapshot, limit)
	copy(result, s.history[len(s.history)-limit:])
	return result
}

func (s *SystemState) GetAlerts() []AlertEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]AlertEvent, len(s.alerts))
	copy(result, s.alerts)
	return result
}

func (s *SystemState) ExecuteCommand(action string) CommandResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isLocked && action != "reset" && action != "unlock" {
		return CommandResponse{
			Success: false,
			Action:  action,
			Message: "System is locked. Reset required before issuing commands.",
		}
	}

	delta := &PartialStats{}

	switch action {
	case "boost-output":
		output := s.stats.OutputKW + 35
		if output > 750 { output = 750 }
		delta.OutputKW = &output
		load := s.stats.GridLoad + 3
		if load > 100 { load = 100 }
		delta.GridLoad = &load
		temp := s.stats.Temperature + 1.2
		if temp > 102 { temp = 102 }
		delta.Temperature = &temp
		s.enginePower++

	case "cooldown":
		temp := s.stats.Temperature - 2.2
		if temp < 65 { temp = 65 }
		delta.Temperature = &temp
		output := s.stats.OutputKW - 12
		if output < 300 { output = 300 }
		delta.OutputKW = &output

	case "load-shed":
		load := s.stats.GridLoad - 5
		if load < 35 { load = 35 }
		delta.GridLoad = &load
		output := s.stats.OutputKW - 8
		if output < 300 { output = 300 }
		delta.OutputKW = &output

	case "eco-mode":
		load := s.stats.GridLoad - 2.5
		if load < 35 { load = 35 }
		delta.GridLoad = &load
		eff := s.stats.Efficiency + 0.8
		if eff > 100 { eff = 100 }
		delta.Efficiency = &eff

	case "lock":
		s.isLocked = true
		locked := true
		delta.IsLocked = &locked

	case "unlock":
		s.isLocked = false
		locked := false
		delta.IsLocked = &locked

	case "reset":
		s.isLocked = false
		locked := false
		delta.IsLocked = &locked
		s.enginePower = 5
		// Reset to healthy baseline
		healthyTemp := 79.0
		healthyLoad := 64.0
		healthyOutput := 452.0
		delta.Temperature = &healthyTemp
		delta.GridLoad = &healthyLoad
		delta.OutputKW = &healthyOutput

	case "pressure-stabilize":
		psi := s.stats.PressurePsi - 2.5
		if psi < 90 { psi = 90 }
		delta.PressurePsi = &psi

	case "precision-tune":
		eff := s.stats.Efficiency + 1.1
		if eff > 100 { eff = 100 }
		delta.Efficiency = &eff
		vib := s.stats.VibrationMM - 0.2
		if vib < 0.6 { vib = 0.6 }
		delta.VibrationMM = &vib

	default:
		return CommandResponse{
			Success: false,
			Action:  action,
			Message: fmt.Sprintf("Unknown command: %s", action),
		}
	}

	// Apply delta
	if delta.Temperature != nil { s.stats.Temperature = *delta.Temperature }
	if delta.GridLoad != nil { s.stats.GridLoad = *delta.GridLoad }
	if delta.OutputKW != nil { s.stats.OutputKW = *delta.OutputKW }
	if delta.FuelLevel != nil { s.stats.FuelLevel = *delta.FuelLevel }
	if delta.PressurePsi != nil { s.stats.PressurePsi = *delta.PressurePsi }
	if delta.VibrationMM != nil { s.stats.VibrationMM = *delta.VibrationMM }
	if delta.Efficiency != nil { s.stats.Efficiency = *delta.Efficiency }
	if delta.IsLocked != nil { s.stats.IsLocked = *delta.IsLocked }

	return CommandResponse{
		Success:      true,
		Action:       action,
		Message:      fmt.Sprintf("Command %s executed successfully", action),
		AppliedDelta: delta,
	}
}

func (s *SystemState) AcknowledgeAlerts(level string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	var remaining []AlertEvent
	count := 0
	for _, a := range s.alerts {
		if level == "" || a.Level == level {
			count++
		} else {
			remaining = append(remaining, a)
		}
	}
	s.alerts = remaining
	return count
}

func clamp(value, min, max float64) float64 {
	if value < min { return min }
	if value > max { return max }
	return value
}

// --- HTTP Handlers ---

type Server struct {
	state *SystemState
}

func NewServer() *Server {
	return &Server{state: NewSystemState()}
}

func (srv *Server) corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func (srv *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats := srv.state.GetStats()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (srv *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	limit := 60 // default
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := fmt.Sscanf(l, "%d", &limit); err != nil || parsed != 1 {
			limit = 60
		}
	}
	history := srv.state.GetHistory(limit)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"history": history,
		"count":   len(history),
	})
}

func (srv *Server) handleAlerts(w http.ResponseWriter, r *http.Request) {
	alerts := srv.state.GetAlerts()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"alerts": alerts,
		"count":  len(alerts),
	})
}

func (srv *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var req CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Printf("JSON Decode Error: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(CommandResponse{
				Success: false,
				Action:  "unknown",
				Message: fmt.Sprintf("Invalid request body: %v", err),
			})
			return
		}
		log.Printf("Received command: action=%s, context=%s", req.Action, req.Context)
		response := srv.state.ExecuteCommand(req.Action)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
		return
	}

	// GET - legacy support
	action := r.URL.Query().Get("action")
	if action == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{
			Success: false,
			Action:  "unknown",
			Message: "No action specified",
		})
		return
	}
	response := srv.state.ExecuteCommand(action)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (srv *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"timestamp": time.Now(),
		"version":   "2.0.0",
	})
}

func (srv *Server) handleAcknowledge(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Level string `json:"level"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	count := srv.state.AcknowledgeAlerts(req.Level)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"acknowledged": count,
		"message":      fmt.Sprintf("%d alerts acknowledged", count),
	})
}

func (srv *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stats := srv.state.GetStats()
			data, _ := json.Marshal(stats)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// --- Main ---

func main() {
	srv := NewServer()

	// Background simulation ticker
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			srv.state.tick()
		}
	}()

	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/stats", srv.corsMiddleware(srv.handleStats))
	mux.HandleFunc("/api/history", srv.corsMiddleware(srv.handleHistory))
	mux.HandleFunc("/api/alerts", srv.corsMiddleware(srv.handleAlerts))
	mux.HandleFunc("/api/command", srv.corsMiddleware(srv.handleCommand))
	mux.HandleFunc("/api/health", srv.corsMiddleware(srv.handleHealth))
	mux.HandleFunc("/api/acknowledge", srv.corsMiddleware(srv.handleAcknowledge))
	mux.HandleFunc("/api/stream", srv.corsMiddleware(srv.handleStream))

	// Health check
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	log.Printf("Brilliant Project API Server v2.0.0 starting on :8080")
	log.Printf("Endpoints:")
	log.Printf("  GET  /api/stats       - Current system stats")
	log.Printf("  GET  /api/history      - Historical data (query: limit)")
	log.Printf("  GET  /api/alerts       - Active alerts")
	log.Printf("  POST /api/command      - Execute command")
	log.Printf("  POST /api/acknowledge  - Acknowledge alerts")
	log.Printf("  GET  /api/stream       - Server-Sent Events stream")
	log.Printf("  GET  /api/health       - Health check")
	log.Printf("  GET  /healthz          - Simple health check")

	server := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}