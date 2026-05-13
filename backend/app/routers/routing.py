from __future__ import annotations

import logging
from math import asin, cos, radians, sin, sqrt
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("app.routing")
OSRM_BASE_URL = "https://router.project-osrm.org"

from app.database import get_db
from app.models.dumping_report import DumpingReport
from app.models.incident import Incident
from app.models.enums import DumpingStatus, IncidentStatus

router = APIRouter()

GWERU_CENTER = {"lat": -19.451, "lng": 29.816}
GWERU_BOUNDS = {
    "min_lat": -19.65,
    "max_lat": -19.25,
    "min_lng": 29.60,
    "max_lng": 30.05,
}
URBAN_SPEED_KMH = 30


CREWS: dict[str, dict] = {
    "crew-1": {
        "id": "crew-1",
        "name": "Team Alpha",
        "department": "solid_waste",
        "status": "available",
        "latitude": -19.456,
        "longitude": 29.818,
    },
    "crew-2": {
        "id": "crew-2",
        "name": "Team Bravo",
        "department": "solid_waste",
        "status": "available",
        "latitude": -19.439,
        "longitude": 29.806,
    },
    "crew-3": {
        "id": "crew-3",
        "name": "Team Charlie",
        "department": "water",
        "status": "on-site",
        "latitude": -19.472,
        "longitude": 29.832,
    },
    "crew-4": {
        "id": "crew-4",
        "name": "Team Delta",
        "department": "solid_waste",
        "status": "off-duty",
        "latitude": None,
        "longitude": None,
    },
}


class Point(BaseModel):
    lat: float
    lng: float


class ShortestRouteRequest(BaseModel):
    incident_id: str
    crew_id: Optional[str] = None
    origin: Optional[Point] = None


class AssignCrewRequest(BaseModel):
    incident_id: str


def _inside_gweru(lat: Optional[float], lng: Optional[float]) -> bool:
    if lat is None or lng is None:
        return False
    return (
        GWERU_BOUNDS["min_lat"] <= lat <= GWERU_BOUNDS["max_lat"]
        and GWERU_BOUNDS["min_lng"] <= lng <= GWERU_BOUNDS["max_lng"]
    )


def _haversine_km(a: Point, b: Point) -> float:
    radius_km = 6371.0
    d_lat = radians(b.lat - a.lat)
    d_lng = radians(b.lng - a.lng)
    lat1 = radians(a.lat)
    lat2 = radians(b.lat)
    h = sin(d_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(d_lng / 2) ** 2
    return 2 * radius_km * asin(sqrt(h))


def _duration_min(distance_km: float) -> float:
    return (distance_km / URBAN_SPEED_KMH) * 60


def _crew_point(crew: dict) -> Optional[Point]:
    lat = crew.get("latitude")
    lng = crew.get("longitude")
    if lat is None or lng is None:
        return None
    return Point(lat=lat, lng=lng)


class _IncidentLike:
    """Lightweight adapter that exposes (id, latitude, longitude, status,
    description, image_url, created_at) regardless of whether the row
    came from `dumping_reports` or `incidents`. Lets the rest of this
    router stay agnostic of which table backed the report id."""

    __slots__ = (
        "id",
        "latitude",
        "longitude",
        "description",
        "image_url",
        "created_at",
        "_kind",
        "_obj",
    )

    def __init__(self, obj, kind: str):
        self._obj = obj
        self._kind = kind  # "dumping" or "incident"
        self.id = obj.id
        self.latitude = obj.latitude
        self.longitude = obj.longitude
        self.description = getattr(obj, "description", None)
        self.image_url = getattr(obj, "image_url", None)
        self.created_at = (
            getattr(obj, "detected_at", None) or getattr(obj, "reported_at", None)
        )

    @property
    def status(self):
        return self._obj.status

    def mark_assigned(self) -> None:
        if self._kind == "dumping":
            self._obj.status = DumpingStatus.assigned
        else:
            self._obj.status = IncidentStatus.assigned

    @property
    def kind(self) -> str:
        return self._kind


async def _get_report(db: AsyncSession, incident_id: str) -> _IncidentLike:
    """Look the report up in dumping_reports first (legacy id space), then
    in incidents (resident-portal general reports). 404 only if neither has it.
    """
    dumping = (
        await db.execute(select(DumpingReport).where(DumpingReport.id == incident_id))
    ).scalar_one_or_none()
    if dumping is not None:
        return _IncidentLike(dumping, "dumping")

    incident = (
        await db.execute(select(Incident).where(Incident.id == incident_id))
    ).scalar_one_or_none()
    if incident is not None:
        return _IncidentLike(incident, "incident")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")


def _recommend_crew(destination: Point) -> Optional[dict]:
    candidates = []
    for crew in CREWS.values():
        point = _crew_point(crew)
        if crew["status"] != "available" or point is None or not _inside_gweru(point.lat, point.lng):
            continue
        distance = _haversine_km(point, destination)
        candidates.append((distance, crew))

    if not candidates:
        return None

    distance, crew = min(candidates, key=lambda item: item[0])
    return {
        "id": crew["id"],
        "name": crew["name"],
        "eta_min": round(_duration_min(distance), 1),
        "distance_km": round(distance, 2),
    }


@router.get("/crews")
async def list_crews():
    return list(CREWS.values())


@router.post("/routing/shortest-route")
async def shortest_route(
    body: ShortestRouteRequest,
    db: AsyncSession = Depends(get_db),
):
    report = await _get_report(db, body.incident_id)
    destination = Point(lat=report.latitude, lng=report.longitude)
    warnings: list[str] = []

    if not _inside_gweru(destination.lat, destination.lng):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This route is outside the supported Gweru service area.",
        )

    origin: Optional[Point] = None
    if body.crew_id:
        crew = CREWS.get(body.crew_id)
        if not crew:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crew not found")
        origin = _crew_point(crew)
    elif body.origin:
        origin = body.origin

    if origin is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select a crew or enter the current crew location.",
        )

    if not _inside_gweru(origin.lat, origin.lng):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This route is outside the supported Gweru service area.",
        )

    distance = _haversine_km(origin, destination)
    warnings.append("Could not calculate road route. Showing approximate route.")

    recommended = _recommend_crew(destination)
    if recommended is None:
        warnings.append("No available crew with a known location is available.")

    return {
        "route": {
            "geometry": [
                [origin.lng, origin.lat],
                [destination.lng, destination.lat],
            ],
            "distance_km": round(distance, 2),
            "duration_min": round(_duration_min(distance), 1),
            "is_approximate": True,
        },
        "origin": origin.model_dump(),
        "destination": destination.model_dump(),
        "recommended_crew": recommended,
        "warnings": warnings,
    }


