import os

from sqlalchemy import event
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Ensure the directory for the SQLite file exists
_db_url = settings.DATABASE_URL  # e.g. sqlite+aiosqlite:///./data/municipal.db
if _db_url.startswith("sqlite"):
    _path = _db_url.split("///")[-1]
    os.makedirs(os.path.dirname(_path) or ".", exist_ok=True)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable SQLite performance and relational-integrity settings."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""

    pass


async def get_db():
    """FastAPI dependency — yields a transactional session.

    Uses session.begin() so the transaction is committed automatically
    when the request succeeds, or rolled back on any exception.
    Routers only need db.flush() to obtain generated values.
    """
    async with async_session_factory() as session:
        async with session.begin():
            yield session


async def init_db():
    """Create missing database tables without deleting existing data.

    This is intentionally conservative: SQLAlchemy create_all() only creates
    missing tables and leaves existing tables/data untouched. SQLite keeps its
    legacy compatibility helpers; PostgreSQL uses the ORM metadata for the
    demo-friendly startup path.
    """
    # Import models here so Base.metadata is fully populated
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_leak_detection_schema(conn)
        await _ensure_assets_geometry_schema(conn)
        await _ensure_incidents_resident_schema(conn)
        await _ensure_gweru_routing_schema(conn)
        await _ensure_performance_indexes(conn)

    print("[i] Database tables checked/created")


