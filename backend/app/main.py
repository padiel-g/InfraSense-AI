import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import init_db
from app.middleware.logging import RequestLoggingMiddleware
from app.ml.loader import load_all_models
from app.routers import assets, incidents, sensors, detection, dumping, dashboard, anomaly, routing, alerts
from app.routers.detection_sessions import router as detection_sessions_router
from app.routers.water_monitor import router as water_router
from app.routers.water_quality import router as water_quality_router
from app.routers.water_quality_simulation import router as water_quality_simulation_router
from app.routers.leak_detection import router as leak_detection_router
from app.routers.simulation_run import router as simulation_run_router
from app.api import auth as auth_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    await init_db()
    if settings.EAGER_LOAD_ML_MODELS:
        load_all_models()
    else:
        print("[i] ML models will load lazily on first use")
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    # Optional warmup for deployments that prefer paying ML cost at boot.
    if settings.EAGER_LOAD_LEAK_LSTM:
        try:
            from app.ml.leak_lstm import get_leak_lstm
            get_leak_lstm()
            print("[✓] leak-detection LSTM ready")
        except Exception as e:                                # pragma: no cover
            print(f"[!] leak-detection LSTM init failed: {e}")

    print(f"[✓] {settings.APP_NAME} started successfully")
    yield
    print(f"[✗] {settings.APP_NAME} shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    description="Anomaly-based detection of water/sewer failures and illegal dumping",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(RequestLoggingMiddleware)

# CORS — must allow credentials for cookie-based auth
if settings.DEBUG:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.FRONTEND_URL],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Static files for uploaded images
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Auth router
app.include_router(auth_router.router, prefix="/api/auth", tags=["Authentication"])

# Feature routers (existing — unchanged)
app.include_router(assets.router,    prefix="/api/v1/assets",    tags=["Assets"])
app.include_router(incidents.router, prefix="/api/v1/incidents", tags=["Incidents"])
app.include_router(incidents.router, prefix="/api/incidents", tags=["Incidents"])
app.include_router(sensors.router,   prefix="/api/v1/sensors",   tags=["Sensors"])
app.include_router(detection.router, prefix="/api/v1/detection", tags=["Anomaly Detection"])
app.include_router(dumping.router,   prefix="/api/v1/dumping",   tags=["Illegal Dumping"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["Dashboard"])
app.include_router(alerts.router,    prefix="/api/v1/alerts",    tags=["Alerts"])
app.include_router(anomaly.router,   prefix="/api/v1",           tags=["Anomaly Detection"])
app.include_router(routing.router,   prefix="/api",              tags=["Crew Routing"])
app.include_router(detection_sessions_router, prefix="/api", tags=["Detection Sessions"])

# Water infrastructure monitoring (new)
app.include_router(water_router, prefix="/api/water", tags=["Water Monitoring"])

# Sensors > Water Quality (turbidity / pH / flow contamination + corrosion)
app.include_router(
    water_quality_router,
    prefix="/api/v1/water-quality",
    tags=["Water Quality"],
)

# Water quality simulation (sequence-based) — stable endpoint used by UI
app.include_router(
    water_quality_simulation_router,
    prefix="/api/water-quality",
    tags=["Water Quality"],
)

# Sensors > Leak & Overflow LSTM (real-time sequence-aware detection)
app.include_router(
    leak_detection_router,
    prefix="/api/v1/leak-detection",
    tags=["Leak & Overflow Detection"],
)

# Leak & Overflow realistic simulation (sequence-based)
app.include_router(
    simulation_run_router,
    prefix="/api",
    tags=["Leak & Overflow Detection"],
)


@app.get("/", tags=["Health"])
async def health_check():
    return {"status": "healthy", "service": settings.APP_NAME, "version": "1.0.0"}
