"""
Seed the database with synthetic data for development and testing.
Run: python -m scripts.seed_data
"""
import asyncio
import random
from datetime import datetime, timedelta
from uuid import uuid4

from app.database import async_session_factory, init_db
from app.models.user import User
from app.models.asset import Asset
from app.models.incident import Incident
from app.models.sensor_reading import SensorReading
from app.core.security import hash_password

# Masvingo coordinates (pilot area)
BASE_LAT = -20.0724
BASE_LON = 30.8344

SUBURBS = ["Mucheke", "Rujeko", "Rhodene", "Target Kopje", "Hillside", "Eastvale"]
MATERIALS = ["PVC", "Cast Iron", "Asbestos Cement", "Ductile Iron", "Steel", "HDPE"]
INCIDENT_TYPES = ["burst", "leak", "overflow", "blockage"]
SENSOR_IDS = [f"SENSOR-{i:03d}" for i in range(1, 21)]


async def seed():
    await init_db()
    async with async_session_factory() as db:
        # --- Users ---
        users = [
            User(
                email="admin@municipality.co.zw",
                full_name="Admin User",
                hashed_password=hash_password("admin123"),
                role="admin",
                department="water",
            ),
            User(
                email="dispatcher@municipality.co.zw",
                full_name="Dispatch Officer",
                hashed_password=hash_password("dispatch123"),
                role="dispatcher",
                department="water",
            ),
            User(
                email="crew1@municipality.co.zw",
                full_name="Tendai Moyo",
                hashed_password=hash_password("crew123"),
                role="field_crew",
                department="sewer",
            ),
            User(
                email="resident@example.com",
                full_name="Community Member",
                hashed_password=hash_password("resident123"),
                role="resident",
            ),
        ]
        db.add_all(users)
        await db.flush()
        print(f"[✓] Seeded {len(users)} users")

        # --- Assets ---
        assets = []
        for i in range(200):
            suburb = random.choice(SUBURBS)
            age = random.randint(2, 55)
            material = random.choice(MATERIALS)
            asset = Asset(
                asset_code=f"PIPE-{suburb[:3].upper()}-{i:04d}",
                asset_type=random.choice(["water_pipe", "sewer_pipe"]),
                material=material,
                diameter_mm=random.choice([50, 75, 100, 150, 200, 250, 300]),
                length_m=round(random.uniform(10, 500), 1),
                depth_m=round(random.uniform(0.5, 3.0), 2),
                installation_date=datetime.utcnow() - timedelta(days=age * 365),
                age_years=age,
                pressure_zone=random.choice(["Zone A", "Zone B", "Zone C"]),
                soil_type=random.choice(["clay", "sandy", "loam", "rocky"]),
                land_use_type=random.choice(["residential", "commercial", "industrial"]),
                suburb=suburb,
                ward=f"Ward {random.randint(1, 10)}",
                condition_rating=random.randint(1, 5),
                failure_count=random.randint(0, 8),
                latitude=BASE_LAT + random.uniform(-0.03, 0.03),
                longitude=BASE_LON + random.uniform(-0.03, 0.03),
            )
            assets.append(asset)
        db.add_all(assets)
        await db.flush()
        print(f"[✓] Seeded {len(assets)} assets")

        # --- Incidents ---
        incidents = []
        for i in range(80):
            suburb = random.choice(SUBURBS)
            reported = datetime.utcnow() - timedelta(days=random.randint(0, 180))
            resolved = (
                reported + timedelta(hours=random.uniform(1, 720))
                if random.random() > 0.3
                else None
            )
            inc = Incident(
                incident_type=random.choice(INCIDENT_TYPES),
                severity=random.choice(["low", "medium", "high", "critical"]),
                status="resolved" if resolved else random.choice(["reported", "assigned", "in_progress"]),
                description=f"Reported {random.choice(INCIDENT_TYPES)} in {suburb}",
                source=random.choice(["citizen", "inspection", "sensor"]),
                latitude=BASE_LAT + random.uniform(-0.03, 0.03),
                longitude=BASE_LON + random.uniform(-0.03, 0.03),
                suburb=suburb,
                ward=f"Ward {random.randint(1, 10)}",
                reported_at=reported,
                resolved_at=resolved,
                response_time_hours=(
                    round((resolved - reported).total_seconds() / 3600, 2) if resolved else None
                ),
            )
            incidents.append(inc)
        db.add_all(incidents)
        await db.flush()
        print(f"[✓] Seeded {len(incidents)} incidents")

        # --- Sensor Readings ---
        readings = []
        now = datetime.utcnow()
        for sensor_id in SENSOR_IDS[:5]:
            for h in range(48):  # 48 hours of data
                ts = now - timedelta(hours=48 - h)
                is_anomaly = random.random() < 0.05
                reading = SensorReading(
                    sensor_id=sensor_id,
                    sensor_type="multi",
                    timestamp=ts,
                    flow_rate_lps=round(
                        random.gauss(5.0, 1.5) + (10 if is_anomaly else 0), 2
                    ),
                    pressure_bar=round(
                        random.gauss(3.0, 0.5) - (2 if is_anomaly else 0), 2
                    ),
                    water_level_m=round(random.gauss(1.2, 0.3), 2),
                    turbidity_ntu=round(
                        random.gauss(2.0, 0.8) + (5 if is_anomaly else 0), 2
                    ),
                    is_anomaly=is_anomaly,
                    anomaly_score=round(random.uniform(0.7, 1.0), 2) if is_anomaly else None,
                    anomaly_type=random.choice(["spike", "drop", "drift"]) if is_anomaly else None,
                )
                readings.append(reading)
        db.add_all(readings)
        await db.flush()
        print(f"[✓] Seeded {len(readings)} sensor readings")

        await db.commit()
        print("\n[✓] Database seeded successfully!")


if __name__ == "__main__":
    asyncio.run(seed())
