import os
import uuid as uuid_lib
import asyncio
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from uuid import UUID
from datetime import datetime, timezone

from app.config import get_settings
from app.database import get_db
from app.models.incident import Incident
from app.models.alert import Alert
from app.models.user import User
from app.models.enums import IncidentType, Severity, IncidentStatus, IncidentSource
from app.schemas.incident import IncidentCreate, IncidentUpdate, IncidentResponse, IncidentStats
from app.schemas.alert import AlertResponse
from app.auth import get_current_user
from app.core.security import decode_token
from app.services.dumping_detection import DumpingDetectionService
from app.utils.image_processing import process_upload_image

router = APIRouter()
settings = get_settings()


async def _get_current_user_if_present(request: Request, db: AsyncSession) -> Optional[User]:
    """Return the active user from the auth cookie when one exists."""
    token = request.cookies.get("access_token")
    if not token:
        return None

    payload = decode_token(token)
    if payload is None or payload.get("type") != "access":
        return None

    email: str | None = payload.get("sub")
    if not email:
        return None

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user


async def _attach_reporters(db: AsyncSession, incidents: list[Incident]) -> list[Incident]:
    reporter_ids = {incident.reported_by for incident in incidents if incident.reported_by}
    if not reporter_ids:
        return incidents

    result = await db.execute(select(User).where(User.id.in_(reporter_ids)))
    users_by_id = {user.id: user for user in result.scalars().all()}
    for incident in incidents:
        reporter = users_by_id.get(incident.reported_by)
        if reporter:
            incident.reporter_name = reporter.full_name
            incident.reporter_email = reporter.email
    return incidents


async def _attach_reporter(db: AsyncSession, incident: Incident) -> Incident:
    return (await _attach_reporters(db, [incident]))[0]


# Resident-portal issue type → coarse IncidentType enum used by legacy filters.
# Every issue the resident portal can submit must appear here, including
# illegal_dumping — that flow now also writes into the shared `incidents`
# table so it shows up on the Alerts page and crew routing map alongside
# water/sewer/etc. The /api/v1/dumping/report endpoint still exists for the
# YOLO-validated dumping pipeline, but is no longer the only path for
# dumping reports.
_ISSUE_TYPE_TO_INCIDENT_TYPE: dict[str, IncidentType] = {
    "illegal_dumping":  IncidentType.blockage,  # closest existing enum bucket
    "water_leak":       IncidentType.leak,
    "burst_pipe":       IncidentType.burst,
    "sewer_burst":      IncidentType.burst,
    "blocked_drainage": IncidentType.blockage,
    "water_quality":    IncidentType.leak,
    "low_pressure":     IncidentType.leak,
    "no_water":         IncidentType.blockage,
    "road_hazard":      IncidentType.blockage,
    "other":            IncidentType.blockage,
}

# High-level grouping shown to admins / used for filtering.
_ISSUE_TYPE_TO_CATEGORY: dict[str, str] = {
    "illegal_dumping":  "environmental",
    "water_leak":       "water_infrastructure",
    "burst_pipe":       "water_infrastructure",
    "sewer_burst":      "sewer",
    "blocked_drainage": "drainage",
    "water_quality":    "water_quality",
    "low_pressure":     "water_supply",
    "no_water":         "water_supply",
    "road_hazard":      "municipal_hazard",
    "other":            "general",
}

# Friendly label used in alert titles / dashboard text.
_ISSUE_TYPE_LABELS: dict[str, str] = {
    "illegal_dumping":  "Illegal Dumping",
    "water_leak":       "Water Leak",
    "burst_pipe":       "Burst Pipe",
    "sewer_burst":      "Sewer Burst",
    "blocked_drainage": "Blocked Drainage",
    "water_quality":    "Water Quality Problem",
    "low_pressure":     "Low Water Pressure",
    "no_water":         "No Water Supply",
    "road_hazard":      "Road or Municipal Hazard",
    "other":            "Municipal Issue",
}

# UI severity values → existing Severity enum.
_SEVERITY_MAP: dict[str, Severity] = {
    "low":       Severity.low,
    "medium":    Severity.medium,
    "high":      Severity.high,
    "emergency": Severity.critical,
    "critical":  Severity.critical,
}


