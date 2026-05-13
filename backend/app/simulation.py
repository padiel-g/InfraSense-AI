"""
In-memory simulation state for Gweru City water monitoring zones.

Module-level dicts hold per-zone reading windows and active anomaly state so
state persists across HTTP requests within the same process.

Public API:
    ZONES               — list of zone dicts [{id, name}, ...]
    zone_windows        — dict[zone_id, list[reading]]  (max 20 readings each)
    zone_anomaly        — dict[zone_id, {type, ticks_remaining}]
    generate_normal_reading(zone_index, tick) -> dict
    apply_anomaly(reading, anomaly_type)      -> dict
    inject_anomaly(zone_id, anomaly_type, ticks) -> str | None
    advance_tick(tick, db)                    -> list[dict]  (async)
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.detection import lstm_anomaly_score, water_quality_score

# ---------------------------------------------------------------------------
# Zone registry
# ---------------------------------------------------------------------------

ZONES: list[dict] = [
    {"id": "Z1", "name": "Gweru CBD"},
    {"id": "Z2", "name": "Mkoba Township"},
    {"id": "Z3", "name": "Senga"},
    {"id": "Z4", "name": "Mambo"},
    {"id": "Z5", "name": "Ascot"},
]

# ---------------------------------------------------------------------------
# Per-zone state (module-level — shared across requests in one process)
# ---------------------------------------------------------------------------

# Sliding windows of up to 20 readings each
zone_windows: dict[str, list[dict]] = {z["id"]: [] for z in ZONES}

# Active anomaly per zone: {"type": str|None, "ticks_remaining": int}
zone_anomaly: dict[str, dict] = {
    z["id"]: {"type": None, "ticks_remaining": 0} for z in ZONES
}

# Previous scores — used to detect threshold-crossing events
_prev_lstm_scores: dict[str, float] = {z["id"]: 0.0 for z in ZONES}
_prev_quality_scores: dict[str, float] = {z["id"]: 0.0 for z in ZONES}


# ---------------------------------------------------------------------------
# Reading generators
# ---------------------------------------------------------------------------

def generate_normal_reading(zone_index: int, tick: int) -> dict:
    """
    Generate one realistic sensor reading using sin-wave variation.
    zone_index: 0-based index into ZONES list.
    tick: global simulation tick counter (any int).
    """
    flow = (
        45.0
        + math.sin(tick / 30.0 + zone_index * 1.2) * 8.0
        + random.uniform(-1.0, 1.0)
    )
    pressure = (
        3.2
        + math.sin(tick / 25.0 + zone_index * 0.8) * 0.3
        + random.uniform(-0.05, 0.05)
    )
    turbidity = 1.8 + random.uniform(0.0, 0.4) + random.uniform(-0.15, 0.15)
    ph = 7.1 + math.sin(tick / 40.0) * 0.15 + random.uniform(-0.025, 0.025)

    return {
        "flow_rate": max(0.0, flow),
        "pressure": max(0.0, pressure),
        "turbidity": max(0.0, turbidity),
        "ph": max(0.0, ph),
    }


def apply_anomaly(reading: dict, anomaly_type: str) -> dict:
    """
    Distort a reading dict to simulate a given anomaly type.
    Returns a new dict — does not mutate the input.
    """
    r = dict(reading)
    if anomaly_type == "leak":
        r["flow_rate"] = r["flow_rate"] * 0.42
        r["pressure"] = r["pressure"] * 0.55
    elif anomaly_type == "overflow":
        r["flow_rate"] = r["flow_rate"] * (2.9 + random.uniform(0.0, 0.3))
        r["pressure"] = r["pressure"] * 1.7
    elif anomaly_type == "contamination":
        r["turbidity"] = r["turbidity"] * (7.0 + random.uniform(0.0, 9.0))
        r["ph"] = r["ph"] - (1.4 + random.uniform(0.0, 0.8))
    return r


# ---------------------------------------------------------------------------
# Anomaly injection (toggle)
# ---------------------------------------------------------------------------

def inject_anomaly(
    zone_id: str,
    anomaly_type: str,
    ticks: int = 28,
) -> Optional[str]:
    """
    Inject an anomaly into a zone for `ticks` simulation steps.
    If the same anomaly type is already active, cancel it (toggle off).
    Returns the new active anomaly type string, or None if cancelled.
    Raises KeyError for unknown zone_id.
    """
    current = zone_anomaly[zone_id]
    if current["type"] == anomaly_type and current["ticks_remaining"] > 0:
        # Toggle off
        zone_anomaly[zone_id] = {"type": None, "ticks_remaining": 0}
        return None
    else:
        zone_anomaly[zone_id] = {"type": anomaly_type, "ticks_remaining": ticks}
        return anomaly_type


# ---------------------------------------------------------------------------
# Tick advancement
# ---------------------------------------------------------------------------

def _status_from_scores(lstm: float, quality: float) -> str:
    if lstm > 0.65 or quality > 0.65:
        return "critical"
    if lstm > 0.35 or quality > 0.35:
        return "warning"
    return "normal"


async def advance_tick(tick: int, db: AsyncSession) -> list[dict]:
    """
    Advance the simulation by one tick for every zone.

    For each zone:
      1. Generate a normal reading.
      2. Apply active anomaly distortion (and decrement ticks_remaining).
      3. Append to zone_windows (cap at 20).
      4. Score with lstm_anomaly_score / water_quality_score.
      5. Persist a WaterSensorReading to the DB.
      6. On threshold-crossing (score crosses 0.65 upward), persist a WaterIncident.

    Returns a list of zone-state dicts for the API response.
    Caller's get_db() dependency handles commit/rollback.
    """
    # Import here to avoid circular imports at module load time
    from app.models.water_monitor import WaterSensorReading, WaterIncident

    results: list[dict] = []

    for idx, zone in enumerate(ZONES):
        zone_id: str = zone["id"]
        zone_name: str = zone["name"]

        # 1. Base reading
        reading = generate_normal_reading(idx, tick)

        # 2. Anomaly distortion
        anom = zone_anomaly[zone_id]
        active_type: Optional[str] = None

        if anom["type"] and anom["ticks_remaining"] > 0:
            active_type = anom["type"]
            reading = apply_anomaly(reading, active_type)
            zone_anomaly[zone_id]["ticks_remaining"] -= 1
            if zone_anomaly[zone_id]["ticks_remaining"] <= 0:
                zone_anomaly[zone_id] = {"type": None, "ticks_remaining": 0}

        # 3. Append to window (max 20)
        window = zone_windows[zone_id]
        window.append(reading)
        if len(window) > 20:
            window.pop(0)

        # 4. Score
        lstm_score = lstm_anomaly_score(window)
        quality_score = water_quality_score(window)

        # 5. Persist sensor reading
        db_reading = WaterSensorReading(
            zone_id=zone_id,
            zone_name=zone_name,
            timestamp=datetime.now(timezone.utc),
            flow_rate=reading["flow_rate"],
            pressure=reading["pressure"],
            turbidity=reading["turbidity"],
            ph=reading["ph"],
            source="simulation",
        )
        db.add(db_reading)

        # 6. Threshold-crossing incidents
        prev_lstm = _prev_lstm_scores[zone_id]
        prev_quality = _prev_quality_scores[zone_id]

        if lstm_score > 0.65 and prev_lstm <= 0.65:
            # Infer incident type from active anomaly; default to "leak"
            inc_type = (
                active_type
                if active_type in ("leak", "overflow")
                else "leak"
            )
            recommendation = (
                "Suspected pipe leak or burst. Dispatch field crew to zone. "
                "Check main line pressure and isolate suspect section."
                if inc_type == "leak"
                else (
                    "Suspected sewer overflow or main burst. Alert operations team immediately. "
                    "Check downstream flow and pump station status."
                )
            )
            db.add(
                WaterIncident(
                    timestamp=datetime.now(timezone.utc),
                    zone_id=zone_id,
                    zone_name=zone_name,
                    incident_type=inc_type,
                    confidence=min(0.98, lstm_score),
                    lstm_score=lstm_score,
                    quality_score=quality_score,
                    indicators=[
                        f"LSTM anomaly score crossed threshold: {lstm_score:.3f} > 0.65"
                    ],
                    recommendation=recommendation,
                    source="simulation",
                )
            )

        if quality_score > 0.65 and prev_quality <= 0.65:
            db.add(
                WaterIncident(
                    timestamp=datetime.now(timezone.utc),
                    zone_id=zone_id,
                    zone_name=zone_name,
                    incident_type="contamination",
                    confidence=min(0.98, quality_score),
                    lstm_score=lstm_score,
                    quality_score=quality_score,
                    indicators=[
                        f"Water quality score crossed threshold: {quality_score:.3f} > 0.65"
                    ],
                    recommendation=(
                        "Water quality anomaly detected. Possible pipe corrosion or external "
                        "contamination. Issue precautionary advisory. Collect samples for lab testing."
                    ),
                    source="simulation",
                )
            )

        _prev_lstm_scores[zone_id] = lstm_score
        _prev_quality_scores[zone_id] = quality_score

        results.append(
            {
                "zone_id": zone_id,
                "zone_name": zone_name,
                "current_reading": {
                    "flow_rate": reading["flow_rate"],
                    "pressure": reading["pressure"],
                    "turbidity": reading["turbidity"],
                    "ph": reading["ph"],
                },
                "lstm_score": lstm_score,
                "quality_score": quality_score,
                "active_anomaly": active_type,
                "status": _status_from_scores(lstm_score, quality_score),
            }
        )

    return results
