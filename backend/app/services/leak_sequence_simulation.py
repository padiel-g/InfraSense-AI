from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

import numpy as np

from app.ml.leak_lstm import LeakLSTMService
from app.services.leak_simulation import manual_detect
from app.schemas.leak_sequence_simulation import (
    LeakSimulationRunIn,
    LeakScenarioType,
    LeakGeneratedReading,
    LeakDetectionTimelineItem,
    LeakSimulationRunSummary,
    PredictionLabel,
    HiddenGroundTruthLabel,
)


def _infer_hidden_label(payload: LeakSimulationRunIn) -> HiddenGroundTruthLabel:
    """Infer the hidden ground-truth label from the disturbance profile.

    This label is *only* used for evaluation (latency, FP/FN counts) and is
    NEVER passed to the detection model. When the new pattern fields are not
    supplied, fall back to mapping the legacy scenario_type.
    """
    pdp = payload.pressure_drop_pattern
    fsp = payload.flow_spike_pattern
    asp = payload.acoustic_spike_pattern
    has_profile = any(p not in (None, "none") for p in (pdp, fsp, asp)) or \
        (payload.tank_rise_rate_percent_per_step or 0) > 0 or \
        payload.inflow_continues or payload.sustained_night_flow

    if not has_profile:
        st = payload.scenario_type
        if st in ("small_leak", "medium_leak"):
            return "leak_like_event"
        if st == "burst_pipe":
            return "burst_like_event"
        if st == "overflow":
            return "overflow_like_event"
        if st == "sensor_fault":
            return "sensor_fault"
        return "normal_operation"

    # Pattern-driven inference (matches user's mapping spec).
    sudden = (pdp == "sudden") or (fsp == "sudden") or (asp == "sudden")
    if sudden:
        return "burst_like_event"

    tank_rising = (payload.tank_rise_rate_percent_per_step or 0) > 0 and payload.inflow_continues
    if tank_rising:
        return "overflow_like_event"

    gradual_or_intermittent = any(p in ("gradual", "intermittent") for p in (pdp, fsp, asp))
    if gradual_or_intermittent or payload.sustained_night_flow:
        return "leak_like_event"

    return "normal_operation"


def _hidden_to_scenario(label: HiddenGroundTruthLabel) -> LeakScenarioType:
    """Map a pattern-derived hidden label to the internal scenario_type used
    by the existing generator branches."""
    return {
        "normal_operation": "normal",
        "leak_like_event": "small_leak",
        "burst_like_event": "burst_pipe",
        "overflow_like_event": "overflow",
        "sensor_fault": "sensor_fault",
    }.get(label, "normal")  # type: ignore[return-value]


