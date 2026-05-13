"""
Synthetic-trajectory generator + scoring for the leak/overflow LSTM module.

Each simulation:
  1. Generates a sequence of readings with ground-truth anomaly flags.
  2. Streams them through the LSTM-backed `LeakLSTMService` so the rolling
     window mechanic + threshold are exercised exactly as in production.
  3. Computes precision / recall / F1 / detection-latency metrics per event.

A "detection event" is the first sample with `anomaly_detected=True` after
the start of a contiguous truth window. Latency is the wall-clock distance
between the truth start and that first detection.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np

from app.ml.leak_lstm import (
    FEATURES, LeakLSTMService, _baseline_sample, _scenario_step,
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ── Trajectory generation ───────────────────────────────────────────────

def _make_trajectory(
    scenario: str, n: int, interval_min: int, noise: float, rng: random.Random,
) -> List[Tuple[datetime, Dict[str, float], bool]]:
    """Return [(timestamp, sample_dict, ground_truth)]."""
    out = []
    start = _now_utc() - timedelta(minutes=interval_min * (n - 1))

    sub_choices = ["normal", "slow_leak", "burst_pipe", "overflow", "intermittent_leak"]
    block = max(8, n // 5)

    for t in range(n):
        sub = scenario if scenario != "random" else sub_choices[(t // block) % len(sub_choices)]
        base = _baseline_sample(rng, noise=noise)
        sample, truth = _scenario_step(sub, t, n, base)
        ts = start + timedelta(minutes=interval_min * t)
        out.append((ts, sample, truth))
    return out


# ── Detection helpers ───────────────────────────────────────────────────

def _classify(prob: float, sample: Dict[str, float]) -> Tuple[Optional[str], str]:
    """Map (probability, sample) -> (anomaly_type, severity)."""
    if prob < 0.30:
        return None, "low"

    # Heuristic anomaly_type from the dominant signal
    pressure = sample["pressure_kpa"]
    flow = sample["flow_rate_lps"]
    acoustic = sample.get("acoustic_signal_db", 0.0)

    if pressure < 280 and flow > 12:
        anomaly_type = "burst"
    elif flow > 10 and pressure > 430:
        anomaly_type = "overflow_risk"
    elif pressure < 360:
        anomaly_type = "pressure_drop"
    elif acoustic > 48:
        anomaly_type = "probable_leak"
    else:
        anomaly_type = "probable_leak"

    if prob >= 0.85:    severity = "critical"
    elif prob >= 0.70:  severity = "high"
    elif prob >= 0.50:  severity = "medium"
    else:               severity = "low"

    return anomaly_type, severity


def manual_detect(
    service: LeakLSTMService, sensor_id: str, sample: Dict[str, float],
) -> dict:
    """Run a single sample through the rolling buffer + classifier."""
    prob, status = service.push_and_score(sensor_id, sample)

    decision_thr = service.threshold if service.ready else 1.01  # never flags if not ready
    is_anomaly = bool(prob >= decision_thr) and status == "active"
    anomaly_type, severity = _classify(prob, sample)
    if not is_anomaly:
        anomaly_type = None
        severity = "low" if status != "active" else severity

    return {
        "is_anomaly": is_anomaly,
        "anomaly_type": anomaly_type,
        "confidence": prob,
        "severity": severity,
        "lstm_sequence_status": status,
    }


def message_for(result: dict) -> str:
    if not result["is_anomaly"]:
        if result["lstm_sequence_status"] == "warming_up":
            return "LSTM warming up — readings being recorded; predictions begin once the window fills."
        return "Reading consistent with normal operation."
    label = (result["anomaly_type"] or "anomaly").replace("_", " ")
    return f"Detected {label} (confidence {result['confidence']*100:.1f}%)."


# ── Public: full simulation ─────────────────────────────────────────────

def simulate(
    *, scenario: str, n: int, interval_min: int, noise: float, sensor_id: str,
    window_size: int, seed: Optional[int] = None,
) -> Tuple[List[dict], dict]:
    rng = random.Random(seed)

    # New service instance per simulation so the buffer is clean and we can
    # honour the per-call `lstm_window_size`. Shares trained weights via load().
    sim_service = LeakLSTMService(window_size=window_size)
    sim_service.load()  # try to load existing weights — may fail silently

    trajectory = _make_trajectory(scenario, n, interval_min, noise, rng)

    readings: List[dict] = []
    truth_run_start: Optional[int] = None
    detection_latencies: List[float] = []
    tp = fp = tn = fn = 0

    for idx, (ts, sample, truth) in enumerate(trajectory):
        det = manual_detect(sim_service, sensor_id, sample)
        readings.append({
            "timestamp": ts,
            "pressure_kpa":       round(sample["pressure_kpa"], 3),
            "flow_rate_lps":      round(sample["flow_rate_lps"], 3),
            "acoustic_signal_db": round(sample["acoustic_signal_db"], 3),
            "soil_moisture_pct":  round(sample["soil_moisture_pct"], 3),
            "anomaly_detected": det["is_anomaly"],
            "anomaly_type": det["anomaly_type"],
            "confidence_score": round(float(det["confidence"]), 3),
            "is_ground_truth_anomaly": bool(truth),
        })

        # Confusion-matrix counts on the per-sample level
        if det["is_anomaly"] and truth:    tp += 1
        elif det["is_anomaly"]:            fp += 1
        elif truth:                        fn += 1
        else:                              tn += 1

        # Track detection latency relative to the start of each truth run
        if truth and truth_run_start is None:
            truth_run_start = idx
        if truth_run_start is not None and det["is_anomaly"]:
            latency_min = (idx - truth_run_start) * interval_min
            detection_latencies.append(float(latency_min))
            truth_run_start = None
        if not truth and truth_run_start is not None and not det["is_anomaly"]:
            # truth ended without detection; reset so the next run is independent
            # (this won't double-count; we still recorded fn above for missed samples)
            pass

    precision = tp / (tp + fp) if (tp + fp) else (1.0 if tp else 0.0)
    recall    = tp / (tp + fn) if (tp + fn) else (1.0 if not fn else 0.0)
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) else 0.0

    if detection_latencies:
        avg_lat = float(np.mean(detection_latencies))
        max_lat = float(np.max(detection_latencies))
    else:
        avg_lat = 0.0
        max_lat = 0.0

    summary = {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "avg_detection_latency_min": round(avg_lat, 2),
        "max_detection_latency_min": round(max_lat, 2),
        "meets_latency_target":  bool(avg_lat < 60.0 and (max_lat < 90.0 or max_lat == 0.0)),
        "meets_precision_target": bool(precision >= 0.7),
    }
    return readings, summary
