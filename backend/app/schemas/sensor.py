from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class SensorReadingCreate(BaseModel):
    sensor_id: str
    sensor_type: str
    asset_id: Optional[UUID] = None
    timestamp: datetime
    flow_rate_lps: Optional[float] = None
    pressure_bar: Optional[float] = None
    water_level_m: Optional[float] = None
    turbidity_ntu: Optional[float] = None


class SensorReadingResponse(BaseModel):
    id: UUID
    sensor_id: str
    sensor_type: str
    timestamp: datetime
    flow_rate_lps: Optional[float]
    pressure_bar: Optional[float]
    water_level_m: Optional[float]
    turbidity_ntu: Optional[float]
    is_anomaly: bool
    anomaly_score: Optional[float]
    anomaly_type: Optional[str]

    class Config:
        from_attributes = True


class SensorBatchCreate(BaseModel):
    readings: list[SensorReadingCreate]


class AnomalyAlert(BaseModel):
    sensor_id: str
    asset_id: Optional[UUID]
    timestamp: datetime
    anomaly_score: float
    anomaly_type: str
    metric: str
    value: float
    threshold: float
    message: str
