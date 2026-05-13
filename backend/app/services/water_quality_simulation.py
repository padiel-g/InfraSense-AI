"""
Synthetic-trajectory generator + scoring for the water-quality module.

Enhanced to support realistic, sequence-based anomaly generation with:
- 7 water quality parameters: turbidity, pH, flow, pressure, temperature,
  chlorine, conductivity
- 5 event types: normal, gradual_corrosion, gradual_contamination,
  sediment_disturbance, sensor_fault
- Event severity levels: low, medium, high, critical
- Ground truth labels for evaluation
- Detection window warmup handling
- Reproducible results via random_seed

Each scenario produces a sequence of readings with per-sample ground-truth labels.
The detector is run over the trajectory exactly as it would on live data.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from app.ml.water_quality import WaterQualityDetector
from app.schemas.water_quality import WQSimulationRunIn


# Per-material corrosion susceptibility multiplier
_MATERIAL_FACTOR = {
    "cast_iron": 1.0,
    "galvanized": 0.95,
    "copper": 0.55,
    "pvc": 0.15,
    "hdpe": 0.10,
}


# Event severity multipliers
_SEVERITY_FACTOR = {
    "low": 0.5,
    "medium": 1.0,
    "high": 1.5,
    "critical": 2.0,
}


@dataclass
class _Sample:
    """Internal representation of a simulated reading."""

    timestamp: datetime
    turbidity: float
    ph: float
    flow: float
    pressure: float
    temperature: float
    chlorine: float
    conductivity: float
    ground_truth_label: Optional[str] = None
    event_active: bool = False


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ── Scenario generators ────────────────────────────────────────────────

def _baseline_tuple(
    baseline: dict,
    noise: float,
    rng: random.Random,
    interval_minutes: int,
) -> Tuple[float, float, float, float, float, float, float]:
    """
    Generate baseline draw with daily variation.

    Returns:
        turbidity, pH, flow, pressure, temperature, chlorine, conductivity
    """
    daily_factor = 1.0 + 0.15 * math.sin(rng.random() * 2 * math.pi)

    turbidity = max(
        0.0,
        rng.gauss(baseline["turbidity"], 0.3 * (1 + noise)),
    )

    ph = baseline["ph"] + rng.gauss(0, 0.1 * (1 + noise))

    flow = max(
        0.0,
        rng.gauss(
            baseline["flow_lps"] * daily_factor,
            baseline["flow_lps"] * 0.15 * (1 + noise),
        ),
    )

    pressure = max(
        0.0,
        rng.gauss(
            baseline["pressure_kpa"],
            baseline["pressure_kpa"] * 0.05 * (1 + noise),
        ),
    )

    temperature = baseline["temperature_c"] + rng.gauss(0, 1.0 * (1 + noise))

    chlorine = max(
        0.0,
        rng.gauss(
            baseline["chlorine_mg_l"],
            baseline["chlorine_mg_l"] * 0.1 * (1 + noise),
        ),
    )

    conductivity = max(
        0.0,
        baseline["conductivity_us_cm"]
        + rng.gauss(0, baseline["conductivity_us_cm"] * 0.01 * (1 + noise)),
    )

    return turbidity, ph, flow, pressure, temperature, chlorine, conductivity


def _generate(
    scenario: str,
    n: int,
    interval_min: int,
    noise: float,
    rng: random.Random,
    baseline: dict,
    event_start_idx: int,
    event_duration_idx: int,
    event_severity: str,
    rates: dict,
    pipe_age_years: float,
    pipe_material: str,
    start_time: Optional[datetime] = None,
) -> List[_Sample]:
    """Generate n samples for the given scenario."""
    out: List[_Sample] = []
    start = (start_time or _now_utc()) - timedelta(minutes=interval_min * (n - 1))

    severity_mult = _SEVERITY_FACTOR.get(event_severity, 1.0)
    mat_factor = _MATERIAL_FACTOR.get((pipe_material or "cast_iron").lower(), 0.7)
    age_factor = min(max(pipe_age_years, 0.0) / 50.0, 1.0)
    corrosion_mult = 0.6 + 0.4 * age_factor * mat_factor

    event_end_idx = min(n, event_start_idx + max(1, event_duration_idx))

    for i in range(n):
        ts = start + timedelta(minutes=interval_min * i)

        (
            turb,
            ph,
            flow,
            pressure,
            temp,
            chlorine,
            conductivity,
        ) = _baseline_tuple(baseline, noise, rng, interval_min)

        ground_truth_label: Optional[str] = None
        event_active = False

        if scenario == "normal":
            pass

        elif scenario == "gradual_corrosion":
            if event_start_idx <= i < event_end_idx:
                event_active = True
                progress = (i - event_start_idx + 1) / max(1, (event_end_idx - event_start_idx))

                steps = (i - event_start_idx + 1)

                turb += (
                    rates["turbidity_increase"]
                    * steps
                    * severity_mult
                    * corrosion_mult
                )
                ph -= (
                    rates["ph_change"]
                    * steps
                    * severity_mult
                    * corrosion_mult
                )
                conductivity += (
                    rates["conductivity_increase"]
                    * steps
                    * severity_mult
                    * corrosion_mult
                )
                chlorine *= max(
                    0.35,
                    1.0 - rates["chlorine_decay"] * steps * severity_mult * 0.25,
                )

                ground_truth_label = "gradual_corrosion"

        elif scenario == "gradual_contamination":
            if event_start_idx <= i < event_end_idx:
                event_active = True
                progress = (i - event_start_idx + 1) / max(1, (event_end_idx - event_start_idx))
                steps = i - event_start_idx + 1

                turb += rates["turbidity_increase"] * steps * severity_mult
                chlorine *= max(
                    0.05,
                    1.0 - rates["chlorine_decay"] * steps * severity_mult,
                )
                ph += (
                    (-0.25 if rng.random() > 0.5 else 0.15)
                    * progress
                    * severity_mult
                )
                conductivity += (
                    rates["conductivity_increase"]
                    * steps
                    * severity_mult
                    * 0.45
                    + rng.gauss(0, baseline["conductivity_us_cm"] * 0.012 * progress)
                )
                pressure -= rates["pressure_drop"] * steps * severity_mult

                ground_truth_label = "gradual_contamination"

        elif scenario == "sediment_disturbance":
            if event_start_idx <= i < event_end_idx:
                event_active = True
                progress = (i - event_start_idx + 1) / max(1, (event_end_idx - event_start_idx))

                spike = (6.0 + 10.0 * (1.0 - abs(2 * progress - 1.0))) * severity_mult
                turb += spike
                flow *= 1.0 + 0.35 * progress * severity_mult

                ground_truth_label = "sediment_disturbance"

        elif scenario == "sensor_fault":
            if event_start_idx <= i < event_end_idx:
                relative_idx = i - event_start_idx
                if relative_idx in {0, 3, 7}:
                    event_active = True
                    turb += rng.uniform(3.5, 5.5) * severity_mult
                    if rng.random() > 0.5:
                        ph += rng.choice([-0.35, 0.35]) * severity_mult
                    else:
                        conductivity += rng.uniform(20, 45) * severity_mult
                    ground_truth_label = "sensor_fault"

        # Clamp values to physical bounds expected by API
        turb = max(0.0, turb)
        ph = max(0.0, min(14.0, ph))
        flow = max(0.0, flow)
        pressure = max(0.0, pressure)
        chlorine = max(0.0, chlorine)
        conductivity = max(0.0, conductivity)

        out.append(
            _Sample(
                timestamp=ts,
                turbidity=turb,
                ph=ph,
                flow=flow,
                pressure=pressure,
                temperature=temp,
                chlorine=chlorine,
                conductivity=conductivity,
                ground_truth_label=ground_truth_label if event_active else "normal",
                event_active=event_active,
            )
        )

    return out


# ── Detection helpers ──────────────────────────────────────────────────

def detect_one(
    detector: WaterQualityDetector,
    *,
    sensor_id: str,
    turbidity: float,
    ph: float,
    flow: float,
    pressure: Optional[float] = None,
    chlorine: Optional[float] = None,
    conductivity: Optional[float] = None,
    pipe_age: Optional[float],
    pipe_material: Optional[str],
) -> dict:
    """
    Run one detector step and compute the response fields the API needs:
    anomaly_type, severity, corrosion_risk_score.
    """
    result = detector.update(
        {
            "sensor_id": sensor_id,
            "turbidity_ntu": turbidity,
            "ph": ph,
            "flow_rate_lps": flow,
            "pressure_kpa": pressure if pressure is not None else 350.0,
            "residual_chlorine_mg_l": chlorine if chlorine is not None else 0.35,
            "conductivity_us_cm": conductivity if conductivity is not None else 400.0,
        }
    )

    score = float(result["score"])
    reasons = result["reasons"]
    is_anom = bool(result["is_contamination"])

    anomaly_type: Optional[str] = None

    if is_anom:
        if "corrosion_signature" in reasons:
            anomaly_type = "possible_corrosion"
        elif any(r.startswith("ph_") for r in reasons):
            anomaly_type = "ph_deviation"
        elif "sediment_disturbance_signal" in reasons:
            anomaly_type = "possible_sediment_disturbance"
        elif "sensor_fault_signal" in reasons:
            anomaly_type = "sensor_fault_suspected"
        else:
            anomaly_type = "possible_contamination"

    if score >= 0.85:
        severity = "critical"
    elif score >= 0.70:
        severity = "high"
    elif score >= 0.50:
        severity = "medium"
    else:
        severity = "low"

    age = pipe_age if pipe_age is not None else 20.0
    mat = (pipe_material or "cast_iron").lower()

    age_factor = min(age / 50.0, 1.0)
    mat_factor = _MATERIAL_FACTOR.get(mat, 0.7)

    corrosion = (
        0.55 * score
        + 0.30 * age_factor * mat_factor
        + (0.30 if anomaly_type == "corrosion_indicator" else 0.0)
    )

    corrosion = max(0.0, min(1.0, corrosion))

    return {
        "is_anomaly": is_anom,
        "anomaly_type": anomaly_type,
        "confidence": score,
        "severity": severity,
        "corrosion_risk": corrosion,
        "reasons": reasons,
    }


def message_for(result: dict) -> str:
    if not result["is_anomaly"]:
        return "Reading within normal operating range."

    bits = [r.replace("_", " ") for r in result["reasons"][:3]]
    label = (result["anomaly_type"] or "possible anomaly").replace("_", " ")

    if bits:
        return f"{label.capitalize()} detected: {', '.join(bits)}."

    return f"{label.capitalize()} detected."


# ── Public: simulate end-to-end ─────────────────────────────────────────

def simulate_enhanced(
    *,
    scenario: str,
    n: int,
    interval_min: int,
    noise: float,
    sensor_id: str,
    pipe_age: float,
    pipe_material: str,
    baseline: dict,
    event_start_minutes: int,
    event_duration_minutes: int,
    event_severity: str,
    rates: dict,
    detection_window_size: int,
    seed: Optional[int] = None,
) -> Tuple[List[dict], dict, Optional[datetime], Optional[datetime]]:
    """
    Generate samples with enhanced parameters, run detector, return readings
    plus summary.

    Returns:
        readings,
        summary,
        event_start_time,
        first_detection_time
    """
    rng = random.Random(seed)

    event_start_idx = event_start_minutes // interval_min
    event_duration_idx = event_duration_minutes // interval_min
    detection_warmup_idx = detection_window_size

    samples = _generate(
        scenario=scenario,
        n=n,
        interval_min=interval_min,
        noise=noise,
        rng=rng,
        baseline=baseline,
        event_start_idx=event_start_idx,
        event_duration_idx=event_duration_idx,
        event_severity=event_severity,
        rates=rates,
        pipe_age_years=pipe_age,
        pipe_material=pipe_material,
    )

    detector = WaterQualityDetector()

    readings: List[dict] = []

    tp = fp = tn = fn = 0
    risk_total = 0.0

    first_detection_time: Optional[datetime] = None
    event_start_time: Optional[datetime] = None

    for idx, s in enumerate(samples):
        in_warmup = idx < detection_warmup_idx

        if s.event_active and event_start_time is None:
            event_start_time = s.timestamp

        if in_warmup:
            confidence_score = 0.0
            is_detected = False
            anomaly_type = None
        else:
            det = detect_one(
                detector,
                sensor_id=sensor_id,
                turbidity=s.turbidity,
                ph=s.ph,
                flow=s.flow,
                pressure=s.pressure,
                chlorine=s.chlorine,
                conductivity=s.conductivity,
                pipe_age=pipe_age,
                pipe_material=pipe_material,
            )

            is_detected = det["is_anomaly"]
            anomaly_type = det["anomaly_type"]
            confidence_score = det["confidence"]
            risk_total += det["corrosion_risk"]

            if is_detected and first_detection_time is None:
                first_detection_time = s.timestamp

        ground_truth = s.ground_truth_label != "normal"

        if not in_warmup:
            if is_detected and ground_truth:
                tp += 1
            elif is_detected:
                fp += 1
            elif ground_truth:
                fn += 1
            else:
                tn += 1

        readings.append(
            {
                "timestamp": s.timestamp,
                "turbidity_ntu": round(s.turbidity, 3),
                "ph": round(s.ph, 3),
                "flow_rate_lps": round(s.flow, 3),
                "pressure_kpa": round(s.pressure, 3),
                "temperature_c": round(s.temperature, 1),
                "chlorine_mg_l": round(s.chlorine, 3),
                "conductivity_us_cm": round(s.conductivity, 1),
                "anomaly_detected": is_detected,
                "anomaly_type": anomaly_type,
                "confidence_score": round(confidence_score, 3),
                "is_ground_truth_anomaly": ground_truth,
                "ground_truth_label": s.ground_truth_label,
            }
        )

    total = tp + fp + tn + fn

    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else (1.0 if tp else 0.0)
    recall = tp / (tp + fn) if (tp + fn) else (1.0 if not fn else 0.0)
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    avg_risk = risk_total / max(1, total) if total else 0.0

    summary = {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "false_positive_rate": round(fpr, 4),
        "avg_corrosion_risk": round(avg_risk, 4),
    }

    return readings, summary, event_start_time, first_detection_time


def _prediction_for(
    *,
    detector: WaterQualityDetector,
    sensor_id: str,
    sample: _Sample,
    baseline: dict,
    recent: list[_Sample],
    window_size: int,
) -> tuple[str, float]:
    """Return (prediction, confidence) for a sample after warmup."""
    # Engineered features are calculated only from sensor streams. Hidden
    # disturbance labels stay outside this prediction path.
    baseline_turbidity = float(baseline["turbidity"])
    baseline_ph = float(baseline["ph"])
    baseline_chlorine = float(baseline["chlorine_mg_l"])
    baseline_conductivity = float(baseline["conductivity_us_cm"])
    baseline_pressure = float(baseline["pressure_kpa"])
    baseline_flow = float(baseline["flow_lps"])

    turbidity_from_baseline = sample.turbidity - baseline_turbidity
    chlorine_drop_from_baseline = baseline_chlorine - sample.chlorine
    conductivity_rise_from_baseline = sample.conductivity - baseline_conductivity
    pressure_deviation = sample.pressure - baseline_pressure
    flow_anomaly_score = abs(sample.flow - baseline_flow) / max(0.1, baseline_flow)
    ph_instability_score = abs(sample.ph - baseline_ph)

    turb_spike = turbidity_from_baseline
    ph_delta = ph_instability_score
    chl_delta = abs(sample.chlorine - baseline_chlorine)
    conductivity_rise = conductivity_rise_from_baseline
    ph_drop = baseline_ph - sample.ph

    if turb_spike >= 0.8 and chlorine_drop_from_baseline >= 0.06 and (ph_delta >= 0.04 or pressure_deviation <= -2.0):
        conf = min(0.90, 0.58 + turb_spike / 14.0 + chlorine_drop_from_baseline / max(0.35, baseline_chlorine))
        return "possible_contamination", float(conf)

    if turb_spike >= 0.8 and ph_drop >= 0.05 and conductivity_rise >= 10.0 and sample.chlorine >= baseline_chlorine * 0.7:
        conf = min(0.88, 0.58 + turb_spike / 16.0 + conductivity_rise / 220.0 + ph_drop / 2.5)
        return "possible_corrosion", float(conf)
    if turb_spike >= 0.5 and conductivity_rise >= 12.0 and sample.chlorine >= baseline_chlorine * 0.75:
        conf = min(0.82, 0.56 + turb_spike / 18.0 + conductivity_rise / 260.0)
        return "possible_corrosion", float(conf)

    if turb_spike >= 6.0 and ph_delta <= 0.25 and chl_delta <= 0.15 and flow_anomaly_score >= 0.1:
        conf = min(0.76, 0.50 + turb_spike / 35.0 + flow_anomaly_score / 3.0)
        return "possible_sediment_disturbance", float(conf)

    window = recent[-window_size:]
    if len(window) >= max(3, window_size // 2):
        first = window[0]
        last = window[-1]
        turb_delta = last.turbidity - first.turbidity
        ph_trend = last.ph - first.ph
        chlorine_delta = last.chlorine - first.chlorine
        conductivity_delta = last.conductivity - first.conductivity
        pressure_delta = last.pressure - first.pressure
        turbidity_rate_of_change = turb_delta / max(1, len(window) - 1)
        chlorine_drop = first.chlorine - last.chlorine
        flow_values = [x.flow for x in window]
        rolling_flow_avg = sum(flow_values) / len(flow_values)
        rolling_flow_var = sum((x - rolling_flow_avg) ** 2 for x in flow_values) / len(flow_values)

        contamination_signal = (
            (turb_delta >= 0.6 or turbidity_rate_of_change >= 0.08)
            and (chlorine_delta <= -0.04 or chlorine_drop_from_baseline >= 0.06 or chlorine_drop >= 0.05)
            and (abs(ph_trend) >= 0.05 or pressure_delta <= -0.5)
        )
        if contamination_signal:
            strength = min(
                1.0,
                0.45
                + turb_delta / 8.0
                + abs(chlorine_delta) / max(0.2, baseline_chlorine)
                + max(0.0, -pressure_delta) / 30.0,
            )
            return "possible_contamination", float(max(0.62, strength))

        corrosion_signal = (
            turb_delta >= 0.8
            and ph_trend <= -0.08
            and conductivity_delta >= 8.0
            and chlorine_drop < 0.05
        )
        if corrosion_signal:
            strength = min(
                1.0,
                0.45
                + turb_delta / 8.0
                + abs(ph_trend) / 2.0
                + conductivity_delta / 120.0,
            )
            return "possible_corrosion", float(max(0.62, strength))

        if rolling_flow_var > 1.0 and pressure_delta <= -2.0 and turb_delta >= 0.4:
            return "normal", 0.42

    # Heuristic: severe sensor faults are reported only when physically
    # impossible values persist. Short spikes are treated as temporary warning.
    if len(recent) >= 3:
        last3 = recent[-3:]
        impossible_count = sum(
            1
            for item in last3
            if item.turbidity >= 40.0
            or item.conductivity >= 2000.0
            or item.ph <= 0.2
            or item.ph >= 13.8
            or item.chlorine >= 3.0
        )
        if impossible_count >= 2:
            return "sensor_fault_suspected", 0.82

        if (
            max(s.turbidity for s in last3) - min(s.turbidity for s in last3) < 1e-6
            and max(s.ph for s in last3) - min(s.ph for s in last3) < 1e-6
        ):
            return "sensor_fault_suspected", 0.78

    det = detect_one(
        detector,
        sensor_id=sensor_id,
        turbidity=sample.turbidity,
        ph=sample.ph,
        flow=sample.flow,
        pressure=sample.pressure,
        chlorine=sample.chlorine,
        conductivity=sample.conductivity,
        pipe_age=None,
        pipe_material=None,
    )

    if not det["is_anomaly"]:
        return "normal", float(det["confidence"])

    if det["anomaly_type"] in ("corrosion_indicator", "possible_corrosion"):
        return "possible_corrosion", float(det["confidence"])
    if det["anomaly_type"] == "possible_sediment_disturbance":
        return "possible_sediment_disturbance", float(det["confidence"])
    if det["anomaly_type"] == "sensor_fault_suspected":
        return "sensor_fault_suspected", float(det["confidence"])

    return "possible_contamination", float(det["confidence"])


def run_sequence_simulation(*, simulation_id: str, payload: WQSimulationRunIn) -> tuple[list[dict], list[dict], dict]:
    """Run the new sequence-based simulation used by /api/water-quality/simulation/run."""
    n = max(1, (payload.duration_hours * 60) // payload.data_frequency_minutes)
    interval_min = payload.data_frequency_minutes
    warmup_time = payload.detection_window_size * interval_min

    baseline = {
        "turbidity": payload.baseline_turbidity_ntu,
        "ph": payload.baseline_ph,
        "flow_lps": payload.baseline_flow_lps,
        "pressure_kpa": payload.baseline_pressure_kpa,
        "temperature_c": payload.baseline_temperature_c,
        "chlorine_mg_l": payload.baseline_chlorine_mg_l,
        "conductivity_us_cm": payload.baseline_conductivity_us_cm,
    }

    rates = {
        "turbidity_increase": payload.turbidity_increase_rate,
        "pressure_drop": payload.pressure_drop_rate_kpa_per_step,
        "flow_change": payload.flow_change_rate_lps_per_step,
        "ph_change": payload.ph_change_rate,
        "chlorine_decay": payload.chlorine_decay_rate,
        "conductivity_increase": payload.conductivity_increase_rate,
    }

    rng = random.Random(payload.random_seed)

    event_start_idx = max(0, payload.event_start_time_minutes // interval_min)
    event_duration_idx = max(1, payload.event_duration_minutes // interval_min)

    samples = _generate(
        scenario=payload.scenario_type,
        n=n,
        interval_min=interval_min,
        noise=payload.sensor_uncertainty,
        rng=rng,
        baseline=baseline,
        event_start_idx=event_start_idx,
        event_duration_idx=event_duration_idx,
        event_severity=payload.event_severity,
        rates=rates,
        pipe_age_years=payload.pipe_age_years,
        pipe_material=payload.pipe_material,
        start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )

    confidence_cap = {
        "low": 0.76,
        "medium": 0.88,
        "high": 0.94,
        "critical": 0.99,
    }.get(payload.event_severity, 0.88)
    if payload.scenario_type == "normal":
        confidence_cap = 0.35
    elif payload.scenario_type == "sensor_fault":
        confidence_cap = 0.62

    detector = WaterQualityDetector()
    generated_readings: list[dict] = []
    detection_results: list[dict] = []

    hidden_disturbance_profile = payload.scenario_type
    hidden_label_map = {
        "normal": "normal",
        "gradual_corrosion": "corrosion_like_event",
        "gradual_contamination": "contamination_like_event",
        "sediment_disturbance": "sediment_like_event",
        "sensor_fault": "sensor_fault_like_event",
    }
    expected_label = hidden_label_map.get(payload.scenario_type, payload.scenario_type)
    max_conf = 0.0
    predicted_label: Optional[str] = None
    first_detection_time: Optional[datetime] = None
    event_start_time: Optional[datetime] = None
    sustained_prediction: Optional[str] = None
    sustained_count = 0
    min_sustained_steps = 3

    fp = fn = 0

    recent: list[_Sample] = []
    for idx, s in enumerate(samples):
        recent.append(s)

        if s.event_active and event_start_time is None and s.ground_truth_label != "normal":
            event_start_time = s.timestamp

        in_warmup = idx < payload.detection_window_size
        if in_warmup:
            status = "collecting_sequence"
            prediction = None
            confidence = None
        else:
            prediction, confidence = _prediction_for(
                detector=detector,
                sensor_id=f"sim-{simulation_id[:8]}",
                sample=s,
                baseline=baseline,
                recent=recent,
                window_size=payload.detection_window_size,
            )
            confidence = min(float(confidence), confidence_cap)
            status = prediction

            if confidence is not None:
                max_conf = max(max_conf, float(confidence))

            pred_is_signal = prediction not in ("normal", "collecting_sequence", None)
            if pred_is_signal and prediction == sustained_prediction:
                sustained_count += 1
            elif pred_is_signal:
                sustained_prediction = prediction
                sustained_count = 1
            else:
                sustained_prediction = None
                sustained_count = 0

            detection_is_after_disturbance = (
                event_start_time is not None
                and s.timestamp > event_start_time
            )
            if (
                predicted_label is None
                and detection_is_after_disturbance
                and sustained_count >= min_sustained_steps
                and (confidence or 0.0) >= 0.70
                and prediction not in ("normal", "collecting_sequence")
            ):
                predicted_label = prediction
                first_detection_time = s.timestamp

            truth_is_anom = s.ground_truth_label != "normal"
            pred_is_anom = prediction not in ("normal", "collecting_sequence", None)

            if pred_is_anom and not truth_is_anom:
                fp += 1
            if truth_is_anom and not pred_is_anom:
                fn += 1

        detection_results.append(
            {
                "timestamp": s.timestamp,
                "status": status,
                "prediction": prediction,
                "confidence": None if confidence is None else round(float(confidence), 3),
            }
        )

        generated_readings.append(
            {
                "timestamp": s.timestamp,
                "turbidity_ntu": round(s.turbidity, 3),
                "ph": round(s.ph, 3),
                "flow_lps": round(s.flow, 3),
                "pressure_kpa": round(s.pressure, 3),
                "temperature_c": round(s.temperature, 1),
                "residual_chlorine_mg_l": round(s.chlorine, 3),
                "conductivity_us_cm": round(s.conductivity, 1),
                "pipe_material": payload.pipe_material,
                "pipe_age_years": payload.pipe_age_years,
                "disturbance_profile": hidden_disturbance_profile,
                "event_active": bool(s.event_active),
                "ground_truth_label": hidden_label_map.get(s.ground_truth_label or "normal", s.ground_truth_label or "normal"),
            }
        )

    detection_latency = None
    if event_start_time and first_detection_time:
        detection_latency = max(
            0.0,
            round((first_detection_time - event_start_time).total_seconds() / 60.0, 2),
        )

    summary = {
        "total_readings": len(generated_readings),
        "disturbance_profile": hidden_disturbance_profile,
        "event_start_time": event_start_time,
        "first_detection_time": first_detection_time,
        "detection_latency": detection_latency,
        "expected_label": expected_label,
        "predicted_label": predicted_label,
        "max_confidence": round(float(max_conf), 3),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "warmup_time": int(warmup_time),
    }

    return generated_readings, detection_results, summary


# ── Backward compatibility: legacy simulate function ───────────────────

def simulate(
    *,
    scenario: str,
    n: int,
    interval_min: int,
    noise: float,
    sensor_id: str,
    pipe_age: float,
    pipe_material: str,
    seed: Optional[int] = None,
) -> Tuple[List[dict], dict]:
    """Legacy function for backward compatibility."""
    baseline = {
        "turbidity": 1.0,
        "ph": 7.2,
        "flow_lps": 4.0,
        "pressure_kpa": 350.0,
        "temperature_c": 20.0,
        "chlorine_mg_l": 0.5,
        "conductivity_us_cm": 400.0,
    }

    rates = {
        "turbidity_increase": 0.2,
        "pressure_drop": 0.1,
        "flow_change": 0.05,
        "ph_change": 0.01,
        "chlorine_decay": 0.02,
        "conductivity_increase": 2.0,
    }

    event_start_idx = int(n * 0.45)
    event_duration_idx = int(n * 0.25)

    scenario_map = {
        "gradual_contamination": "gradual_contamination",
        "sudden_spike": "sediment_disturbance",
        "corrosion_event": "gradual_corrosion",
    }

    new_scenario = scenario_map.get(scenario, scenario)

    rng = random.Random(seed)

    samples = _generate(
        scenario=new_scenario,
        n=n,
        interval_min=interval_min,
        noise=noise,
        rng=rng,
        baseline=baseline,
        event_start_idx=event_start_idx,
        event_duration_idx=event_duration_idx,
        event_severity="medium",
        rates=rates,
        pipe_age_years=pipe_age,
        pipe_material=pipe_material,
    )

    detector = WaterQualityDetector()

    readings: List[dict] = []

    tp = fp = tn = fn = 0
    risk_total = 0.0

    for s in samples:
        det = detect_one(
            detector,
            sensor_id=sensor_id,
            turbidity=s.turbidity,
            ph=s.ph,
                flow=s.flow,
                pressure=s.pressure,
                chlorine=s.chlorine,
                conductivity=s.conductivity,
                pipe_age=pipe_age,
            pipe_material=pipe_material,
        )

        risk_total += det["corrosion_risk"]

        readings.append(
            {
                "timestamp": s.timestamp,
                "turbidity_ntu": round(s.turbidity, 3),
                "ph": round(s.ph, 3),
                "flow_rate_lps": round(s.flow, 3),
                "anomaly_detected": det["is_anomaly"],
                "anomaly_type": det["anomaly_type"],
                "confidence_score": round(det["confidence"], 3),
                "is_ground_truth_anomaly": s.ground_truth_label != "normal",
            }
        )

        if det["is_anomaly"] and s.ground_truth_label != "normal":
            tp += 1
        elif det["is_anomaly"]:
            fp += 1
        elif s.ground_truth_label != "normal":
            fn += 1
        else:
            tn += 1

    total = tp + fp + tn + fn

    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else (1.0 if tp else 0.0)
    recall = tp / (tp + fn) if (tp + fn) else (1.0 if not fn else 0.0)
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    avg_risk = risk_total / max(1, total) if total else 0.0

    summary = {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "false_positive_rate": round(fpr, 4),
        "avg_corrosion_risk": round(avg_risk, 4),
    }

    return readings, summary
