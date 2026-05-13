from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.ml.sklearn_autoencoder import (  # noqa: E402
    FEATURES,
    SklearnAEArtifact,
    make_windows,
    train_sklearn_ae,
)


DATA = ROOT / "data" / "synthetic"
WEIGHTS = ROOT / "app" / "ml" / "weights" / "sklearn_anomaly.joblib"


def evaluate(art: SklearnAEArtifact, test_csv: Path) -> dict:
    df = pd.read_csv(test_csv)
    X, y = make_windows(df, window=art.window)

    flat = X.reshape(len(X), -1)
    flat_s = art.scaler.transform(flat)
    recon = art.model.predict(flat_s)
    err = ((flat_s - recon) ** 2).mean(axis=1)
    pred = (err > art.threshold).astype(int)

    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-9)
    accuracy = (tp + tn) / max(tp + tn + fp + fn, 1)

    # Detection latency (sample-level): for each anomaly event in the test
    # set, find the first window that flagged it after the event start.
    latency_minutes = _detection_latency(df, art, threshold=art.threshold)

    metrics = {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "accuracy": round(accuracy, 4),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "median_detection_latency_min": latency_minutes["median"],
        "p90_detection_latency_min": latency_minutes["p90"],
        "events_detected": latency_minutes["detected"],
        "events_total": latency_minutes["total"],
    }
    return metrics


def _detection_latency(df: pd.DataFrame, art: SklearnAEArtifact, threshold: float) -> dict:
    """For each anomaly event in each sensor, compute time from event onset to first detection."""
    detected, total, latencies = 0, 0, []
    for _, group in df.groupby("sensor_id"):
        feats = group[FEATURES].to_numpy(dtype=np.float32)
        labels = group["anomaly"].to_numpy(dtype=np.int8)

        # Identify event onsets (0 -> 1 transitions)
        in_event = False
        event_start = None
        for t in range(len(labels)):
            if labels[t] == 1 and not in_event:
                in_event = True
                event_start = t
                total += 1
            elif labels[t] == 0 and in_event:
                in_event = False
                # scan windows that ended within this event
                end_t = t
                detect_t = _first_detection(feats, art, event_start, end_t)
                if detect_t is not None:
                    detected += 1
                    latencies.append(detect_t - event_start)
                event_start = None
        if in_event and event_start is not None:
            detect_t = _first_detection(feats, art, event_start, len(feats))
            if detect_t is not None:
                detected += 1
                latencies.append(detect_t - event_start)

    if not latencies:
        return {"median": None, "p90": None, "detected": detected, "total": total}
    arr = np.array(latencies)
    return {
        "median": int(np.median(arr)),
        "p90": int(np.quantile(arr, 0.9)),
        "detected": detected,
        "total": total,
    }


def _first_detection(feats: np.ndarray, art: SklearnAEArtifact, start: int, end: int):
    w = art.window
    # earliest window that contains the start
    first_w = max(0, start - w + 1)
    last_w = min(len(feats) - w, end - 1)
    if last_w < first_w:
        return None
    windows = np.stack([feats[i:i + w] for i in range(first_w, last_w + 1)])
    flat = windows.reshape(len(windows), -1)
    flat_s = art.scaler.transform(flat)
    recon = art.model.predict(flat_s)
    err = ((flat_s - recon) ** 2).mean(axis=1)
    flagged = np.where(err > art.threshold)[0]
    if len(flagged) == 0:
        return None
    # convert window index back to sample index (window end)
    win_idx = first_w + flagged[0]
    return win_idx + w - 1  # detection at end of window


def main():
    print("=" * 60)
    print("Training sklearn autoencoder anomaly detector")
    print("=" * 60)
    t0 = time.time()
    art = train_sklearn_ae(
        train_csv=DATA / "sensor_train.csv",
        val_csv=DATA / "sensor_val.csv",
        out_path=WEIGHTS,
        target_precision=0.7,
    )
    print(f"[i] training took {time.time() - t0:.1f}s")

    print()
    print("=" * 60)
    print("Evaluating on labeled pilot test set")
    print("=" * 60)
    metrics = evaluate(art, DATA / "sensor_test.csv")
    for k, v in metrics.items():
        print(f"  {k:35s} {v}")

    # Pass/fail vs targets
    print()
    print("Targets:")
    print(f"  precision >= 0.70             ->  {'PASS' if metrics['precision'] >= 0.70 else 'FAIL'}")
    print(f"  median latency  < 60 minutes  ->  {'PASS' if (metrics['median_detection_latency_min'] or 9999) < 60 else 'FAIL'}")


if __name__ == "__main__":
    main()
