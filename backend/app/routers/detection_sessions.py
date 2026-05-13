from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.detection_session import DetectionResult as DetectionResultModel
from app.models.detection_session import DetectionSession
from app.models.enums import SensorType
from app.models.sensor_reading import SensorReading
from app.schemas.detection_session import (
    DetectionResultOut,
    DetectionSessionCreate,
    DetectionSessionHistoryOut,
    DetectionSessionOut,
    SessionReadingCreate,
    SessionReadingOut,
)
from app.services.sequence_detection import run_sequence_detection

router = APIRouter()
settings = get_settings()


@router.post("/sessions", response_model=DetectionSessionOut, status_code=201)
async def create_session(
    payload: Optional[DetectionSessionCreate] = Body(default=None),
    db: AsyncSession = Depends(get_db),
) -> DetectionSession:
    payload = payload or DetectionSessionCreate()
    session = DetectionSession(**payload.model_dump())
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


@router.get("/sessions", response_model=list[DetectionSessionHistoryOut])
async def list_sessions(db: AsyncSession = Depends(get_db)) -> list[DetectionSessionHistoryOut]:
    result = await db.execute(select(DetectionSession).order_by(DetectionSession.created_at.desc()))
    sessions = result.scalars().all()
    rows: list[DetectionSessionHistoryOut] = []

    for session in sessions:
        readings_result = await db.execute(
            select(SensorReading)
            .where(SensorReading.session_id == session.id)
            .order_by(SensorReading.timestamp.asc())
        )
        readings = readings_result.scalars().all()
        latest_reading = readings[-1] if readings else None

        result_row = await db.execute(
            select(DetectionResultModel)
            .where(DetectionResultModel.session_id == session.id)
            .order_by(DetectionResultModel.created_at.desc())
            .limit(1)
        )
        latest_result = result_row.scalars().first()

        rows.append(
            DetectionSessionHistoryOut(
                session_id=session.id,
                number_of_readings=len(readings),
                latest_pressure=latest_reading.pressure_kpa if latest_reading else None,
                latest_flow=_reading_flow(latest_reading) if latest_reading else None,
                latest_valve_status=latest_reading.valve_status if latest_reading else None,
                latest_tank_level=latest_reading.tank_level_percent if latest_reading else None,
                result=(latest_result.prediction or latest_result.status) if latest_result else None,
                confidence=latest_result.confidence if latest_result else None,
                latest_timestamp=latest_reading.timestamp if latest_reading else None,
            )
        )

    return rows


@router.post("/sessions/{session_id}/readings", response_model=SessionReadingOut, status_code=201)
async def add_session_reading(
    session_id: str,
    payload: SessionReadingCreate,
    db: AsyncSession = Depends(get_db),
) -> SensorReading:
    session = await _get_session_or_404(db, session_id)

    reading = SensorReading(
        session_id=session.id,
        sensor_id=payload.sensor_id,
        sensor_type=SensorType.flow,
        timestamp=payload.timestamp,
        pressure_kpa=payload.pressure_kpa,
        pressure_bar=payload.pressure_kpa / 100.0,
        flow_lps=payload.flow_lps,
        flow_rate_lps=payload.flow_lps,
        acoustic_db=payload.acoustic_db,
        soil_moisture_percent=payload.soil_moisture_percent,
        valve_status=payload.valve_status,
        tank_level_percent=payload.tank_level_percent,
        pipe_zone=payload.pipe_zone,
    )
    db.add(reading)

    if not session.sensor_id:
        session.sensor_id = payload.sensor_id
    if not session.pipe_zone and payload.pipe_zone:
        session.pipe_zone = payload.pipe_zone
    session.updated_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(reading)
    return reading


@router.get("/sessions/{session_id}/readings", response_model=list[SessionReadingOut])
async def get_session_readings(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[SensorReading]:
    await _get_session_or_404(db, session_id)
    result = await db.execute(
        select(SensorReading)
        .where(SensorReading.session_id == session_id)
        .order_by(SensorReading.timestamp.asc())
    )
    return result.scalars().all()


@router.post("/sessions/{session_id}/detect", response_model=DetectionResultOut)
async def detect_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> DetectionResultModel:
    await _get_session_or_404(db, session_id)
    readings_result = await db.execute(
        select(SensorReading)
        .where(SensorReading.session_id == session_id)
        .order_by(SensorReading.timestamp.asc())
    )
    readings = readings_result.scalars().all()
    decision = run_sequence_detection(readings, settings.MIN_SEQUENCE_LENGTH)

    result = DetectionResultModel(
        session_id=session_id,
        status=decision.status,
        prediction=decision.prediction,
        confidence=decision.confidence,
        message=decision.message,
        reading_count=len(readings),
    )
    db.add(result)
    await db.flush()
    await db.refresh(result)
    return result


async def _get_session_or_404(db: AsyncSession, session_id: str) -> DetectionSession:
    result = await db.execute(select(DetectionSession).where(DetectionSession.id == session_id))
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Detection session not found")
    return session


def _reading_flow(reading: SensorReading) -> Optional[float]:
    if reading.flow_lps is not None:
        return reading.flow_lps
    return reading.flow_rate_lps
