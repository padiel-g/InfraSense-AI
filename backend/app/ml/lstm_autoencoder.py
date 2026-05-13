"""
LSTM Autoencoder for sensor stream anomaly detection (PyTorch).

Architecture:
    Encoder: LSTM(input_dim -> hidden) -> LSTM(hidden -> latent)
    Decoder: RepeatVector -> LSTM(latent -> hidden) -> LSTM(hidden -> input_dim)

Training objective:
    Reconstruct nominal sequences. At inference, large reconstruction error
    indicates an anomaly. Threshold is learned from validation set so that
    precision >= 0.7 on the labeled pilot set.

This module is the canonical training script. To train:

    python -m app.ml.lstm_autoencoder train \
        --train data/synthetic/sensor_train.csv \
        --val   data/synthetic/sensor_val.csv \
        --out   app/ml/weights/lstm_anomaly.pt

Requires: torch>=2.0, numpy, pandas, scikit-learn
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Tuple

import numpy as np
import pandas as pd

try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset
    HAS_TORCH = True
except ImportError:  # pragma: no cover
    HAS_TORCH = False


FEATURES = ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"]
WINDOW = 30          # 30 minutes context window
STRIDE = 1
HIDDEN = 64
LATENT = 16


# ---------------------------------------------------------------------------
# Model definition
# ---------------------------------------------------------------------------

if HAS_TORCH:

    class LSTMAutoencoder(nn.Module):
        def __init__(self, n_features: int = len(FEATURES), hidden: int = HIDDEN, latent: int = LATENT):
            super().__init__()
            self.n_features = n_features
            self.hidden = hidden
            self.latent = latent

            # Encoder
            self.enc_lstm1 = nn.LSTM(n_features, hidden, batch_first=True)
            self.enc_lstm2 = nn.LSTM(hidden, latent, batch_first=True)

            # Decoder
            self.dec_lstm1 = nn.LSTM(latent, hidden, batch_first=True)
            self.dec_lstm2 = nn.LSTM(hidden, n_features, batch_first=True)

        def forward(self, x: "torch.Tensor") -> "torch.Tensor":
            # x : (B, T, F)
            _, (h1, _) = self.enc_lstm1(x)
            enc, (h2, _) = self.enc_lstm2(_repeat(h1[-1], x.size(1)))
            # decode
            dec, _ = self.dec_lstm1(enc)
            out, _ = self.dec_lstm2(dec)
            return out

    def _repeat(h: "torch.Tensor", T: int) -> "torch.Tensor":
        return h.unsqueeze(1).repeat(1, T, 1)


# ---------------------------------------------------------------------------
# Windowing utilities
# ---------------------------------------------------------------------------

def make_windows(df: pd.DataFrame, window: int = WINDOW, stride: int = STRIDE) -> Tuple[np.ndarray, np.ndarray]:
    """Slide a window per sensor. Returns (X, y) where y is window-level anomaly flag."""
    Xs, ys = [], []
    for _, group in df.groupby("sensor_id"):
        feats = group[FEATURES].to_numpy(dtype=np.float32)
        labels = group["anomaly"].to_numpy(dtype=np.int8)
        for i in range(0, len(feats) - window + 1, stride):
            Xs.append(feats[i:i + window])
            ys.append(int(labels[i:i + window].max()))
    return np.stack(Xs), np.array(ys, dtype=np.int8)


def fit_scaler(X: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    flat = X.reshape(-1, X.shape[-1])
    mean = flat.mean(axis=0)
    std = flat.std(axis=0) + 1e-6
    return mean, std


def apply_scaler(X: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return (X - mean) / std


# ---------------------------------------------------------------------------
# Training (PyTorch)
# ---------------------------------------------------------------------------

def train(args: argparse.Namespace) -> None:
    if not HAS_TORCH:
        raise RuntimeError("PyTorch is not installed. `pip install torch` to train the LSTM autoencoder.")

    train_df = pd.read_csv(args.train)
    val_df = pd.read_csv(args.val)

    Xtr, ytr = make_windows(train_df)
    Xva, yva = make_windows(val_df)

    # Train ONLY on nominal windows (anomaly == 0) so the AE learns the baseline.
    Xtr_clean = Xtr[ytr == 0]

    mean, std = fit_scaler(Xtr_clean)
    Xtr_clean = apply_scaler(Xtr_clean, mean, std)
    Xva_s = apply_scaler(Xva, mean, std)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = LSTMAutoencoder().to(device)

    optim = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    train_ds = TensorDataset(torch.from_numpy(Xtr_clean))
    loader = DataLoader(train_ds, batch_size=128, shuffle=True)

    for epoch in range(args.epochs):
        model.train()
        running = 0.0
        for (xb,) in loader:
            xb = xb.to(device)
            recon = model(xb)
            loss = loss_fn(recon, xb)
            optim.zero_grad()
            loss.backward()
            optim.step()
            running += loss.item() * xb.size(0)
        running /= len(train_ds)
        print(f"epoch {epoch + 1:02d}/{args.epochs}  train_mse={running:.5f}")

    # Pick threshold on val set so that precision >= 0.7
    model.eval()
    with torch.no_grad():
        recon = model(torch.from_numpy(Xva_s).to(device)).cpu().numpy()
    err = ((Xva_s - recon) ** 2).mean(axis=(1, 2))
    thr = pick_threshold(err, yva, target_precision=0.7)

    out_dir = Path(args.out).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), args.out)
    meta = {
        "features": FEATURES,
        "window": WINDOW,
        "hidden": HIDDEN,
        "latent": LATENT,
        "mean": mean.tolist(),
        "std": std.tolist(),
        "threshold": float(thr),
    }
    with open(out_dir / "lstm_anomaly_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[✓] saved {args.out}  threshold={thr:.5f}")


def pick_threshold(err: np.ndarray, y: np.ndarray, target_precision: float = 0.7) -> float:
    """Find smallest threshold whose precision >= target on the val set."""
    candidates = np.quantile(err, np.linspace(0.80, 0.999, 200))
    best = float(np.quantile(err, 0.97))
    for thr in candidates:
        pred = (err > thr).astype(int)
        tp = int(((pred == 1) & (y == 1)).sum())
        fp = int(((pred == 1) & (y == 0)).sum())
        if tp + fp == 0:
            continue
        prec = tp / (tp + fp)
        if prec >= target_precision:
            best = float(thr)
            break
    return best


def _cli():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd")

    t = sub.add_parser("train")
    t.add_argument("--train", required=True)
    t.add_argument("--val", required=True)
    t.add_argument("--out", default="app/ml/weights/lstm_anomaly.pt")
    t.add_argument("--epochs", type=int, default=15)

    args = p.parse_args()
    if args.cmd == "train":
        train(args)
    else:
        p.print_help()


if __name__ == "__main__":
    _cli()
