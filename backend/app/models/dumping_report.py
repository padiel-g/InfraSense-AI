import uuid
from sqlalchemy import Column, String, Float, DateTime, Text, Boolean, ForeignKey, Enum, func
from app.database import Base
from app.models.enums import DumpingStatus, DumpingSource


class DumpingReport(Base):
    __tablename__ = "dumping_reports"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    status = Column(
        Enum(DumpingStatus, name="dumping_status", create_constraint=True),
        default=DumpingStatus.detected,
        index=True,
    )
    source = Column(
        Enum(DumpingSource, name="dumping_source", create_constraint=True),
        default=DumpingSource.citizen,
    )

    # Image (local filesystem storage)
    image_path = Column(String(500), nullable=False)
    image_url = Column(String(500), nullable=True)

    # Location (was PostGIS POINT — now plain floats)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    address = Column(String(500), nullable=True)
    suburb = Column(String(100), nullable=True, index=True)

    # YOLO detection results
    detection_confidence = Column(Float, nullable=True)
    bounding_boxes = Column(Text, nullable=True)
    waste_categories = Column(String(255), nullable=True)

    # Verification
    is_verified = Column(Boolean, default=False)
    verified_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    # Reporter
    reported_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    description = Column(Text, nullable=True)
    capture_date = Column(DateTime(timezone=True), nullable=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
