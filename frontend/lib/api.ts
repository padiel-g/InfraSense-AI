import axios from "axios";
import type {
  DashboardSummary,
  AlertItem,
  Alert,
  RiskMapLayer,
  SensorReading,
  Incident,
  IncidentCreate,
  IncidentReportResult,
  IncidentStats,
  DumpingReport,
  DumpingDetectionResult,
  DumpingImageAnalysisResult,
  Asset,
  Crew,
  RoutingCrew,
  ShortestRouteResponse,
  OsrmRouteResponse,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // send HttpOnly auth cookies on every request
});

// ── FormData request interceptor ────────────────────────────────────────────
// The instance-level "Content-Type: application/json" default is correct for
// JSON requests, but it overrides axios's automatic multipart/form-data
// detection when FormData is sent — some axios versions don't clear it.
// FastAPI then sees Content-Type: application/json, tries to parse the body
// as JSON, finds none of the required Form() fields, and returns a 422
// ("image: Field required. latitude: Field required. ...").
// Fix: delete Content-Type for FormData so the browser sets it natively
// with the correct multipart boundary.
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }
  return config;
});

// ── 401 interceptor: silently refresh access token then retry once ──────────
let _refreshing = false;
// Each entry holds both sides of the queued promise so we can properly
// reject them when a refresh attempt fails — previously they were silently
// dropped, freezing any component waiting on those requests.
let _waitQueue: Array<{
  resolve: () => void;
  reject: (reason: unknown) => void;
}> = [];

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const status = err.response?.status;
    const isAuthFailure = status === 401 || status === 403;
    const isRefreshCall = original?.url?.includes("/api/auth/refresh");
    const isLoginCall = original?.url?.includes("/api/auth/login");
    const alreadyRetried = original?._retry;

    if (!isAuthFailure || isRefreshCall || isLoginCall || alreadyRetried || !original) {
      return Promise.reject(err);
    }

    original._retry = true;

    if (_refreshing) {
      // Queue this request until the in-flight refresh finishes.
      // Store the reject callback so we can unblock waiters on failure.
      return new Promise((resolve, reject) => {
        _waitQueue.push({ resolve: () => resolve(api(original)), reject });
      });
    }

    _refreshing = true;
    try {
      await axios.post(`${BASE}/api/auth/refresh`, {}, { withCredentials: true });
      // Refresh succeeded — unblock all queued requests
      _waitQueue.forEach(({ resolve }) => resolve());
      _waitQueue = [];
      return api(original);
    } catch (refreshErr) {
      // Refresh failed — properly reject every queued promise so components
      // don't hang waiting for a response that will never arrive.
      _waitQueue.forEach(({ reject }) => reject(refreshErr));
      _waitQueue = [];
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("imads:auth-lost"));
      }
      // Do NOT use window.location.href here. A hard reload remounts
      // AuthProvider, which calls fetchMe() again, which fails again,
      // which triggers another hard reload — an infinite loop.
      // AppShell already watches isAuthenticated and calls router.replace("/login")
      // via a client-side navigation that keeps AuthProvider mounted, breaking the cycle.
      return Promise.reject(err);
    } finally {
      _refreshing = false;
    }
  }
);

// Dashboard
export const fetchDashboardSummary = () =>
  api.get<DashboardSummary>("/api/v1/dashboard/summary").then((r) => r.data);

export const fetchAlerts = (hours = 24) =>
  api.get<AlertItem[]>("/api/v1/dashboard/alerts", { params: { hours } }).then((r) => r.data);

export const fetchRiskMap = (params?: { suburb?: string; min_risk?: number }) =>
  api.get<RiskMapLayer[]>("/api/v1/dashboard/risk-map", { params }).then((r) => r.data);

// Sensors
export const fetchSensorReadings = (params?: {
  sensor_id?: string;
  sensor_type?: string;
  start_time?: string;
  end_time?: string;
  anomalies_only?: boolean;
  skip?: number;
  limit?: number;
}) =>
  api.get<SensorReading[]>("/api/v1/sensors/readings", { params }).then((r) => r.data);

