export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface DashboardSummary {
  total_assets: number;
  high_risk_assets: number;
  active_incidents: number;
  anomalies_today: number;
  dumping_reports_pending: number;
  avg_response_time_hours: number;
}

export interface AlertItem {
  id: string;
  alert_type: "anomaly" | "incident" | "dumping";
  severity: string;
  message: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  is_acknowledged: boolean;
}

export interface RiskMapLayer {
  asset_id: string;
  asset_type: string;
  latitude: number;
  longitude: number;
  risk_score: number;
  risk_category: string;
  last_failure: string | null;
}

export interface Sensor {
  id: string;
  sensor_id: string;
  sensor_type: string;
  asset_id: string | null;
  status: "active" | "warning" | "critical" | "offline";
  latitude?: number;
  longitude?: number;
}

export interface SensorReading {
  id: string;
  sensor_id: string;
  sensor_type: string;
  timestamp: string;
  flow_rate_lps: number | null;
  pressure_bar: number | null;
  water_level_m: number | null;
  turbidity_ntu: number | null;
  is_anomaly: boolean;
  anomaly_score: number | null;
  anomaly_type: string | null;
}

export interface Incident {
  id: string;
  incident_type: string;
  issue_type?: string | null;
  category?: string | null;
  severity: string;
  status: string;
  description: string | null;
  source: string;
  latitude: number;
  longitude: number;
  address: string | null;
  suburb: string | null;
  image_url?: string | null;
  reported_by?: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
  reporter_phone?: string | null;
  reported_at: string;
  resolved_at: string | null;
  response_time_hours: number | null;
  model_confidence: number | null;
  assigned_to?: string | null;
}

// Persistent alert row from /api/v1/alerts (new endpoint, distinct from
// the legacy aggregated AlertItem used by dashboard.alerts).
export interface Alert {
  id: string;
  incident_id: string | null;
  alert_type: string;
  severity: string;
  title: string;
  message: string | null;
  latitude: number | null;
  longitude: number | null;
  is_read: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

// Combined response from POST /api/v1/incidents/report
export interface IncidentReportResult {
  incident: Incident;
  alert: Alert;
}

// Response from GET /api/routing/shortest-route (OSRM-backed)
export interface OsrmRouteResponse {
  start: { lat: number; lng: number };
  end:   { lat: number; lng: number };
  distance_km: number;
  duration_min: number;
  distance_meters: number;
  duration_seconds: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  provider: "osrm";
}

export interface IncidentCreate {
  incident_type: string;
  severity?: string;
  description?: string;
  latitude: number;
  longitude: number;
  address?: string;
  suburb?: string;
  reporter_phone?: string;
}

export interface IncidentStats {
  total_incidents: number;
  open_incidents: number;
  resolved_today: number;
  avg_response_time_hours: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
}

export interface Crew {
  id: string;
  name?: string;
  full_name: string;
  email?: string;
  role?: string;
  department: string | null;
  is_active?: boolean;
  status: "available" | "en-route" | "on-site" | "off-duty";
  latitude?: number;
  longitude?: number;
}

export interface RoutingCrew {
  id: string;
  name: string;
  department: string;
  status: "available" | "en-route" | "on-site" | "off-duty";
  latitude?: number | null;
  longitude?: number | null;
}

export interface ShortestRouteResponse {
  route: {
    geometry: [number, number][];
    distance_km: number;
    duration_min: number;
    is_approximate: boolean;
  };
  origin: {
    lat: number;
    lng: number;
  };
  destination: {
    lat: number;
    lng: number;
  };
  recommended_crew: {
    id: string;
    name: string;
    eta_min: number;
    distance_km: number;
  } | null;
  warnings: string[];
}

export interface BoundingBox {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  class?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface DumpingReport {
  id: string;
  status: string;
  source: string;
  image_url: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  suburb: string | null;
  detection_confidence: number | null;
  waste_categories: string | null;
  bounding_boxes: BoundingBox[] | null;
  is_verified: boolean;
  description: string | null;
  capture_date: string | null;
  detected_at: string;
  resolved_at: string | null;
}

export interface DumpingDetectionResult {
  report_id: string;
  detections: Array<Record<string, unknown>>;
  confidence: number;
  waste_categories: string[];
  image_url: string;
  processing_time_ms: number;
}

export type DumpingImageAnalysisStatus =
  | "suspected_illegal_dumping"
  | "not_illegal_dumping"
  | "needs_manual_review";

export interface DumpingImageAnalysisResult {
  status: DumpingImageAnalysisStatus;
  detected_class: string;
  confidence: number;
  bounding_boxes: Array<Record<string, unknown>>;
  message: string;
  can_submit: boolean;
}

export interface Asset {
  id: string;
  asset_code: string;
  asset_type: string;
  material: string | null;
  diameter_mm: number | null;
  age_years: number | null;
  suburb: string | null;
  ward: string | null;
  latitude: number | null;
  longitude: number | null;
  risk_score: number | null;
  risk_category: string | null;
  failure_count: number;
  condition_rating: number | null;
  created_at: string;
}

export type SeverityLevel = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "reported" | "assigned" | "in_progress" | "resolved";
