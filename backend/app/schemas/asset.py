from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class AssetCreate(BaseModel):
    asset_code: str
    asset_type: str
    material: Optional[str] = None
    diameter_mm: Optional[float] = None
    length_m: Optional[float] = None
    depth_m: Optional[float] = None
    installation_date: Optional[datetime] = None
    pressure_zone: Optional[str] = None
    soil_type: Optional[str] = None
    land_use_type: Optional[str] = None
    suburb: Optional[str] = None
    ward: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    notes: Optional[str] = None


class AssetUpdate(BaseModel):
    condition_rating: Optional[int] = None
    last_inspection_date: Optional[datetime] = None
    notes: Optional[str] = None
    risk_score: Optional[float] = None
    risk_category: Optional[str] = None


class AssetResponse(BaseModel):
    id: UUID
    asset_code: str
    asset_type: str
    material: Optional[str]
    diameter_mm: Optional[float]
    age_years: Optional[int]
    suburb: Optional[str]
    ward: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    risk_score: Optional[float]
    risk_category: Optional[str]
    failure_count: int
    condition_rating: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class AssetRiskPrediction(BaseModel):
    asset_id: UUID
    asset_code: str
    risk_score: float
    risk_category: str
    top_risk_factors: list[dict]
    recommended_action: str
