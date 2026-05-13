import uuid
from sqlalchemy import Column, String, Float, DateTime, Text, ForeignKey, Enum, func
from app.database import Base
from app.models.enums import IncidentType, Severity, IncidentStatus, IncidentSource


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    incident_type = Column(
        Enum(IncidentType, name="incident_type", create_constraint=True),
        nullable=False,
    )
    severity = Column(
        Enum(Severity, name="severity", create_constraint=True),
        default=Severity.medium,
    )
    status = Column(
        Enum(IncidentStatus, name="incident_status", create_constraint=True),
        default=IncidentStatus.reported,
        index=True,
    )
    description = Column(Text, nullable=True)
    source = Column(
        Enum(IncidentSource, name="incident_source", create_constraint=True),
        default=IncidentSource.citizen,
    )

    # Resident-portal issue category. Free-text so the UI can present
    # categories beyond the four enum buckets (water_leak, burst_pipe,
    # sewer_burst, blocked_drainage, water_quality, low_pressure, no_water,
    # road_hazard, other) without forcing a destructive enum migration on
    # SQLite. The coarser `incident_type` enum above stays populated via a
    # mapping so legacy filters keep working.
    issue_type = Column(String(60), nullable=True, index=True)

    # High-level grouping derived from issue_type. Used by the Alerts page
    # and admin filters to split water vs sewer vs environmental vs hazard
    # without having to maintain a long if/else chain everywhere.
    # Examples: "environmental", "water_infrastructure", "sewer",
    # "drainage", "water_quality", "water_supply", "municipal_hazard",
    # "general".
    category = Column(String(60), nullable=True, index=True)

    # Optional photo uploaded with the report (served from /uploads/...).
    image_url = Column(String(500), nullable=True)
    image_path = Column(String(500), nullable=True)

    # Location (was PostGIS POINT — now plain floats)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    address = Column(String(500), nullable=True)
    suburb = Column(String(100), nullable=True)
    ward = Column(String(50), nullable=True)

    # Linked asset
    asset_id = Column(String(36), ForeignKey("assets.id"), nullable=True)

    # Reporter
    reported_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    reporter_phone = Column(String(20), nullable=True)

    # Crew assignment
    assigned_to = Column(String(36), ForeignKey("users.id"), nullable=True)

    # Timestamps
    reported_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    response_time_hours = Column(Float, nullable=True)

    # Model confidence if detected by ML
    model_confidence = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
