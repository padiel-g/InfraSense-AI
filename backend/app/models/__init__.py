"""ORM models — import all so Alembic / init_db sees them."""

from app.models.enums import *  # noqa: F401,F403
from app.models.user import User  # noqa: F401
from app.models.asset import Asset  # noqa: F401
from app.models.incident import Incident  # noqa: F401
from app.models.alert import Alert  # noqa: F401
from app.models.sensor_reading import SensorReading  # noqa: F401
from app.models.detection_session import DetectionResult, DetectionSession  # noqa: F401
from app.models.dumping_report import DumpingReport  # noqa: F401
from app.models.water_monitor import WaterSensorReading, WaterIncident  # noqa: F401
