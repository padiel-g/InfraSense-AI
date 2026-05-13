import asyncio
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.asset import Asset
from app.services.risk_prediction import RiskPredictionService
from app.auth import get_current_user

router = APIRouter()


@router.post("/run-risk-batch")
async def run_batch_risk_prediction(
    suburb: str = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Run risk prediction across all assets (or filtered by suburb)."""
    query = select(Asset)
    if suburb:
        query = query.where(Asset.suburb == suburb)
    result = await db.execute(query)
    assets = result.scalars().all()

    service = RiskPredictionService()
    loop = asyncio.get_event_loop()

    # XGBoost/RF inference is CPU-bound. Run all predictions concurrently
    # in the thread pool instead of blocking the event loop one-by-one.
    preds = await asyncio.gather(
        *[loop.run_in_executor(None, service.predict_risk, asset) for asset in assets]
    )

    predictions = []
    for asset, pred in zip(assets, preds):
        asset.risk_score = pred["risk_score"]
        asset.risk_category = pred["risk_category"]
        predictions.append({
            "asset_code": asset.asset_code,
            "risk_score": pred["risk_score"],
            "risk_category": pred["risk_category"],
        })

    await db.flush()
    return {
        "processed": len(predictions),
        "predictions": predictions,
    }
