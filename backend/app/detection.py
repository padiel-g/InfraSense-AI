"""
Water infrastructure anomaly detection — pure Python / NumPy.
No PyTorch / TensorFlow dependency.

Exports:
    lstm_anomaly_score(readings)  -> float 0.0–1.0
    water_quality_score(readings) -> float 0.0–1.0
    classify_manual(flow_rate, pressure, turbidity, ph) -> DetectionResult
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import numpy as np


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class DetectionResult:
    incident_type: str          # "normal" | "leak" | "overflow" | "contamination"
    confidence: float           # 0.0 – 0.98
    lstm_score: float           # 0.0 – 1.0
    quality_score: float        # 0.0 – 1.0
    indicators: List[str] = field(default_factory=list)
    recommendation: str = ""


# ---------------------------------------------------------------------------
# LSTM-style sliding-window anomaly scorer
# ---------------------------------------------------------------------------

def lstm_anomaly_score(readings: list[dict]) -> float:
    """
    Accepts a list of dicts with keys: flow_rate, pressure.
    Uses a sliding window of up to 20 readings.
    Returns a float 0.0–1.0 indicating anomaly severity.
    """
    if len(readings) < 10:
        return 0.0

    window = readings[-20:]  # cap at last 20

    flows = np.array([r["flow_rate"] for r in window], dtype=float)
    pressures = np.array([r["pressure"] for r in window], dtype=float)

    # Recent = last 5, older = positions [−15, −5)
    recent_flows = flows[-5:]
    older_flows = flows[-15:-5] if len(flows) >= 15 else flows[: len(flows) - 5]

    recent_pressures = pressures[-5:]
    older_pressures = (
        pressures[-15:-5] if len(pressures) >= 15 else pressures[: len(pressures) - 5]
    )

    if len(older_flows) == 0 or len(older_pressures) == 0:
        return 0.0

    recent_mean_flow = float(np.mean(recent_flows))
    older_mean_flow = float(np.mean(older_flows))
    recent_mean_pressure = float(np.mean(recent_pressures))
    older_mean_pressure = float(np.mean(older_pressures))

    flow_delta = (
        abs(recent_mean_flow - older_mean_flow) / abs(older_mean_flow)
        if older_mean_flow != 0
        else 0.0
    )
    pressure_delta = (
        abs(recent_mean_pressure - older_mean_pressure) / abs(older_mean_pressure)
        if older_mean_pressure != 0
        else 0.0
    )
    recent_std = (
        float(np.std(recent_flows)) / abs(recent_mean_flow)
        if recent_mean_flow != 0
        else 0.0
    )

    score = float(
        min(1.0, flow_delta * 1.9 + pressure_delta * 1.3 + recent_std * 0.5)
    )
    return score


# ---------------------------------------------------------------------------
# Water quality scorer
# ---------------------------------------------------------------------------

def water_quality_score(readings: list[dict]) -> float:
    """
    Accepts a list of dicts with keys: turbidity, ph.
    Uses the last 3 readings.
    Returns a float 0.0–1.0.
    """
    if not readings:
        return 0.0

    last3 = readings[-3:]
    avg_turbidity = float(np.mean([r["turbidity"] for r in last3]))
    avg_ph = float(np.mean([r["ph"] for r in last3]))

    turb_score = max(0.0, (avg_turbidity - 2.5) / 8.0) * 1.6
    ph_score = max(0.0, (abs(avg_ph - 7.0) - 0.5) / 2.0) * 1.3

    return float(min(1.0, turb_score + ph_score))


# ---------------------------------------------------------------------------
# Single-reading rule-based classifier (manual entry)
# ---------------------------------------------------------------------------

# Thresholds
_FLOW_NORMAL_MIN = 35.0
_FLOW_NORMAL_MAX = 60.0
_FLOW_LEAK_BELOW = 25.0
_FLOW_OVERFLOW_ABOVE = 80.0

_PRESSURE_NORMAL_MIN = 2.8
_PRESSURE_NORMAL_MAX = 3.8
_PRESSURE_LEAK_BELOW = 2.0
_PRESSURE_OVERFLOW_ABOVE = 5.0

_TURBIDITY_NORMAL = 4.0
_TURBIDITY_WARNING = 8.0
_TURBIDITY_CRITICAL = 15.0

_PH_NORMAL_LOW = 6.5
_PH_NORMAL_HIGH = 8.5
_PH_CRITICAL_LOW = 5.5
_PH_CRITICAL_HIGH = 9.5

_RECOMMENDATIONS = {
    "leak": (
        "Suspected pipe leak or burst. Dispatch field crew to zone. "
        "Check main line pressure and isolate suspect section."
    ),
    "overflow": (
        "Suspected sewer overflow or main burst. Alert operations team immediately. "
        "Check downstream flow and pump station status."
    ),
    "contamination": (
        "Water quality anomaly detected. Possible pipe corrosion or external contamination. "
        "Issue precautionary advisory. Collect samples for lab testing."
    ),
    "normal": "All readings within acceptable ranges. No action required.",
}


def classify_manual(
    flow_rate: float,
    pressure: float,
    turbidity: float,
    ph: float,
) -> DetectionResult:
    """
    Rule-based instant classifier for a single manual sensor reading.
    Returns a DetectionResult with incident_type, confidence, and human-readable indicators.
    """
    indicators: list[str] = []
    leak_score = 0.0
    overflow_score = 0.0
    contam_score = 0.0

    # ---- Flow / Leak -------------------------------------------------------
    if flow_rate < _FLOW_LEAK_BELOW:
        leak_score += 0.50
        indicators.append(
            f"Flow rate critically low: {flow_rate:.1f} L/s "
            f"(critical threshold {_FLOW_LEAK_BELOW} L/s)"
        )
    elif flow_rate < _FLOW_NORMAL_MIN:
        leak_score += 0.25
        indicators.append(
            f"Flow rate below normal: {flow_rate:.1f} L/s "
            f"(normal range {_FLOW_NORMAL_MIN}–{_FLOW_NORMAL_MAX} L/s)"
        )

    # ---- Pressure / Leak ---------------------------------------------------
    if pressure < _PRESSURE_LEAK_BELOW:
        leak_score += 0.45
        indicators.append(
            f"Pressure critically low: {pressure:.2f} bar "
            f"(critical threshold {_PRESSURE_LEAK_BELOW} bar)"
        )
    elif pressure < _PRESSURE_NORMAL_MIN:
        leak_score += 0.20
        indicators.append(
            f"Pressure below normal: {pressure:.2f} bar "
            f"(normal range {_PRESSURE_NORMAL_MIN}–{_PRESSURE_NORMAL_MAX} bar)"
        )

    # ---- Flow / Overflow ---------------------------------------------------
    if flow_rate > _FLOW_OVERFLOW_ABOVE:
        overflow_score += 0.50
        indicators.append(
            f"Flow rate critically high: {flow_rate:.1f} L/s "
            f"(overflow threshold {_FLOW_OVERFLOW_ABOVE} L/s)"
        )
    elif flow_rate > _FLOW_NORMAL_MAX:
        overflow_score += 0.25
        indicators.append(
            f"Flow rate above normal: {flow_rate:.1f} L/s "
            f"(normal range {_FLOW_NORMAL_MIN}–{_FLOW_NORMAL_MAX} L/s)"
        )

    # ---- Pressure / Overflow -----------------------------------------------
    if pressure > _PRESSURE_OVERFLOW_ABOVE:
        overflow_score += 0.45
        indicators.append(
            f"Pressure critically high: {pressure:.2f} bar "
            f"(overflow threshold {_PRESSURE_OVERFLOW_ABOVE} bar)"
        )
    elif pressure > _PRESSURE_NORMAL_MAX:
        overflow_score += 0.20
        indicators.append(
            f"Pressure above normal: {pressure:.2f} bar "
            f"(normal range {_PRESSURE_NORMAL_MIN}–{_PRESSURE_NORMAL_MAX} bar)"
        )

    # ---- Turbidity ---------------------------------------------------------
    if turbidity > _TURBIDITY_CRITICAL:
        contam_score += 0.55
        indicators.append(
            f"Turbidity critical: {turbidity:.1f} NTU "
            f"(critical threshold >{_TURBIDITY_CRITICAL} NTU)"
        )
    elif turbidity > _TURBIDITY_WARNING:
        contam_score += 0.35
        indicators.append(
            f"Turbidity elevated: {turbidity:.1f} NTU "
            f"(warning threshold >{_TURBIDITY_WARNING} NTU)"
        )
    elif turbidity > _TURBIDITY_NORMAL:
        contam_score += 0.15
        indicators.append(
            f"Turbidity above normal: {turbidity:.1f} NTU "
            f"(normal <{_TURBIDITY_NORMAL} NTU)"
        )

    # ---- pH ----------------------------------------------------------------
    if ph < _PH_CRITICAL_LOW or ph > _PH_CRITICAL_HIGH:
        contam_score += 0.40
        indicators.append(
            f"pH critical: {ph:.2f} "
            f"(critical range <{_PH_CRITICAL_LOW} or >{_PH_CRITICAL_HIGH})"
        )
    elif ph < _PH_NORMAL_LOW or ph > _PH_NORMAL_HIGH:
        contam_score += 0.20
        indicators.append(
            f"pH outside normal range: {ph:.2f} "
            f"(normal {_PH_NORMAL_LOW}–{_PH_NORMAL_HIGH})"
        )

    # ---- Classify ----------------------------------------------------------
    max_score = max(leak_score, overflow_score, contam_score)

    if max_score < 0.25:
        incident_type = "normal"
        confidence = 0.0
        if not indicators:
            indicators.append("All parameters within acceptable ranges.")
    elif leak_score >= overflow_score and leak_score >= contam_score:
        incident_type = "leak"
        confidence = min(0.98, leak_score)
    elif overflow_score >= leak_score and overflow_score >= contam_score:
        incident_type = "overflow"
        confidence = min(0.98, overflow_score)
    else:
        incident_type = "contamination"
        confidence = min(0.98, contam_score)

    # Quality score from the single reading
    q_score = water_quality_score([{"turbidity": turbidity, "ph": ph}])

    return DetectionResult(
        incident_type=incident_type,
        confidence=confidence,
        lstm_score=0.0,        # single-point manual — no window history
        quality_score=q_score,
        indicators=indicators,
        recommendation=_RECOMMENDATIONS[incident_type],
    )
