"""Pydantic schemas for the Alert table.

Kept separate from `app/schemas/dashboard.py::AlertItem`, which is the
legacy aggregated alerts schema (sensor anomalies + incidents) returned
by /api/v1/dashboard/alerts. The new schemas below back the persistent
alerts feed at /api/v1/alerts.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AlertResponse(BaseModel):
    id: str
    incident_id: Optional[str] = None
    alert_type: str
    severity: str
    title: str
    message: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_read: bool
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
