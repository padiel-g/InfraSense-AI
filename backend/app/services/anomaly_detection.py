"""
Real-time anomaly detection service.

Pipeline:

    Sensor reading
        ↓
    Per-sensor rolling buffer (length = WINDOW)
        ↓
    LSTM autoencoder  (PyTorch)   ──┐
        OR sklearn AE fallback     ──┼─→ reconstruction error
        OR SPC                     ──┘
        ↓
    SPC threshold (precision-tuned)
        ↓
    Water-quality module (turbidity / pH / flow)
        ↓
    is_anomaly + score + type + reasons
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Deque, Dict, List

import numpy as np

from app.ml.loader import get_model
from app.ml.water_quality import get_water_quality_detector

FEATURES = ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"]
WINDOW = 30


class AnomalyDetectionService:
    """
    Detects anomalies in sensor readings using LSTM, sklearn AE, or SPC fallback.
    Targets: precision >= 0.7, detection latency < 60 minutes.
    """

    SPC_THRESHOLDS = {
        "flow_rate_lps":  {"mean": 5.0, "std": 1.5, "sigma": 3},
        "pressure_bar":   {"mean": 3.0, "std": 0.5, "sigma": 3},
        "water_level_m":  {"mean": 1.2, "std": 0.3, "sigma": 3},
        "turbidity_ntu":  {"mean": 2.0, "std": 0.8, "sigma": 3},
        "ph":             {"mean": 7.2, "std": 0.4, "sigma": 3},
    }
    EWMA_LAMBDA = 0.3

    def __init__(self):
        self._buffer: Dict[str, Deque[List[float]]] = defaultdict(
            lambda: deque(maxlen=WINDOW)
        )
        self._ewma_state = defaultdict(lambda: defaultdict(lambda: None))
        self._water_quality = get_water_quality_detector()

    # ------------------------------------------------------------------
    # Public API - single reading & batch sequence
    # ------------------------------------------------------------------

    def check_reading(self, reading: dict) -> dict:
        """Score a single sensor reading."""
        sensor_id = str(reading.get("sensor_id", "unknown"))
        feats = self._extract_sensor_features(reading)
        self._buffer[sensor_id].append(feats)

        result = self._sequence_score(sensor_id) or self._spc_detect(reading)
        wq = self._water_quality.update(reading)

        if wq["is_contamination"]:
            result["is_anomaly"] = True
            result["score"] = max(result.get("score", 0.0), wq["score"])
            result["type"] = result.get("type") or "contamination"
            result["water_quality"] = wq
        else:
            result["water_quality"] = wq
        return result

    def check_sequence(self, sequence: np.ndarray, sensor_id: str = "stream") -> dict:
        """
        Score a contiguous (T, F) sensor sequence.
        Used by the /analyze endpoint.
        """
        if sequence.ndim != 2:
            raise ValueError("sequence must be 2D (timesteps, features)")
        if sequence.shape[1] < 3:
            raise ValueError("sequence must have at least pressure, flow, level columns")

        # Pad missing trailing columns (turbidity, pH) so we always have 5 features.
        if sequence.shape[1] < len(FEATURES):
            pad = np.tile(
                np.array([self.SPC_THRESHOLDS[f]["mean"] for f in FEATURES[sequence.shape[1]:]]),
                (sequence.shape[0], 1),
            )
            sequence = np.hstack([sequence, pad])

        if sequence.shape[0] < WINDOW:
            # Pad at start with the first observed row to fill the window
            pad_rows = WINDOW - sequence.shape[0]
            sequence = np.vstack([np.tile(sequence[0], (pad_rows, 1)), sequence])

        window = sequence[-WINDOW:]
        return self._score_window(window, sensor_id)

    # ------------------------------------------------------------------
    # Internal scoring helpers
    # ------------------------------------------------------------------

    def _sequence_score(self, sensor_id: str) -> dict | None:
        buf = self._buffer[sensor_id]
        if len(buf) < WINDOW:
            return None
        window = np.array(buf, dtype=np.float32)
        return self._score_window(window, sensor_id)

    def _score_window(self, window: np.ndarray, sensor_id: str) -> dict:
        # Try PyTorch LSTM first
        torch_model = get_model("lstm_anomaly")
        if torch_model is not None:
            try:
                return self._lstm_torch_score(torch_model, window)
            except Exception:
                pass
        # Then sklearn AE
        sk_model = get_model("sklearn_ae")
        if sk_model is not None:
            try:
                err, is_anom = sk_model.score(window)
                return {
                    "is_anomaly": bool(is_anom),
                    "score": round(min(err / max(sk_model.threshold, 1e-6), 1.0), 4),
                    "reconstruction_error": round(err, 6),
                    "threshold": round(sk_model.threshold, 6),
                    "type": self._classify_anomaly_type(window) if is_anom else None,
                    "model": "sklearn_ae",
                }
            except Exception:
                pass
        # SPC fallback at window level (last row)
        last = {feat: window[-1, i] for i, feat in enumerate(FEATURES)}
        last["sensor_id"] = sensor_id
        return self._spc_detect(last)

    def _lstm_torch_score(self, model, window: np.ndarray) -> dict:
        import torch
        # NB: scaling stats live in lstm_anomaly_meta.json - in production we'd
        # cache them on the model. For now we use the per-window normalisation.
        win = window - window.mean(axis=0, keepdims=True)
        win = win / (window.std(axis=0, keepdims=True) + 1e-6)
        x = torch.from_numpy(win[None, :, :].astype(np.float32))
        with torch.no_grad():
            recon = model(x).numpy()[0]
        err = float(np.mean((win - recon) ** 2))
        threshold = 0.5
        is_anom = err > threshold
        return {
            "is_anomaly": bool(is_anom),
            "score": round(min(err / threshold, 1.0), 4),
            "reconstruction_error": round(err, 6),
            "threshold": threshold,
            "type": self._classify_anomaly_type(window) if is_anom else None,
            "model": "lstm_torch",
        }

    def _spc_detect(self, reading: dict) -> dict:
        sensor_id = reading.get("sensor_id", "unknown")
        anomalies = []

        for metric in FEATURES:
            value = reading.get(metric)
            if value is None:
                continue
            params = self.SPC_THRESHOLDS.get(metric)
            if not params:
                continue
            z_score = abs(value - params["mean"]) / params["std"]
            if z_score > params["sigma"]:
                anomalies.append({"metric": metric, "value": value, "z_score": round(z_score, 2)})

            prev = self._ewma_state[sensor_id][metric]
            if prev is None:
                self._ewma_state[sensor_id][metric] = value
            else:
                ewma = self.EWMA_LAMBDA * value + (1 - self.EWMA_LAMBDA) * prev
                self._ewma_state[sensor_id][metric] = ewma
                ewma_z = abs(ewma - params["mean"]) / (
                    params["std"] * np.sqrt(self.EWMA_LAMBDA / (2 - self.EWMA_LAMBDA))
                )
                if ewma_z > params["sigma"]:
                    anomalies.append({"metric": metric, "ewma_z": round(ewma_z, 2)})

        if anomalies:
            max_z = max(a.get("z_score", a.get("ewma_z", 0)) for a in anomalies)
            return {
                "is_anomaly": True,
                "score": round(min(max_z / 5.0, 1.0), 4),
                "type": self._classify_anomaly_type(reading),
                "model": "spc",
                "details": anomalies,
            }
        return {"is_anomaly": False, "score": 0.0, "type": None, "model": "spc"}

    # ------------------------------------------------------------------

    def _extract_sensor_features(self, reading: dict) -> List[float]:
        return [
            float(reading.get("pressure_bar", self.SPC_THRESHOLDS["pressure_bar"]["mean"])),
            float(reading.get("flow_rate_lps", self.SPC_THRESHOLDS["flow_rate_lps"]["mean"])),
            float(reading.get("water_level_m", self.SPC_THRESHOLDS["water_level_m"]["mean"])),
            float(reading.get("turbidity_ntu", self.SPC_THRESHOLDS["turbidity_ntu"]["mean"])),
            float(reading.get("ph", self.SPC_THRESHOLDS["ph"]["mean"])),
        ]

    def _classify_anomaly_type(self, source) -> str:
        if isinstance(source, np.ndarray):
            flow = float(source[-1, 1])
            pressure = float(source[-1, 0])
            level = float(source[-1, 2])
            turb = float(source[-1, 3])
        else:
            flow = source.get("flow_rate_lps", 0)
            pressure = source.get("pressure_bar", 0)
            level = source.get("water_level_m", 0)
            turb = source.get("turbidity_ntu", 0)

        if turb > self.SPC_THRESHOLDS["turbidity_ntu"]["mean"] * 2:
            return "contamination"
        if level > self.SPC_THRESHOLDS["water_level_m"]["mean"] * 1.6:
            return "overflow"
        if flow > self.SPC_THRESHOLDS["flow_rate_lps"]["mean"] * 1.8 and pressure < self.SPC_THRESHOLDS["pressure_bar"]["mean"] * 0.7:
            return "leak"
        if flow > self.SPC_THRESHOLDS["flow_rate_lps"]["mean"] * 2:
            return "spike"
        if pressure < self.SPC_THRESHOLDS["pressure_bar"]["mean"] * 0.5:
            return "drop"
        if flow < self.SPC_THRESHOLDS["flow_rate_lps"]["mean"] * 0.1:
            return "flatline"
        return "drift"


# ---------------------------------------------------------------------------
# Module-level singleton + functional API expected by routers
# ---------------------------------------------------------------------------

_service: AnomalyDetectionService | None = None


def _get() -> AnomalyDetectionService:
    global _service
    if _service is None:
        _service = AnomalyDetectionService()
    return _service


def detect_anomaly(sequence) -> dict:
    """
    Functional entrypoint used by routers/sensors.py and the /analyze endpoint.
    Accepts a 2D numpy array OR list of lists OR a single dict reading.
    """
    if isinstance(sequence, dict):
        return _get().check_reading(sequence)
    arr = np.asarray(sequence, dtype=np.float32)
    return _get().check_sequence(arr)