export const fetchRecentAnomalies = (hours = 24) =>
  api.get<SensorReading[]>("/api/v1/sensors/anomalies/recent", { params: { hours } }).then((r) => r.data);

// Incidents
export const fetchIncidents = (params?: {
  status?: string;
  incident_type?: string;
  severity?: string;
  suburb?: string;
  skip?: number;
  limit?: number;
}) =>
  api.get<Incident[]>("/api/v1/incidents", { params }).then((r) => r.data);

export const fetchIncident = (id: string) =>
  api.get<Incident>(`/api/v1/incidents/${id}`).then((r) => r.data);

export const createIncident = (data: IncidentCreate) =>
  api.post<Incident>("/api/v1/incidents", data).then((r) => r.data);

export const updateIncident = (id: string, data: Partial<Incident>) =>
  api.patch<Incident>(`/api/v1/incidents/${id}`, data).then((r) => r.data);

export const fetchIncidentStats = () =>
  api.get<IncidentStats>("/api/v1/incidents/stats").then((r) => r.data);

// Assets
export const fetchAssets = (params?: {
  asset_type?: string;
  suburb?: string;
  risk_category?: string;
  skip?: number;
  limit?: number;
}) =>
  api.get<Asset[]>("/api/v1/assets", { params }).then((r) => r.data);

export const fetchAssetStats = () =>
  api.get("/api/v1/assets/stats/summary").then((r) => r.data);

// Dumping
export const fetchDumpingReports = (params?: {
  status?: string;
  suburb?: string;
  skip?: number;
  limit?: number;
}) =>
  api.get<DumpingReport[]>("/api/v1/dumping", { params }).then((r) => r.data);

export const fetchDumpingReport = (id: string) =>
  api.get<DumpingReport>(`/api/v1/dumping/${id}`).then((r) => r.data);

// Do NOT set Content-Type manually — axios auto-adds multipart/form-data
// with the correct boundary when it detects a FormData body.
export const reportDumping = (formData: FormData) =>
  api.post<DumpingDetectionResult>("/api/v1/dumping/report", formData).then((r) => r.data);

export const analyseDumpingImage = (formData: FormData) =>
  api.post<DumpingImageAnalysisResult>("/api/v1/dumping/analyse-image", formData).then((r) => r.data);

export const verifyDumpingReport = (id: string, is_verified: boolean) =>
  api.patch(`/api/v1/dumping/${id}/verify`, null, { params: { is_verified } }).then((r) => r.data);

// Resident-portal general municipal incident report.
// FormData fields: issue_type, severity, description, address, latitude,
// longitude, source, photo. The backend stores the row in the shared
// `incidents` table, auto-creates a matching Alert, and returns both.
export const reportIncident = (formData: FormData) =>
  api.post<IncidentReportResult>("/api/v1/incidents/report", formData).then((r) => r.data);

// Open (= not yet resolved) incidents — used by the Crew Routing map.
export const fetchOpenIncidents = () =>
  api.get<Incident[]>("/api/v1/incidents/open").then((r) => r.data);

export const fetchActiveIncidents = () =>
  api.get<Incident[]>("/api/v1/incidents/active").then((r) => r.data);

// Crew action buttons: assign / in-progress / resolved.
export const updateIncidentStatus = (id: string, status: string) =>
  api.patch<Incident>(`/api/v1/incidents/${id}/status`, { status }).then((r) => r.data);

// Persistent alerts feed (separate from the legacy /dashboard/alerts).
export const fetchAlertsFeed = (params?: {
  severity?: string;
  is_read?: boolean;
  status?: string;
  limit?: number;
}) => api.get<Alert[]>("/api/v1/alerts", { params }).then((r) => r.data);

export const markAlertRead = (id: string) =>
  api.patch<Alert>(`/api/v1/alerts/${id}/read`).then((r) => r.data);

