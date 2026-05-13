"""Tests for anomaly detection service."""
from app.services.anomaly_detection import AnomalyDetectionService


def test_normal_reading():
    service = AnomalyDetectionService()
    reading = {
        "sensor_id": "TEST-001",
        "flow_rate_lps": 5.0,
        "pressure_bar": 3.0,
        "water_level_m": 1.2,
        "turbidity_ntu": 2.0,
    }
    result = service.check_reading(reading)
    assert result["is_anomaly"] is False


def test_spike_anomaly():
    service = AnomalyDetectionService()
    reading = {
        "sensor_id": "TEST-002",
        "flow_rate_lps": 25.0,  # Very high
        "pressure_bar": 0.3,   # Very low
        "water_level_m": 1.2,
        "turbidity_ntu": 2.0,
    }
    result = service.check_reading(reading)
    assert result["is_anomaly"] is True
    assert result["score"] > 0


def test_classify_spike():
    service = AnomalyDetectionService()
    reading = {"flow_rate_lps": 15.0, "pressure_bar": 3.0}
    assert service._classify_anomaly_type(reading) == "spike"


def test_classify_drop():
    service = AnomalyDetectionService()
    reading = {"flow_rate_lps": 5.0, "pressure_bar": 0.5}
    assert service._classify_anomaly_type(reading) == "drop"