@router.get("/", response_model=list[IncidentResponse])
async def list_incidents(
    status: Optional[str] = None,
    incident_type: Optional[str] = None,
    severity: Optional[str] = None,
    suburb: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    query = select(Incident).order_by(Incident.reported_at.desc())
    if status:
        query = query.where(Incident.status == status)
    if incident_type:
        query = query.where(Incident.incident_type == incident_type)
    if severity:
        query = query.where(Incident.severity == severity)
    if suburb:
        query = query.where(Incident.suburb == suburb)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return await _attach_reporters(db, list(result.scalars().all()))


@router.post("/", response_model=IncidentResponse, status_code=201)
async def create_incident(
    data: IncidentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    current_user = await _get_current_user_if_present(request, db)
    payload = data.model_dump(exclude={"reported_by", "source"})
    incident = Incident(
        **payload,
        source="citizen",
        reported_by=current_user.id if current_user else None,
    )
    db.add(incident)
    await db.flush()
    await db.refresh(incident)
    return await _attach_reporter(db, incident)


class IncidentReportResult(BaseModel):
    """Combined response: the saved incident plus its auto-created alert."""
    incident: IncidentResponse
    alert: AlertResponse


@router.post("/report", response_model=IncidentReportResult, status_code=201)
async def report_incident(
    request: Request,
    issue_type: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    severity: str = Form("medium"),
    description: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    reporter_phone: Optional[str] = Form(None),
    source: str = Form("resident_portal"),  # noqa: ARG001 — accepted for forward-compat; normalised below
    yolo_status: Optional[str] = Form(None),
    yolo_confidence: Optional[float] = Form(None),  # noqa: ARG001 - client display value; server revalidates
    photo: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
):
    """Single resident-portal entry point for any municipal incident.

    Accepts multipart/form-data so the same request carries a photo, GPS
    coordinates, and free-text fields. The behaviour is:

    1. Validate `issue_type`, `severity`, and the lat/lng pair.
    2. Save a row in the shared `incidents` table (so the report shows up on
       the admin dashboard, the incidents page, and the crew-routing map).
    3. Auto-create a matching row in the `alerts` table so the report
       immediately appears on the Alerts page without re-deriving anything.
    4. Return both.

    Illegal-dumping reports flow through here too — the legacy
    /api/v1/dumping/report endpoint still exists for the YOLO-validated
    pipeline, but the resident UI now always uses this endpoint so every
    submission becomes an Incident + Alert pair.
    """
    issue_key = (issue_type or "").strip().lower()
    incident_enum = _ISSUE_TYPE_TO_INCIDENT_TYPE.get(issue_key)
    if incident_enum is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unknown issue_type. Expected one of: "
                + ", ".join(sorted(_ISSUE_TYPE_TO_INCIDENT_TYPE.keys()))
            ),
        )

    # Coordinate sanity — anything outside this range is a client bug.
    if not (-90.0 <= latitude <= 90.0) or not (-180.0 <= longitude <= 180.0):
        raise HTTPException(status_code=400, detail="latitude/longitude out of range.")

    severity_key = (severity or "medium").strip().lower()
    severity_enum = _SEVERITY_MAP.get(severity_key, Severity.medium)

    category = _ISSUE_TYPE_TO_CATEGORY.get(issue_key, "general")
    label = _ISSUE_TYPE_LABELS.get(issue_key, issue_key.replace("_", " ").title())
    current_user = await _get_current_user_if_present(request, db)

    # Optional photo — accept JPEG/PNG/WebP; cap at MAX_UPLOAD_SIZE_MB.
    image_url: Optional[str] = None
    image_path: Optional[str] = None
    if issue_key == "illegal_dumping" and (photo is None or not photo.filename):
        raise HTTPException(
            status_code=400,
            detail="A photo is required for Illegal Dumping reports.",
        )

    if photo is not None and photo.filename:
        if photo.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(
                status_code=400,
                detail="Only JPEG, PNG, and WebP images are accepted.",
            )

        contents = await photo.read()
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        if len(contents) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
            )

        ext = "jpg"
        if "." in photo.filename:
            derived = photo.filename.rsplit(".", 1)[-1].lower()
            if derived:
                ext = derived

        if issue_key == "illegal_dumping":
            temp_name = f"{uuid_lib.uuid4()}.{ext}"
            temp_dir = os.path.join(settings.UPLOAD_DIR, "validation")
            os.makedirs(temp_dir, exist_ok=True)
            temp_path = os.path.join(temp_dir, temp_name)
            loop = asyncio.get_event_loop()
            try:
                processed_path = await loop.run_in_executor(
                    None, process_upload_image, contents, temp_path
                )
                detection_service = DumpingDetectionService()
                detections = await loop.run_in_executor(
                    None, detection_service.detect, processed_path
                )
                decision = detection_service.analyse_detections(detections)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))
            finally:
                try:
                    Path(temp_path).unlink(missing_ok=True)
                except OSError:
                    pass

            if decision["status"] != "suspected_illegal_dumping" or not decision["can_submit"]:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "The image does not appear to show illegal dumping. "
                        "Please retake the photo if this is incorrect, or choose another issue type if you are reporting a different municipal problem."
                    ),
                )

            if yolo_status and yolo_status != "suspected_illegal_dumping":
                raise HTTPException(
                    status_code=400,
                    detail="Illegal Dumping reports require a suspected illegal dumping image validation result.",
                )

        file_name = f"{uuid_lib.uuid4()}.{ext}"
        rel_dir = os.path.join(settings.UPLOAD_DIR, "incidents")
        os.makedirs(rel_dir, exist_ok=True)
        image_path = os.path.join(rel_dir, file_name)
        with open(image_path, "wb") as fh:
            fh.write(contents)
        image_url = f"/uploads/incidents/{file_name}"

    incident = Incident(
        incident_type=incident_enum,
        issue_type=issue_key,
        category=category,
        severity=severity_enum,
        status=IncidentStatus.reported,
        description=description,
        address=address,
        latitude=latitude,
        longitude=longitude,
        # IncidentSource has a DB CHECK constraint that rejects free-form
        # values like "resident_portal", so we normalise to the closest
        # existing bucket. The granular issue_type column carries the
        # precise category for filtering.
        source=IncidentSource.citizen,
        image_url=image_url,
        image_path=image_path,
        reported_by=current_user.id if current_user else None,
        reporter_phone=reporter_phone,
    )
    db.add(incident)
    await db.flush()
    await db.refresh(incident)
    incident = await _attach_reporter(db, incident)

    # Persist alert immediately so the Alerts page reflects this report
    # on the very next fetch. severity stored as a free-text string so
    # the UI can show "emergency" without an enum migration.
    alert_message_parts = [label]
    if address:
        alert_message_parts.append(f"reported at {address}")
    else:
        alert_message_parts.append(
            f"reported at ({latitude:.5f}, {longitude:.5f})"
        )
    if description:
        alert_message_parts.append(f"— {description}")

    alert = Alert(
        incident_id=incident.id,
        alert_type=issue_key,
        severity=severity_key if severity_key in {"low", "medium", "high", "emergency", "critical"} else "medium",
        title=f"New {label.lower()} report",
        message=" ".join(alert_message_parts),
        latitude=latitude,
        longitude=longitude,
        is_read=False,
        status="open",
    )
    db.add(alert)
    await db.flush()
    await db.refresh(alert)

    return IncidentReportResult(
        incident=IncidentResponse.model_validate(incident),
        alert=AlertResponse.model_validate(alert),
    )


