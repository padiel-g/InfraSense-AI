"""FastAPI routes for /api/v1/water-quality/*"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

from app.ml.water_quality import get_water_quality_detector
from app.schemas.water_quality import (
    WQManualEntryIn, WQManualEntryOut, WQReadings,
    WQSimulateIn, WQSimulateOut, WQSimReading, WQSimSummary,
    WQThresholds,
)
from app.services.water_quality_simulation import (
    detect_one, message_for, simulate, simulate_enhanced,
)

router = APIRouter()


@router.post("/manual-entry", response_model=WQManualEntryOut)
async def manual_entry(payload: WQManualEntryIn) -> WQManualEntryOut:
    detector = get_water_quality_detector()
    result = detect_one(
        detector,
        sensor_id=payload.sensor_id,
        turbidity=payload.turbidity_ntu,
        ph=payload.ph,
        flow=payload.flow_rate_lps,
        pressure=payload.pressure_kpa,
        chlorine=payload.residual_chlorine_mg_l,
        conductivity=payload.conductivity_us_cm,
        pipe_age=payload.pipe_age_years,
        pipe_material=payload.pipe_material,
    )
    return WQManualEntryOut(
        id=str(uuid.uuid4()),
        sensor_id=payload.sensor_id,
        timestamp=payload.timestamp or datetime.now(timezone.utc),
        readings=WQReadings(
            turbidity_ntu=payload.turbidity_ntu,
            ph=payload.ph,
            flow_rate_lps=payload.flow_rate_lps,
            pressure_kpa=payload.pressure_kpa,
            residual_chlorine_mg_l=payload.residual_chlorine_mg_l,
            conductivity_us_cm=payload.conductivity_us_cm,
        ),
        anomaly_detected=result["is_anomaly"],
        anomaly_type=result["anomaly_type"],
        confidence_score=round(result["confidence"], 3),
        severity=result["severity"],
        corrosion_risk_score=round(result["corrosion_risk"], 3),
        message=message_for(result),
    )


@router.post("/simulate", response_model=WQSimulateOut)
async def run_simulation(payload: WQSimulateIn) -> WQSimulateOut:
    sensor_id = payload.sensor_id or f"sim-{uuid.uuid4().hex[:8]}"
    n = max(1, (payload.duration_hours * 60) // payload.interval_minutes)
    
    # Prepare baseline dict
    baseline = {
        "turbidity": payload.baseline_turbidity_ntu,
        "ph": payload.baseline_ph,
        "flow_lps": payload.baseline_flow_lps,
        "pressure_kpa": payload.baseline_pressure_kpa,
        "temperature_c": payload.baseline_temperature_c,
        "chlorine_mg_l": payload.baseline_chlorine_mg_l,
        "conductivity_us_cm": payload.baseline_conductivity_us_cm,
    }
    
    # Prepare rates dict
    rates = {
        "turbidity_increase": payload.turbidity_increase_rate,
        "pressure_drop": payload.pressure_drop_rate_kpa_per_step,
        "flow_change": payload.flow_change_rate_lps_per_step,
        "ph_change": payload.ph_change_rate,
        "chlorine_decay": payload.chlorine_decay_rate,
        "conductivity_increase": payload.conductivity_increase_rate,
    }
    
    # Run enhanced simulation
    readings, summary, event_start_time, first_detection_time = simulate_enhanced(
        scenario=payload.scenario,
        n=n,
        interval_min=payload.interval_minutes,
        noise=payload.noise_level,
        sensor_id=sensor_id,
        pipe_age=payload.pipe_age_years,
        pipe_material=payload.pipe_material,
        baseline=baseline,
        event_start_minutes=payload.event_start_time_minutes,
        event_duration_minutes=payload.event_duration_minutes,
        event_severity=payload.event_severity,
        rates=rates,
        detection_window_size=payload.detection_window_size,
        seed=payload.random_seed,
    )
    
    # Calculate detection latency
    detection_latency_minutes = None
    if event_start_time and first_detection_time:
        delta = first_detection_time - event_start_time
        detection_latency_minutes = round(delta.total_seconds() / 60, 2)
    
    return WQSimulateOut(
        simulation_id=str(uuid.uuid4()),
        sensor_id=sensor_id,
        scenario=payload.scenario,
        total_readings=len(readings),
        anomalies_detected=sum(1 for r in readings if r["anomaly_detected"]),
        detection_accuracy=summary["accuracy"],
        event_start_time=event_start_time,
        first_detection_time=first_detection_time,
        detection_latency_minutes=detection_latency_minutes,
        readings=[WQSimReading(**r) for r in readings],
        summary=WQSimSummary(**summary),
    )


@router.get("/thresholds", response_model=WQThresholds)
async def get_thresholds() -> WQThresholds:
    """Return the configured detection thresholds for the UI."""
    return WQThresholds()