// OSRM road route between two coordinates. Returned geometry is a
// GeoJSON LineString ready to feed straight into Leaflet.
export const fetchOsrmRoute = (start: { lat: number; lng: number }, end: { lat: number; lng: number }) =>
  api
    .get<OsrmRouteResponse>("/api/routing/shortest-route", {
      params: {
        start_lat: start.lat,
        start_lng: start.lng,
        end_lat: end.lat,
        end_lng: end.lng,
      },
    })
    .then((r) => r.data);

export const deleteDumpingReportImage = (id: string) =>
  api.delete<DumpingReport>(`/api/v1/dumping/${id}/image`).then((r) => r.data);

// Crew routing
export const fetchCrews = () =>
  api.get<RoutingCrew[]>("/api/crews").then((r) =>
    r.data.map((crew): Crew => ({
      id: crew.id,
      name: crew.name,
      full_name: crew.name,
      email: `${crew.id}@imads.local`,
      role: "field_crew",
      department: crew.department,
      is_active: crew.status !== "off-duty",
      status: crew.status,
      latitude: crew.latitude ?? undefined,
      longitude: crew.longitude ?? undefined,
    }))
  );

export const calculateShortestRoute = (data: {
  incident_id: string;
  crew_id?: string;
  origin?: { lat: number; lng: number };
}) =>
  api.post<ShortestRouteResponse>("/api/routing/shortest-route", data).then((r) => r.data);

export const assignCrewToIncident = (crewId: string, incidentId: string) =>
  api.post(`/api/crews/${crewId}/assign`, { incident_id: incidentId }).then((r) => r.data);

// Auth — cookie-based (tokens never touch JS; backend sets HttpOnly cookies)
export const login = (email: string, password: string, remember_me = false) =>
  api.post("/api/auth/login", { email, password, remember_me }).then((r) => r.data);

export const register = (data: { email: string; password: string; full_name?: string }) =>
  api.post("/api/auth/register", data).then((r) => r.data);

export const fetchMe = () =>
  api.get("/api/auth/me").then((r) => r.data);

export const logoutApi = () =>
  api.post("/api/auth/logout").then((r) => r.data);

export default api;

// Manual sensor reading — runs both leakage + water quality detection
export interface ManualReadingInput {
  sensor_id: string;
  pressure_bar: number;
  flow_rate_lps: number;
  turbidity_ntu: number;
  ph: number;
  water_level_m: number;
}

export interface ManualReadingResult {
  status: "normal" | "anomaly";
  score: number;
  type: string | null;
  model: string | null;
  water_quality: {
    is_contamination: boolean;
    score: number;
    reasons: string[];
  } | null;
}

export const submitManualReading = (data: ManualReadingInput) =>
  api.post<ManualReadingResult>("/api/v1/anomaly/reading", data).then((r) => r.data);

/* ── Water Quality module ─────────────────────────────────────────────── */

export type Severity = "low" | "medium" | "high" | "critical";

export interface WQManualEntryInput {
  sensor_id: string;
  timestamp?: string;
  turbidity_ntu: number;
  ph: number;
  flow_rate_lps: number;
  pressure_kpa?: number;
  residual_chlorine_mg_l?: number;
  conductivity_us_cm?: number;
  pipe_age_years?: number;
  pipe_material?: string;
}

export interface WQManualEntryResult {
  id: string;
  sensor_id: string;
  timestamp: string;
  readings: {
    turbidity_ntu: number;
    ph: number;
    flow_rate_lps: number;
    pressure_kpa?: number | null;
    residual_chlorine_mg_l?: number | null;
    conductivity_us_cm?: number | null;
  };
  anomaly_detected: boolean;
  anomaly_type:
    | "possible_contamination"
    | "possible_corrosion"
    | "possible_sediment_disturbance"
    | "sensor_fault_suspected"
    | "ph_deviation"
    | null;
  confidence_score: number;
  severity: Severity;
  corrosion_risk_score: number;
  message: string;
}

export type WQScenario =
  | "normal"
  | "gradual_contamination"
  | "sudden_spike"
  | "corrosion_event"
  | "random"
  | "gradual_corrosion"
  | "sediment_disturbance"
  | "sensor_fault";

