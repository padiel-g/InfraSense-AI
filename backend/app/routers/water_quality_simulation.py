"""FastAPI routes for /api/water-quality/simulation/* (sequence-based simulation)."""
from __future__ import annotations

import uuid
from fastapi import APIRouter, HTTPException

from app.schemas.water_quality import (
    WQSimulationRunIn,
    WQSimulationRunOut,
    WQGeneratedReading,
    WQDetectionResult,
    WQSimulationSummary,
)
from app.services.water_quality_simulation import run_sequence_simulation

router = APIRouter()


@router.post("/simulation/run", response_model=WQSimulationRunOut)
async def run_water_quality_simulation(payload: WQSimulationRunIn) -> WQSimulationRunOut:
    total_minutes = payload.duration_hours * 60
    if payload.data_frequency_minutes <= 0:
        raise HTTPException(status_code=422, detail="data_frequency_minutes must be > 0")
    if payload.duration_hours <= 0:
        raise HTTPException(status_code=422, detail="duration_hours must be > 0")
    if payload.detection_window_size < 2:
        raise HTTPException(status_code=422, detail="detection_window_size must be >= 2")
    if payload.event_start_time_minutes < 0 or payload.event_start_time_minutes > total_minutes:
        raise HTTPException(status_code=422, detail="event_start_time_minutes must be within duration")
    if payload.event_duration_minutes <= 0:
        raise HTTPException(status_code=422, detail="event_duration_minutes must be > 0")
    if payload.event_start_time_minutes + payload.event_duration_minutes > total_minutes:
        raise HTTPException(status_code=422, detail="event window must fit within duration")
    if payload.baseline_ph < 0 or payload.baseline_ph > 14:
        raise HTTPException(status_code=422, detail="baseline_ph must be within [0, 14]")
    if payload.baseline_turbidity_ntu < 0:
        raise HTTPException(status_code=422, detail="baseline_turbidity_ntu must be >= 0")
    if payload.baseline_chlorine_mg_l < 0:
        raise HTTPException(status_code=422, detail="baseline_chlorine_mg_l must be >= 0")

    simulation_id = str(uuid.uuid4())

    generated_readings, detection_results, summary = run_sequence_simulation(
        simulation_id=simulation_id,
        payload=payload,
    )

    return WQSimulationRunOut(
        simulation_id=simulation_id,
        generated_readings=[WQGeneratedReading(**r) for r in generated_readings],
        detection_results=[WQDetectionResult(**r) for r in detection_results],
        summary=WQSimulationSummary(**summary),
    )
