"""Persistent alerts feed.

Backed by the `alerts` table. The legacy aggregated alerts view at
/api/v1/dashboard/alerts (sensor anomalies + open incidents derived on
the fly) is preserved for back-compat, but the Alerts page now reads
from this endpoint so resident-portal reports show up immediately and
status updates from the Crew Routing page are reflected without
re-deriving anything.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.alert import Alert
from app.schemas.alert import AlertResponse

router = APIRouter()


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    severity: Optional[str] = Query(None),
    is_read: Optional[bool] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List alerts ordered newest-first.

    Optional filters keep this endpoint useful for both the unfiltered
    Alerts page and any future "unread only" / "high severity only" views.
    """
    query = select(Alert).order_by(Alert.created_at.desc())
    if severity:
        query = query.where(Alert.severity == severity.lower())
    if is_read is not None:
        query = query.where(Alert.is_read == is_read)
    if status:
        query = query.where(Alert.status == status.lower())
    query = query.limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


@router.patch("/{alert_id}/read", response_model=AlertResponse)
async def mark_alert_read(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Toggle an alert to is_read=True so the unread badge clears."""
    result = await db.execute(select(Alert).where(Alert.id == str(alert_id)))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_read = True
    await db.flush()
    await db.refresh(alert)
    return alert