export interface WQSimulateInput {
  sensor_id?: string;
  duration_hours?: number;
  interval_minutes?: number;
  scenario?: WQScenario;
  noise_level?: number;
  pipe_age_years?: number;
  pipe_material?: string;
  
  // Baseline water quality
  baseline_turbidity_ntu?: number;
  baseline_ph?: number;
  baseline_flow_lps?: number;
  baseline_pressure_kpa?: number;
  baseline_temperature_c?: number;
  baseline_chlorine_mg_l?: number;
  baseline_conductivity_us_cm?: number;
  
  // Event settings
  event_start_time_minutes?: number;
  event_duration_minutes?: number;
  event_severity?: "low" | "medium" | "high" | "critical";
  
  // Behavior rates
  pressure_drop_rate_kpa_per_step?: number;
  flow_change_rate_lps_per_step?: number;
  turbidity_increase_rate?: number;
  ph_change_rate?: number;
  chlorine_decay_rate?: number;
  conductivity_increase_rate?: number;
  
  // Detection config
  detection_window_size?: number;
  random_seed?: number;
}

export interface WQSimulationReading {
  timestamp: string;
  turbidity_ntu: number;
  ph: number;
  flow_rate_lps: number;
  pressure_kpa: number;
  temperature_c: number;
  chlorine_mg_l: number;
  conductivity_us_cm: number;
  anomaly_detected: boolean;
  anomaly_type: string | null;
  confidence_score: number;
  is_ground_truth_anomaly: boolean;
  ground_truth_label: string | null;
}

export interface WQSimulationResult {
  simulation_id: string;
  sensor_id: string;
  scenario: string;
  total_readings: number;
  anomalies_detected: number;
  detection_accuracy: number;
  event_start_time: string | null;
  first_detection_time: string | null;
  detection_latency_minutes: number | null;
  readings: WQSimulationReading[];
  summary: {
    accuracy: number;
    precision: number;
    recall: number;
    false_positive_rate: number;
    avg_corrosion_risk: number;
  };
}

export interface WQThresholds {
  turbidity_normal_max_ntu: number;
  turbidity_warning_ntu: number;
  turbidity_critical_ntu: number;
  ph_normal_range: [number, number];
  ph_warning_range: [number, number];
  flow_deviation_warning_pct: number;
  flow_deviation_critical_pct: number;
}

export const submitWaterQualityManual = (data: WQManualEntryInput) =>
  api
    .post<WQManualEntryResult>("/api/v1/water-quality/manual-entry", data)
    .then((r) => r.data);

export const runWaterQualitySimulation = (data: WQSimulateInput) =>
  api
    .post<WQSimulationResult>("/api/v1/water-quality/simulate", data)
    .then((r) => r.data);

export const fetchWaterQualityThresholds = () =>
  api
    .get<WQThresholds>("/api/v1/water-quality/thresholds")
    .then((r) => r.data);

/* ── Water Quality sequence-based simulation (/api/water-quality/simulation/run) ── */

export type WQScenarioType =
  | "normal"
  | "gradual_corrosion"
  | "gradual_contamination"
  | "sediment_disturbance"
  | "sensor_fault";

export type WQWindowPrediction =
  | "collecting_sequence"
  | "normal"
  | "possible_corrosion"
  | "possible_contamination"
  | "possible_sediment_disturbance"
  | "sensor_fault_suspected";

export interface WQSequenceSimulateInput {
  // Baseline water quality
  baseline_turbidity_ntu?: number;
  baseline_ph?: number;
  baseline_flow_lps?: number;
  baseline_pressure_kpa?: number;
  baseline_temperature_c?: number;
  baseline_chlorine_mg_l?: number;
  baseline_conductivity_us_cm?: number;

  // Scenario settings
  scenario_type?: WQScenarioType;
  event_start_time_minutes?: number;
  event_duration_minutes?: number;
  event_severity?: "low" | "medium" | "high" | "critical";

