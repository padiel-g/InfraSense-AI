from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ValveStatus = Literal["open", "closed", "partially_open", "unknown"]
DetectionStatus = Literal[
    "collecting_sequence",
    "normal",
    "possible_leak",
    "possible_burst",
    "overflow_risk",
]


class DetectionSessionCreate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    sensor_id: Optional[str] = Field(None, max_length=50)
    pipe_zone: Optional[str] = Field(None, max_length=120)


class DetectionSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: Optional[str]
    sensor_id: Optional[str]
    pipe_zone: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime


class SessionReadingCreate(BaseModel):
    timestamp: datetime
    sensor_id: str = Field(..., min_length=1, max_length=50)
    pressure_kpa: float = Field(..., ge=0)
    flow_lps: float = Field(..., ge=0)
    acoustic_db: Optional[float] = None
    soil_moisture_percent: Optional[float] = Field(None, ge=0, le=100)
    valve_status: ValveStatus = "unknown"
    tank_level_percent: Optional[float] = Field(None, ge=0, le=100)
    pipe_zone: Optional[str] = Field(None, max_length=120)


class SessionReadingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: Optional[str]
    timestamp: datetime
    sensor_id: str
    pressure_kpa: float
    flow_lps: float
    acoustic_db: Optional[float]
    soil_moisture_percent: Optional[float]
    valve_status: ValveStatus
    tank_level_percent: Optional[float]
    pipe_zone: Optional[str]


class DetectionResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    status: DetectionStatus
    prediction: Optional[DetectionStatus]
    confidence: Optional[float]
    message: str
    reading_count: int
    created_at: datetime


class DetectionSessionHistoryOut(BaseModel):
    session_id: str
    number_of_readings: int
    latest_pressure: Optional[float]
    latest_flow: Optional[float]
    latest_valve_status: Optional[str]
    latest_tank_level: Optional[float]
    result: Optional[str]
    confidence: Optional[float]
    latest_timestamp: Optional[datetime]