@router.get("/stats", response_model=IncidentStats)
async def incident_stats(db: AsyncSession = Depends(get_db)):
    total = (await db.execute(select(func.count(Incident.id)))).scalar() or 0
    open_count = (
        await db.execute(
            select(func.count(Incident.id)).where(Incident.status != "resolved")
        )
    ).scalar() or 0

    today = datetime.now(timezone.utc).date()
    resolved_today = (
        await db.execute(
            select(func.count(Incident.id)).where(
                Incident.status == "resolved",
                func.date(Incident.resolved_at) == today,
            )
        )
    ).scalar() or 0

    avg_resp = (
        await db.execute(
            select(func.avg(Incident.response_time_hours)).where(
                Incident.response_time_hours.isnot(None)
            )
        )
    ).scalar() or 0.0

    return IncidentStats(
        total_incidents=total,
        open_incidents=open_count,
        resolved_today=resolved_today,
        avg_response_time_hours=round(float(avg_resp), 2),
        by_type={},
        by_severity={},
    )


@router.get("/open", response_model=list[IncidentResponse])
async def list_open_incidents(
    limit: int = Query(200, le=500),
    db: AsyncSession = Depends(get_db),
):
    """All incidents whose status is not yet `resolved`.

    Used by the Crew Routing page to render markers on the map. Sorted
    newest-first so the highest-priority items show up at the top of the
    incident list beside the map.
    """
    result = await db.execute(
        select(Incident)
        .where(Incident.status != IncidentStatus.resolved)
        .order_by(Incident.reported_at.desc())
        .limit(limit)
    )
    return await _attach_reporters(db, list(result.scalars().all()))


