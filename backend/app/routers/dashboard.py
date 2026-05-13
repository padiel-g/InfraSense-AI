from datetime import datetime, timedelta, timezone
import json
import hashlib
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db, is_point_inside_gweru
from app.models.asset import Asset
from app.models.incident import Incident
from app.models.sensor_reading import SensorReading
from app.models.dumping_report import DumpingReport
from app.schemas.dashboard import (
    DashboardSummary,
    RiskMapLayer,
    AlertItem,
    GweruRouteRequest,
    GweruRouteResponse,
    MapPoint,
    RouteHistoryItem,
)

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(db: AsyncSession = Depends(get_db)):
    today = datetime.now(timezone.utc) - timedelta(hours=24)

    stmt = select(
        select(func.count(Asset.id)).scalar_subquery().label("total_assets"),
        select(func.count(Asset.id))
        .where(Asset.risk_category.in_(["high", "critical"]))
        .scalar_subquery()
        .label("high_risk"),
        select(func.count(Incident.id))
        .where(Incident.status != "resolved")
        .scalar_subquery()
        .label("active_incidents"),
        select(func.count(SensorReading.id))
        .where(SensorReading.is_anomaly == True, SensorReading.timestamp >= today)
        .scalar_subquery()
        .label("anomalies_today"),
        select(func.count(DumpingReport.id))
        .where(DumpingReport.status.in_(["detected", "verified"]))
        .scalar_subquery()
        .label("pending_dumping"),
        select(func.avg(Incident.response_time_hours))
        .where(Incident.response_time_hours.isnot(None))
        .scalar_subquery()
        .label("avg_resp"),
    )

    row = (await db.execute(stmt)).one()

    return DashboardSummary(
        total_assets=row.total_assets or 0,
        high_risk_assets=row.high_risk or 0,
        active_incidents=row.active_incidents or 0,
        anomalies_today=row.anomalies_today or 0,
        dumping_reports_pending=row.pending_dumping or 0,
        avg_response_time_hours=round(float(row.avg_resp or 0.0), 2),
    )


