import json
from pydantic import BaseModel, field_validator
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class DumpingReportCreate(BaseModel):
    latitude: float
    longitude: float
    address: Optional[str] = None
    suburb: Optional[str] = None
    description: Optional[str] = None
    capture_date: Optional[datetime] = None


class DumpingReportResponse(BaseModel):
    id: UUID
    status: str
    source: str
    image_url: Optional[str]
    latitude: float
    longitude: float
    address: Optional[str]
    suburb: Optional[str]
    detection_confidence: Optional[float]
    waste_categories: Optional[str]
    bounding_boxes: Optional[list[dict[str, Any]]] = None
    is_verified: bool
    description: Optional[str]
    capture_date: Optional[datetime]
    detected_at: datetime
    resolved_at: Optional[datetime]

    @field_validator("bounding_boxes", mode="before")
    @classmethod
    def parse_bounding_boxes(cls, v: Any) -> list[dict]:
        """DB stores boxes as a JSON string; parse it back to a list."""
        if v is None:
            return []
        if isinstance(v, (list, tuple)):
            return list(v)
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
        return []

    model_config = {"from_attributes": True}


class DumpingDetectionResult(BaseModel):
    report_id: UUID
    detections: list[dict]
    confidence: float
    waste_categories: list[str]
    image_url: str
    processing_time_ms: float


class DumpingImageAnalysisResult(BaseModel):
    status: str
    detected_class: str
    confidence: float
    bounding_boxes: list[dict[str, Any]] = []
    message: str
    can_submit: bool