  // Behavior rates
  pressure_drop_rate_kpa_per_step?: number;
  flow_change_rate_lps_per_step?: number;
  turbidity_increase_rate?: number;
  ph_change_rate?: number;
  chlorine_decay_rate?: number;
  conductivity_increase_rate?: number;

  // Context
  pipe_material?: string;
  pipe_age_years?: number;
  pipe_zone?: string;

  // Controls
  duration_hours?: number;
  data_frequency_minutes?: number;
  sensor_uncertainty?: number;
  detection_window_size?: number;
  random_seed?: number;
}

export interface WQGeneratedReading {
  timestamp: string;
  turbidity_ntu: number;
  ph: number;
  flow_lps: number;
  pressure_kpa: number;
  temperature_c: number;
  residual_chlorine_mg_l: number;
  conductivity_us_cm: number;
  pipe_material: string;
  pipe_age_years: number;
  disturbance_profile: string;
  event_active: boolean;
  ground_truth_label: string;
}

export interface WQDetectionTimelineItem {
  timestamp: string;
  status: WQWindowPrediction;
  prediction: WQWindowPrediction | null;
  confidence: number | null;
}

export interface WQSequenceSimulationResult {
  simulation_id: string;
  generated_readings: WQGeneratedReading[];
  detection_results: WQDetectionTimelineItem[];
  summary: {
    total_readings: number;
    disturbance_profile: string;
    event_start_time: string | null;
    first_detection_time: string | null;
    detection_latency: number | null;
    expected_label: string;
    predicted_label: string | null;
    max_confidence: number;
    false_positives: number;
    false_negatives: number;
    warmup_time: number;
  };
}

export const runWaterQualitySequenceSimulation = (data: WQSequenceSimulateInput) =>
  api
    .post<WQSequenceSimulationResult>("/api/water-quality/simulation/run", data)
    .then((r) => r.data);

/* ── Leak & Overflow Detection (LSTM) module ──────────────────────────── */

export interface LeakManualEntryInput {
  sensor_id: string;
  timestamp?: string;
  pressure_kpa: number;
  flow_rate_lps: number;
  acoustic_signal_db?: number;
  soil_moisture_pct?: number;
  pipe_zone?: string;
}

export interface LeakManualEntryResult {
  id: string;
  sensor_id: string;
  timestamp: string;
  readings: {
    pressure_kpa: number;
    flow_rate_lps: number;
    acoustic_signal_db: number | null;
    soil_moisture_pct: number | null;
  };
  anomaly_detected: boolean;
  anomaly_type:
    | "probable_leak"
    | "overflow_risk"
    | "pressure_drop"
    | "burst"
    | null;
  confidence_score: number;
  severity: Severity;
  estimated_detection_latency_min: number;
  lstm_sequence_status: "warming_up" | "active" | "insufficient_data";
  message: string;
}

export const MIN_LEAK_SEQUENCE_LENGTH = 6;

export type ValveStatus = "open" | "closed" | "partially_open" | "unknown";

