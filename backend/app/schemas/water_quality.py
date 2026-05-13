"""Pydantic schemas for the /api/v1/water-quality module."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional, Tuple

from pydantic import BaseModel, Field


# ── Inputs ──────────────────────────────────────────────────────────────

class WQManualEntryIn(BaseModel):
    sensor_id: str
    timestamp: Optional[datetime] = None
    turbidity_ntu: float = Field(..., ge=0)
    ph: float = Field(..., ge=0, le=14)
    flow_rate_lps: float = Field(..., ge=0)
    pressure_kpa: Optional[float] = Field(None, ge=0)
    residual_chlorine_mg_l: Optional[float] = Field(None, ge=0)
    conductivity_us_cm: Optional[float] = Field(None, ge=0)
    pipe_age_years: Optional[float] = Field(None, ge=0)
    pipe_material: Optional[str] = None


class WQSimulateIn(BaseModel):
    # Existing fields
    sensor_id: Optional[str] = None
    duration_hours: int = Field(24, ge=1, le=168)
    interval_minutes: int = Field(15, ge=1, le=120)
    scenario: Literal[
        "normal", "gradual_contamination", "sudden_spike",
        "corrosion_event", "random", "gradual_corrosion", "sediment_disturbance", "sensor_fault"
    ] = "normal"
    noise_level: float = Field(0.1, ge=0.0, le=1.0)
    pipe_age_years: float = Field(20.0, ge=0)
    pipe_material: str = "cast_iron"
    
    # New: Baseline water quality parameters
    baseline_turbidity_ntu: float = Field(1.0, ge=0.0)
    baseline_ph: float = Field(7.2, ge=0.0, le=14.0)
    baseline_flow_lps: float = Field(4.0, ge=0.0)
    baseline_pressure_kpa: float = Field(350.0, ge=0.0)
    baseline_temperature_c: float = Field(20.0, ge=-10.0, le=50.0)
    baseline_chlorine_mg_l: float = Field(0.5, ge=0.0)
    baseline_conductivity_us_cm: float = Field(400.0, ge=0.0)
    
    # New: Scenario event settings
    event_start_time_minutes: int = Field(360, ge=0)  # default: 6 hours in
    event_duration_minutes: int = Field(240, ge=1)    # default: 4 hours
    event_severity: Literal["low", "medium", "high", "critical"] = "medium"
    
    # New: Hydraulic and chemical behavior rates (per sampling interval)
    pressure_drop_rate_kpa_per_step: float = Field(0.1, ge=0.0)
    flow_change_rate_lps_per_step: float = Field(0.05, ge=0.0)
    turbidity_increase_rate: float = Field(0.2, ge=0.0)
    ph_change_rate: float = Field(0.01, ge=0.0)
    chlorine_decay_rate: float = Field(0.02, ge=0.0)
    conductivity_increase_rate: float = Field(2.0, ge=0.0)
    
    # New: Detection configuration
    detection_window_size: int = Field(12, ge=2)
    random_seed: Optional[int] = None


# ── Outputs ─────────────────────────────────────────────────────────────

Severity = Literal["low", "medium", "high", "critical"]
WQAnomalyType = Literal[
    "possible_contamination",
    "possible_corrosion",
    "possible_sediment_disturbance",
    "sensor_fault_suspected",
    "ph_deviation",
]


class WQReadings(BaseModel):
    turbidity_ntu: float
    ph: float
    flow_rate_lps: float
    residual_chlorine_mg_l: Optional[float] = None
    conductivity_us_cm: Optional[float] = None
    pressure_kpa: Optional[float] = None


class WQManualEntryOut(BaseModel):
    id: str
    sensor_id: str
    timestamp: datetime
    readings: WQReadings
    anomaly_detected: bool
    anomaly_type: Optional[WQAnomalyType] = None
    confidence_score: float
    severity: Severity
    corrosion_risk_score: float
    message: str


class WQSimReading(BaseModel):
    timestamp: datetime
    turbidity_ntu: float
    ph: float
    flow_rate_lps: float
    pressure_kpa: float
    temperature_c: float
    chlorine_mg_l: float
    conductivity_us_cm: float
    anomaly_detected: bool
    anomaly_type: Optional[str] = None
    confidence_score: float
    is_ground_truth_anomaly: bool
    ground_truth_label: Optional[str] = None


class WQSimSummary(BaseModel):
    accuracy: float
    precision: float
    recall: float
    false_positive_rate: float
    avg_corrosion_risk: float


class WQSimulateOut(BaseModel):
    simulation_id: str
    sensor_id: str
    scenario: str
    total_readings: int
    anomalies_detected: int
    detection_accuracy: float
    event_start_time: Optional[datetime] = None
    first_detection_time: Optional[datetime] = None
    detection_latency_minutes: Optional[float] = None
    readings: list[WQSimReading]
    summary: WQSimSummary


# ── Sequence-based simulation endpoint (/api/water-quality/simulation/run) ──

WQScenarioType = Literal[
    "normal",
    "gradual_corrosion",
    "gradual_contamination",
    "sediment_disturbance",
    "sensor_fault",
]

WQEventSeverity = Literal["low", "medium", "high", "critical"]

WQPrediction = Literal[
    "collecting_sequence",
    "normal",
    "possible_corrosion",
    "possible_contamination",
    "possible_sediment_disturbance",
    "sensor_fault_suspected",
]


class WQSimulationRunIn(BaseModel):
    # Baseline water quality
    baseline_turbidity_ntu: float = Field(1.0, ge=0.0)
    baseline_ph: float = Field(7.2, ge=0.0, le=14.0)
    baseline_flow_lps: float = Field(4.0, ge=0.0)
    baseline_pressure_kpa: float = Field(350.0, ge=0.0)
    baseline_temperature_c: float = Field(20.0, ge=-10.0, le=50.0)
    baseline_chlorine_mg_l: float = Field(0.5, ge=0.0)
    baseline_conductivity_us_cm: float = Field(400.0, ge=0.0)

    # Scenario settings
    scenario_type: WQScenarioType = Field("normal")
    event_start_time_minutes: int = Field(360, ge=0)
    event_duration_minutes: int = Field(240, ge=1)
    event_severity: WQEventSeverity = Field("medium")

    # Hydraulic / chemical behavior rates (per step)
    pressure_drop_rate_kpa_per_step: float = Field(0.1, ge=0.0)
    flow_change_rate_lps_per_step: float = Field(0.05, ge=0.0)
    turbidity_increase_rate: float = Field(0.2, ge=0.0)
    ph_change_rate: float = Field(0.01, ge=0.0)
    chlorine_decay_rate: float = Field(0.02, ge=0.0)
    conductivity_increase_rate: float = Field(2.0, ge=0.0)

    # Context
    pipe_material: str = Field("cast_iron")
    pipe_age_years: float = Field(20.0, ge=0.0)
    pipe_zone: Optional[str] = None

    # Simulation controls
    duration_hours: int = Field(24, gt=0, le=168)
    data_frequency_minutes: int = Field(15, gt=0, le=120)
    sensor_uncertainty: float = Field(0.1, ge=0.0, le=1.0)
    detection_window_size: int = Field(12, ge=2)
    random_seed: Optional[int] = None

    class Config:
        populate_by_name = True


class WQGeneratedReading(BaseModel):
    timestamp: datetime
    turbidity_ntu: float
    ph: float
    flow_lps: float
    pressure_kpa: float
    temperature_c: float
    residual_chlorine_mg_l: float
    conductivity_us_cm: float
    pipe_material: str
    pipe_age_years: float
    disturbance_profile: str
    event_active: bool
    ground_truth_label: str


class WQDetectionResult(BaseModel):
    timestamp: datetime
    status: WQPrediction
    prediction: Optional[WQPrediction] = None
    confidence: Optional[float] = None


class WQSimulationSummary(BaseModel):
    total_readings: int
    disturbance_profile: str
    event_start_time: Optional[datetime] = None
    first_detection_time: Optional[datetime] = None
    detection_latency: Optional[float] = None
    expected_label: str
    predicted_label: Optional[str] = None
    max_confidence: float
    false_positives: int
    false_negatives: int
    warmup_time: int


class WQSimulationRunOut(BaseModel):
    simulation_id: str
    generated_readings: list[WQGeneratedReading]
    detection_results: list[WQDetectionResult]
    summary: WQSimulationSummary


class WQThresholds(BaseModel):
    turbidity_normal_max_ntu: float = 4.0
    turbidity_warning_ntu: float = 6.0
    turbidity_critical_ntu: float = 10.0
    ph_normal_range: Tuple[float, float] = (6.5, 8.5)
    ph_warning_range: Tuple[float, float] = (6.0, 9.0)
    flow_deviation_warning_pct: float = 20.0
    flow_deviation_critical_pct: float = 40.0
