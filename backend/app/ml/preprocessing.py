import numpy as np
from datetime import datetime


def extract_pipe_features(asset_dict: dict) -> np.ndarray:
    """Extract and normalize features from a pipe/sewer asset record."""
    material_encoding = {
        "pvc": 0, "hdpe": 1, "ductile_iron": 2, "steel": 3,
        "galvanized_steel": 4, "cast_iron": 5, "asbestos_cement": 6,
    }
    material = (asset_dict.get("material") or "unknown").lower().replace(" ", "_")
    mat_code = material_encoding.get(material, 3)

    land_use_encoding = {"residential": 0, "commercial": 1, "industrial": 2}
    land_use = (asset_dict.get("land_use_type") or "residential").lower()
    lu_code = land_use_encoding.get(land_use, 0)

    age = asset_dict.get("age_years") or 0
    diameter = asset_dict.get("diameter_mm") or 150
    depth = asset_dict.get("depth_m") or 1.0
    failures = asset_dict.get("failure_count") or 0
    condition = asset_dict.get("condition_rating") or 3

    now = datetime.utcnow()
    is_wet = 1 if now.month in [11, 12, 1, 2, 3] else 0

    # Engineered features
    age_risk = min(age / 50.0, 1.0)
    failure_density = min(failures / 10.0, 1.0)

    features = [
        age, diameter, depth, failures, condition,
        mat_code, lu_code, is_wet, age_risk, failure_density,
    ]
    return np.array(features, dtype=np.float32)


def normalize_sensor_sequence(readings: list[dict], seq_length: int = 24) -> np.ndarray:
    """Prepare a sensor reading sequence for LSTM input."""
    metrics = ["flow_rate_lps", "pressure_bar", "water_level_m", "turbidity_ntu"]

    # Default normalization ranges
    ranges = {
        "flow_rate_lps": (0, 20),
        "pressure_bar": (0, 8),
        "water_level_m": (0, 5),
        "turbidity_ntu": (0, 10),
    }

    sequence = []
    for reading in readings[-seq_length:]:
        row = []
        for m in metrics:
            val = reading.get(m, 0.0) or 0.0
            lo, hi = ranges[m]
            normalized = (val - lo) / (hi - lo) if hi > lo else 0.0
            row.append(max(0.0, min(1.0, normalized)))
        sequence.append(row)

    # Pad if not enough readings
    while len(sequence) < seq_length:
        sequence.insert(0, [0.5] * len(metrics))

    return np.array([sequence], dtype=np.float32)  # shape: (1, seq_length, n_features)
