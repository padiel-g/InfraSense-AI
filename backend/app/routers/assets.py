from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from uuid import UUID

from app.database import get_db
from app.models.asset import Asset
from app.schemas.asset import AssetCreate, AssetUpdate, AssetResponse, AssetRiskPrediction
from app.auth import get_current_user
from app.services.risk_prediction import RiskPredictionService

router = APIRouter()


@router.get("/", response_model=list[AssetResponse])
async def list_assets(
    asset_type: Optional[str] = None,
    suburb: Optional[str] = None,
    risk_category: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    query = select(Asset)
    if asset_type:
        query = query.where(Asset.asset_type == asset_type)
    if suburb:
        query = query.where(Asset.suburb == suburb)
    if risk_category:
        query = query.where(Asset.risk_category == risk_category)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=AssetResponse, status_code=201)
async def create_asset(
    asset_data: AssetCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    asset = Asset(**asset_data.model_dump())
    if asset.installation_date:
        from datetime import datetime
        asset.age_years = (datetime.utcnow() - asset.installation_date).days // 365
    db.add(asset)
    await db.flush()
    await db.refresh(asset)
    return asset


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(asset_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.patch("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: UUID,
    update_data: AssetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for field, value in update_data.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    await db.flush()
    await db.refresh(asset)
    return asset


@router.post("/{asset_id}/predict-risk", response_model=AssetRiskPrediction)
async def predict_asset_risk(
    asset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    service = RiskPredictionService()
    prediction = service.predict_risk(asset)

    # Persist the risk score
    asset.risk_score = prediction["risk_score"]
    asset.risk_category = prediction["risk_category"]
    await db.flush()

    return AssetRiskPrediction(
        asset_id=asset.id,
        asset_code=asset.asset_code,
        **prediction,
    )


@router.get("/stats/summary")
async def asset_stats(db: AsyncSession = Depends(get_db)):
    total = await db.execute(select(func.count(Asset.id)))
    high_risk = await db.execute(
        select(func.count(Asset.id)).where(Asset.risk_category.in_(["high", "critical"]))
    )
    return {
        "total_assets": total.scalar() or 0,
        "high_risk_assets": high_risk.scalar() or 0,
    }
