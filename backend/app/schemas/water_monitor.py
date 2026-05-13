"""
Pydantic schemas for the water monitoring feature.

These are entirely separate from the existing sensor / incident schemas.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Sensor reading
# ---------------------------------------------------------------------------

class WaterSensorReadingCreate(BaseModel):
    """Body for POST /api/water/detect (manual entry)."""

    zone_id: str
    zone_name: str
    flow_rate: float   # L/s
    pressure: float    # bar
    turbidity: float   # NTU
    ph: float
    source: str = "manual"


class WaterSensorReadingOut(BaseModel):
    """Response for persisted sensor readings."""

    id: int
    zone_id: str
    zone_name: str
    timestamp: datetime
    flow_rate: float
    pressure: float
    turbidity: float
    ph: float
    source: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Detection result
# ---------------------------------------------------------------------------

class WaterDetectionResult(BaseModel):
    """Returned by POST /api/water/detect."""

    incident_type: str          # "normal" | "leak" | "overflow" | "contamination"
    confidence: float           # 0.0 – 0.98
    lstm_score: float           # 0.0 – 1.0
    quality_score: float        # 0.0 – 1.0
    indicators: List[str]
    recommendation: str


# ---------------------------------------------------------------------------
# Incident log
# ---------------------------------------------------------------------------

class WaterIncidentOut(BaseModel):
    """Response for items in GET /api/water/incidents."""

    id: int
    timestamp: datetime
    zone_id: str
    zone_name: str
    incident_type: str
    confidence: float
    lstm_score: Optional[float]
    quality_score: Optional[float]
    indicators: List[str]
    recommendation: str
    source: str

    model_config = {"from_attributes": True}
