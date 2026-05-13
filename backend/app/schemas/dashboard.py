from datetime import datetime
from typing import Optional, Literal, Any

from pydantic import BaseModel, Field, field_validator


class DashboardSummary(BaseModel):
    total_assets: int
    high_risk_assets: int
    active_incidents: int
    anomalies_today: int
    dumping_reports_pending: int
    avg_response_time_hours: float
    nrw_percentage: Optional[float] = None


class RiskMapLayer(BaseModel):
    asset_id: str
    asset_type: str
    latitude: float
    longitude: float
    risk_score: float
    risk_category: str
    last_failure: Optional[datetime] = None


class AlertItem(BaseModel):
    id: str
    alert_type: str  # anomaly, risk, dumping
    severity: str
    message: str
    latitude: float
    longitude: float
    timestamp: datetime
    is_acknowledged: bool = False


class MapPoint(BaseModel):
    """A reusable latitude/longitude point for the dashboard map."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    label: Optional[str] = None
    address: Optional[str] = None


class GweruRouteRequest(BaseModel):
    """Request body for calculating the shortest route inside Gweru."""

    current_location: MapPoint
    destination: MapPoint

    route_profile: Literal["driving", "walking", "cycling"] = "driving"
    routing_provider: Literal["osrm", "openrouteservice", "graphhopper"] = "osrm"

    requested_by: Optional[str] = None

    @field_validator("current_location", "destination")
    @classmethod
    def validate_point_is_near_gweru(cls, point: MapPoint) -> MapPoint:
        """Quick schema-level validation for Gweru city bounding box.

        This is not a replacement for backend database validation using
        map_geofences. It only rejects clearly invalid coordinates early.
        """
        min_lat = -19.6000
        max_lat = -19.3000
        min_lng = 29.6500
        max_lng = 30.0000

        if not (min_lat <= point.latitude <= max_lat):
            raise ValueError("Location latitude must be within Gweru City.")

        if not (min_lng <= point.longitude <= max_lng):
            raise ValueError("Location longitude must be within Gweru City.")

        return point


class RouteStep(BaseModel):
    """Optional turn-by-turn route instruction."""

    instruction: str
    distance_meters: Optional[float] = None
    duration_seconds: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class GweruRouteResponse(BaseModel):
    """Response returned after calculating the shortest route."""

    route_id: Optional[int] = None

    start: MapPoint
    destination: MapPoint

    city: str = "Gweru"
    routing_provider: str
    route_profile: str

    distance_meters: float
    distance_km: float
    duration_seconds: float
    duration_minutes: float

    # Can be GeoJSON LineString, encoded polyline, or raw provider geometry.
    route_geometry: Any

    steps: list[RouteStep] = []

    message: str = "Shortest route calculated successfully within Gweru City."


class SavedMapLocation(BaseModel):
    """Location stored for dashboard map use."""

    id: Optional[int] = None
    label: Optional[str] = None

    location_type: Literal[
        "custom",
        "current_location",
        "destination",
        "incident",
        "asset",
        "dump_report",
        "sensor",
        "crew",
        "depot",
        "landmark",
    ] = "custom"

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    address: Optional[str] = None
    suburb: Optional[str] = None
    city: str = "Gweru"

    incident_id: Optional[int] = None
    asset_id: Optional[int] = None
    dumping_report_id: Optional[int] = None
    sensor_id: Optional[int] = None
    crew_id: Optional[int] = None

    source: str = "dashboard"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RouteHistoryItem(BaseModel):
    """Saved route request shown in dashboard route history."""

    id: int

    start_label: Optional[str] = None
    start_lat: float
    start_lng: float

    destination_label: Optional[str] = None
    destination_lat: float
    destination_lng: float

    city: str = "Gweru"
    routing_provider: str
    route_profile: str

    distance_meters: Optional[float] = None
    duration_seconds: Optional[float] = None

    status: str
    error_message: Optional[str] = None

    requested_by: Optional[str] = None
    created_at: datetime


class CrewRouting(BaseModel):
    crew_id: str
    crew_name: str
    current_latitude: float = Field(..., ge=-90, le=90)
    current_longitude: float = Field(..., ge=-180, le=180)
    assigned_incidents: list[str]

    # Ordered lat/lng waypoints for the crew route.
    optimized_route: list[dict]

    # Optional Gweru route summary.
    route_distance_meters: Optional[float] = None
    route_duration_seconds: Optional[float] = None
    route_geometry: Optional[Any] = None