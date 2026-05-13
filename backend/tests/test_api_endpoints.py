"""Basic API endpoint tests."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_register_user(client):
    response = await client.post("/api/v1/auth/register", json={
        "email": "test@example.com",
        "full_name": "Test User",
        "password": "testpass123",
        "role": "resident",
    })
    assert response.status_code in [201, 400]  # 400 if already exists


@pytest.mark.asyncio
async def test_list_assets(client):
    response = await client.get("/api/v1/assets/")
    assert response.status_code in [200, 401]


@pytest.mark.asyncio
async def test_list_incidents(client):
    response = await client.get("/api/v1/incidents/")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_dashboard_summary(client):
    response = await client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200
