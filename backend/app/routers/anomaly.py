"""
/analyze endpoint - real-time anomaly detection on a sensor sequence.
"""

from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.anomaly_detection import detect_anomaly, _get as _get_service
from app.ml.water_quality import get_water_quality_detector

router = APIRouter(prefix="/anomaly", tags=["anomaly"])


class SensorReading(BaseModel):
    sensor_id: Optional[str] = "stream"
    pressure_bar: float
    flow_rate_lps: float
    water_level_m: float
    turbidity_ntu: Optional[float] = None
    ph: Optional[float] = None


class AnalyzeRequest(BaseModel):
    sensor_id: Optional[str] = "stream"
    sequence: List[List[float]] = Field(
        ...,
        description="2D array of sensor samples ordered oldest -> newest. "
                    "Each row: [pressure_bar, flow_rate_lps, water_level_m, "
                    "turbidity_ntu?, ph?]",
    )


class AnalyzeResponse(BaseModel):
    status: str
    score: float
    reconstruction_error: Optional[float] = None
    threshold: Optional[float] = None
    type: Optional[str] = None
    model: Optional[str] = None
    water_quality: Optional[dict] = None


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_sequence(payload: AnalyzeRequest) -> AnalyzeResponse:
    if not payload.sequence:
        raise HTTPException(status_code=400, detail="sequence must not be empty")
    try:
        arr = np.asarray(payload.sequence, dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid sequence: {e}")

    result = _get_service().check_sequence(arr, sensor_id=payload.sensor_id or "stream")

    # Optional water-quality side check on most recent row when full features supplied
    if arr.shape[1] >= 5:
        last = {
            "sensor_id": payload.sensor_id or "stream",
            "pressure_bar": float(arr[-1, 0]),
            "flow_rate_lps": float(arr[-1, 1]),
            "water_level_m": float(arr[-1, 2]),
            "turbidity_ntu": float(arr[-1, 3]),
            "ph": float(arr[-1, 4]),
        }
        wq = get_water_quality_detector().update(last)
        result["water_quality"] = wq
        if wq["is_contamination"]:
            result["is_anomaly"] = True
            result["score"] = max(result.get("score", 0.0), wq["score"])
            result["type"] = result.get("type") or "contamination"

    return AnalyzeResponse(
        status="anomaly" if result.get("is_anomaly") else "normal",
        score=float(result.get("score", 0.0)),
        reconstruction_error=result.get("reconstruction_error"),
        threshold=result.get("threshold"),
        type=result.get("type"),
        model=result.get("model"),
        water_quality=result.get("water_quality"),
    )


@router.post("/reading")
async def analyze_reading(reading: SensorReading) -> dict:
    """Single-reading endpoint - feeds the per-sensor rolling buffer."""
    result = _get_service().check_reading(reading.model_dump())
    return {
        "status": "anomaly" if result.get("is_anomaly") else "normal",
        "score": float(result.get("score", 0.0)),
        "type": result.get("type"),
        "model": result.get("model"),
        "water_quality": result.get("water_quality"),
    }
