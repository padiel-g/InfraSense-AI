from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


LeakScenarioType = Literal[
    "normal",
    "small_leak",
    "medium_leak",
    "burst_pipe",
    "overflow",
    "sensor_fault",
]

EventSeverity = Literal["low", "medium", "high", "critical"]

ZoneType = Literal["residential", "commercial", "industrial", "mixed"]

ValveStatusSim = Literal[
    "open",
    "closed",
    "partially_open",
    "failed_open",
    "failed_closed",
    "unknown",
]

GroundTruthLabel = LeakScenarioType

PredictionLabel = Literal[
    "normal",
    "possible_leak",
    "possible_burst",
    "overflow_risk",
    "sensor_fault",
]

# Hidden labels are NEVER exposed to the model. They exist only to support
# academic evaluation (latency, confusion counts) and are derived internally
# from the disturbance profile.
HiddenGroundTruthLabel = Literal[
    "normal_operation",
    "leak_like_event",
    "burst_like_event",
    "overflow_like_event",
    "sensor_fault",
]

DisturbancePattern = Literal["none", "gradual", "sudden", "intermittent"]


class LeakSimulationRunIn(BaseModel):
    # Controls
    duration_hours: int = Field(48, gt=0)
    data_frequency_minutes: int = Field(15, gt=0)
    sensor_uncertainty: float = Field(0.2, ge=0.0, le=1.0)
    detection_sensitivity_window: int = Field(21, ge=2)

    # Baseline system settings
    baseline_pressure_min_kpa: float = Field(270, ge=0)
    baseline_pressure_max_kpa: float = Field(480, ge=0)
    baseline_flow_min_lps: float = Field(5, ge=0)
    baseline_flow_max_lps: float = Field(20, ge=0)
    pipe_diameter_mm: Literal[50, 75, 100, 150, 200, 250] = 150
    zone_type: ZoneType = "residential"
    connected_properties_count: int = Field(50, ge=1)
    pipe_zone: Optional[str] = None

    # Event settings
    scenario_type: LeakScenarioType = "small_leak"
    event_start_time_minutes: int = Field(180, ge=0)
    event_duration_minutes: int = Field(240, ge=1)
    event_severity: EventSeverity = "medium"

    # Hydraulic behavior
    pressure_drop_rate_kpa_per_step: float = Field(0.8, ge=0)
    flow_increase_rate_lps_per_step: float = Field(0.2, ge=0)
    acoustic_baseline_db: float = Field(38.0, ge=0)
    acoustic_event_increase_db: float = Field(10.0, ge=0)
    soil_moisture_baseline_percent: float = Field(28.0, ge=0, le=100)
    soil_moisture_increase_rate_percent_per_step: float = Field(0.3, ge=0)

    # Valve and tank fields
    valve_status: ValveStatusSim = "unknown"
    tank_level_initial_percent: float = Field(60.0, ge=0, le=100)
    tank_inflow_lps: float = Field(1.5, ge=0)
    tank_outflow_lps: float = Field(1.2, ge=0)
    overflow_threshold_percent: float = Field(95.0, ge=0, le=100)

    # Time pattern
    enable_time_of_day_pattern: bool = True
    morning_peak_multiplier: float = Field(1.35, ge=0)
    evening_peak_multiplier: float = Field(1.45, ge=0)
    night_low_flow_multiplier: float = Field(0.65, ge=0)

    # Extended disturbance profile (Detection Session UI).
    # All optional; when not provided the legacy scenario_type-driven behavior
    # is used. These never reach the model — they only shape generated data.
    pressure_drop_pattern: Optional[DisturbancePattern] = None
    pressure_decay_rate_kpa_per_step: Optional[float] = Field(default=None, ge=0)

    flow_spike_pattern: Optional[DisturbancePattern] = None
    sustained_night_flow: bool = False

    acoustic_spike_pattern: Optional[DisturbancePattern] = None
    acoustic_increase_rate_db: Optional[float] = Field(default=None, ge=0)

    tank_rise_rate_percent_per_step: Optional[float] = Field(default=None, ge=0)
    inflow_continues: bool = False

    soil_moisture_increase_rate_percent: Optional[float] = Field(default=None, ge=0)

    disturbance_duration_minutes: Optional[int] = Field(default=None, ge=1)

    # Testing / reproducibility
    random_seed: Optional[int] = None
    expected_label_output: Optional[GroundTruthLabel] = None

    @model_validator(mode="after")
    def _validate_ranges(self):
        if self.baseline_pressure_min_kpa >= self.baseline_pressure_max_kpa:
            raise ValueError("baseline_pressure_min_kpa must be < baseline_pressure_max_kpa")
        if self.baseline_flow_min_lps >= self.baseline_flow_max_lps:
            raise ValueError("baseline_flow_min_lps must be < baseline_flow_max_lps")

        total_minutes = self.duration_hours * 60
        if self.event_start_time_minutes > total_minutes:
            raise ValueError("event_start_time_minutes must be within simulation duration")
        if self.event_start_time_minutes + self.event_duration_minutes > total_minutes:
            raise ValueError("event_start_time_minutes + event_duration_minutes must be within simulation duration")
        return self


class LeakGeneratedReading(BaseModel):
    timestamp: datetime
    sensor_id: str

    pressure_kpa: float
    flow_lps: float
    acoustic_db: float
    soil_moisture_percent: float

    valve_status: ValveStatusSim
    tank_level_percent: float

    pipe_zone: str
    pipe_diameter_mm: int
    zone_type: ZoneType
    connected_properties_count: int

    scenario_type: LeakScenarioType
    event_active: bool
    ground_truth_label: GroundTruthLabel


class LeakDetectionTimelineItem(BaseModel):
    timestamp: datetime
    status: Literal["collecting_sequence", "active"]
    prediction: Optional[PredictionLabel] = None
    confidence: Optional[float] = None


class LeakSimulationRunSummary(BaseModel):
    total_readings: int
    scenario_type: LeakScenarioType
    event_start_time_minutes: int
    first_detection_time_minutes: Optional[int] = None
    detection_latency_minutes: Optional[int] = None

    expected_label_output: Optional[GroundTruthLabel] = None
    predicted_label: Optional[PredictionLabel] = None
    max_confidence: float
    max_anomaly_score: float = 0.0
    false_positive_count: int
    false_negative_count: int
    warmup_time_minutes: int

    # Hidden evaluation-only label inferred from the disturbance profile.
    # Never used as model input.
    hidden_ground_truth_label: Optional[HiddenGroundTruthLabel] = None


class LeakSimulationRunOut(BaseModel):
    simulation_id: str
    generated_readings: List[LeakGeneratedReading]
    detection_results: List[LeakDetectionTimelineItem]
    summary: LeakSimulationRunSummary
