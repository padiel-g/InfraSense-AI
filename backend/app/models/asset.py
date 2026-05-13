import uuid
from sqlalchemy import Column, String, Float, Integer, DateTime, Text, Enum, func
from app.database import Base
from app.models.enums import AssetType, RiskCategory


class Asset(Base):
    __tablename__ = "assets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    asset_code = Column(String(50), unique=True, nullable=False, index=True)
    asset_type = Column(
        Enum(AssetType, name="asset_type", create_constraint=True),
        nullable=False,
    )
    material = Column(String(100), nullable=True)
    diameter_mm = Column(Float, nullable=True)
    length_m = Column(Float, nullable=True)
    depth_m = Column(Float, nullable=True)
    installation_date = Column(DateTime(timezone=True), nullable=True)
    age_years = Column(Integer, nullable=True)
    pressure_zone = Column(String(50), nullable=True)
    soil_type = Column(String(100), nullable=True)
    land_use_type = Column(String(50), nullable=True)
    suburb = Column(String(100), nullable=True, index=True)
    ward = Column(String(50), nullable=True)
    condition_rating = Column(Integer, nullable=True)
    last_inspection_date = Column(DateTime(timezone=True), nullable=True)
    failure_count = Column(Integer, default=0)

    # Risk scores computed by ML models
    risk_score = Column(Float, nullable=True)
    risk_category = Column(
        Enum(RiskCategory, name="risk_category", create_constraint=True),
        nullable=True,
        index=True,
    )

    # Geometry replaced by explicit lat/lon columns (was PostGIS LINESTRING)
    # For linestrings: start/end points stored separately
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    start_latitude = Column(Float, nullable=True)
    start_longitude = Column(Float, nullable=True)
    end_latitude = Column(Float, nullable=True)
    end_longitude = Column(Float, nullable=True)

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
