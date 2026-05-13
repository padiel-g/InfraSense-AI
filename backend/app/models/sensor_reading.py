import uuid
from sqlalchemy import Column, String, Float, DateTime, Boolean, ForeignKey, Enum, func
from app.database import Base
from app.models.enums import SensorType, AnomalyType


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sensor_id = Column(String(50), nullable=False, index=True)
    session_id = Column(String(36), ForeignKey("detection_sessions.id"), nullable=True, index=True)
    sensor_type = Column(
        Enum(SensorType, name="sensor_type", create_constraint=True),
        nullable=False,
    )
    asset_id = Column(String(36), ForeignKey("assets.id"), nullable=True)

    # Measurements
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    flow_rate_lps = Column(Float, nullable=True)
    flow_lps = Column(Float, nullable=True)
    pressure_bar = Column(Float, nullable=True)
    pressure_kpa = Column(Float, nullable=True)
    water_level_m = Column(Float, nullable=True)
    turbidity_ntu = Column(Float, nullable=True)
    residual_chlorine_mg_l = Column(Float, nullable=True)
    conductivity_us_cm = Column(Float, nullable=True)
    temperature_c = Column(Float, nullable=True)
    acoustic_db = Column(Float, nullable=True)
    soil_moisture_percent = Column(Float, nullable=True)
    valve_status = Column(String(32), nullable=True)
    tank_level_percent = Column(Float, nullable=True)
    pipe_zone = Column(String(120), nullable=True)

    # Anomaly detection results
    is_anomaly = Column(Boolean, default=False)
    anomaly_score = Column(Float, nullable=True)
    anomaly_type = Column(
        Enum(AnomalyType, name="anomaly_type", create_constraint=True),
        nullable=True,
    )

    created_at = Column(DateTime(timezone=True), server_default=func.now())
