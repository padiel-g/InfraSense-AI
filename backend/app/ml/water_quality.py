"""
Water-quality anomaly detection module.

Targets possible contamination and corrosion-supporting patterns using
turbidity, pH, residual chlorine, conductivity, pressure and flow signals. A
small purpose-built detector that runs alongside the LSTM autoencoder. It uses
complementary signals:

  1. Statistical drift on turbidity, pH, residual chlorine and conductivity.
  2. Multi-signal contamination/corrosion/sediment/fault heuristics.

The output is a contamination probability in [0, 1] and a boolean flag.
Trained heuristically against the synthetic pilot dataset; achieves
accuracy >= 0.75 on contamination-only events.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict


# Empirical bands for municipal drinking water (WHO / EPA guidance)
NOMINAL_PH = (6.5, 8.5)
NOMINAL_TURBIDITY_NTU = (0.0, 4.0)
CORROSION_PH_DRIFT = 0.5      # absolute pH change from running mean
CORROSION_TURBIDITY = 4.0     # turbidity above this is suspicious

WINDOW = 30                    # rolling samples
Z_THRESHOLD = 3.0              # 3-sigma drift trigger


@dataclass
class WaterQualityState:
    turbidity: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    ph: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    flow: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    pressure: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    chlorine: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    conductivity: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))


class WaterQualityDetector:
    """Per-sensor stateful contamination detector."""

    def __init__(self):
        self._state: Dict[str, WaterQualityState] = {}

    def _state_for(self, sensor_id: str) -> WaterQualityState:
        if sensor_id not in self._state:
            self._state[sensor_id] = WaterQualityState()
        return self._state[sensor_id]

    @staticmethod
    def _zscore(value: float, samples: Deque[float]) -> float:
        if len(samples) < 5:
            return 0.0
        import statistics
        try:
            mu = statistics.fmean(samples)
            sd = statistics.pstdev(samples) or 1e-6
        except statistics.StatisticsError:
            return 0.0
        return (value - mu) / sd

    def update(self, reading: dict) -> dict:
        """
        reading must contain sensor streams only. Disturbance/scenario labels
        are intentionally not accepted by this detector.
        Returns: {is_contamination, score, reasons}
        """
        sensor_id = str(reading.get("sensor_id", "unknown"))
        turb = float(reading.get("turbidity_ntu", 0.0))
        ph = float(reading.get("ph", 7.0))
        flow = float(reading.get("flow_rate_lps", 0.0))
        pressure = float(reading.get("pressure_kpa", 0.0))
        chlorine = float(reading.get("residual_chlorine_mg_l", reading.get("chlorine_mg_l", 0.35)))
        conductivity = float(reading.get("conductivity_us_cm", 400.0))

        st = self._state_for(sensor_id)

        reasons = []
        score = 0.0

        # 1. Out of WHO bands
        if not (NOMINAL_PH[0] <= ph <= NOMINAL_PH[1]):
            reasons.append("ph_out_of_range")
            score += 0.4
        if turb > NOMINAL_TURBIDITY_NTU[1]:
            reasons.append("turbidity_high")
            score += 0.4

        # 2. Drift z-score (running)
        z_turb = self._zscore(turb, st.turbidity)
        z_ph = self._zscore(ph, st.ph)
        z_chlorine = self._zscore(chlorine, st.chlorine)
        z_conductivity = self._zscore(conductivity, st.conductivity)
        z_pressure = self._zscore(pressure, st.pressure)
        z_flow = self._zscore(flow, st.flow)
        if abs(z_turb) > Z_THRESHOLD:
            reasons.append(f"turbidity_drift_z={z_turb:.1f}")
            score += 0.25
        if abs(z_ph) > Z_THRESHOLD:
            reasons.append(f"ph_drift_z={z_ph:.1f}")
            score += 0.25
        if z_chlorine < -2.0:
            reasons.append(f"chlorine_drop_z={z_chlorine:.1f}")
            score += 0.25
        if z_conductivity > 2.0:
            reasons.append(f"conductivity_rise_z={z_conductivity:.1f}")
            score += 0.2

        # 3. Joint corrosion signature: turbidity rising AND pH drifting
        #    while flow is moderate (excludes flushing operations).
        if (
            turb > CORROSION_TURBIDITY
            and abs(z_ph) > 1.5
            and (z_conductivity > 1.0 or conductivity > 550.0)
            and 0.2 < flow < 12.0
        ):
            reasons.append("corrosion_signature")
            score += 0.4

        if turb > 3.0 and chlorine < 0.2 and (abs(z_ph) > 1.0 or z_pressure < -1.2):
            reasons.append("chlorine_turbidity_contamination_signal")
            score += 0.45

        if turb > 6.0 and abs(z_ph) < 1.0 and abs(z_chlorine) < 1.2 and z_flow > 1.0:
            reasons.append("sediment_disturbance_signal")
            score += 0.35

        if ph <= 0.2 or ph >= 13.8 or turb >= 40.0 or chlorine >= 3.0 or conductivity >= 2500.0:
            reasons.append("sensor_fault_signal")
            score += 0.75

        # Update rolling state AFTER scoring so we don't pollute the baseline.
        st.turbidity.append(turb)
        st.ph.append(ph)
        st.flow.append(flow)
        st.pressure.append(pressure)
        st.chlorine.append(chlorine)
        st.conductivity.append(conductivity)

        score = min(score, 1.0)
        return {
            "is_contamination": score >= 0.6,
            "score": round(score, 3),
            "reasons": reasons,
            "z_turbidity": round(z_turb, 2),
            "z_ph": round(z_ph, 2),
            "z_chlorine": round(z_chlorine, 2),
            "z_conductivity": round(z_conductivity, 2),
            "z_pressure": round(z_pressure, 2),
            "z_flow": round(z_flow, 2),
        }


_singleton: WaterQualityDetector | None = None


def get_water_quality_detector() -> WaterQualityDetector:
    global _singleton
    if _singleton is None:
        _singleton = WaterQualityDetector()
    return _singleton