async def _ensure_leak_detection_schema(conn) -> None:
    """Add sequence-detection columns to existing SQLite databases.

    Base.metadata.create_all() creates missing tables but does not alter tables
    that already exist. These idempotent ALTERs preserve older single-reading
    sensor records while allowing new detection sessions to reuse sensor_readings.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    result = await conn.execute(text("PRAGMA table_info(sensor_readings)"))
    existing_columns = {row[1] for row in result.fetchall()}

    required_columns = {
        "session_id": "VARCHAR(36)",
        "flow_lps": "FLOAT",
        "pressure_kpa": "FLOAT",
        "acoustic_db": "FLOAT",
        "soil_moisture_percent": "FLOAT",
        "valve_status": "VARCHAR(32)",
        "tank_level_percent": "FLOAT",
        "pipe_zone": "VARCHAR(120)",
    }

    for column_name, column_type in required_columns.items():
        if column_name not in existing_columns:
            await conn.execute(
                text(
                    f"""
                    ALTER TABLE sensor_readings
                    ADD COLUMN {column_name} {column_type}
                    """
                )
            )

    indexes = [
        """
        CREATE INDEX IF NOT EXISTS ix_sensor_readings_session_id
        ON sensor_readings (session_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_detection_sessions_created_at
        ON detection_sessions (created_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_detection_results_session_created
        ON detection_results (session_id, created_at)
        """,
    ]

    for statement in indexes:
        await conn.execute(text(statement))


async def _ensure_assets_geometry_schema(conn) -> None:
    """Add linestring start/end coordinate columns to legacy assets tables.

    The ORM model defines start_latitude / start_longitude / end_latitude /
    end_longitude on `assets`, but databases created before these were
    introduced are missing them, causing
    `sqlite3.OperationalError: no such column: assets.start_latitude`
    on any SELECT * against the table (e.g. /api/v1/dashboard/risk-map).

    This idempotent ALTER preserves existing rows.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    result = await conn.execute(text("PRAGMA table_info(assets)"))
    rows = result.fetchall()
    if not rows:
        # Table not created yet (will be handled by create_all on first run).
        return
    existing_columns = {row[1] for row in rows}

    required_columns = {
        "start_latitude": "FLOAT",
        "start_longitude": "FLOAT",
        "end_latitude": "FLOAT",
        "end_longitude": "FLOAT",
    }

    for column_name, column_type in required_columns.items():
        if column_name not in existing_columns:
            await conn.execute(
                text(
                    f"ALTER TABLE assets ADD COLUMN {column_name} {column_type}"
                )
            )


async def _ensure_incidents_resident_schema(conn) -> None:
    """Add resident-portal columns (issue_type, image_url, image_path) to incidents.

    These were introduced when the resident page was generalised from
    illegal-dumping-only to a multi-category municipal reporting portal.
    Idempotent ALTERs preserve all existing incident rows.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    result = await conn.execute(text("PRAGMA table_info(incidents)"))
    rows = result.fetchall()
    if not rows:
        return
    existing_columns = {row[1] for row in rows}

    required_columns = {
        "issue_type": "VARCHAR(60)",
        "category":   "VARCHAR(60)",
        "image_url":  "VARCHAR(500)",
        "image_path": "VARCHAR(500)",
    }

    for column_name, column_type in required_columns.items():
        if column_name not in existing_columns:
            await conn.execute(
                text(f"ALTER TABLE incidents ADD COLUMN {column_name} {column_type}")
            )

    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_incidents_issue_type ON incidents (issue_type)")
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_incidents_category ON incidents (category)")
    )


async def _ensure_gweru_routing_schema(conn) -> None:
    """Create tables needed for the Gweru-only routing map.

    These tables are not ORM models, so Base.metadata.create_all() will not
    create them.

    The actual shortest-route calculation should be done by a routing service
    such as OSRM, OpenRouteService, GraphHopper, or a custom Python graph
    service. The database stores routing inputs/history/cache only.
    """
    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    if not is_sqlite:
        statements = [
            """
            CREATE TABLE IF NOT EXISTS map_geofences (
                id SERIAL PRIMARY KEY,
                name VARCHAR(120) NOT NULL UNIQUE,
                city VARCHAR(120) NOT NULL,
                country VARCHAR(120) NOT NULL DEFAULT 'Zimbabwe',
                min_lat FLOAT NOT NULL,
                max_lat FLOAT NOT NULL,
                min_lng FLOAT NOT NULL,
                max_lng FLOAT NOT NULL,
                boundary_geojson TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """,
            """
            INSERT INTO map_geofences (
                name,
                city,
                country,
                min_lat,
                max_lat,
                min_lng,
                max_lng,
                is_active
            )
            VALUES (
                'gweru_city_routing_boundary',
                'Gweru',
                'Zimbabwe',
                -19.6000,
                -19.3000,
                29.6500,
                30.0000,
                TRUE
            )
            ON CONFLICT (name) DO NOTHING
            """,
            """
            CREATE TABLE IF NOT EXISTS map_locations (
                id SERIAL PRIMARY KEY,
                label VARCHAR(160),
                location_type VARCHAR(60) NOT NULL DEFAULT 'custom',
                latitude FLOAT NOT NULL,
                longitude FLOAT NOT NULL,
                address TEXT,
                suburb VARCHAR(120),
                city VARCHAR(120) NOT NULL DEFAULT 'Gweru',
                incident_id INTEGER,
                asset_id INTEGER,
                dumping_report_id INTEGER,
                sensor_id INTEGER,
                crew_id INTEGER,
                source VARCHAR(80) DEFAULT 'dashboard',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS route_requests (
                id SERIAL PRIMARY KEY,
                start_label VARCHAR(160),
                start_lat FLOAT NOT NULL,
                start_lng FLOAT NOT NULL,
                destination_label VARCHAR(160),
                destination_lat FLOAT NOT NULL,
                destination_lng FLOAT NOT NULL,
                city VARCHAR(120) NOT NULL DEFAULT 'Gweru',
                routing_provider VARCHAR(80) DEFAULT 'osrm',
                route_profile VARCHAR(40) DEFAULT 'driving',
                distance_meters FLOAT,
                duration_seconds FLOAT,
                route_geometry TEXT,
                status VARCHAR(40) NOT NULL DEFAULT 'completed',
                error_message TEXT,
                requested_by VARCHAR(120),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS route_cache (
                id SERIAL PRIMARY KEY,
                cache_key VARCHAR(255) NOT NULL UNIQUE,
                start_lat FLOAT NOT NULL,
                start_lng FLOAT NOT NULL,
                destination_lat FLOAT NOT NULL,
                destination_lng FLOAT NOT NULL,
                routing_provider VARCHAR(80) DEFAULT 'osrm',
                route_profile VARCHAR(40) DEFAULT 'driving',
                distance_meters FLOAT NOT NULL,
                duration_seconds FLOAT NOT NULL,
                route_geometry TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_map_geofences_name_active
            ON map_geofences (name, is_active)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_map_locations_city_type
            ON map_locations (city, location_type)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_map_locations_lat_lng
            ON map_locations (latitude, longitude)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_map_locations_refs
            ON map_locations (
                incident_id,
                asset_id,
                dumping_report_id,
                sensor_id,
                crew_id
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_route_requests_created_at
            ON route_requests (created_at)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_route_requests_city_status
            ON route_requests (city, status)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_route_requests_points
            ON route_requests (
                start_lat,
                start_lng,
                destination_lat,
                destination_lng
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_route_cache_key
            ON route_cache (cache_key)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_route_cache_start_destination
            ON route_cache (
                start_lat,
                start_lng,
                destination_lat,
                destination_lng
            )
            """,
        ]

        for statement in statements:
            await conn.execute(text(statement))
        return

    statements = [
        """
        CREATE TABLE IF NOT EXISTS map_geofences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(120) NOT NULL UNIQUE,
            city VARCHAR(120) NOT NULL,
            country VARCHAR(120) NOT NULL DEFAULT 'Zimbabwe',

            -- Bounding box used for quick SQLite validation.
            -- Replace these approximate values with an official Gweru boundary
            -- polygon if you later add one.
            min_lat FLOAT NOT NULL,
            max_lat FLOAT NOT NULL,
            min_lng FLOAT NOT NULL,
            max_lng FLOAT NOT NULL,

            -- Optional GeoJSON polygon string for stricter app-level validation.
            boundary_geojson TEXT,

            is_active BOOLEAN NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT OR IGNORE INTO map_geofences (
            name,
            city,
            country,
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            is_active
        )
        VALUES (
            'gweru_city_routing_boundary',
            'Gweru',
            'Zimbabwe',
            -19.6000,
            -19.3000,
            29.6500,
            30.0000,
            1
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS map_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label VARCHAR(160),
            location_type VARCHAR(60) NOT NULL DEFAULT 'custom',

            -- Examples:
            -- current_location, destination, incident, asset, dump_report,
            -- sensor, crew, depot, landmark
            latitude FLOAT NOT NULL,
            longitude FLOAT NOT NULL,

            address TEXT,
            suburb VARCHAR(120),
            city VARCHAR(120) NOT NULL DEFAULT 'Gweru',

            -- Optional references to existing system entities.
            incident_id INTEGER,
            asset_id INTEGER,
            dumping_report_id INTEGER,
            sensor_id INTEGER,
            crew_id INTEGER,

            source VARCHAR(80) DEFAULT 'dashboard',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS route_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            start_label VARCHAR(160),
            start_lat FLOAT NOT NULL,
            start_lng FLOAT NOT NULL,

            destination_label VARCHAR(160),
            destination_lat FLOAT NOT NULL,
            destination_lng FLOAT NOT NULL,

            city VARCHAR(120) NOT NULL DEFAULT 'Gweru',
            routing_provider VARCHAR(80) DEFAULT 'osrm',
            route_profile VARCHAR(40) DEFAULT 'driving',

            distance_meters FLOAT,
            duration_seconds FLOAT,

            -- Encoded polyline or GeoJSON LineString returned by the routing API.
            route_geometry TEXT,

            status VARCHAR(40) NOT NULL DEFAULT 'completed',
            error_message TEXT,

            requested_by VARCHAR(120),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS route_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            cache_key VARCHAR(255) NOT NULL UNIQUE,

            start_lat FLOAT NOT NULL,
            start_lng FLOAT NOT NULL,
            destination_lat FLOAT NOT NULL,
            destination_lng FLOAT NOT NULL,

            routing_provider VARCHAR(80) DEFAULT 'osrm',
            route_profile VARCHAR(40) DEFAULT 'driving',

            distance_meters FLOAT NOT NULL,
            duration_seconds FLOAT NOT NULL,
            route_geometry TEXT NOT NULL,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_map_geofences_name_active
        ON map_geofences (name, is_active)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_map_locations_city_type
        ON map_locations (city, location_type)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_map_locations_lat_lng
        ON map_locations (latitude, longitude)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_map_locations_refs
        ON map_locations (
            incident_id,
            asset_id,
            dumping_report_id,
            sensor_id,
            crew_id
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_route_requests_created_at
        ON route_requests (created_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_route_requests_city_status
        ON route_requests (city, status)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_route_requests_points
        ON route_requests (
            start_lat,
            start_lng,
            destination_lat,
            destination_lng
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_route_cache_key
        ON route_cache (cache_key)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_route_cache_start_destination
        ON route_cache (
            start_lat,
            start_lng,
            destination_lat,
            destination_lng
        )
        """,
    ]

    for statement in statements:
        await conn.execute(text(statement))

    # Optional SQLite RTree spatial index.
    # Useful for fast map viewport or bounding-box searches.
    # Some SQLite builds may not include the RTree extension, so this is optional.
    try:
        await conn.execute(
            text(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS map_locations_rtree
                USING rtree(
                    id,
                    min_lng,
                    max_lng,
                    min_lat,
                    max_lat
                )
                """
            )
        )
    except Exception:
        pass


async def _ensure_performance_indexes(conn) -> None:
    """Create indexes for the dashboard and monitoring hot paths.

    create_all() skips schema objects missing from existing tables,
    so the most latency-sensitive SQLite indexes are declared explicitly here.
    """
    indexes = [
        """
        CREATE INDEX IF NOT EXISTS ix_sensor_readings_anomaly_timestamp
        ON sensor_readings (is_anomaly, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_sensor_readings_sensor_timestamp
        ON sensor_readings (sensor_id, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_sensor_readings_type_timestamp
        ON sensor_readings (sensor_type, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_incidents_status_reported_at
        ON incidents (status, reported_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_incidents_filters_reported_at
        ON incidents (status, severity, incident_type, suburb, reported_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_incidents_response_time_hours
        ON incidents (response_time_hours)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_dumping_reports_status_detected_at
        ON dumping_reports (status, detected_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_dumping_reports_status_suburb_detected_at
        ON dumping_reports (status, suburb, detected_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_assets_risk_category_score
        ON assets (risk_category, risk_score)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_assets_filters
        ON assets (asset_type, suburb, risk_category)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_assets_map_location_score
        ON assets (latitude, longitude, risk_score)
        """,
    ]

    for statement in indexes:
        await conn.execute(text(statement))


async def is_point_inside_gweru(
    db: AsyncSession,
    lat: float,
    lng: float,
) -> bool:
    """Return True when a coordinate is inside the configured Gweru boundary.

    This uses the SQLite bounding-box geofence stored in map_geofences.
    It is fast and good for dashboard validation.

    For final production accuracy, replace or supplement this with a proper
    Gweru polygon check using GeoJSON in the application layer.
    """
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM map_geofences
            WHERE name = 'gweru_city_routing_boundary'
              AND is_active = 1
              AND :lat BETWEEN min_lat AND max_lat
              AND :lng BETWEEN min_lng AND max_lng
            LIMIT 1
            """
        ),
        {"lat": lat, "lng": lng},
    )

    return result.scalar_one_or_none() is not None
