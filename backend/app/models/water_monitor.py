"""
Water monitoring ORM models.

Uses distinct table names (water_sensor_readings, water_incidents) to avoid
any conflict with the existing sensor_readings and incidents tables.
Integer primary keys are used as specified for these new tables.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, JSON, String

from app.database import Base


class WaterSensorReading(Base):
    """One sensor snapshot from a Gweru water zone (simulation or manual)."""

    __tablename__ = "water_sensor_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(String(10), nullable=False, index=True)
    zone_name = Column(String(100), nullable=False)
    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        default=lambda: datetime.now(timezone.utc),
    )
    flow_rate = Column(Float, nullable=False)       # L/s
    pressure = Column(Float, nullable=False)        # bar
    turbidity = Column(Float, nullable=False)       # NTU
    ph = Column(Float, nullable=False)
    residual_chlorine_mg_l = Column(Float, nullable=True)  # mg/L
    conductivity_us_cm = Column(Float, nullable=True)      # uS/cm
    temperature_c = Column(Float, nullable=True)           # Celsius
    source = Column(String(20), nullable=False, default="simulation")  # "simulation"|"manual"


class WaterIncident(Base):
    """Detected water infrastructure incident (auto or manual)."""

    __tablename__ = "water_incidents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        default=lambda: datetime.now(timezone.utc),
    )
    zone_id = Column(String(10), nullable=False, index=True)
    zone_name = Column(String(100), nullable=False)
    incident_type = Column(
        String(30),
        nullable=False,
    )  # "leak" | "overflow" | "contamination" | "normal"
    confidence = Column(Float, nullable=False, default=0.0)  # 0.0 – 1.0
    lstm_score = Column(Float, nullable=True)
    quality_score = Column(Float, nullable=True)
    indicators = Column(JSON, nullable=False, default=list)  # list[str]
    recommendation = Column(String(600), nullable=False, default="")
    source = Column(String(20), nullable=False, default="simulation")  # "simulation"|"manual"