@router.get("/risk-map", response_model=list[RiskMapLayer])
async def risk_map(
    suburb: str | None = None,
    min_risk: float = Query(0.0, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
):
    query = select(Asset).where(
        Asset.latitude.isnot(None),
        Asset.longitude.isnot(None),
        Asset.risk_score.isnot(None),
    )

    if suburb:
        query = query.where(Asset.suburb == suburb)

    if min_risk > 0:
        query = query.where(Asset.risk_score >= min_risk)

    query = query.order_by(Asset.risk_score.desc()).limit(500)

    result = await db.execute(query)
    assets = result.scalars().all()

    return [
        RiskMapLayer(
            asset_id=str(a.id),
            asset_type=a.asset_type,
            latitude=float(a.latitude),
            longitude=float(a.longitude),
            risk_score=float(a.risk_score),
            risk_category=(a.risk_category or "unknown").lower(),
            last_failure=None,
        )
        for a in assets
    ]


@router.get("/alerts", response_model=list[AlertItem])
async def get_alerts(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    alerts: list[AlertItem] = []

    anomalies = await db.execute(
        select(SensorReading)
        .where(SensorReading.is_anomaly == True, SensorReading.timestamp >= cutoff)
        .order_by(SensorReading.timestamp.desc())
        .limit(50)
    )

    for a in anomalies.scalars().all():
        alerts.append(
            AlertItem(
                id=str(a.id),
                alert_type="anomaly",
                severity="high" if (a.anomaly_score or 0) > 0.8 else "medium",
                message=f"Anomaly detected on sensor {a.sensor_id}: {a.anomaly_type}",
                latitude=0.0,
                longitude=0.0,
                timestamp=a.timestamp,
            )
        )

    incidents = await db.execute(
        select(Incident)
        .where(
            Incident.reported_at >= cutoff,
            Incident.status != "resolved",
            Incident.latitude.isnot(None),
            Incident.longitude.isnot(None),
        )
        .order_by(Incident.reported_at.desc())
        .limit(50)
    )

    for i in incidents.scalars().all():
        alerts.append(
            AlertItem(
                id=str(i.id),
                alert_type="incident",
                severity=i.severity or "medium",
                message=f"{i.incident_type.replace('_', ' ').title()} reported at {i.address or 'unknown location'}",
                latitude=float(i.latitude),
                longitude=float(i.longitude),
                timestamp=i.reported_at,
            )
        )

    alerts.sort(key=lambda x: x.timestamp, reverse=True)
    return alerts


@router.post("/gweru-route", response_model=GweruRouteResponse)
async def calculate_gweru_shortest_route(
    payload: GweruRouteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Calculate the shortest route inside Gweru City only.

    The frontend should call this endpoint after the user enters:
    - current location
    - destination

    The response returns route geometry that can be drawn on Leaflet.
    """

    start = payload.current_location
    destination = payload.destination

    start_inside_gweru = await is_point_inside_gweru(
        db,
        start.latitude,
        start.longitude,
    )
    destination_inside_gweru = await is_point_inside_gweru(
        db,
        destination.latitude,
        destination.longitude,
    )

    if not start_inside_gweru:
        raise HTTPException(
            status_code=400,
            detail="Current location must be inside Gweru City.",
        )

    if not destination_inside_gweru:
        raise HTTPException(
            status_code=400,
            detail="Destination must be inside Gweru City.",
        )

    cache_key = _build_route_cache_key(
        start_lat=start.latitude,
        start_lng=start.longitude,
        destination_lat=destination.latitude,
        destination_lng=destination.longitude,
        provider=payload.routing_provider,
        profile=payload.route_profile,
    )

    cached_route = await _get_cached_route(db, cache_key)

    if cached_route:
        return GweruRouteResponse(
            route_id=None,
            start=start,
            destination=destination,
            city="Gweru",
            routing_provider=payload.routing_provider,
            route_profile=payload.route_profile,
            distance_meters=float(cached_route["distance_meters"]),
            distance_km=round(float(cached_route["distance_meters"]) / 1000, 2),
            duration_seconds=float(cached_route["duration_seconds"]),
            duration_minutes=round(float(cached_route["duration_seconds"]) / 60, 1),
            route_geometry=json.loads(cached_route["route_geometry"]),
            steps=[],
            message="Shortest route loaded from cache.",
        )

    try:
        route_data = await _calculate_route_with_osrm(
            start_lat=start.latitude,
            start_lng=start.longitude,
            destination_lat=destination.latitude,
            destination_lng=destination.longitude,
            profile=payload.route_profile,
        )

        distance_meters = route_data["distance_meters"]
        duration_seconds = route_data["duration_seconds"]
        route_geometry = route_data["route_geometry"]

        route_id = await _save_route_request(
            db=db,
            start=start,
            destination=destination,
            provider=payload.routing_provider,
            profile=payload.route_profile,
            distance_meters=distance_meters,
            duration_seconds=duration_seconds,
            route_geometry=route_geometry,
            requested_by=payload.requested_by or _get_user_identifier(current_user),
            status="completed",
            error_message=None,
        )

        await _save_route_cache(
            db=db,
            cache_key=cache_key,
            start=start,
            destination=destination,
            provider=payload.routing_provider,
            profile=payload.route_profile,
            distance_meters=distance_meters,
            duration_seconds=duration_seconds,
            route_geometry=route_geometry,
        )

        return GweruRouteResponse(
            route_id=route_id,
            start=start,
            destination=destination,
            city="Gweru",
            routing_provider=payload.routing_provider,
            route_profile=payload.route_profile,
            distance_meters=distance_meters,
            distance_km=round(distance_meters / 1000, 2),
            duration_seconds=duration_seconds,
            duration_minutes=round(duration_seconds / 60, 1),
            route_geometry=route_geometry,
            steps=[],
            message="Shortest route calculated successfully within Gweru City.",
        )

    except HTTPException:
        raise

    except Exception as exc:
        await _save_route_request(
            db=db,
            start=start,
            destination=destination,
            provider=payload.routing_provider,
            profile=payload.route_profile,
            distance_meters=None,
            duration_seconds=None,
            route_geometry=None,
            requested_by=payload.requested_by or _get_user_identifier(current_user),
            status="failed",
            error_message=str(exc),
        )

        raise HTTPException(
            status_code=502,
            detail="Failed to calculate route. Please try again.",
        ) from exc


@router.get("/gweru-route/history", response_model=list[RouteHistoryItem])
async def get_gweru_route_history(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    result = await db.execute(
        text(
            """
            SELECT
                id,
                start_label,
                start_lat,
                start_lng,
                destination_label,
                destination_lat,
                destination_lng,
                city,
                routing_provider,
                route_profile,
                distance_meters,
                duration_seconds,
                status,
                error_message,
                requested_by,
                created_at
            FROM route_requests
            WHERE city = 'Gweru'
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        {"limit": limit},
    )

    rows = result.mappings().all()

    return [
        RouteHistoryItem(
            id=row["id"],
            start_label=row["start_label"],
            start_lat=float(row["start_lat"]),
            start_lng=float(row["start_lng"]),
            destination_label=row["destination_label"],
            destination_lat=float(row["destination_lat"]),
            destination_lng=float(row["destination_lng"]),
            city=row["city"],
            routing_provider=row["routing_provider"],
            route_profile=row["route_profile"],
            distance_meters=(
                float(row["distance_meters"])
                if row["distance_meters"] is not None
                else None
            ),
            duration_seconds=(
                float(row["duration_seconds"])
                if row["duration_seconds"] is not None
                else None
            ),
            status=row["status"],
            error_message=row["error_message"],
            requested_by=row["requested_by"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


async def _calculate_route_with_osrm(
    start_lat: float,
    start_lng: float,
    destination_lat: float,
    destination_lng: float,
    profile: str,
) -> dict:
    """Calculate shortest route using OSRM.

    OSRM coordinate order is:
    longitude,latitude
    """

    if profile not in {"driving", "walking", "cycling"}:
        profile = "driving"

    # Public OSRM mainly supports driving well.
    # Walking/cycling may require your own OSRM server later.
    osrm_profile = "driving" if profile in {"driving", "walking", "cycling"} else "driving"

    url = (
        f"https://router.project-osrm.org/route/v1/{osrm_profile}/"
        f"{start_lng},{start_lat};{destination_lng},{destination_lat}"
    )

    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "alternatives": "false",
    }

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, params=params)

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Routing provider failed to return a valid route.",
        )

    data = response.json()

    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(
            status_code=404,
            detail="No route found between the selected Gweru locations.",
        )

    route = data["routes"][0]

    return {
        "distance_meters": float(route["distance"]),
        "duration_seconds": float(route["duration"]),
        "route_geometry": route["geometry"],
    }


def _build_route_cache_key(
    start_lat: float,
    start_lng: float,
    destination_lat: float,
    destination_lng: float,
    provider: str,
    profile: str,
) -> str:
    raw_key = (
        f"{provider}:{profile}:"
        f"{round(start_lat, 5)},{round(start_lng, 5)}:"
        f"{round(destination_lat, 5)},{round(destination_lng, 5)}"
    )

    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


async def _get_cached_route(
    db: AsyncSession,
    cache_key: str,
) -> dict | None:
    result = await db.execute(
        text(
            """
            SELECT
                distance_meters,
                duration_seconds,
                route_geometry
            FROM route_cache
            WHERE cache_key = :cache_key
              AND (
                    expires_at IS NULL
                    OR expires_at > CURRENT_TIMESTAMP
                  )
            LIMIT 1
            """
        ),
        {"cache_key": cache_key},
    )

    row = result.mappings().first()
    return dict(row) if row else None


async def _save_route_cache(
    db: AsyncSession,
    cache_key: str,
    start: MapPoint,
    destination: MapPoint,
    provider: str,
    profile: str,
    distance_meters: float,
    duration_seconds: float,
    route_geometry: dict,
) -> None:
    await db.execute(
        text(
            """
            INSERT OR REPLACE INTO route_cache (
                cache_key,
                start_lat,
                start_lng,
                destination_lat,
                destination_lng,
                routing_provider,
                route_profile,
                distance_meters,
                duration_seconds,
                route_geometry,
                created_at,
                expires_at
            )
            VALUES (
                :cache_key,
                :start_lat,
                :start_lng,
                :destination_lat,
                :destination_lng,
                :routing_provider,
                :route_profile,
                :distance_meters,
                :duration_seconds,
                :route_geometry,
                CURRENT_TIMESTAMP,
                DATETIME(CURRENT_TIMESTAMP, '+1 day')
            )
            """
        ),
        {
            "cache_key": cache_key,
            "start_lat": start.latitude,
            "start_lng": start.longitude,
            "destination_lat": destination.latitude,
            "destination_lng": destination.longitude,
            "routing_provider": provider,
            "route_profile": profile,
            "distance_meters": distance_meters,
            "duration_seconds": duration_seconds,
            "route_geometry": json.dumps(route_geometry),
        },
    )


async def _save_route_request(
    db: AsyncSession,
    start: MapPoint,
    destination: MapPoint,
    provider: str,
    profile: str,
    distance_meters: float | None,
    duration_seconds: float | None,
    route_geometry: dict | None,
    requested_by: str | None,
    status: str,
    error_message: str | None,
) -> int:
    result = await db.execute(
        text(
            """
            INSERT INTO route_requests (
                start_label,
                start_lat,
                start_lng,
                destination_label,
                destination_lat,
                destination_lng,
                city,
                routing_provider,
                route_profile,
                distance_meters,
                duration_seconds,
                route_geometry,
                status,
                error_message,
                requested_by,
                created_at
            )
            VALUES (
                :start_label,
                :start_lat,
                :start_lng,
                :destination_label,
                :destination_lat,
                :destination_lng,
                'Gweru',
                :routing_provider,
                :route_profile,
                :distance_meters,
                :duration_seconds,
                :route_geometry,
                :status,
                :error_message,
                :requested_by,
                CURRENT_TIMESTAMP
            )
            """
        ),
        {
            "start_label": start.label,
            "start_lat": start.latitude,
            "start_lng": start.longitude,
            "destination_label": destination.label,
            "destination_lat": destination.latitude,
            "destination_lng": destination.longitude,
            "routing_provider": provider,
            "route_profile": profile,
            "distance_meters": distance_meters,
            "duration_seconds": duration_seconds,
            "route_geometry": json.dumps(route_geometry) if route_geometry else None,
            "status": status,
            "error_message": error_message,
            "requested_by": requested_by,
        },
    )

    return int(result.lastrowid or 0)


def _get_user_identifier(current_user: Any) -> str | None:
    if current_user is None:
        return None

    if isinstance(current_user, dict):
        return (
            current_user.get("email")
            or current_user.get("username")
            or current_user.get("id")
        )

    return (
        getattr(current_user, "email", None)
        or getattr(current_user, "username", None)
        or str(getattr(current_user, "id", ""))
        or None
    )