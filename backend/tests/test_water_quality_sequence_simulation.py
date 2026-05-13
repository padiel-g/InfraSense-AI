"""Tests for sequence-based water quality simulation."""

from __future__ import annotations

from app.schemas.water_quality import WQSimulationRunIn
from app.services.water_quality_simulation import run_sequence_simulation


def _run(scenario_type: str, seed: int = 123):
    payload = WQSimulationRunIn(
        scenario_type=scenario_type,
        duration_hours=6,
        data_frequency_minutes=15,
        detection_window_size=12,
        random_seed=seed,
        baseline_turbidity_ntu=1.0,
        baseline_ph=7.2,
        baseline_flow_lps=4.0,
        baseline_pressure_kpa=350.0,
        baseline_temperature_c=20.0,
        baseline_chlorine_mg_l=0.5,
        baseline_conductivity_us_cm=400.0,
        event_start_time_minutes=180,
        event_duration_minutes=120,
        event_severity="high",
        pipe_material="cast_iron",
        pipe_age_years=40.0,
    )
    readings, detection, summary = run_sequence_simulation(simulation_id="test", payload=payload)
    return payload, readings, detection, summary


def test_random_seed_repeatable():
    _, r1, d1, s1 = _run("gradual_contamination", seed=999)
    _, r2, d2, s2 = _run("gradual_contamination", seed=999)

    assert r1[:10] == r2[:10]
    assert d1[:10] == d2[:10]
    assert s1 == s2


def test_detection_warmup_collecting_sequence():
    payload, _, detection, _ = _run("normal")
    assert len(detection) > payload.detection_window_size
    for i in range(payload.detection_window_size):
        assert detection[i]["status"] == "collecting_sequence"
        assert detection[i]["prediction"] is None


def test_each_anomaly_scenario_produces_matching_detection_family():
    expected = {
        "gradual_corrosion": ("possible_corrosion", "corrosion_like_event"),
        "gradual_contamination": ("possible_contamination", "contamination_like_event"),
        "sediment_disturbance": ("possible_sediment_disturbance", "sediment_like_event"),
        "sensor_fault": ("sensor_fault_suspected", "sensor_fault_like_event"),
    }

    for scenario, (prediction, hidden_label) in expected.items():
        _, readings, detection, summary = _run(scenario)
        assert any(r["ground_truth_label"] == hidden_label for r in readings)
        assert any(d["prediction"] == prediction for d in detection)
        assert summary["predicted_label"] == prediction


def test_contamination_lowers_chlorine_after_event_start():
    payload, readings, _, _ = _run("gradual_contamination")
    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    pre = [readings[i]["residual_chlorine_mg_l"] for i in range(max(0, start - 3), start)]
    post = [readings[i]["residual_chlorine_mg_l"] for i in range(start, min(start + 4, len(readings)))]
    assert sum(post) / len(post) < sum(pre) / len(pre)


def test_sediment_disturbance_keeps_chlorine_stable():
    payload, readings, _, _ = _run("sediment_disturbance")
    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    pre = [readings[i]["residual_chlorine_mg_l"] for i in range(max(0, start - 3), start)]
    post = [readings[i]["residual_chlorine_mg_l"] for i in range(start, min(start + 4, len(readings)))]
    assert abs((sum(post) / len(post)) - (sum(pre) / len(pre))) < 0.12


def test_corrosion_increases_conductivity_and_lowers_ph():
    payload, readings, _, _ = _run("gradual_corrosion")
    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    pre_c = [readings[i]["conductivity_us_cm"] for i in range(max(0, start - 3), start)]
    post_c = [readings[i]["conductivity_us_cm"] for i in range(start, min(start + 4, len(readings)))]
    assert (sum(post_c) / len(post_c)) > (sum(pre_c) / len(pre_c)) + 3.0

    pre_ph = [readings[i]["ph"] for i in range(max(0, start - 3), start)]
    post_ph = [readings[i]["ph"] for i in range(start, min(start + 4, len(readings)))]
    assert sum(post_ph) / len(post_ph) < sum(pre_ph) / len(pre_ph)


def test_sediment_disturbance_spikes_turbidity_without_large_ph_change():
    payload, readings, _, _ = _run("sediment_disturbance")
    start = payload.event_start_time_minutes // payload.data_frequency_minutes

    pre_t = [readings[i]["turbidity_ntu"] for i in range(max(0, start - 3), start)]
    post_t = [readings[i]["turbidity_ntu"] for i in range(start, min(start + 3, len(readings)))]
    assert max(post_t) > max(pre_t) + 3.0

    pre_ph = [readings[i]["ph"] for i in range(max(0, start - 3), start)]
    post_ph = [readings[i]["ph"] for i in range(start, min(start + 3, len(readings)))]
    assert abs((sum(post_ph) / len(post_ph)) - (sum(pre_ph) / len(pre_ph))) < 0.4


def test_sensor_fault_generates_impossible_or_flatline_readings():
    payload, readings, _, _ = _run("sensor_fault")
    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    end = start + payload.event_duration_minutes // payload.data_frequency_minutes
    event_rows = readings[start:end]

    impossible = [
        r for r in event_rows
        if r["turbidity_ntu"] >= 15
        or r["ph"] <= 3
        or r["ph"] >= 11
        or r["residual_chlorine_mg_l"] >= 3
    ]

    assert impossible
    assert all(r["ground_truth_label"] == "sensor_fault_like_event" for r in event_rows)


def test_ground_truth_labels_match_event_active():
    payload, readings, _, _ = _run("gradual_contamination")
    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    end = start + payload.event_duration_minutes // payload.data_frequency_minutes

    assert all(r["ground_truth_label"] == "normal" for r in readings[:start])
    assert any(r["event_active"] for r in readings[start:end])
    assert all(r["ground_truth_label"] != "normal" for r in readings[start:end])


def test_hidden_labels_are_evaluation_metadata_not_detection_inputs(monkeypatch):
    captured = []

    def fake_prediction(**kwargs):
        sample = kwargs["sample"]
        captured.append(kwargs)
        if sample.event_active:
            return "possible_contamination", 0.8
        return "normal", 0.1

    monkeypatch.setattr("app.services.water_quality_simulation._prediction_for", fake_prediction)
    _, _, detection, summary = _run("gradual_contamination")

    assert any(d["prediction"] == "possible_contamination" for d in detection)
    assert summary["expected_label"] == "contamination_like_event"
    assert summary["disturbance_profile"] == "gradual_contamination"
    assert captured
    for call in captured:
        assert "scenario_type" not in call
        assert "ground_truth_label" not in call
        assert "disturbance_profile" not in call
