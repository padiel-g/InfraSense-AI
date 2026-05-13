"""Shared Python enums used across ORM models and Pydantic schemas."""

import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    dispatcher = "dispatcher"
    field_crew = "field_crew"
    resident = "resident"


class Department(str, enum.Enum):
    water = "water"
    sewer = "sewer"
    solid_waste = "solid_waste"


class AssetType(str, enum.Enum):
    water_pipe = "water_pipe"
    sewer_pipe = "sewer_pipe"
    manhole = "manhole"
    valve = "valve"


class RiskCategory(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class IncidentType(str, enum.Enum):
    burst = "burst"
    leak = "leak"
    overflow = "overflow"
    blockage = "blockage"


class Severity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class IncidentStatus(str, enum.Enum):
    reported = "reported"
    assigned = "assigned"
    in_progress = "in_progress"
    resolved = "resolved"


class IncidentSource(str, enum.Enum):
    citizen = "citizen"
    sensor = "sensor"
    inspection = "inspection"
    model = "model"


class SensorType(str, enum.Enum):
    flow = "flow"
    pressure = "pressure"
    level = "level"
    turbidity = "turbidity"


class AnomalyType(str, enum.Enum):
    spike = "spike"
    drift = "drift"
    drop = "drop"
    flatline = "flatline"


class DumpingStatus(str, enum.Enum):
    detected = "detected"
    verified = "verified"
    assigned = "assigned"
    cleaned = "cleaned"
    rejected = "rejected"


class DumpingSource(str, enum.Enum):
    citizen = "citizen"
    satellite = "satellite"
    drone = "drone"
    model = "model"
