import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func

from app.database import Base


class DetectionSession(Base):
    __tablename__ = "detection_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(120), nullable=True)
    sensor_id = Column(String(50), nullable=True, index=True)
    pipe_zone = Column(String(120), nullable=True)
    status = Column(String(32), nullable=False, default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class DetectionResult(Base):
    __tablename__ = "detection_results"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("detection_sessions.id"), nullable=False, index=True)
    status = Column(String(40), nullable=False)
    prediction = Column(String(40), nullable=True)
    confidence = Column(Float, nullable=True)
    message = Column(String(500), nullable=False)
    reading_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
