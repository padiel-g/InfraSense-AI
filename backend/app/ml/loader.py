import os
import threading
from typing import Callable, Iterable, Optional
from app.config import get_settings

settings = get_settings()

_models: dict = {}
_model_lock = threading.RLock()
_load_attempted: set[str] = set()
_MODEL_NAMES = (
    "xgboost_risk",
    "rf_risk",
    "lstm_anomaly",
    "sklearn_ae",
    "yolo_dumping",
)


def _train_yolo_dumping(weights_path: str, dataset_yaml: str) -> bool:
    """Best-effort YOLO training for illegal dumping from the local dataset."""
    try:
        from ultralytics import YOLO

        # Start from a small pretrained model (Ultralytics may download this
        # once if not present locally).
        model = YOLO("yolov8n.pt")

        # Keep defaults conservative: the goal is to ensure the system has a
        # usable model rather than run an expensive training job.
        results = model.train(
            data=dataset_yaml,
            epochs=20,
            imgsz=640,
            batch=8,
            device="cpu",
            verbose=False,
        )

        # Ultralytics writes best.pt under the run directory.
        best = getattr(results, "best", None)
        if best and os.path.exists(str(best)):
            os.makedirs(os.path.dirname(weights_path) or ".", exist_ok=True)
            import shutil
            shutil.copyfile(str(best), weights_path)
            print(f"  [✓] Trained YOLO model saved to {weights_path}")
            return True

        # If we cannot find best weights, training still may have produced a
        # last.pt. Try to locate it.
        save_dir = getattr(results, "save_dir", None)
        if save_dir:
            candidate = os.path.join(str(save_dir), "weights", "best.pt")
            if os.path.exists(candidate):
                os.makedirs(os.path.dirname(weights_path) or ".", exist_ok=True)
                import shutil
                shutil.copyfile(candidate, weights_path)
                print(f"  [✓] Trained YOLO model saved to {weights_path}")
                return True
    except Exception as e:
        print(f"[!] YOLO auto-train failed: {e}")
        return False

    print("[!] YOLO auto-train finished but no weights were produced")
    return False


def _generate_xgboost_placeholder(path: str) -> None:
    """Generate a minimal XGBoost classifier so the model can load."""
    import numpy as np
    import xgboost as xgb

    rng = np.random.RandomState(42)
    n = 200
    X = rng.rand(n, 7).astype(np.float32)
    y = (X[:, 0] * 0.4 + X[:, 3] * 0.3 + X[:, 5] * 0.3 > 0.45).astype(int)
    model = xgb.XGBClassifier(
        n_estimators=10, max_depth=3, use_label_encoder=False,
        eval_metric="logloss", random_state=42,
    )
    model.fit(X, y)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    model.save_model(path)
    print(f"  [i] Generated placeholder XGBoost model at {path}")


def _generate_rf_placeholder(path: str) -> None:
    """Generate a minimal Random Forest classifier so the model can load."""
    import numpy as np
    import joblib
    from sklearn.ensemble import RandomForestClassifier

    rng = np.random.RandomState(42)
    n = 200
    X = rng.rand(n, 7).astype(np.float32)
    y = (X[:, 0] * 0.4 + X[:, 3] * 0.3 + X[:, 5] * 0.3 > 0.45).astype(int)
    rf = RandomForestClassifier(n_estimators=10, max_depth=4, random_state=42)
    rf.fit(X, y)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    joblib.dump(rf, path)
    print(f"  [i] Generated placeholder RF model at {path}")


def _generate_lstm_placeholder(path: str) -> None:
    """Generate a randomly-initialized LSTM autoencoder state dict."""
    import json
    import torch
    from pathlib import Path
    from app.ml.lstm_autoencoder import LSTMAutoencoder

    model = LSTMAutoencoder(n_features=5, hidden=64, latent=16)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    torch.save(model.state_dict(), path)
    meta = {
        "features": ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"],
        "window": 30, "hidden": 64, "latent": 16,
        "mean": [0.0] * 5, "std": [1.0] * 5, "threshold": 0.5,
    }
    with open(Path(path).parent / "lstm_anomaly_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  [i] Generated placeholder LSTM model at {path}")


