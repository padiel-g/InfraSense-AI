"""Pydantic schemas for the /api/v1/leak-detection module."""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


# ── Inputs ──────────────────────────────────────────────────────────────

class LeakManualEntryIn(BaseModel):
    sensor_id: str
    timestamp: Optional[datetime] = None
    pressure_kpa: float = Field(..., ge=0)
    flow_rate_lps: float = Field(..., ge=0)
    acoustic_signal_db: Optional[float] = None
    soil_moisture_pct: Optional[float] = Field(None, ge=0, le=100)
    pipe_zone: Optional[str] = None


class LeakSimulateIn(BaseModel):
    sensor_id: Optional[str] = None
    duration_hours: int = Field(48, ge=1, le=168)
    interval_minutes: int = Field(5, ge=1, le=120)
    scenario: Literal[
        "normal", "slow_leak", "burst_pipe", "overflow",
        "intermittent_leak", "random",
    ] = "normal"
    noise_level: float = Field(0.1, ge=0.0, le=1.0)
    lstm_window_size: int = Field(12, ge=4, le=48)


# ── Outputs ─────────────────────────────────────────────────────────────

Severity = Literal["low", "medium", "high", "critical"]
LeakAnomalyType = Literal["probable_leak", "overflow_risk", "pressure_drop", "burst"]
LSTMSeqStatus = Literal["warming_up", "active", "insufficient_data"]


class LeakReadings(BaseModel):
    pressure_kpa: float
    flow_rate_lps: float
    acoustic_signal_db: Optional[float] = None
    soil_moisture_pct: Optional[float] = None


class LeakManualEntryOut(BaseModel):
    id: str
    sensor_id: str
    timestamp: datetime
    readings: LeakReadings
    anomaly_detected: bool
    anomaly_type: Optional[LeakAnomalyType] = None
    confidence_score: float
    severity: Severity
    estimated_detection_latency_min: float
    lstm_sequence_status: LSTMSeqStatus
    message: str


class LeakSimReading(BaseModel):
    timestamp: datetime
    pressure_kpa: float
    flow_rate_lps: float
    acoustic_signal_db: float
    soil_moisture_pct: float
    anomaly_detected: bool
    anomaly_type: Optional[str] = None
    confidence_score: float
    is_ground_truth_anomaly: bool


class LeakSimSummary(BaseModel):
    precision: float
    recall: float
    f1_score: float
    avg_detection_latency_min: float
    max_detection_latency_min: float
    meets_latency_target: bool
    meets_precision_target: bool


class LeakSimulateOut(BaseModel):
    simulation_id: str
    sensor_id: str
    scenario: str
    total_readings: int
    anomalies_detected: int
    readings: List[LeakSimReading]
    summary: LeakSimSummary


class LeakModelStatusOut(BaseModel):
    model_loaded: bool
    model_version: str
    window_size: int
    features: List[str]
    last_retrained: Optional[str] = None
    training_samples: int
    validation_precision: float
