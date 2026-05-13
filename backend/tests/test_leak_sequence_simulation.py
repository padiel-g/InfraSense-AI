from __future__ import annotations

from app.schemas.leak_sequence_simulation import LeakSimulationRunIn
from app.services.leak_sequence_simulation import run_leak_sequence_simulation


def _run(scenario_type: str, seed: int = 123):
    payload = LeakSimulationRunIn(
        scenario_type=scenario_type,
        duration_hours=12,
        data_frequency_minutes=15,
        sensor_uncertainty=0.1,
        detection_sensitivity_window=21,
        baseline_pressure_min_kpa=270,
        baseline_pressure_max_kpa=480,
        baseline_flow_min_lps=5,
        baseline_flow_max_lps=20,
        pipe_diameter_mm=150,
        zone_type="residential",
        connected_properties_count=50,
        event_start_time_minutes=180,
        event_duration_minutes=180,
        event_severity="high",
        valve_status="open",
        random_seed=seed,
        expected_label_output=scenario_type if scenario_type != "normal" else "normal",
    )

    readings, detection, summary = run_leak_sequence_simulation(simulation_id="test", payload=payload)
    return payload, readings, detection, summary


def test_random_seed_repeatable():
    _, r1, d1, s1 = _run("small_leak", seed=999)
    _, r2, d2, s2 = _run("small_leak", seed=999)

    assert r1[:10] == r2[:10]
    assert d1[:10] == d2[:10]
    assert s1 == s2


def test_detection_warmup_collecting_sequence():
    payload, _readings, detection, _summary = _run("normal")
    assert len(detection) > payload.detection_sensitivity_window

    for i in range(payload.detection_sensitivity_window - 1):
        assert detection[i]["status"] == "collecting_sequence"
        assert detection[i]["prediction"] is None


def test_normal_simulation_produces_normal_labels():
    payload, readings, detection, summary = _run("normal")

    assert all(r["ground_truth_label"] == "normal" for r in readings)
    assert summary["scenario_type"] == "normal"


def test_small_leak_gradually_increases_flow_and_lowers_pressure():
    payload, readings, _detection, _summary = _run("small_leak")

    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    pre = readings[max(0, start - 3) : start]
    post = readings[start : start + 6]

    pre_flow = sum(r["flow_lps"] for r in pre) / len(pre)
    post_flow = sum(r["flow_lps"] for r in post) / len(post)
    assert post_flow > pre_flow * 0.98

    pre_p = sum(r["pressure_kpa"] for r in pre) / len(pre)
    post_p = sum(r["pressure_kpa"] for r in post) / len(post)
    assert post_p < pre_p


def test_burst_pipe_sharp_flow_increase_and_pressure_drop():
    payload, readings, _detection, _summary = _run("burst_pipe")

    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    pre = readings[max(0, start - 1) : start]
    at = readings[start : start + 2]

    pre_flow = sum(r["flow_lps"] for r in pre) / len(pre)
    at_flow = sum(r["flow_lps"] for r in at) / len(at)
    assert at_flow > pre_flow + 3

    pre_p = sum(r["pressure_kpa"] for r in pre) / len(pre)
    at_p = sum(r["pressure_kpa"] for r in at) / len(at)
    assert at_p < pre_p - 30


def test_overflow_rises_tank_level_and_labels_overflow():
    payload, readings, _detection, _summary = _run("overflow")

    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    end = start + payload.event_duration_minutes // payload.data_frequency_minutes

    event_rows = readings[start:end]
    assert any(r["tank_level_percent"] >= 80 for r in event_rows)
    assert any(r["ground_truth_label"] == "overflow" for r in event_rows)


def test_sensor_fault_creates_abnormal_patterns():
    payload, readings, _detection, _summary = _run("sensor_fault")

    start = payload.event_start_time_minutes // payload.data_frequency_minutes
    end = start + payload.event_duration_minutes // payload.data_frequency_minutes

    event_rows = readings[start:end]
    assert all(r["ground_truth_label"] == "sensor_fault" for r in event_rows)

    # Some impossible values (negative / >100 moisture etc) should exist
    impossible = [
        r
        for r in event_rows
        if r["pressure_kpa"] < 0
        or r["flow_lps"] < 0
        or r["soil_moisture_percent"] < 0
        or r["soil_moisture_percent"] > 100
        or r["acoustic_db"] < 0
        or r["acoustic_db"] > 120
    ]
    assert impossible
