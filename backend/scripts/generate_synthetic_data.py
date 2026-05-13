"""
Synthetic sensor data generator for LSTM anomaly detection training.

Generates labeled time-series for:
- pressure_bar      (leak/burst detection)
- flow_rate_lps     (leak/overflow)
- water_level_m     (overflow)
- turbidity_ntu     (water quality / contamination)
- ph                (water quality / corrosion)

Anomaly types injected:
- leak       : flow spikes, pressure drops
- overflow   : water level climbs, flow high
- contamination : turbidity + pH drift (corrosion-related)
- sensor_fault  : flatline / out-of-range

Outputs:
    data/synthetic_sensor_train.csv
    data/synthetic_sensor_val.csv
    data/synthetic_sensor_test.csv   (labeled pilot set for precision metric)
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.water_quality_simulation import run_sequence_simulation
from app.schemas.water_quality import WQSimulationRunIn


FEATURES = ["pressure_bar", "flow_rate_lps", "water_level_m", "turbidity_ntu", "ph"]

# Nominal operating ranges (mean, std) - typical municipal water network
NOMINAL = {
    "pressure_bar":   (3.0, 0.25),
    "flow_rate_lps":  (5.0, 0.8),
    "water_level_m":  (1.2, 0.15),
    "turbidity_ntu":  (1.5, 0.4),
    "ph":             (7.2, 0.15),
}


@dataclass
class GenConfig:
    n_sensors: int = 8
    samples_per_sensor: int = 4320    # 3 days @ 1 sample/min
    sample_period_min: int = 1
    anomaly_rate: float = 0.04        # fraction of windows that contain anomalies
    seed: int = 42


def _diurnal(n: int, period_min: int, amplitude: float = 0.3) -> np.ndarray:
    """Daily cycle component - demand peaks morning & evening."""
    t = np.arange(n) * period_min / 60.0  # hours
    return amplitude * (np.sin(2 * np.pi * t / 24.0) + 0.5 * np.sin(2 * np.pi * t / 12.0))


def _base_signal(n: int, cfg: GenConfig, rng: np.random.Generator) -> pd.DataFrame:
    """Nominal operating signal with diurnal pattern + mild noise + drift."""
    df = pd.DataFrame(index=range(n))
    cycle = _diurnal(n, cfg.sample_period_min)
    for feat, (mu, sigma) in NOMINAL.items():
        drift = np.cumsum(rng.normal(0, sigma * 0.002, size=n))
        noise = rng.normal(0, sigma * 0.5, size=n)
        if feat in ("flow_rate_lps", "pressure_bar"):
            df[feat] = mu + mu * 0.15 * cycle + drift + noise
        else:
            df[feat] = mu + drift + noise
    return df


def _inject_leak(df: pd.DataFrame, start: int, length: int, rng: np.random.Generator) -> None:
    """Leak: flow rises, pressure drops."""
    end = min(start + length, len(df))
    ramp = np.linspace(0, 1, end - start)
    df.loc[start:end - 1, "flow_rate_lps"] += ramp * rng.uniform(4.0, 8.0)
    df.loc[start:end - 1, "pressure_bar"] -= ramp * rng.uniform(1.0, 2.0)


def _inject_overflow(df: pd.DataFrame, start: int, length: int, rng: np.random.Generator) -> None:
    """Overflow: water level climbs, flow high."""
    end = min(start + length, len(df))
    ramp = np.linspace(0, 1, end - start) ** 0.7
    df.loc[start:end - 1, "water_level_m"] += ramp * rng.uniform(0.8, 1.6)
    df.loc[start:end - 1, "flow_rate_lps"] += ramp * rng.uniform(2.0, 4.0)


def _inject_contamination(df: pd.DataFrame, start: int, length: int, rng: np.random.Generator) -> None:
    """Corrosion-related contamination: turbidity spike + pH drift."""
    end = min(start + length, len(df))
    ramp = np.linspace(0, 1, end - start)
    df.loc[start:end - 1, "turbidity_ntu"] += ramp * rng.uniform(4.0, 10.0)
    direction = rng.choice([-1, 1])
    df.loc[start:end - 1, "ph"] += direction * ramp * rng.uniform(0.4, 0.9)


def _inject_sensor_fault(df: pd.DataFrame, start: int, length: int, rng: np.random.Generator) -> None:
    """Flatline / stuck sensor."""
    end = min(start + length, len(df))
    feat = rng.choice(FEATURES)
    df.loc[start:end - 1, feat] = df.loc[start, feat]


INJECTORS = {
    "leak": _inject_leak,
    "overflow": _inject_overflow,
    "contamination": _inject_contamination,
    "sensor_fault": _inject_sensor_fault,
}


def generate_sensor_stream(sensor_id: int, cfg: GenConfig, rng: np.random.Generator) -> pd.DataFrame:
    n = cfg.samples_per_sensor
    df = _base_signal(n, cfg, rng)
    df["sensor_id"] = sensor_id
    df["timestamp"] = pd.date_range("2026-01-01", periods=n, freq=f"{cfg.sample_period_min}min")
    df["anomaly"] = 0
    df["anomaly_type"] = ""

    # Decide number of anomalies
    n_anomalies = max(1, int(cfg.anomaly_rate * n / 60))  # target ~ anomaly_rate fraction of time
    for _ in range(n_anomalies):
        anomaly_type = rng.choice(list(INJECTORS.keys()), p=[0.35, 0.2, 0.3, 0.15])
        length = int(rng.integers(20, 90))  # 20 - 90 minutes
        start = int(rng.integers(60, max(61, n - length - 60)))
        INJECTORS[anomaly_type](df, start, length, rng)
        df.loc[start:start + length - 1, "anomaly"] = 1
        df.loc[start:start + length - 1, "anomaly_type"] = anomaly_type

    # Clip physically impossible values
    df["pressure_bar"] = df["pressure_bar"].clip(lower=0.0)
    df["flow_rate_lps"] = df["flow_rate_lps"].clip(lower=0.0)
    df["water_level_m"] = df["water_level_m"].clip(lower=0.0)
    df["turbidity_ntu"] = df["turbidity_ntu"].clip(lower=0.0)
    df["ph"] = df["ph"].clip(lower=0.0, upper=14.0)
    return df


def generate_dataset(cfg: GenConfig) -> pd.DataFrame:
    rng = np.random.default_rng(cfg.seed)
    frames = [generate_sensor_stream(i, cfg, rng) for i in range(cfg.n_sensors)]
    df = pd.concat(frames, ignore_index=True)
    return df[["timestamp", "sensor_id", *FEATURES, "anomaly", "anomaly_type"]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/synthetic", help="output directory")
    parser.add_argument("--sensors", type=int, default=8)
    parser.add_argument("--minutes", type=int, default=4320, help="samples per sensor")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--water_quality", action="store_true", help="generate water-quality-only time-series")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if not args.water_quality:
        # Train set (mostly clean)
        train_cfg = GenConfig(n_sensors=args.sensors, samples_per_sensor=args.minutes,
                              anomaly_rate=0.02, seed=args.seed)
        train = generate_dataset(train_cfg)

        # Validation
        val_cfg = GenConfig(n_sensors=max(2, args.sensors // 2), samples_per_sensor=args.minutes // 2,
                            anomaly_rate=0.05, seed=args.seed + 1)
        val = generate_dataset(val_cfg)

        # Labeled pilot test set (richer anomalies)
        test_cfg = GenConfig(n_sensors=max(2, args.sensors // 2), samples_per_sensor=args.minutes // 2,
                             anomaly_rate=0.08, seed=args.seed + 2)
        test = generate_dataset(test_cfg)

        train.to_csv(out / "sensor_train.csv", index=False)
        val.to_csv(out / "sensor_val.csv", index=False)
        test.to_csv(out / "sensor_test.csv", index=False)

        print(f"[✓] train: {len(train):,} rows  ({train['anomaly'].sum()} anomalous)")
        print(f"[✓] val  : {len(val):,} rows  ({val['anomaly'].sum()} anomalous)")
        print(f"[✓] test : {len(test):,} rows  ({test['anomaly'].sum()} anomalous)")
        print(f"[✓] saved to {out.resolve()}")
        return

    scenarios = [
        "normal",
        "gradual_corrosion",
        "gradual_contamination",
        "sediment_disturbance",
        "sensor_fault",
    ]
    frames = []
    for i in range(args.sensors):
        scenario = scenarios[i % len(scenarios)]
        payload = WQSimulationRunIn(
            scenario_type=scenario,
            duration_hours=max(1, args.minutes // 60),
            data_frequency_minutes=1,
            detection_window_size=12,
            random_seed=args.seed + i,
            pipe_material="cast_iron",
            pipe_age_years=20.0,
        )
        readings, _, _ = run_sequence_simulation(simulation_id=f"gen-{i}", payload=payload)
        df = pd.DataFrame(readings)
        df["sensor_id"] = f"WQ-{i:03d}"
        frames.append(df)

    df_all = pd.concat(frames, ignore_index=True)
    df_all.to_csv(out / "water_quality_sequences.csv", index=False)
    print(f"[✓] water_quality_sequences: {len(df_all):,} rows")
    print(f"[✓] saved to {out.resolve()}")


if __name__ == "__main__":
    main()
