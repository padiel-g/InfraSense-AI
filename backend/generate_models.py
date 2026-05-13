"""
Generate placeholder ML model weights for development/testing.

Creates valid, loadable (but untrained on real data) model artifacts for:
  1. XGBoost risk classifier       -> app/ml/weights/xgboost_risk.json
  2. Random Forest risk classifier  -> app/ml/weights/rf_risk.joblib
  3. LSTM Autoencoder (PyTorch)     -> app/ml/weights/lstm_anomaly.pt
  4. Sklearn MLP Autoencoder        -> app/ml/weights/sklearn_anomaly.joblib
  5. YOLOv8 dumping detector        -> (re-saves existing with safe tensors)

Usage:  python generate_models.py
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
import joblib

WEIGHTS_DIR = Path("app/ml/weights")
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

# ── 1. XGBoost risk classifier ──────────────────────────────────────────────
print("[1/5] Generating XGBoost risk model ...")
try:
    import xgboost as xgb

    # 7 features matching RiskPredictionService._extract_features():
    # age_years, diameter_mm, depth_m, failure_count, condition_rating,
    # material_risk, is_wet_season
    rng = np.random.RandomState(42)
    n = 200
    X = rng.rand(n, 7).astype(np.float32)
    y = (X[:, 0] * 0.4 + X[:, 3] * 0.3 + X[:, 5] * 0.3 > 0.45).astype(int)

    model = xgb.XGBClassifier(
        n_estimators=10, max_depth=3, use_label_encoder=False,
        eval_metric="logloss", random_state=42,
    )
    model.fit(X, y)
    model.save_model(str(WEIGHTS_DIR / "xgboost_risk.json"))
    print(f"  -> {WEIGHTS_DIR / 'xgboost_risk.json'}")
except Exception as e:
    print(f"  [!] Skipped XGBoost: {e}")

# ── 2. Random Forest risk classifier ────────────────────────────────────────
print("[2/5] Generating Random Forest risk model ...")
try:
    from sklearn.ensemble import RandomForestClassifier

    rng = np.random.RandomState(42)
    n = 200
    X = rng.rand(n, 7).astype(np.float32)
    y = (X[:, 0] * 0.4 + X[:, 3] * 0.3 + X[:, 5] * 0.3 > 0.45).astype(int)

    rf = RandomForestClassifier(n_estimators=10, max_depth=4, random_state=42)
    rf.fit(X, y)
    joblib.dump(rf, str(WEIGHTS_DIR / "rf_risk.joblib"))
    print(f"  -> {WEIGHTS_DIR / 'rf_risk.joblib'}")
except Exception as e:
    print(f"  [!] Skipped RF: {e}")

# ── 3. LSTM Autoencoder (PyTorch) ───────────────────────────────────────────
print("[3/5] Generating LSTM anomaly model ...")
try:
    import torch

    # Must match LSTMAutoencoder(n_features=5, hidden=64, latent=16)
    sys.path.insert(0, ".")
    from app.ml.lstm_autoencoder import LSTMAutoencoder

    model = LSTMAutoencoder(n_features=5, hidden=64, latent=16)
    torch.save(model.state_dict(), str(WEIGHTS_DIR / "lstm_anomaly.pt"))

    # Also save meta
    meta = {
        "features": ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"],
        "window": 30,
        "hidden": 64,
        "latent": 16,
        "mean": [0.0] * 5,
        "std": [1.0] * 5,
        "threshold": 0.5,
    }
    with open(WEIGHTS_DIR / "lstm_anomaly_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  -> {WEIGHTS_DIR / 'lstm_anomaly.pt'}")
except Exception as e:
    print(f"  [!] Skipped LSTM: {e}")

# ── 4. Sklearn MLP Autoencoder ──────────────────────────────────────────────
print("[4/5] Regenerating sklearn AE model (fixes numpy version mismatch) ...")
try:
    from sklearn.neural_network import MLPRegressor
    from sklearn.preprocessing import StandardScaler

    FEATURES = ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"]
    WINDOW = 30
    n_features = len(FEATURES)
    flat_dim = WINDOW * n_features  # 150

    rng = np.random.RandomState(42)
    # Synthetic "normal" data: 100 flattened windows
    X_train = rng.randn(100, flat_dim).astype(np.float32)

    scaler = StandardScaler().fit(X_train)
    X_scaled = scaler.transform(X_train)

    ae = MLPRegressor(
        hidden_layer_sizes=(64, 16, 64),
        activation="relu", solver="adam",
        learning_rate_init=1e-3, max_iter=20,
        batch_size=32, random_state=42, verbose=False,
    )
    ae.fit(X_scaled, X_scaled)

    # Compute a reasonable threshold
    recon = ae.predict(X_scaled)
    errors = ((X_scaled - recon) ** 2).mean(axis=1)
    threshold = float(np.quantile(errors, 0.97))

    joblib.dump({"model": ae, "scaler": scaler}, str(WEIGHTS_DIR / "sklearn_anomaly.joblib"))
    meta = {"threshold": threshold, "window": WINDOW, "features": FEATURES}
    with open(WEIGHTS_DIR / "sklearn_anomaly.meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  -> {WEIGHTS_DIR / 'sklearn_anomaly.joblib'}  threshold={threshold:.5f}")
except Exception as e:
    print(f"  [!] Skipped sklearn AE: {e}")

# ── 5. YOLO — handled via loader fix (weights_only=False) ──────────────────
print("[5/5] YOLO model: will be handled by loader.py fix (torch safe-globals)")
print()
print("[✓] Model generation complete.")
