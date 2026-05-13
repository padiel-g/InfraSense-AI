from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Literal, Optional

from app.models.sensor_reading import SensorReading


Prediction = Literal[
    "normal",
    "possible_leak",
    "possible_burst",
    "overflow_risk",
    "collecting_sequence",
]

VALVE_STATUS_ENCODING = {
    "closed": 0.0,
    "partially_open": 0.5,
    "open": 1.0,
    "unknown": -1.0,
}


@dataclass(frozen=True)
class SequenceDetectionResult:
    status: Prediction
    prediction: Optional[Prediction]
    confidence: Optional[float]
    message: str


def collecting_sequence_result(reading_count: int, min_sequence_length: int) -> SequenceDetectionResult:
    return SequenceDetectionResult(
        status="collecting_sequence",
        prediction=None,
        confidence=None,
        message=f"Need at least {min_sequence_length} readings before LSTM detection can run.",
    )


def run_sequence_detection(
    sequence: list[SensorReading],
    min_sequence_length: int,
) -> SequenceDetectionResult:
    ordered = _ordered(sequence)
    if len(ordered) < min_sequence_length:
        return collecting_sequence_result(len(ordered), min_sequence_length)

    rule_result = _run_rule_based_checks(ordered)
    if rule_result:
        return rule_result

    return run_lstm_detection(ordered)


def run_lstm_detection(sequence: list[SensorReading]) -> SequenceDetectionResult:
    """LSTM-ready placeholder for full-sequence leak/overflow inference.

    A trained PyTorch/TensorFlow model can replace the trend scoring below by
    consuming prepare_sequence_features(sequence) without changing the API.
    """
    ordered = _ordered(sequence)
    features = prepare_sequence_features(ordered)
    if not features:
        return SequenceDetectionResult(
            status="collecting_sequence",
            prediction=None,
            confidence=None,
            message="Need timestamped readings before LSTM detection can run.",
        )

    first = ordered[0]
    latest = ordered[-1]
    baseline = _baseline(ordered)
    pressure_drop = _pressure(first) - _pressure(latest)
    flow_increase = _flow(latest) - baseline["flow"]
    acoustic_increase = features[-1][2] - features[0][2]
    soil_increase = features[-1][3] - features[0][3]

    if pressure_drop >= 45 and flow_increase >= max(1.5, baseline["flow"] * 0.25):
        return SequenceDetectionResult(
            status="possible_leak",
            prediction="possible_leak",
            confidence=_clamp(0.68 + min(0.2, pressure_drop / 400) + min(0.1, flow_increase / 40)),
            message="Sequence trend suggests a possible leak: pressure is falling while flow is rising.",
        )

    if acoustic_increase >= 8 or soil_increase >= 10:
        return SequenceDetectionResult(
            status="possible_leak",
            prediction="possible_leak",
            confidence=_clamp(0.62 + min(0.18, max(acoustic_increase, soil_increase) / 100)),
            message="Sequence trend suggests a possible leak from acoustic or soil-moisture changes.",
        )

    return SequenceDetectionResult(
        status="normal",
        prediction="normal",
        confidence=0.72,
        message="All readings normal for the collected sequence.",
    )


def prepare_sequence_features(sequence: list[SensorReading]) -> list[list[float]]:
    """Build model input rows from timestamp-ordered readings.

    Row shape:
    [pressure_kpa, flow_lps, acoustic_db, soil_moisture_percent,
     valve_status_encoded, tank_level_percent, delta_seconds]
    """
    rows: list[list[float]] = []
    previous_timestamp: Optional[datetime] = None
    previous_acoustic = 0.0
    previous_soil = 0.0
    previous_tank = 0.0

    for reading in _ordered(sequence):
        acoustic = _optional_float(reading.acoustic_db, previous_acoustic)
        soil = _optional_float(reading.soil_moisture_percent, previous_soil)
        tank = _optional_float(reading.tank_level_percent, previous_tank)
        valve = VALVE_STATUS_ENCODING.get((reading.valve_status or "unknown").lower(), -1.0)
        delta_seconds = 0.0
        if previous_timestamp is not None:
            delta_seconds = max(0.0, (reading.timestamp - previous_timestamp).total_seconds())

        rows.append([
            _pressure(reading),
            _flow(reading),
            acoustic,
            soil,
            valve,
            tank,
            delta_seconds,
        ])

        previous_timestamp = reading.timestamp
        previous_acoustic = acoustic
        previous_soil = soil
        previous_tank = tank

    return rows


def _run_rule_based_checks(sequence: list[SensorReading]) -> Optional[SequenceDetectionResult]:
    latest = sequence[-1]
    baseline = _baseline(sequence)
    latest_pressure = _pressure(latest)
    latest_flow = _flow(latest)
    pressure_drop = _pressure(sequence[0]) - latest_pressure
    flow_increase = latest_flow - baseline["flow"]

    if (
        latest.tank_level_percent is not None
        and latest.tank_level_percent >= 95
        and (latest.valve_status or "unknown") in {"open", "partially_open"}
        and latest_flow > max(0.2, baseline["flow"] * 0.5)
    ):
        return SequenceDetectionResult(
            status="overflow_risk",
            prediction="overflow_risk",
            confidence=0.91,
            message="Overflow risk: tank level is at least 95%, the valve is open, and inflow continues.",
        )

    if pressure_drop >= 90 and flow_increase >= max(3.0, baseline["flow"] * 0.45):
        return SequenceDetectionResult(
            status="possible_burst",
            prediction="possible_burst",
            confidence=0.9,
            message="Possible burst: pressure dropped sharply while flow increased sharply.",
        )

    high_flow_vs_baseline = latest_flow >= max(8.0, baseline["flow"] * 1.5)
    if latest_pressure < 200 and high_flow_vs_baseline:
        return SequenceDetectionResult(
            status="possible_leak",
            prediction="possible_leak",
            confidence=0.84,
            message="Possible leak or burst: pressure is below 200 kPa and flow is high versus the recent baseline.",
        )

    return None


def _ordered(sequence: Iterable[SensorReading]) -> list[SensorReading]:
    return sorted(sequence, key=lambda reading: reading.timestamp)


def _baseline(sequence: list[SensorReading]) -> dict[str, float]:
    baseline_window = sequence[:-1] or sequence
    return {
        "pressure": sum(_pressure(reading) for reading in baseline_window) / len(baseline_window),
        "flow": sum(_flow(reading) for reading in baseline_window) / len(baseline_window),
    }


def _pressure(reading: SensorReading) -> float:
    if reading.pressure_kpa is not None:
        return float(reading.pressure_kpa)
    if reading.pressure_bar is not None:
        return float(reading.pressure_bar) * 100.0
    return 0.0


def _flow(reading: SensorReading) -> float:
    if reading.flow_lps is not None:
        return float(reading.flow_lps)
    if reading.flow_rate_lps is not None:
        return float(reading.flow_rate_lps)
    return 0.0


def _optional_float(value: Optional[float], fallback: float) -> float:
    return float(value) if value is not None else fallback


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)
