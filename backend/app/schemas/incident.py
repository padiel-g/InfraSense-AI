from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime
from app.models.enums import IncidentType, Severity, IncidentStatus, IncidentSource


class IncidentCreate(BaseModel):
    incident_type: IncidentType
    severity: Optional[Severity] = Severity.medium
    status: Optional[IncidentStatus] = IncidentStatus.reported
    description: Optional[str] = None
    source: Optional[IncidentSource] = IncidentSource.citizen
    latitude: float
    longitude: float
    address: Optional[str] = None
    suburb: Optional[str] = None
    ward: Optional[str] = None
    asset_id: Optional[str] = None
    reported_by: Optional[str] = None
    reporter_phone: Optional[str] = None
    assigned_to: Optional[str] = None
    model_confidence: Optional[float] = None


class IncidentUpdate(BaseModel):
    incident_type: Optional[IncidentType] = None
    severity: Optional[Severity] = None
    status: Optional[IncidentStatus] = None
    description: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    ward: Optional[str] = None
    asset_id: Optional[str] = None
    assigned_to: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    model_confidence: Optional[float] = None


class IncidentResponse(BaseModel):
    id: str
    incident_type: IncidentType
    issue_type: Optional[str] = None
    severity: Severity
    status: IncidentStatus
    description: Optional[str]
    source: IncidentSource
    latitude: float
    longitude: float
    address: Optional[str]
    suburb: Optional[str]
    ward: Optional[str]
    asset_id: Optional[str]
    reported_by: Optional[str]
    reporter_name: Optional[str] = None
    reporter_email: Optional[str] = None
    reporter_phone: Optional[str]
    assigned_to: Optional[str]
    image_url: Optional[str] = None
    reported_at: datetime
    acknowledged_at: Optional[datetime]
    resolved_at: Optional[datetime]
    response_time_hours: Optional[float]
    model_confidence: Optional[float]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IncidentStats(BaseModel):
    total_incidents: int
    open_incidents: int
    resolved_today: int
    avg_response_time_hours: float
    by_type: Dict[str, int]
    by_severity: Dict[str, int]