export interface DetectionSession {
  id: string;
  name: string | null;
  sensor_id: string | null;
  pipe_zone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DetectionSessionCreate {
  name?: string;
  sensor_id?: string;
  pipe_zone?: string;
}

export interface DetectionSessionReadingInput {
  timestamp: string;
  sensor_id: string;
  pressure_kpa: number;
  flow_lps: number;
  acoustic_db?: number;
  soil_moisture_percent?: number;
  valve_status: ValveStatus;
  tank_level_percent?: number;
  pipe_zone?: string;
}

export interface DetectionSessionReading {
  id: string;
  session_id: string;
  timestamp: string;
  sensor_id: string;
  pressure_kpa: number;
  flow_lps: number;
  acoustic_db: number | null;
  soil_moisture_percent: number | null;
  valve_status: ValveStatus;
  tank_level_percent: number | null;
  pipe_zone: string | null;
}

export type SessionDetectionStatus =
  | "collecting_sequence"
  | "normal"
  | "possible_leak"
  | "possible_burst"
  | "overflow_risk";

export interface SessionDetectionResult {
  id: string;
  session_id: string;
  status: SessionDetectionStatus;
  prediction: SessionDetectionStatus | null;
  confidence: number | null;
  message: string;
  reading_count: number;
  created_at: string;
}

export interface DetectionSessionHistory {
  session_id: string;
  number_of_readings: number;
  latest_pressure: number | null;
  latest_flow: number | null;
  latest_valve_status: string | null;
  latest_tank_level: number | null;
  result: string | null;
  confidence: number | null;
  latest_timestamp: string | null;
}

export type LeakScenario =
  | "normal"
  | "slow_leak"
  | "burst_pipe"
  | "overflow"
  | "intermittent_leak"
  | "random";

export type LeakScenarioType =
  | "normal"
  | "small_leak"
  | "medium_leak"
  | "burst_pipe"
  | "overflow"
  | "sensor_fault";

export type LeakZoneType = "residential" | "commercial" | "industrial" | "mixed";

export type LeakEventSeverity = "low" | "medium" | "high" | "critical";

export type LeakValveStatusSim =
  | "open"
  | "closed"
  | "partially_open"
  | "failed_open"
  | "failed_closed"
  | "unknown";

export type LeakPredictionLabel =
  | "normal"
  | "possible_leak"
  | "possible_burst"
  | "overflow_risk"
  | "sensor_fault";

export type LeakHiddenGroundTruth =
  | "normal_operation"
  | "leak_like_event"
  | "burst_like_event"
  | "overflow_like_event"
  | "sensor_fault";

export type LeakDisturbancePattern = "none" | "gradual" | "sudden" | "intermittent";

export interface LeakSimulateInput {
  sensor_id?: string;
  duration_hours?: number;
  interval_minutes?: number;
  scenario?: LeakScenario;
  noise_level?: number;
  lstm_window_size?: number;
}

export interface LeakSimulationRunInput {
  duration_hours?: number;
  data_frequency_minutes?: number;
  sensor_uncertainty?: number;
  detection_sensitivity_window?: number;

  baseline_pressure_min_kpa?: number;
  baseline_pressure_max_kpa?: number;
  baseline_flow_min_lps?: number;
  baseline_flow_max_lps?: number;
  pipe_diameter_mm?: 50 | 75 | 100 | 150 | 200 | 250;
  zone_type?: LeakZoneType;
  connected_properties_count?: number;
  pipe_zone?: string;

  scenario_type?: LeakScenarioType;
  event_start_time_minutes?: number;
  event_duration_minutes?: number;
  event_severity?: LeakEventSeverity;

  pressure_drop_rate_kpa_per_step?: number;
  flow_increase_rate_lps_per_step?: number;
  acoustic_baseline_db?: number;
  acoustic_event_increase_db?: number;
  soil_moisture_baseline_percent?: number;
  soil_moisture_increase_rate_percent_per_step?: number;

  valve_status?: LeakValveStatusSim;
  tank_level_initial_percent?: number;
  tank_inflow_lps?: number;
  tank_outflow_lps?: number;
  overflow_threshold_percent?: number;

  enable_time_of_day_pattern?: boolean;
  morning_peak_multiplier?: number;
  evening_peak_multiplier?: number;
  night_low_flow_multiplier?: number;

  random_seed?: number;
  expected_label_output?: LeakScenarioType;

  // Extended disturbance profile (Detection Session). Optional.
  pressure_drop_pattern?: LeakDisturbancePattern;
  pressure_decay_rate_kpa_per_step?: number;

  flow_spike_pattern?: LeakDisturbancePattern;
  sustained_night_flow?: boolean;

  acoustic_spike_pattern?: LeakDisturbancePattern;
  acoustic_increase_rate_db?: number;

  tank_rise_rate_percent_per_step?: number;
  inflow_continues?: boolean;