def _generate_sklearn_ae_placeholder(path: str) -> None:
    """Generate a fresh sklearn MLP autoencoder (fixes numpy version issues)."""
    import json
    import numpy as np
    import joblib
    from pathlib import Path
    from sklearn.neural_network import MLPRegressor
    from sklearn.preprocessing import StandardScaler

    FEATURES = ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"]
    WINDOW = 30
    flat_dim = WINDOW * len(FEATURES)

    rng = np.random.RandomState(42)
    X_train = rng.randn(100, flat_dim).astype(np.float32)
    scaler = StandardScaler().fit(X_train)
    X_scaled = scaler.transform(X_train)

    ae = MLPRegressor(
        hidden_layer_sizes=(64, 16, 64), activation="relu", solver="adam",
        learning_rate_init=1e-3, max_iter=20, batch_size=32,
        random_state=42, verbose=False,
    )
    ae.fit(X_scaled, X_scaled)

    recon = ae.predict(X_scaled)
    errors = ((X_scaled - recon) ** 2).mean(axis=1)
    threshold = float(np.quantile(errors, 0.97))

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    joblib.dump({"model": ae, "scaler": scaler}, path)
    meta = {"threshold": threshold, "window": WINDOW, "features": FEATURES}
    with open(Path(path).with_suffix(".meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  [i] Regenerated sklearn AE at {path} (threshold={threshold:.5f})")


def _load_xgboost_risk() -> None:
    """Load or generate the XGBoost risk model."""

    # ── XGBoost risk model ──────────────────────────────────────────────
    xgb_path = settings.XGBOOST_MODEL_PATH
    if not os.path.exists(xgb_path):
        try:
            _generate_xgboost_placeholder(xgb_path)
        except Exception as e:
            print(f"[✗] Could not generate XGBoost placeholder: {e}")
    if os.path.exists(xgb_path):
        try:
            import xgboost as xgb
            model = xgb.XGBClassifier()
            model.load_model(xgb_path)
            _models["xgboost_risk"] = model
            print(f"[✓] XGBoost risk model loaded from {xgb_path}")
        except Exception as e:
            print(f"[✗] Failed to load XGBoost model: {e}")

def _load_rf_risk() -> None:
    """Load or generate the Random Forest risk model."""
    rf_path = settings.RF_MODEL_PATH
    if not os.path.exists(rf_path):
        try:
            _generate_rf_placeholder(rf_path)
        except Exception as e:
            print(f"[✗] Could not generate RF placeholder: {e}")
    if os.path.exists(rf_path):
        try:
            import joblib
            _models["rf_risk"] = joblib.load(rf_path)
            print(f"[✓] Random Forest model loaded from {rf_path}")
        except Exception as e:
            print(f"[✗] Failed to load RF model: {e}")

def _load_lstm_anomaly() -> None:
    """Load or generate the PyTorch LSTM anomaly model."""
    lstm_path = settings.LSTM_MODEL_PATH
    if not os.path.exists(lstm_path):
        try:
            _generate_lstm_placeholder(lstm_path)
        except Exception as e:
            print(f"[✗] Could not generate LSTM placeholder: {e}")
    if os.path.exists(lstm_path):
        try:
            import torch
            from app.ml.lstm_autoencoder import LSTMAutoencoder
            model = LSTMAutoencoder()
            model.load_state_dict(
                torch.load(lstm_path, map_location="cpu", weights_only=False)
            )
            model.eval()
            _models["lstm_anomaly"] = model
            print(f"[✓] LSTM anomaly model loaded from {lstm_path}")
        except Exception as e:
            print(f"[✗] Failed to load LSTM model: {e}")

def _load_sklearn_ae() -> None:
    """Load or generate the sklearn autoencoder fallback."""
    sk_path = getattr(settings, "SKLEARN_AE_MODEL_PATH", "app/ml/weights/sklearn_anomaly.joblib")
    # Always regenerate if the file exists but was pickled with an
    # incompatible numpy version (common after upgrades).
    if os.path.exists(sk_path):
        try:
            from app.ml.sklearn_autoencoder import SklearnAEArtifact
            _models["sklearn_ae"] = SklearnAEArtifact.load(sk_path)
            print(f"[✓] sklearn AE loaded from {sk_path}")
        except Exception:
            print(f"[!] sklearn AE at {sk_path} is incompatible — regenerating ...")
            try:
                _generate_sklearn_ae_placeholder(sk_path)
                from app.ml.sklearn_autoencoder import SklearnAEArtifact
                _models["sklearn_ae"] = SklearnAEArtifact.load(sk_path)
                print(f"[✓] sklearn AE reloaded after regeneration")
            except Exception as e2:
                print(f"[✗] Failed to regenerate sklearn AE: {e2}")
    else:
        try:
            _generate_sklearn_ae_placeholder(sk_path)
            from app.ml.sklearn_autoencoder import SklearnAEArtifact
            _models["sklearn_ae"] = SklearnAEArtifact.load(sk_path)
            print(f"[✓] sklearn AE generated and loaded from {sk_path}")
        except Exception as e:
            print(f"[✗] Could not generate sklearn AE: {e}")

def _load_yolo_dumping() -> None:
    """Load or optionally train the YOLOv8 dumping detector."""
    yolo_path = settings.YOLO_MODEL_PATH
    if not os.path.exists(yolo_path) and getattr(settings, "YOLO_AUTO_TRAIN", False):
        dataset_yaml = getattr(settings, "YOLO_DATASET_YAML", "data/data.yaml")
        print(f"[i] YOLO weights missing at {yolo_path} — training from {dataset_yaml} ...")
        _train_yolo_dumping(yolo_path, dataset_yaml)

    if os.path.exists(yolo_path):
        try:
            # Set safe-globals BEFORE ultralytics tries to load.
            # PyTorch 2.6 changed weights_only default to True, so any class
            # the checkpoint references must be explicitly allowlisted.
            try:
                import torch.serialization
                import torch.nn.modules.container as _c
                import torch.nn.modules.conv as _conv
                import torch.nn.modules.batchnorm as _bn
                import torch.nn.modules.activation as _act
                import torch.nn.modules.pooling as _pool
                import torch.nn.modules.upsampling as _up
                _safe = [
                    _c.Sequential, _c.ModuleList, _c.ModuleDict,
                    _conv.Conv2d,
                    _bn.BatchNorm2d,
                    _act.SiLU, _act.ReLU, _act.LeakyReLU,
                    _pool.MaxPool2d,
                    _up.Upsample,
                ]
                try:
                    import ultralytics.nn.tasks as _tasks
                    _safe.append(_tasks.DetectionModel)
                except Exception:
                    pass
                torch.serialization.add_safe_globals(_safe)
            except Exception:
                pass  # older PyTorch — try anyway
            from ultralytics import YOLO
            _models["yolo_dumping"] = YOLO(yolo_path)
            print(f"[✓] YOLOv8 dumping model loaded from {yolo_path}")
        except Exception as e:
            print(f"[✗] Failed to load YOLO model: {e}")
    else:
        print(f"[!] YOLO model not found at {yolo_path} - detection disabled")

_MODEL_LOADERS: dict[str, Callable[[], None]] = {
    "xgboost_risk": _load_xgboost_risk,
    "rf_risk": _load_rf_risk,
    "lstm_anomaly": _load_lstm_anomaly,
    "sklearn_ae": _load_sklearn_ae,
    "yolo_dumping": _load_yolo_dumping,
}


def load_model(name: str) -> Optional[object]:
    """Load one model on demand and return it when available."""
    if name in _models:
        return _models[name]

    loader = _MODEL_LOADERS.get(name)
    if loader is None:
        return None

    with _model_lock:
        if name in _models:
            return _models[name]
        if name in _load_attempted:
            return None
        _load_attempted.add(name)
        loader()
        return _models.get(name)


def load_all_models(model_names: Optional[Iterable[str]] = None) -> None:
    """Load selected ML models.

    Non-ML endpoints should not wait for torch, xgboost, sklearn, or YOLO
    imports during startup. Keep this for explicit warmups and deployments
    that prefer eager model loading.
    """
    names = tuple(model_names or _MODEL_NAMES)
    for name in names:
        load_model(name)

    loaded = len(_models)
    print(f"[i] Loaded {loaded} / {len(_MODEL_NAMES)} ML models")
    missing = set(_MODEL_NAMES) - set(_models.keys())
    if missing:
        print(f"    Missing: {', '.join(sorted(missing))}")


def get_model(name: str, *, load_if_missing: bool = True) -> Optional[object]:
    """Retrieve a model, loading it lazily by default."""
    model = _models.get(name)
    if model is not None or not load_if_missing:
        return model
    return load_model(name)
