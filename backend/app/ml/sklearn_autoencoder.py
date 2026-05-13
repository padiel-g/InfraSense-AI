"""
Sklearn-based sequence autoencoder used as the runtime fallback when PyTorch
is not available (e.g. lightweight container deployments).

It's an MLP-AE on flattened sliding windows. Trained ONLY on nominal windows,
it learns the manifold of normal multivariate sensor behaviour. Reconstruction
error then serves as anomaly score - identical contract to the PyTorch LSTM AE.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

FEATURES = ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"]
WINDOW = 30


@dataclass
class SklearnAEArtifact:
    model: MLPRegressor
    scaler: StandardScaler
    threshold: float
    window: int
    features: list

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": self.model, "scaler": self.scaler}, path)
        meta = {
            "threshold": float(self.threshold),
            "window": self.window,
            "features": self.features,
        }
        with open(path.with_suffix(".meta.json"), "w") as f:
            json.dump(meta, f, indent=2)

    @classmethod
    def load(cls, path: str | Path) -> "SklearnAEArtifact":
        path = Path(path)
        bundle = joblib.load(path)
        with open(path.with_suffix(".meta.json")) as f:
            meta = json.load(f)
        return cls(
            model=bundle["model"],
            scaler=bundle["scaler"],
            threshold=meta["threshold"],
            window=meta["window"],
            features=meta["features"],
        )

    def score(self, window: np.ndarray) -> Tuple[float, bool]:
        """Score one (T, F) window. Returns (recon_error, is_anomaly)."""
        if window.shape[0] != self.window:
            raise ValueError(
                f"expected window of {self.window} steps, got {window.shape[0]}"
            )
        flat = window[None, :, :].reshape(1, -1)
        flat_scaled = self.scaler.transform(flat)
        recon = self.model.predict(flat_scaled)
        err = float(np.mean((flat_scaled - recon) ** 2))
        return err, err > self.threshold


# ---------------------------------------------------------------------------
# Training helpers
# ---------------------------------------------------------------------------

def make_windows(df: pd.DataFrame, window: int = WINDOW) -> Tuple[np.ndarray, np.ndarray]:
    Xs, ys = [], []
    for _, group in df.groupby("sensor_id"):
        feats = group[FEATURES].to_numpy(dtype=np.float32)
        labels = group["anomaly"].to_numpy(dtype=np.int8)
        for i in range(0, len(feats) - window + 1):
            Xs.append(feats[i:i + window])
            ys.append(int(labels[i:i + window].max()))
    return np.stack(Xs), np.array(ys, dtype=np.int8)


def pick_threshold(err: np.ndarray, y: np.ndarray, target_precision: float = 0.7) -> float:
    candidates = np.quantile(err, np.linspace(0.80, 0.999, 400))
    best = float(np.quantile(err, 0.97))
    for thr in candidates:
        pred = (err > thr).astype(int)
        tp = int(((pred == 1) & (y == 1)).sum())
        fp = int(((pred == 1) & (y == 0)).sum())
        if tp + fp < 5:
            continue
        prec = tp / (tp + fp)
        if prec >= target_precision:
            best = float(thr)
            break
    return best


def train_sklearn_ae(
    train_csv: str | Path,
    val_csv: str | Path,
    out_path: str | Path,
    target_precision: float = 0.7,
) -> SklearnAEArtifact:
    train_df = pd.read_csv(train_csv)
    val_df = pd.read_csv(val_csv)

    Xtr, ytr = make_windows(train_df)
    Xva, yva = make_windows(val_df)

    Xtr_clean = Xtr[ytr == 0]
    flat_tr = Xtr_clean.reshape(len(Xtr_clean), -1)
    flat_va = Xva.reshape(len(Xva), -1)

    scaler = StandardScaler().fit(flat_tr)
    flat_tr_s = scaler.transform(flat_tr)
    flat_va_s = scaler.transform(flat_va)

    n_in = flat_tr_s.shape[1]
    model = MLPRegressor(
        hidden_layer_sizes=(64, 16, 64),  # bottleneck of 16
        activation="relu",
        solver="adam",
        learning_rate_init=1e-3,
        max_iter=80,
        batch_size=128,
        random_state=42,
        verbose=False,
    )
    print(f"[i] training sklearn AE on {len(flat_tr_s)} nominal windows ({n_in} features)")
    model.fit(flat_tr_s, flat_tr_s)

    recon = model.predict(flat_va_s)
    err = ((flat_va_s - recon) ** 2).mean(axis=1)
    thr = pick_threshold(err, yva, target_precision=target_precision)

    art = SklearnAEArtifact(model=model, scaler=scaler, threshold=thr, window=WINDOW, features=FEATURES)
    art.save(out_path)
    print(f"[✓] saved {out_path}  threshold={thr:.5f}")
    return art