@router.get("/routing/shortest-route")
async def shortest_route_osrm(
    start_lat: float = Query(..., ge=-90, le=90),
    start_lng: float = Query(..., ge=-180, le=180),
    end_lat:   float = Query(..., ge=-90, le=90),
    end_lng:   float = Query(..., ge=-180, le=180),
):
    """Driving route between two coordinates via the public OSRM server.

    Used by the Crew Routing page to draw the shortest road route from
    the crew's current location to the selected incident. Returns a
    GeoJSON LineString plus distance / duration so the frontend can both
    render the path and show an ETA.

    Failure modes are mapped to clean HTTP responses so the frontend can
    display a sensible message:
      * 422 — same start/end or invalid pair
      * 404 — OSRM responded but found no route between the points
      * 502 — OSRM unreachable / timed out / returned a transport error
    """
    if (start_lat, start_lng) == (end_lat, end_lng):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Start and end coordinates are identical.",
        )

    # OSRM expects lng,lat (the order is non-obvious — OSRM uses x,y).
    coords = f"{start_lng},{start_lat};{end_lng},{end_lat}"
    url = f"{OSRM_BASE_URL}/route/v1/driving/{coords}"
    params = {"overview": "full", "geometries": "geojson", "steps": "false"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("OSRM unreachable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Routing service is currently unavailable. Please try again.",
        )

    if resp.status_code >= 500:
        logger.warning("OSRM 5xx: %s %s", resp.status_code, resp.text[:200])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Routing service returned an error. Please try again.",
        )

    try:
        payload: dict[str, Any] = resp.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Routing service returned an invalid response.",
        )

    if payload.get("code") != "Ok" or not payload.get("routes"):
        # OSRM uses "NoRoute"/"NoSegment" for unroutable pairs — surface
        # as 404 so the UI can show "no route found" specifically.
        message = payload.get("message") or "No route found between the selected points."
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)

    primary = payload["routes"][0]
    distance_m = float(primary.get("distance", 0.0))
    duration_s = float(primary.get("duration", 0.0))

    return {
        "start": {"lat": start_lat, "lng": start_lng},
        "end":   {"lat": end_lat,   "lng": end_lng},
        "distance_km":   round(distance_m / 1000.0, 3),
        "duration_min":  round(duration_s / 60.0, 1),
        "distance_meters":  distance_m,
        "duration_seconds": duration_s,
        # Full GeoJSON LineString for direct consumption by Leaflet's
        # L.geoJSON() / react-leaflet's <GeoJSON /> component.
        "geometry": primary.get("geometry"),
        "provider": "osrm",
    }


@router.post("/crews/{crew_id}/assign")
async def assign_crew(
    crew_id: str,
    body: AssignCrewRequest,
    db: AsyncSession = Depends(get_db),
):
    crew = CREWS.get(crew_id)
    if not crew:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crew not found")
    if crew["status"] == "off-duty":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot assign an off-duty crew")

    report = await _get_report(db, body.incident_id)
    if not _inside_gweru(report.latitude, report.longitude):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This route is outside the supported Gweru service area.",
        )

    crew["status"] = "en-route"
    report.mark_assigned()
    await db.flush()

    raw_status = report.status
    status_value = raw_status.value if hasattr(raw_status, "value") else raw_status

    return {
        "crew": crew,
        "incident": {
            "id": report.id,
            "title": report.description or (
                "Illegal dumping incident" if report.kind == "dumping" else "Municipal incident"
            ),
            "type": "illegal_dumping" if report.kind == "dumping" else "municipal_incident",
            "status": status_value,
            "latitude": report.latitude,
            "longitude": report.longitude,
            "created_at": report.created_at,
            "image_url": report.image_url,
        },
    }