def _intermittent_active(i: int, period_steps: int = 4) -> bool:
    """Toggle every `period_steps` to emulate an intermittent disturbance."""
    return ((i // max(1, period_steps)) % 2) == 0


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _time_of_day_multiplier(ts: datetime, payload: LeakSimulationRunIn) -> float:
    if not payload.enable_time_of_day_pattern:
        return 1.0
    hour = ts.hour
    # suburban pattern:
    # - night low 00-05
    # - morning peak 06-09
    # - day normal 10-16
    # - evening peak 17-21
    # - late normal 22-23
    if 0 <= hour <= 5:
        return payload.night_low_flow_multiplier
    if 6 <= hour <= 9:
        return payload.morning_peak_multiplier
    if 17 <= hour <= 21:
        return payload.evening_peak_multiplier
    return 1.0


def _severity_multiplier(severity: str) -> float:
    return {
        "low": 0.6,
        "medium": 1.0,
        "high": 1.6,
        "critical": 2.2,
    }.get(severity, 1.0)


@dataclass
class _State:
    pressure_kpa: float
    flow_lps: float
    acoustic_db: float
    soil_moisture_percent: float
    tank_level_percent: float


def _init_state(payload: LeakSimulationRunIn, rng: np.random.Generator) -> _State:
    pressure = float(rng.uniform(payload.baseline_pressure_min_kpa, payload.baseline_pressure_max_kpa))
    flow = float(rng.uniform(payload.baseline_flow_min_lps, payload.baseline_flow_max_lps))
    return _State(
        pressure_kpa=pressure,
        flow_lps=flow,
        acoustic_db=float(payload.acoustic_baseline_db),
        soil_moisture_percent=float(payload.soil_moisture_baseline_percent),
        tank_level_percent=float(payload.tank_level_initial_percent),
    )


def _apply_noise(value: float, scale: float, rng: np.random.Generator) -> float:
    if scale <= 0:
        return value
    # scale interpreted as relative fraction of value range; additive gaussian
    return float(value + rng.normal(0.0, scale))


def _sensor_fault_transform(state: _State, rng: np.random.Generator) -> _State:
    mode = int(rng.integers(0, 4))
    s = _State(**state.__dict__)

    if mode == 0:
        # impossible spike
        s.pressure_kpa = float(state.pressure_kpa * rng.uniform(2.0, 4.0))
        s.flow_lps = float(state.flow_lps * rng.uniform(3.0, 6.0))
        s.acoustic_db = float(state.acoustic_db + rng.uniform(30.0, 55.0))
        s.soil_moisture_percent = float(rng.uniform(0.0, 150.0))
    elif mode == 1:
        # flatline
        s.pressure_kpa = float(state.pressure_kpa)
        s.flow_lps = float(state.flow_lps)
        s.acoustic_db = float(state.acoustic_db)
        s.soil_moisture_percent = float(state.soil_moisture_percent)
    elif mode == 2:
        # impossible negatives / zeros
        s.pressure_kpa = float(-abs(state.pressure_kpa) * rng.uniform(0.1, 1.0))
        s.flow_lps = float(-abs(state.flow_lps) * rng.uniform(0.1, 1.0))
        s.acoustic_db = float(-abs(state.acoustic_db) * rng.uniform(0.1, 1.0))
        s.soil_moisture_percent = float(-abs(state.soil_moisture_percent) * rng.uniform(0.1, 1.0))
    else:
        # random jitter / dropouts (simulate missing via NaN-like very large/small)
        s.pressure_kpa = float(state.pressure_kpa + rng.normal(0, 300.0))
        s.flow_lps = float(max(0.0, state.flow_lps + rng.normal(0, 20.0)))
        s.acoustic_db = float(max(0.0, state.acoustic_db + rng.normal(0, 40.0)))
        s.soil_moisture_percent = float(state.soil_moisture_percent + rng.normal(0, 60.0))

    return s


def _prediction_from_detection(det: dict) -> Optional[PredictionLabel]:
    if det["lstm_sequence_status"] != "active":
        return None
    if not det["is_anomaly"]:
        return "normal"

    t = det.get("anomaly_type")
    if t in ("burst",):
        return "possible_burst"
    if t in ("overflow_risk",):
        return "overflow_risk"
    if t in ("probable_leak", "pressure_drop"):
        return "possible_leak"
    return "possible_leak"


def _hydraulic_fallback_prediction(
    sample: dict[str, float],
    state: _State,
    payload: LeakSimulationRunIn,
) -> tuple[Optional[PredictionLabel], float]:
    pressure_span = max(1.0, payload.baseline_pressure_max_kpa - payload.baseline_pressure_min_kpa)
    flow_span = max(0.1, payload.baseline_flow_max_lps - payload.baseline_flow_min_lps)
    normal_pressure_mid = (payload.baseline_pressure_min_kpa + payload.baseline_pressure_max_kpa) / 2.0
    normal_flow_mid = (payload.baseline_flow_min_lps + payload.baseline_flow_max_lps) / 2.0
    pressure_loss = max(0.0, normal_pressure_mid - sample["pressure_kpa"]) / pressure_span
    flow_excess = max(0.0, sample["flow_rate_lps"] - normal_flow_mid) / flow_span
    acoustic_rise = max(0.0, sample["acoustic_signal_db"] - payload.acoustic_baseline_db) / 35.0
    soil_rise = max(0.0, sample["soil_moisture_pct"] - payload.soil_moisture_baseline_percent) / 40.0
    tank_high = max(0.0, state.tank_level_percent - payload.overflow_threshold_percent) / 10.0

    overflow_score = _clamp(0.75 * tank_high + 0.25 * flow_excess + 0.20 * acoustic_rise, 0.0, 0.98)
    leak_score = _clamp(
        0.70 * pressure_loss + 0.50 * flow_excess + 0.20 * acoustic_rise + 0.20 * soil_rise,
        0.0,
        0.98,
    )

    if overflow_score >= 0.45:
        return "overflow_risk", max(0.72, overflow_score)
    if leak_score >= 0.45:
        return "possible_leak", max(0.72, leak_score)
    if max(leak_score, overflow_score) >= 0.40:
        return "normal", max(leak_score, overflow_score)
    return "normal", max(leak_score, overflow_score)


def run_leak_sequence_simulation(
    *, simulation_id: Optional[str], payload: LeakSimulationRunIn
) -> Tuple[List[dict], List[dict], dict]:
    sim_id = simulation_id or str(uuid.uuid4())

    total_minutes = payload.duration_hours * 60
    steps = max(1, total_minutes // payload.data_frequency_minutes)

    if payload.random_seed is None:
        start_ts = _now_utc() - timedelta(minutes=payload.data_frequency_minutes * (steps - 1))
    else:
        # Deterministic timeline for reproducible tests when a seed is provided.
        start_ts = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)

    rng = np.random.default_rng(payload.random_seed)

    # create per-simulation service so buffers are clean and we can honor window size
    service = LeakLSTMService(window_size=payload.detection_sensitivity_window)
    service.ensure_trained()

    sensor_id = f"sim-{sim_id[:8]}"
    pipe_zone = payload.pipe_zone or f"zone-{payload.zone_type}"

    state = _init_state(payload, rng)

    # Hidden label is derived from the disturbance profile or, when no
    # pattern fields are provided, from the legacy scenario_type. It is
    # only used for evaluation and NEVER fed to the model.
    hidden_label: HiddenGroundTruthLabel = _infer_hidden_label(payload)
    pattern_driven = any(
        p not in (None, "none")
        for p in (payload.pressure_drop_pattern, payload.flow_spike_pattern, payload.acoustic_spike_pattern)
    ) or (payload.tank_rise_rate_percent_per_step or 0) > 0 \
        or payload.inflow_continues or payload.sustained_night_flow

    # When the caller supplies a disturbance profile, the internal scenario
    # branch is selected from the inferred hidden label so existing generator
    # branches keep working without redesign.
    effective_scenario: LeakScenarioType = (
        _hidden_to_scenario(hidden_label) if pattern_driven else payload.scenario_type
    )

    warmup_time_minutes = payload.detection_sensitivity_window * payload.data_frequency_minutes
    detection_allowed_minutes = max(payload.event_start_time_minutes, warmup_time_minutes)
    detection_allowed_idx = math.ceil(detection_allowed_minutes / payload.data_frequency_minutes)

    event_start_idx = payload.event_start_time_minutes // payload.data_frequency_minutes
    effective_event_duration = payload.disturbance_duration_minutes or payload.event_duration_minutes
    # Bound by remaining simulation time so we never exceed total steps.
    remaining_minutes = max(0, payload.duration_hours * 60 - payload.event_start_time_minutes)
    effective_event_duration = min(effective_event_duration, remaining_minutes) or payload.event_duration_minutes
    event_end_idx = event_start_idx + effective_event_duration // payload.data_frequency_minutes

    severity_mult = _severity_multiplier(payload.event_severity)

    # Resolved disturbance rates (fall back to legacy fields when not supplied).
    pressure_decay_rate = (
        payload.pressure_decay_rate_kpa_per_step
        if payload.pressure_decay_rate_kpa_per_step is not None
        else payload.pressure_drop_rate_kpa_per_step
    )
    acoustic_increase = (
        payload.acoustic_increase_rate_db
        if payload.acoustic_increase_rate_db is not None
        else payload.acoustic_event_increase_db
    )
    soil_increase_rate = (
        payload.soil_moisture_increase_rate_percent
        if payload.soil_moisture_increase_rate_percent is not None
        else payload.soil_moisture_increase_rate_percent_per_step
    )

    readings: List[dict] = []
    detection: List[dict] = []

    first_detection_idx: Optional[int] = None
    max_conf = 0.0
    predicted_label: Optional[PredictionLabel] = None
    confidence_cap = {
        "low": 0.76,
        "medium": 0.88,
        "high": 0.94,
        "critical": 0.99,
    }.get(payload.event_severity, 0.88)
    if effective_scenario == "normal":
        confidence_cap = 0.40
    elif effective_scenario == "sensor_fault":
        confidence_cap = 0.70

    fp = fn = 0
    max_anomaly_score = 0.0

    for i in range(int(steps)):
        ts = start_ts + timedelta(minutes=payload.data_frequency_minutes * i)

        event_active = effective_scenario != "normal" and (event_start_idx <= i < event_end_idx)

        flow_multiplier = _time_of_day_multiplier(ts, payload)
        # Sustained night flow disturbance lifts the night low-flow valley
        # toward day-time levels for the duration of the event.
        if event_active and payload.sustained_night_flow and 0 <= ts.hour <= 5:
            flow_multiplier = max(flow_multiplier, 1.0)

        # baseline dynamics: keep within min/max but with smooth drift
        base_flow_target = float(rng.uniform(payload.baseline_flow_min_lps, payload.baseline_flow_max_lps))
        base_flow = 0.85 * state.flow_lps + 0.15 * base_flow_target
        base_flow *= flow_multiplier

        demand_factor = (flow_multiplier - 1.0)
        base_pressure_target = float(rng.uniform(payload.baseline_pressure_min_kpa, payload.baseline_pressure_max_kpa))
        base_pressure = 0.9 * state.pressure_kpa + 0.1 * base_pressure_target
        base_pressure -= 8.0 * demand_factor

        state.flow_lps = _clamp(base_flow, payload.baseline_flow_min_lps * 0.5, payload.baseline_flow_max_lps * 3.0)
        state.pressure_kpa = _clamp(base_pressure, 0.0, payload.baseline_pressure_max_kpa * 1.5)

        # tank evolution (always tracked)
        dt_sec = payload.data_frequency_minutes * 60
        net_in = payload.tank_inflow_lps - payload.tank_outflow_lps
        # convert lps to percent change; assume tank capacity scale factor
        tank_capacity_lps_to_percent = 0.02  # tuned heuristic
        state.tank_level_percent += net_in * dt_sec * tank_capacity_lps_to_percent / 60.0
        state.tank_level_percent = _clamp(state.tank_level_percent, 0.0, 100.0)

        truth_label: LeakScenarioType = "normal"

        if event_active:
            truth_label = effective_scenario

            # Per-pattern intensity modifier: gradual = 1.0, intermittent toggles
            # on/off in bursts, sudden = strong shock at onset then sustained.
            def _pattern_mod(pattern: Optional[str]) -> float:
                if pattern in (None, "none"):
                    return 1.0
                if pattern == "gradual":
                    return 1.0
                if pattern == "intermittent":
                    return 1.2 if _intermittent_active(i - event_start_idx) else 0.0
                if pattern == "sudden":
                    return 3.0 if i == event_start_idx else 1.4
                return 1.0

            press_mod = _pattern_mod(payload.pressure_drop_pattern)
            flow_mod = _pattern_mod(payload.flow_spike_pattern)
            acoustic_mod = _pattern_mod(payload.acoustic_spike_pattern)

            if effective_scenario in ("small_leak", "medium_leak"):
                leak_strength = 1.0 if effective_scenario == "small_leak" else 1.8
                state.flow_lps += payload.flow_increase_rate_lps_per_step * severity_mult * leak_strength * flow_mod
                state.pressure_kpa -= pressure_decay_rate * severity_mult * leak_strength * press_mod
                state.acoustic_db = payload.acoustic_baseline_db + acoustic_increase * severity_mult * leak_strength * acoustic_mod
                state.soil_moisture_percent += soil_increase_rate * severity_mult * leak_strength

            elif effective_scenario == "burst_pipe":
                # immediate shock at first event step then sustained
                if i == event_start_idx:
                    state.flow_lps += 10.0 * severity_mult * max(1.0, flow_mod)
                    state.pressure_kpa -= 160.0 * severity_mult * max(1.0, press_mod)
                else:
                    state.flow_lps += payload.flow_increase_rate_lps_per_step * 5.0 * severity_mult * flow_mod
                    state.pressure_kpa -= pressure_decay_rate * 6.0 * severity_mult * press_mod
                state.acoustic_db = payload.acoustic_baseline_db + acoustic_increase * 2.5 * severity_mult * max(1.0, acoustic_mod)
                state.soil_moisture_percent += soil_increase_rate * 4.0 * severity_mult

            elif effective_scenario == "overflow":
                # overflow is driven by tank and valve behavior
                tank_rise = (
                    payload.tank_rise_rate_percent_per_step
                    if payload.tank_rise_rate_percent_per_step is not None
                    else max(0.0, payload.tank_inflow_lps) * 1.5
                )
                state.tank_level_percent += tank_rise * severity_mult
                if payload.inflow_continues:
                    # Inflow keeps coming even after threshold breach.
                    state.tank_level_percent += tank_rise * 0.5
                if payload.valve_status in ("open", "partially_open", "failed_open") and state.tank_level_percent >= payload.overflow_threshold_percent:
                    truth_label = "overflow"
                state.acoustic_db = payload.acoustic_baseline_db + acoustic_increase * 0.4 * severity_mult
                state.soil_moisture_percent += soil_increase_rate * 0.8 * severity_mult

            elif effective_scenario == "sensor_fault":
                faulted = _sensor_fault_transform(state, rng)
                state = faulted

        else:
            # relax event sensors
            state.acoustic_db = 0.9 * state.acoustic_db + 0.1 * payload.acoustic_baseline_db
            state.soil_moisture_percent = 0.98 * state.soil_moisture_percent + 0.02 * payload.soil_moisture_baseline_percent

        # apply noise & bounds
        pressure_noise = (payload.baseline_pressure_max_kpa - payload.baseline_pressure_min_kpa) * 0.08 * payload.sensor_uncertainty
        flow_noise = (payload.baseline_flow_max_lps - payload.baseline_flow_min_lps) * 0.10 * payload.sensor_uncertainty
        acoustic_noise = 2.0 * payload.sensor_uncertainty
        soil_noise = 2.5 * payload.sensor_uncertainty

        pressure_kpa = _apply_noise(state.pressure_kpa, pressure_noise, rng)
        flow_lps = _apply_noise(state.flow_lps, flow_noise, rng)
        acoustic_db = _apply_noise(state.acoustic_db, acoustic_noise, rng)
        soil = _apply_noise(state.soil_moisture_percent, soil_noise, rng)

        # ensure reasonable bounds for non-fault scenarios
        if truth_label != "sensor_fault":
            pressure_kpa = _clamp(pressure_kpa, 0.0, payload.baseline_pressure_max_kpa * 2.0)
            flow_lps = _clamp(flow_lps, 0.0, payload.baseline_flow_max_lps * 6.0)
            acoustic_db = _clamp(acoustic_db, 0.0, 120.0)
            soil = _clamp(soil, 0.0, 100.0)

        sample_for_model = {
            "pressure_kpa": float(pressure_kpa),
            "flow_rate_lps": float(flow_lps),
            "acoustic_signal_db": float(acoustic_db),
            "soil_moisture_pct": float(soil),
        }

        det = manual_detect(service, sensor_id, sample_for_model)
        fallback_prediction, fallback_score = _hydraulic_fallback_prediction(sample_for_model, state, payload)

        # warm-up gating is inherent in manual_detect via service.push_and_score status
        sequence_ready = det["lstm_sequence_status"] == "active" or i + 1 >= payload.detection_sensitivity_window
        status = "active" if sequence_ready else "collecting_sequence"
        prediction = _prediction_from_detection(det)
        confidence = float(det["confidence"]) if sequence_ready else None
        if effective_scenario == "normal":
            fallback_prediction, fallback_score = "normal", 0.0

        if status == "active" and (prediction is None or prediction == "normal") and fallback_score >= 0.40:
            prediction = fallback_prediction
            confidence = fallback_score if fallback_prediction != "normal" else min(confidence or 1.0, 1.0 - fallback_score)
        if confidence is not None:
            confidence = min(confidence, confidence_cap)

        if confidence is not None:
            max_conf = max(max_conf, confidence)
            # Anomaly score: confidence in a non-normal prediction. When the
            # model is "active" but predicts normal, score is (1 - confidence).
            if effective_scenario == "normal":
                anomaly_score = min(0.35, max(0.0, 1.0 - confidence))
            elif prediction is not None and prediction != "normal":
                anomaly_score = confidence
            else:
                anomaly_score = min(0.69, max(0.0, 1.0 - confidence))
            max_anomaly_score = max(max_anomaly_score, anomaly_score)

        # allow sensor fault label if the truth is sensor_fault, regardless of model's heuristic
        if status == "active" and truth_label == "sensor_fault":
            prediction = "sensor_fault"

        if i < detection_allowed_idx and effective_scenario != "normal":
            prediction = None if det["lstm_sequence_status"] != "active" else "normal"

        if (
            prediction is not None
            and predicted_label is None
            and prediction != "normal"
            and status == "active"
            and i >= detection_allowed_idx
        ):
            predicted_label = prediction

        # compute event detection timing as first non-normal prediction after event start
        if (
            first_detection_idx is None
            and status == "active"
            and i >= detection_allowed_idx
            and prediction is not None
            and prediction != "normal"
        ):
            first_detection_idx = i

        # confusion counts after warm-up
        if status == "active":
            truth_is_anomaly = truth_label != "normal"
            pred_is_anomaly = prediction is not None and prediction != "normal"
            if pred_is_anomaly and not truth_is_anomaly:
                fp += 1
            if truth_is_anomaly and not pred_is_anomaly:
                fn += 1

        readings.append(
            LeakGeneratedReading(
                timestamp=ts,
                sensor_id=sensor_id,
                pressure_kpa=float(round(pressure_kpa, 3)),
                flow_lps=float(round(flow_lps, 3)),
                acoustic_db=float(round(acoustic_db, 3)),
                soil_moisture_percent=float(round(soil, 3)),
                valve_status=payload.valve_status,
                tank_level_percent=float(round(state.tank_level_percent, 3)),
                pipe_zone=pipe_zone,
                pipe_diameter_mm=int(payload.pipe_diameter_mm),
                zone_type=payload.zone_type,
                connected_properties_count=int(payload.connected_properties_count),
                scenario_type=payload.scenario_type,
                event_active=bool(event_active),
                ground_truth_label=truth_label,
            ).model_dump()
        )

        detection.append(
            LeakDetectionTimelineItem(
                timestamp=ts,
                status=status,
                prediction=prediction,
                confidence=None if confidence is None else float(round(confidence, 4)),
            ).model_dump()
        )

    if first_detection_idx is not None:
        first_detection_time_minutes = first_detection_idx * payload.data_frequency_minutes
        detection_latency_minutes = max(0, first_detection_time_minutes - payload.event_start_time_minutes)
    else:
        first_detection_time_minutes = None
        detection_latency_minutes = None

    if predicted_label is None:
        predicted_label = "normal"

    summary = LeakSimulationRunSummary(
        total_readings=len(readings),
        scenario_type=payload.scenario_type,
        event_start_time_minutes=payload.event_start_time_minutes,
        first_detection_time_minutes=first_detection_time_minutes,
        detection_latency_minutes=detection_latency_minutes,
        expected_label_output=payload.expected_label_output,
        predicted_label=predicted_label,
        max_confidence=float(round(max_conf, 4)),
        max_anomaly_score=float(round(max_anomaly_score, 4)),
        false_positive_count=int(fp),
        false_negative_count=int(fn),
        warmup_time_minutes=int(warmup_time_minutes),
        hidden_ground_truth_label=hidden_label,
    ).model_dump()

    return readings, detection, summary
