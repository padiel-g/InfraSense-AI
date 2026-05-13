"""
FastAPI router for the Gweru City water infrastructure monitoring feature.

Register in main.py with:
    app.include_router(water_router, prefix="/api/water", tags=["Water Monitoring"])

Routes:
    GET  /api/water/zones               — live zone state for all 5 zones
    POST /api/water/tick                — advance simulation by one tick
    POST /api/water/inject              — inject / cancel anomaly in a zone
    POST /api/water/detect              — manual sensor entry + instant detection
    GET  /api/water/incidents           — paginated incident log
    DELETE /api/water/incidents/{id}    — delete one incident
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.detection import classify_manual
from app.models.water_monitor import WaterIncident, WaterSensorReading
from app.schemas.water_monitor import (
    WaterDetectionResult,
    WaterIncidentOut,
    WaterSensorReadingCreate,
)
from app.simulation import (
    ZONES,
    advance_tick,
    inject_anomaly,
    lstm_anomaly_score,
    water_quality_score,
    zone_anomaly,
    zone_windows,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _status(lstm: float, quality: float) -> str:
    if lstm > 0.65 or quality > 0.65:
        return "critical"
    if lstm > 0.35 or quality > 0.35:
        return "warning"
    return "normal"


# ---------------------------------------------------------------------------
# GET /zones
# ---------------------------------------------------------------------------

@router.get("/zones")
async def get_zones() -> list[dict]:
    """
    Returns the current live state for all 5 Gweru zones from in-memory state.
    No DB query — reads zone_windows and zone_anomaly directly.
    """
    results = []
    for zone in ZONES:
        zone_id = zone["id"]
        window = zone_windows[zone_id]

        lstm = lstm_anomaly_score(window) if len(window) >= 10 else 0.0
        quality = water_quality_score(window) if window else 0.0

        last = (
            window[-1]
            if window
            else {"flow_rate": 0.0, "pressure": 0.0, "turbidity": 0.0, "ph": 0.0}
        )
        anom = zone_anomaly[zone_id]
        active = anom["type"] if anom["ticks_remaining"] > 0 else None

        results.append(
            {
                "zone_id": zone_id,
                "zone_name": zone["name"],
                "current_reading": {
                    "flow_rate": last.get("flow_rate", 0.0),
                    "pressure": last.get("pressure", 0.0),
                    "turbidity": last.get("turbidity", 0.0),
                    "ph": last.get("ph", 0.0),
                },
                "lstm_score": lstm,
                "quality_score": quality,
                "active_anomaly": active,
                "status": _status(lstm, quality),
            }
        )
    return results


# ---------------------------------------------------------------------------
# POST /tick
# ---------------------------------------------------------------------------

class _TickBody(BaseModel):
    tick: int


@router.post("/tick")
async def tick_simulation(
    body: _TickBody,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Advance the simulation by one tick.
    Frontend polls this every ~1 500 ms.
    """
    return await advance_tick(body.tick, db)


# ---------------------------------------------------------------------------
# POST /inject
# ---------------------------------------------------------------------------

class _InjectBody(BaseModel):
    zone_id: str
    anomaly_type: str


@router.post("/inject")
async def inject_zone_anomaly(body: _InjectBody) -> dict:
    """
    Inject (or toggle off) an anomaly into a zone.
    Calling with the same anomaly_type that is already active cancels it.
    """
    valid_ids = {z["id"] for z in ZONES}
    if body.zone_id not in valid_ids:
        raise HTTPException(status_code=404, detail=f"Zone '{body.zone_id}' not found.")

    valid_types = {"leak", "overflow", "contamination"}
    if body.anomaly_type not in valid_types:
        raise HTTPException(
            status_code=422,
            detail=f"anomaly_type must be one of {sorted(valid_types)}.",
        )

    result_type = inject_anomaly(body.zone_id, body.anomaly_type)
    return {
        "status": "ok",
        "zone_id": body.zone_id,
        "anomaly_type": result_type,   # None when cancelled
    }


# ---------------------------------------------------------------------------
# POST /detect  (manual entry)
# ---------------------------------------------------------------------------

@router.post("/detect", response_model=WaterDetectionResult)
async def manual_detect(
    body: WaterSensorReadingCreate,
    db: AsyncSession = Depends(get_db),
) -> WaterDetectionResult:
    """
    Accept a manual sensor reading, run instant rule-based detection, persist
    both the reading and any non-normal incident, then return the result.
    """
    from datetime import datetime, timezone

    result = classify_manual(body.flow_rate, body.pressure, body.turbidity, body.ph)

    # Persist sensor reading
    reading = WaterSensorReading(
        zone_id=body.zone_id,
        zone_name=body.zone_name,
        timestamp=datetime.now(timezone.utc),
        flow_rate=body.flow_rate,
        pressure=body.pressure,
        turbidity=body.turbidity,
        ph=body.ph,
        source="manual",
    )
    db.add(reading)

    # Persist incident only when something is detected
    if result.incident_type != "normal":
        db.add(
            WaterIncident(
                timestamp=datetime.now(timezone.utc),
                zone_id=body.zone_id,
                zone_name=body.zone_name,
                incident_type=result.incident_type,
                confidence=result.confidence,
                lstm_score=result.lstm_score,
                quality_score=result.quality_score,
                indicators=result.indicators,
                recommendation=result.recommendation,
                source="manual",
            )
        )

    return WaterDetectionResult(
        incident_type=result.incident_type,
        confidence=result.confidence,
        lstm_score=result.lstm_score,
        quality_score=result.quality_score,
        indicators=result.indicators,
        recommendation=result.recommendation,
    )


# ---------------------------------------------------------------------------
# GET /incidents
# ---------------------------------------------------------------------------

@router.get("/incidents", response_model=List[WaterIncidentOut])
async def list_incidents(
    skip: int = 0,
    limit: int = 50,
    source: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[WaterIncident]:
    """
    Paginated incident log ordered by timestamp DESC.
    Optional ?source=manual|simulation filter.
    """
    stmt = select(WaterIncident).order_by(desc(WaterIncident.timestamp))
    if source:
        stmt = stmt.where(WaterIncident.source == source)
    stmt = stmt.offset(skip).limit(limit)

    rows = await db.execute(stmt)
    return rows.scalars().all()


# ---------------------------------------------------------------------------
# DELETE /incidents/{incident_id}
# ---------------------------------------------------------------------------

@router.delete("/incidents/{incident_id}")
async def delete_incident(
    incident_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete a single water incident by integer ID."""
    row = await db.execute(
        select(WaterIncident).where(WaterIncident.id == incident_id)
    )
    incident = row.scalar_one_or_none()
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found.")
    await db.delete(incident)
    return {"status": "deleted"}
