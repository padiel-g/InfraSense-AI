from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime

from app.database import get_db
from app.models.sensor_reading import SensorReading
from app.schemas.sensor import SensorReadingCreate, SensorReadingResponse, SensorBatchCreate
from app.services.anomaly_detection import AnomalyDetectionService
from app.auth import get_current_user

router = APIRouter()


@router.post("/readings", response_model=list[SensorReadingResponse], status_code=201)
async def ingest_readings(
    batch: SensorBatchCreate,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a batch of sensor readings and run anomaly detection."""
    anomaly_service = AnomalyDetectionService()
    created = []

    for reading_data in batch.readings:
        reading = SensorReading(**reading_data.model_dump())

        # Run anomaly detection
        anomaly_result = anomaly_service.check_reading(reading_data.model_dump())
        if anomaly_result["is_anomaly"]:
            reading.is_anomaly = True
            reading.anomaly_score = anomaly_result["score"]
            reading.anomaly_type = anomaly_result["type"]

        db.add(reading)
        created.append(reading)

    await db.flush()
    for r in created:
        await db.refresh(r)
    return created


@router.get("/readings", response_model=list[SensorReadingResponse])
async def get_readings(
    sensor_id: Optional[str] = None,
    sensor_type: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    anomalies_only: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=1000),
    db: AsyncSession = Depends(get_db),
):
    query = select(SensorReading).order_by(SensorReading.timestamp.desc())
    if sensor_id:
        query = query.where(SensorReading.sensor_id == sensor_id)
    if sensor_type:
        query = query.where(SensorReading.sensor_type == sensor_type)
    if start_time:
        query = query.where(SensorReading.timestamp >= start_time)
    if end_time:
        query = query.where(SensorReading.timestamp <= end_time)
    if anomalies_only:
        query = query.where(SensorReading.is_anomaly == True)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/anomalies/recent")
async def recent_anomalies(
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Get anomalies from the last N hours."""
    from datetime import timedelta
    from datetime import timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = (
        select(SensorReading)
        .where(SensorReading.is_anomaly == True, SensorReading.timestamp >= cutoff)
        .order_by(SensorReading.timestamp.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    readings = result.scalars().all()
    return [SensorReadingResponse.model_validate(r) for r in readings]