@router.get("/active", response_model=list[IncidentResponse])
async def list_active_incidents(
    limit: int = Query(200, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Active/reportable incidents for crew routing.

    Includes reported/assigned/in_progress and excludes resolved. The app
    currently has no cancelled enum value, so cancelled rows are naturally
    absent unless a future migration adds that status.
    """
    active_statuses = [
        IncidentStatus.reported,
        "acknowledged",
        IncidentStatus.assigned,
        IncidentStatus.in_progress,
    ]
    result = await db.execute(
        select(Incident)
        .where(Incident.status.in_(active_statuses))
        .order_by(Incident.reported_at.desc())
        .limit(limit)
    )
    return await _attach_reporters(db, list(result.scalars().all()))


# UI status keys → IncidentStatus enum. The UI uses friendly names like
# "in_progress" already; map "pending" back to the existing `reported`
# bucket so existing data stays valid.
_STATUS_MAP: dict[str, IncidentStatus] = {
    "pending":     IncidentStatus.reported,
    "reported":    IncidentStatus.reported,
    "assigned":    IncidentStatus.assigned,
    "in_progress": IncidentStatus.in_progress,
    "resolved":    IncidentStatus.resolved,
}


class IncidentStatusUpdate(BaseModel):
    status: str


@router.patch("/{incident_id}/status", response_model=IncidentResponse)
async def update_incident_status(
    incident_id: UUID,
    body: IncidentStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Lightweight status-only update used by the Crew Routing buttons.

    Kept distinct from the generic /{incident_id} PATCH so that crews can
    update status without authentication friction in the field workflow,
    and so the linked Alert row's `status` field is kept in sync in one
    place.
    """
    new_status_key = (body.status or "").strip().lower()
    new_status = _STATUS_MAP.get(new_status_key)
    if new_status is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unknown status. Expected one of: "
                + ", ".join(sorted(_STATUS_MAP.keys()))
            ),
        )

    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident.status = new_status
    if new_status == IncidentStatus.resolved and not incident.resolved_at:
        incident.resolved_at = datetime.now(timezone.utc)
        if incident.reported_at:
            delta = incident.resolved_at - incident.reported_at
            incident.response_time_hours = round(delta.total_seconds() / 3600, 2)

    # Keep any associated alert row in sync so the Alerts page reflects
    # the new state without a second round-trip.
    alert_rows = await db.execute(select(Alert).where(Alert.incident_id == str(incident.id)))
    for alert in alert_rows.scalars().all():
        if new_status == IncidentStatus.resolved:
            alert.status = "resolved"
        elif new_status in (IncidentStatus.assigned, IncidentStatus.in_progress):
            alert.status = "in_progress"
        else:
            alert.status = "open"

    await db.flush()
    await db.refresh(incident)
    return await _attach_reporter(db, incident)


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident(incident_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return await _attach_reporter(db, incident)


@router.patch("/{incident_id}", response_model=IncidentResponse)
async def update_incident(
    incident_id: UUID,
    update_data: IncidentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    for field, value in update_data.model_dump(exclude_unset=True).items():
        setattr(incident, field, value)

    if update_data.status == "resolved" and not incident.resolved_at:
        incident.resolved_at = datetime.now(timezone.utc)
        if incident.reported_at:
            delta = incident.resolved_at - incident.reported_at
            incident.response_time_hours = round(delta.total_seconds() / 3600, 2)

    await db.flush()
    await db.refresh(incident)
    return await _attach_reporter(db, incident)