  soil_moisture_increase_rate_percent?: number;
  disturbance_duration_minutes?: number;
}

export interface LeakGeneratedReading {
  timestamp: string;
  sensor_id: string;
  pressure_kpa: number;
  flow_lps: number;
  acoustic_db: number;
  soil_moisture_percent: number;
  valve_status: LeakValveStatusSim;
  tank_level_percent: number;
  pipe_zone: string;
  pipe_diameter_mm: number;
  zone_type: LeakZoneType;
  connected_properties_count: number;
  scenario_type: LeakScenarioType;
  event_active: boolean;
  ground_truth_label: LeakScenarioType;
}

export interface LeakDetectionTimelineItem {
  timestamp: string;
  status: "collecting_sequence" | "active";
  prediction: LeakPredictionLabel | null;
  confidence: number | null;
}

export interface LeakSimulationRunResult {
  simulation_id: string;
  generated_readings: LeakGeneratedReading[];
  detection_results: LeakDetectionTimelineItem[];
  summary: {
    total_readings: number;
    scenario_type: LeakScenarioType;
    event_start_time_minutes: number;
    first_detection_time_minutes: number | null;
    detection_latency_minutes: number | null;
    expected_label_output: LeakScenarioType | null;
    predicted_label: LeakPredictionLabel | null;
    max_confidence: number;
    max_anomaly_score: number;
    hidden_ground_truth_label: LeakHiddenGroundTruth | null;
    false_positive_count: number;
    false_negative_count: number;
    warmup_time_minutes: number;
  };
}

export interface LeakSimulationReading {
  timestamp: string;
  pressure_kpa: number;
  flow_rate_lps: number;
  acoustic_signal_db: number;
  soil_moisture_pct: number;
  anomaly_detected: boolean;
  anomaly_type: string | null;
  confidence_score: number;
  is_ground_truth_anomaly: boolean;
}

export interface LeakSimulationResult {
  simulation_id: string;
  sensor_id: string;
  scenario: string;
  total_readings: number;
  anomalies_detected: number;
  readings: LeakSimulationReading[];
  summary: {
    precision: number;
    recall: number;
    f1_score: number;
    avg_detection_latency_min: number;
    max_detection_latency_min: number;
    meets_latency_target: boolean;
    meets_precision_target: boolean;
  };
}

export interface LeakModelStatus {
  model_loaded: boolean;
  model_version: string;
  window_size: number;
  features: string[];
  last_retrained: string | null;
  training_samples: number;
  validation_precision: number;
}

export const submitLeakManual = (data: LeakManualEntryInput) =>
  api
    .post<LeakManualEntryResult>("/api/v1/leak-detection/manual-entry", data)
    .then((r) => r.data);

export const createDetectionSession = (data?: DetectionSessionCreate) =>
  api.post<DetectionSession>("/api/sessions", data ?? {}).then((r) => r.data);

export const fetchDetectionSessions = () =>
  api.get<DetectionSessionHistory[]>("/api/sessions").then((r) => r.data);

export const addDetectionSessionReading = (
  sessionId: string,
  data: DetectionSessionReadingInput
) =>
  api
    .post<DetectionSessionReading>(`/api/sessions/${sessionId}/readings`, data)
    .then((r) => r.data);

export const fetchDetectionSessionReadings = (sessionId: string) =>
  api
    .get<DetectionSessionReading[]>(`/api/sessions/${sessionId}/readings`)
    .then((r) => r.data);

export const runDetectionSession = (sessionId: string) =>
  api
    .post<SessionDetectionResult>(`/api/sessions/${sessionId}/detect`)
    .then((r) => r.data);

export const runLeakSimulation = (data: LeakSimulateInput) =>
  api
    .post<LeakSimulationResult>("/api/v1/leak-detection/simulate", data)
    .then((r) => r.data);

export const runLeakSequenceSimulation = (data: LeakSimulationRunInput) =>
  api
    .post<LeakSimulationRunResult>("/api/simulation/run", data)
    .then((r) => r.data);

export const fetchLeakModelStatus = () =>
  api
    .get<LeakModelStatus>("/api/v1/leak-detection/model-status")
    .then((r) => r.data);
