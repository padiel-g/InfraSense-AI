import os
import json
import time
import uuid
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.database import get_db
from app.config import get_settings
from app.models.dumping_report import DumpingReport
from app.schemas.dumping import DumpingReportResponse, DumpingDetectionResult, DumpingImageAnalysisResult
from app.services.dumping_detection import DumpingDetectionService
from app.utils.image_processing import process_upload_image

router = APIRouter()
settings = get_settings()


async def _analyse_uploaded_dumping_image(image: UploadFile) -> tuple[dict, dict]:
    if image.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images accepted")

    contents = await image.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    file_ext = "jpg"
    if image.filename and "." in image.filename:
        derived = image.filename.rsplit(".", 1)[-1].lower()
        if derived:
            file_ext = derived

    file_id = str(uuid.uuid4())
    file_name = f"{file_id}.{file_ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, "validation", file_name)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    loop = asyncio.get_event_loop()
    try:
        processed_path = await loop.run_in_executor(
            None, process_upload_image, contents, file_path
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    detection_service = DumpingDetectionService()
    detections = await loop.run_in_executor(
        None, detection_service.detect, processed_path
    )
    decision = detection_service.analyse_detections(detections)

    # Validation uploads are temporary; report submission performs its own
    # server-side validation before storing a resident incident.
    try:
        Path(processed_path).unlink(missing_ok=True)
    except OSError:
        pass

    return detections, decision


@router.post("/analyse-image", response_model=DumpingImageAnalysisResult)
async def analyse_image(image: UploadFile = File(...)):
    detections, decision = await _analyse_uploaded_dumping_image(image)
    return DumpingImageAnalysisResult(
        status=decision["status"],
        detected_class=decision["detected_class"],
        confidence=round(float(decision["confidence"]), 4),
        bounding_boxes=detections.get("boxes", []) or [],
        message=decision["message"],
        can_submit=bool(decision["can_submit"]),
    )


def _delete_report_image_file(report: DumpingReport) -> None:
    """Best-effort removal of the stored image file.

    Older rows may have relative image paths created from a different working
    directory. The UI should still be able to delete the report image reference
    even if the physical file is already missing or the path format changed.
    """
    backend_root = Path(__file__).resolve().parents[2]
    upload_roots = {
        Path(settings.UPLOAD_DIR).resolve(),
        (Path.cwd() / settings.UPLOAD_DIR).resolve(),
        (backend_root / settings.UPLOAD_DIR).resolve(),
    }

    candidates: list[Path] = []
    if report.image_path:
        candidates.append(Path(report.image_path))

    if report.image_url and report.image_url.startswith("/uploads/"):
        relative_url_path = Path(report.image_url.removeprefix("/uploads/"))
        candidates.extend(root / relative_url_path for root in upload_roots)

    for candidate in candidates:
        resolved = candidate.resolve()
        if not any(_is_relative_to(resolved, root) for root in upload_roots):
            continue
        if resolved.exists() and resolved.is_file():
            resolved.unlink()
            return


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


@router.post("/report", response_model=DumpingDetectionResult)
async def report_dumping(
    image: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    address: Optional[str] = Form(None),
    suburb: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a geo-tagged image for illegal dumping detection.
    Target: <10s upload-to-detection latency.
    """
    start_time = time.time()

    # Validate file type
    if image.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images accepted")

    # Read the body first so we can enforce the size limit before doing any
    # expensive I/O or ML inference.
    contents = await image.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    # Derive a safe file extension: fall back to "jpg" if the filename is
    # absent, empty, or has no dot (e.g. the blob uploaded from canvas).
    file_ext = "jpg"
    if image.filename and "." in image.filename:
        derived = image.filename.rsplit(".", 1)[-1].lower()
        if derived:
            file_ext = derived

    # Save and preprocess image
    file_id = str(uuid.uuid4())
    file_name = f"{file_id}.{file_ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, "dumping", file_name)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    loop = asyncio.get_event_loop()

    # PIL image processing is CPU-bound — run in thread pool to avoid
    # blocking the async event loop and stalling every other request.
    try:
        processed_path = await loop.run_in_executor(
            None, process_upload_image, contents, file_path
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # YOLO inference is also CPU-bound — keep it off the event loop.
    detection_service = DumpingDetectionService()

    detections = await loop.run_in_executor(
        None, detection_service.detect, processed_path
    )

    # Validate the already-computed YOLO result before accepting the report.
    # This avoids a second inference pass on the same image.
    is_valid, message = detection_service.validate_detections(detections)
    if not is_valid:
        raise HTTPException(status_code=422, detail=message)

    # Save report to database
    report = DumpingReport(
        image_path=file_path,
        image_url=f"/uploads/dumping/{file_name}",
        latitude=latitude,
        longitude=longitude,
        address=address,
        suburb=suburb,
        description=description,
        source="citizen",
        detection_confidence=detections["confidence"],
        waste_categories=",".join(detections["categories"]),
        bounding_boxes=json.dumps(detections["boxes"]),
        capture_date=datetime.now(timezone.utc),
    )
    db.add(report)
    await db.flush()
    await db.refresh(report)

    processing_time = (time.time() - start_time) * 1000  # ms

    return DumpingDetectionResult(
        report_id=report.id,
        detections=detections["boxes"],
        confidence=detections["confidence"],
        waste_categories=detections["categories"],
        image_url=report.image_url,
        processing_time_ms=round(processing_time, 2),
    )


@router.get("/", response_model=list[DumpingReportResponse])
async def list_reports(
    status: Optional[str] = None,
    suburb: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    query = select(DumpingReport).order_by(DumpingReport.detected_at.desc())
    if status:
        query = query.where(DumpingReport.status == status)
    if suburb:
        query = query.where(DumpingReport.suburb == suburb)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{report_id}", response_model=DumpingReportResponse)
async def get_report(report_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DumpingReport).where(DumpingReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.patch("/{report_id}/verify")
async def verify_report(
    report_id: uuid.UUID,
    is_verified: bool = True,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DumpingReport).where(DumpingReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.is_verified = is_verified
    report.status = "verified" if is_verified else "rejected"
    await db.flush()
    return {"status": "updated", "is_verified": is_verified}


@router.delete("/{report_id}/image", response_model=DumpingReportResponse)
async def delete_report_image(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DumpingReport).where(DumpingReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    _delete_report_image_file(report)

    # Keep the report and location data, but remove the uploaded image from UI/API.
    # image_path is intentionally retained because older SQLite tables may have a
    # NOT NULL constraint there; image_url is what the frontend uses to render.
    report.image_url = None
    report.bounding_boxes = "[]"
    await db.flush()
    await db.refresh(report)
    return report
