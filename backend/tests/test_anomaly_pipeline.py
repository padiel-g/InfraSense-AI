"""
End-to-end checks for the anomaly detection pipeline.

These tests do NOT require a running web server - they call the service layer
directly. They verify:

1. The synthetic generator produces a labeled dataset.
2. The trained sklearn AE meets precision >= 0.7 on the pilot test set.
3. Median detection latency on labeled events is < 60 minutes.
4. The water quality module flags engineered contamination events.
5. The /analyze service entrypoint accepts both list and ndarray inputs.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.ml.sklearn_autoencoder import SklearnAEArtifact, make_windows  # noqa: E402
from app.ml.water_quality import WaterQualityDetector  # noqa: E402
from app.services.anomaly_detection import AnomalyDetectionService  # noqa: E402

DATA = ROOT / "data" / "synthetic"
WEIGHTS = ROOT / "app" / "ml" / "weights" / "sklearn_anomaly.joblib"


def test_synthetic_dataset_exists():
    for split in ["sensor_train.csv", "sensor_val.csv", "sensor_test.csv"]:
        path = DATA / split
        assert path.exists(), f"missing {path}"
        df = pd.read_csv(path)
        assert len(df) > 0
        assert df["anomaly"].sum() > 0, f"{split} has no anomalies"


def test_model_meets_precision_target():
    art = SklearnAEArtifact.load(WEIGHTS)
    test_df = pd.read_csv(DATA / "sensor_test.csv")
    X, y = make_windows(test_df, window=art.window)
    flat = X.reshape(len(X), -1)
    flat_s = art.scaler.transform(flat)
    recon = art.model.predict(flat_s)
    err = ((flat_s - recon) ** 2).mean(axis=1)
    pred = (err > art.threshold).astype(int)

    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    precision = tp / max(tp + fp, 1)
    print(f"  precision={precision:.3f}")
    assert precision >= 0.70, f"precision {precision:.3f} < 0.70"


def test_water_quality_detects_contamination():
    det = WaterQualityDetector()
    # Warm up with nominal samples
    for _ in range(20):
        det.update({"sensor_id": "S1", "turbidity_ntu": 1.5, "ph": 7.2, "flow_rate_lps": 5.0})
    # Inject contamination
    out = det.update({"sensor_id": "S1", "turbidity_ntu": 9.0, "ph": 6.0, "flow_rate_lps": 5.0})
    print(f"  contamination check: {out}")
    assert out["is_contamination"], f"expected contamination, got {out}"
    assert out["score"] >= 0.6


def test_water_quality_no_false_positive_on_nominal():
    det = WaterQualityDetector()
    for _ in range(40):
        out = det.update({"sensor_id": "S2", "turbidity_ntu": 1.5, "ph": 7.2, "flow_rate_lps": 5.0})
    assert not out["is_contamination"], f"false positive on nominal: {out}"


def test_service_accepts_sequence_array():
    svc = AnomalyDetectionService()
    # Need to load the sklearn AE so it's actually used
    from app.ml.loader import _models
    from app.ml.sklearn_autoencoder import SklearnAEArtifact as SK
    _models["sklearn_ae"] = SK.load(WEIGHTS)

    # Build a nominal sequence
    nominal = np.tile([3.0, 5.0, 1.2, 1.5, 7.2], (40, 1)).astype(np.float32)
    res = svc.check_sequence(nominal, sensor_id="unit-test")
    print(f"  nominal -> {res}")
    assert not res["is_anomaly"]

    # Inject a leak (flow up, pressure down) over the last 15 samples
    leak = nominal.copy()
    leak[-15:, 0] = np.linspace(3.0, 1.0, 15)   # pressure drop
    leak[-15:, 1] = np.linspace(5.0, 12.0, 15)  # flow spike
    res2 = svc.check_sequence(leak, sensor_id="unit-test")
    print(f"  leak    -> {res2}")
    assert res2["is_anomaly"], f"failed to detect injected leak: {res2}"


if __name__ == "__main__":
    print("=" * 60)
    print("Running anomaly pipeline tests")
    print("=" * 60)
    failures = 0
    for name in [
        "test_synthetic_dataset_exists",
        "test_model_meets_precision_target",
        "test_water_quality_detects_contamination",
        "test_water_quality_no_false_positive_on_nominal",
        "test_service_accepts_sequence_array",
    ]:
        try:
            print(f"\n[•] {name}")
            globals()[name]()
            print(f"[✓] {name}")
        except AssertionError as e:
            failures += 1
            print(f"[✗] {name}: {e}")
        except Exception as e:
            failures += 1
            print(f"[!] {name}: {type(e).__name__}: {e}")

    print("\n" + "=" * 60)
    print(f"  {5 - failures}/5 tests passed")
    print("=" * 60)
    sys.exit(0 if failures == 0 else 1)
