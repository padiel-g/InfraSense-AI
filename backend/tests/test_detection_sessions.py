from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.database import init_db
from app.main import app


@pytest.fixture(autouse=True)
async def ensure_database():
    await init_db()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _reading_payload(index: int, **overrides):
    base_time = datetime(2026, 5, 5, 12, 0, tzinfo=timezone.utc)
    payload = {
        "timestamp": (base_time + timedelta(minutes=index)).isoformat(),
        "sensor_id": f"LD-TEST-{index}",
        "pressure_kpa": 420.0,
        "flow_lps": 5.0,
        "acoustic_db": 38.0,
        "soil_moisture_percent": 28.0,
        "valve_status": "unknown",
        "tank_level_percent": 55.0,
        "pipe_zone": "test_zone",
    }
    payload.update(overrides)
    return payload


async def _create_session(client: AsyncClient) -> str:
    response = await client.post("/api/sessions", json={})
    assert response.status_code == 201
    return response.json()["id"]


async def _add_readings(client: AsyncClient, session_id: str, readings: list[dict]):
    for reading in readings:
        response = await client.post(f"/api/sessions/{session_id}/readings", json=reading)
        assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_create_session(client):
    session_id = await _create_session(client)
    assert session_id


@pytest.mark.asyncio
async def test_add_readings_and_return_in_timestamp_order(client):
    session_id = await _create_session(client)
    late = _reading_payload(2, pressure_kpa=410)
    early = _reading_payload(1, pressure_kpa=420)

    await _add_readings(client, session_id, [late, early])

    response = await client.get(f"/api/sessions/{session_id}/readings")
    assert response.status_code == 200
    data = response.json()
    assert [row["pressure_kpa"] for row in data] == [420.0, 410.0]


@pytest.mark.asyncio
async def test_detection_blocked_when_fewer_than_minimum_readings(client):
    min_sequence_length = get_settings().MIN_SEQUENCE_LENGTH
    session_id = await _create_session(client)
    await _add_readings(client, session_id, [_reading_payload(0)])

    response = await client.post(f"/api/sessions/{session_id}/detect")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "collecting_sequence"
    assert data["prediction"] is None
    assert data["confidence"] is None
    assert data["message"] == f"Need at least {min_sequence_length} readings before LSTM detection can run."


@pytest.mark.asyncio
async def test_detection_allowed_when_minimum_readings_exist(client):
    min_sequence_length = get_settings().MIN_SEQUENCE_LENGTH
    session_id = await _create_session(client)
    await _add_readings(
        client,
        session_id,
        [_reading_payload(i) for i in range(min_sequence_length)],
    )

    response = await client.post(f"/api/sessions/{session_id}/detect")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] != "collecting_sequence"
    assert data["prediction"] is not None
    assert data["confidence"] is not None


@pytest.mark.asyncio
async def test_low_pressure_high_flow_flags_possible_leak_or_burst(client):
    min_sequence_length = get_settings().MIN_SEQUENCE_LENGTH
    session_id = await _create_session(client)
    readings = [_reading_payload(i) for i in range(min_sequence_length - 1)]
    readings.append(_reading_payload(min_sequence_length, pressure_kpa=180.0, flow_lps=13.0))
    await _add_readings(client, session_id, readings)

    response = await client.post(f"/api/sessions/{session_id}/detect")

    assert response.status_code == 200
    data = response.json()
    assert data["prediction"] in {"possible_leak", "possible_burst"}
    assert "normal" not in data["status"]


@pytest.mark.asyncio
async def test_open_valve_high_tank_flags_overflow_risk(client):
    min_sequence_length = get_settings().MIN_SEQUENCE_LENGTH
    session_id = await _create_session(client)
    readings = [_reading_payload(i, valve_status="open", tank_level_percent=80.0) for i in range(min_sequence_length - 1)]
    readings.append(_reading_payload(min_sequence_length, valve_status="open", tank_level_percent=96.0, flow_lps=5.2))
    await _add_readings(client, session_id, readings)

    response = await client.post(f"/api/sessions/{session_id}/detect")

    assert response.status_code == 200
    data = response.json()
    assert data["prediction"] == "overflow_risk"
    assert data["confidence"] > 0


@pytest.mark.asyncio
async def test_normal_only_after_enough_readings(client):
    min_sequence_length = get_settings().MIN_SEQUENCE_LENGTH
    session_id = await _create_session(client)
    await _add_readings(
        client,
        session_id,
        [_reading_payload(i) for i in range(min_sequence_length - 1)],
    )
    warmup = await client.post(f"/api/sessions/{session_id}/detect")
    assert warmup.json()["status"] == "collecting_sequence"
    assert warmup.json()["prediction"] is None

    await _add_readings(client, session_id, [_reading_payload(min_sequence_length)])
    detected = await client.post(f"/api/sessions/{session_id}/detect")
    data = detected.json()

    assert data["status"] == "normal"
    assert data["prediction"] == "normal"
    assert data["confidence"] is not None
