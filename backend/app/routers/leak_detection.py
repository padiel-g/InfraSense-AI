"""FastAPI routes for /api/v1/leak-detection/*"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

from app.ml.leak_lstm import get_leak_lstm
from app.schemas.leak_detection import (
    LeakManualEntryIn, LeakManualEntryOut, LeakReadings,
    LeakModelStatusOut,
    LeakSimulateIn, LeakSimulateOut, LeakSimReading, LeakSimSummary,
)
from app.services.leak_simulation import manual_detect, message_for, simulate


router = APIRouter()


@router.post("/manual-entry", response_model=LeakManualEntryOut)
async def manual_entry(payload: LeakManualEntryIn) -> LeakManualEntryOut:
    service = get_leak_lstm()
    sample = {
        "pressure_kpa":       payload.pressure_kpa,
        "flow_rate_lps":      payload.flow_rate_lps,
        "acoustic_signal_db": payload.acoustic_signal_db if payload.acoustic_signal_db is not None else 38.0,
        "soil_moisture_pct":  payload.soil_moisture_pct  if payload.soil_moisture_pct  is not None else 28.0,
    }
    det = manual_detect(service, payload.sensor_id, sample)

    # Estimate latency from how full the rolling buffer is.
    buf = service._buffers.get(payload.sensor_id, [])
    if det["lstm_sequence_status"] == "warming_up":
        # window not yet full — predicted latency = how long until it fills
        est_latency = max(0.0, (service.window_size - len(buf)) * 5.0)
    elif det["is_anomaly"]:
        est_latency = 5.0  # detected immediately after a fresh sample
    else:
        est_latency = 0.0

    return LeakManualEntryOut(
        id=str(uuid.uuid4()),
        sensor_id=payload.sensor_id,
        timestamp=payload.timestamp or datetime.now(timezone.utc),
        readings=LeakReadings(
            pressure_kpa=payload.pressure_kpa,
            flow_rate_lps=payload.flow_rate_lps,
            acoustic_signal_db=payload.acoustic_signal_db,
            soil_moisture_pct=payload.soil_moisture_pct,
        ),
        anomaly_detected=det["is_anomaly"],
        anomaly_type=det["anomaly_type"],
        confidence_score=round(float(det["confidence"]), 3),
        severity=det["severity"],
        estimated_detection_latency_min=round(est_latency, 1),
        lstm_sequence_status=det["lstm_sequence_status"],
        message=message_for(det),
    )


@router.post("/simulate", response_model=LeakSimulateOut)
async def run_simulation(payload: LeakSimulateIn) -> LeakSimulateOut:
    sensor_id = payload.sensor_id or f"sim-{uuid.uuid4().hex[:8]}"
    n = max(1, (payload.duration_hours * 60) // payload.interval_minutes)

    readings, summary = simulate(
        scenario=payload.scenario, n=n,
        interval_min=payload.interval_minutes, noise=payload.noise_level,
        sensor_id=sensor_id, window_size=payload.lstm_window_size,
    )

    return LeakSimulateOut(
        simulation_id=str(uuid.uuid4()),
        sensor_id=sensor_id,
        scenario=payload.scenario,
        total_readings=len(readings),
        anomalies_detected=sum(1 for r in readings if r["anomaly_detected"]),
        readings=[LeakSimReading(**r) for r in readings],
        summary=LeakSimSummary(**summary),
    )


@router.get("/model-status", response_model=LeakModelStatusOut)
async def model_status() -> LeakModelStatusOut:
    service = get_leak_lstm()
    return LeakModelStatusOut(**service.meta)
