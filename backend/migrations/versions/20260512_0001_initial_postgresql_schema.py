"""Initial PostgreSQL schema.

Revision ID: 20260512_0001
Revises:
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260512_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


user_role = postgresql.ENUM("admin", "dispatcher", "field_crew", "resident", name="user_role", create_type=False)
department = postgresql.ENUM("water", "sewer", "solid_waste", name="department", create_type=False)
asset_type = postgresql.ENUM("water_pipe", "sewer_pipe", "manhole", "valve", name="asset_type", create_type=False)
risk_category = postgresql.ENUM("low", "medium", "high", "critical", name="risk_category", create_type=False)
incident_type = postgresql.ENUM("burst", "leak", "overflow", "blockage", name="incident_type", create_type=False)
severity = postgresql.ENUM("low", "medium", "high", "critical", name="severity", create_type=False)
incident_status = postgresql.ENUM(
    "reported",
    "assigned",
    "in_progress",
    "resolved",
    name="incident_status",
    create_type=False,
)
incident_source = postgresql.ENUM("citizen", "sensor", "inspection", "model", name="incident_source", create_type=False)
sensor_type = postgresql.ENUM("flow", "pressure", "level", "turbidity", name="sensor_type", create_type=False)
anomaly_type = postgresql.ENUM("spike", "drift", "drop", "flatline", name="anomaly_type", create_type=False)
dumping_status = postgresql.ENUM(
    "detected",
    "verified",
    "assigned",
    "cleaned",
    "rejected",
    name="dumping_status",
    create_type=False,
)
dumping_source = postgresql.ENUM("citizen", "satellite", "drone", "model", name="dumping_source", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in (
        user_role,
        department,
        asset_type,
        risk_category,
        incident_type,
        severity,
        incident_status,
        incident_source,
        sensor_type,
        anomaly_type,
        dumping_status,
        dumping_source,
    ):
        enum_type.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("department", department, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "assets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("asset_code", sa.String(length=50), nullable=False),
        sa.Column("asset_type", asset_type, nullable=False),
        sa.Column("material", sa.String(length=100)),
        sa.Column("diameter_mm", sa.Float()),
        sa.Column("length_m", sa.Float()),
        sa.Column("depth_m", sa.Float()),
        sa.Column("installation_date", sa.DateTime(timezone=True)),
        sa.Column("age_years", sa.Integer()),
        sa.Column("pressure_zone", sa.String(length=50)),
        sa.Column("soil_type", sa.String(length=100)),
        sa.Column("land_use_type", sa.String(length=50)),
        sa.Column("suburb", sa.String(length=100)),
        sa.Column("ward", sa.String(length=50)),
        sa.Column("condition_rating", sa.Integer()),
        sa.Column("last_inspection_date", sa.DateTime(timezone=True)),
        sa.Column("failure_count", sa.Integer()),
        sa.Column("risk_score", sa.Float()),
        sa.Column("risk_category", risk_category),
        sa.Column("latitude", sa.Float()),
        sa.Column("longitude", sa.Float()),
        sa.Column("start_latitude", sa.Float()),
        sa.Column("start_longitude", sa.Float()),
        sa.Column("end_latitude", sa.Float()),
        sa.Column("end_longitude", sa.Float()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_assets_asset_code", "assets", ["asset_code"], unique=True)
    op.create_index("ix_assets_suburb", "assets", ["suburb"])
    op.create_index("ix_assets_risk_category", "assets", ["risk_category"])
    op.create_index("ix_assets_risk_category_score", "assets", ["risk_category", "risk_score"])
    op.create_index("ix_assets_filters", "assets", ["asset_type", "suburb", "risk_category"])
    op.create_index("ix_assets_map_location_score", "assets", ["latitude", "longitude", "risk_score"])

    op.create_table(
        "detection_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=120)),
        sa.Column("sensor_id", sa.String(length=50)),
        sa.Column("pipe_zone", sa.String(length=120)),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_detection_sessions_sensor_id", "detection_sessions", ["sensor_id"])
    op.create_index("ix_detection_sessions_created_at", "detection_sessions", ["created_at"])

    op.create_table(
        "incidents",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("incident_type", incident_type, nullable=False),
        sa.Column("severity", severity),
        sa.Column("status", incident_status),
        sa.Column("description", sa.Text()),
        sa.Column("source", incident_source),
        sa.Column("issue_type", sa.String(length=60)),
        sa.Column("category", sa.String(length=60)),
        sa.Column("image_url", sa.String(length=500)),
        sa.Column("image_path", sa.String(length=500)),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("address", sa.String(length=500)),
        sa.Column("suburb", sa.String(length=100)),
        sa.Column("ward", sa.String(length=50)),
        sa.Column("asset_id", sa.String(length=36), sa.ForeignKey("assets.id")),
        sa.Column("reported_by", sa.String(length=36), sa.ForeignKey("users.id")),
        sa.Column("reporter_phone", sa.String(length=20)),
        sa.Column("assigned_to", sa.String(length=36), sa.ForeignKey("users.id")),
        sa.Column("reported_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("response_time_hours", sa.Float()),
        sa.Column("model_confidence", sa.Float()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_incidents_status", "incidents", ["status"])
    op.create_index("ix_incidents_reported_at", "incidents", ["reported_at"])
    op.create_index("ix_incidents_issue_type", "incidents", ["issue_type"])
    op.create_index("ix_incidents_category", "incidents", ["category"])
    op.create_index("ix_incidents_status_reported_at", "incidents", ["status", "reported_at"])
    op.create_index(
        "ix_incidents_filters_reported_at",
        "incidents",
        ["status", "severity", "incident_type", "suburb", "reported_at"],
    )
    op.create_index("ix_incidents_response_time_hours", "incidents", ["response_time_hours"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "incident_id",
            sa.String(length=36),
            sa.ForeignKey("incidents.id", ondelete="CASCADE"),
        ),
        sa.Column("alert_type", sa.String(length=60), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text()),
        sa.Column("latitude", sa.Float()),
        sa.Column("longitude", sa.Float()),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_alerts_incident_id", "alerts", ["incident_id"])
    op.create_index("ix_alerts_alert_type", "alerts", ["alert_type"])
    op.create_index("ix_alerts_severity", "alerts", ["severity"])
    op.create_index("ix_alerts_is_read", "alerts", ["is_read"])
    op.create_index("ix_alerts_status", "alerts", ["status"])
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"])

    op.create_table(
        "sensor_readings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("sensor_id", sa.String(length=50), nullable=False),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("detection_sessions.id")),
        sa.Column("sensor_type", sensor_type, nullable=False),
        sa.Column("asset_id", sa.String(length=36), sa.ForeignKey("assets.id")),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("flow_rate_lps", sa.Float()),
        sa.Column("flow_lps", sa.Float()),
        sa.Column("pressure_bar", sa.Float()),
        sa.Column("pressure_kpa", sa.Float()),
        sa.Column("water_level_m", sa.Float()),
        sa.Column("turbidity_ntu", sa.Float()),
        sa.Column("residual_chlorine_mg_l", sa.Float()),
        sa.Column("conductivity_us_cm", sa.Float()),
        sa.Column("temperature_c", sa.Float()),
        sa.Column("acoustic_db", sa.Float()),
        sa.Column("soil_moisture_percent", sa.Float()),
        sa.Column("valve_status", sa.String(length=32)),
        sa.Column("tank_level_percent", sa.Float()),
        sa.Column("pipe_zone", sa.String(length=120)),
        sa.Column("is_anomaly", sa.Boolean()),
        sa.Column("anomaly_score", sa.Float()),
        sa.Column("anomaly_type", anomaly_type),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_sensor_readings_sensor_id", "sensor_readings", ["sensor_id"])
    op.create_index("ix_sensor_readings_session_id", "sensor_readings", ["session_id"])
    op.create_index("ix_sensor_readings_timestamp", "sensor_readings", ["timestamp"])
    op.create_index("ix_sensor_readings_anomaly_timestamp", "sensor_readings", ["is_anomaly", "timestamp"])
    op.create_index("ix_sensor_readings_sensor_timestamp", "sensor_readings", ["sensor_id", "timestamp"])
    op.create_index("ix_sensor_readings_type_timestamp", "sensor_readings", ["sensor_type", "timestamp"])

    op.create_table(
        "detection_results",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("detection_sessions.id"), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("prediction", sa.String(length=40)),
        sa.Column("confidence", sa.Float()),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("reading_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_detection_results_session_id", "detection_results", ["session_id"])
    op.create_index("ix_detection_results_session_created", "detection_results", ["session_id", "created_at"])

    op.create_table(
        "dumping_reports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("status", dumping_status),
        sa.Column("source", dumping_source),
        sa.Column("image_path", sa.String(length=500), nullable=False),
        sa.Column("image_url", sa.String(length=500)),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("address", sa.String(length=500)),
        sa.Column("suburb", sa.String(length=100)),
        sa.Column("detection_confidence", sa.Float()),
        sa.Column("bounding_boxes", sa.Text()),
        sa.Column("waste_categories", sa.String(length=255)),
        sa.Column("is_verified", sa.Boolean()),
        sa.Column("verified_by", sa.String(length=36), sa.ForeignKey("users.id")),
        sa.Column("reported_by", sa.String(length=36), sa.ForeignKey("users.id")),
        sa.Column("description", sa.Text()),
        sa.Column("capture_date", sa.DateTime(timezone=True)),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_dumping_reports_status", "dumping_reports", ["status"])
    op.create_index("ix_dumping_reports_suburb", "dumping_reports", ["suburb"])
    op.create_index("ix_dumping_reports_detected_at", "dumping_reports", ["detected_at"])
    op.create_index("ix_dumping_reports_status_detected_at", "dumping_reports", ["status", "detected_at"])
    op.create_index(
        "ix_dumping_reports_status_suburb_detected_at",
        "dumping_reports",
        ["status", "suburb", "detected_at"],
    )

    op.create_table(
        "water_sensor_readings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("zone_id", sa.String(length=10), nullable=False),
        sa.Column("zone_name", sa.String(length=100), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("flow_rate", sa.Float(), nullable=False),
        sa.Column("pressure", sa.Float(), nullable=False),
        sa.Column("turbidity", sa.Float(), nullable=False),
        sa.Column("ph", sa.Float(), nullable=False),
        sa.Column("residual_chlorine_mg_l", sa.Float()),
        sa.Column("conductivity_us_cm", sa.Float()),
        sa.Column("temperature_c", sa.Float()),
        sa.Column("source", sa.String(length=20), nullable=False),
    )
    op.create_index("ix_water_sensor_readings_zone_id", "water_sensor_readings", ["zone_id"])
    op.create_index("ix_water_sensor_readings_timestamp", "water_sensor_readings", ["timestamp"])

    op.create_table(
        "water_incidents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("zone_id", sa.String(length=10), nullable=False),
        sa.Column("zone_name", sa.String(length=100), nullable=False),
        sa.Column("incident_type", sa.String(length=30), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("lstm_score", sa.Float()),
        sa.Column("quality_score", sa.Float()),
        sa.Column("indicators", sa.JSON(), nullable=False),
        sa.Column("recommendation", sa.String(length=600), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
    )
    op.create_index("ix_water_incidents_zone_id", "water_incidents", ["zone_id"])
    op.create_index("ix_water_incidents_timestamp", "water_incidents", ["timestamp"])

    op.create_table(
        "map_geofences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("city", sa.String(length=120), nullable=False),
        sa.Column("country", sa.String(length=120), nullable=False, server_default="Zimbabwe"),
        sa.Column("min_lat", sa.Float(), nullable=False),
        sa.Column("max_lat", sa.Float(), nullable=False),
        sa.Column("min_lng", sa.Float(), nullable=False),
        sa.Column("max_lng", sa.Float(), nullable=False),
        sa.Column("boundary_geojson", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_map_geofences_name_active", "map_geofences", ["name", "is_active"])
    op.bulk_insert(
        sa.table(
            "map_geofences",
            sa.column("name", sa.String),
            sa.column("city", sa.String),
            sa.column("country", sa.String),
            sa.column("min_lat", sa.Float),
            sa.column("max_lat", sa.Float),
            sa.column("min_lng", sa.Float),
            sa.column("max_lng", sa.Float),
            sa.column("is_active", sa.Boolean),
        ),
        [
            {
                "name": "gweru_city_routing_boundary",
                "city": "Gweru",
                "country": "Zimbabwe",
                "min_lat": -19.6000,
                "max_lat": -19.3000,
                "min_lng": 29.6500,
                "max_lng": 30.0000,
                "is_active": True,
            }
        ],
    )

    op.create_table(
        "map_locations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("label", sa.String(length=160)),
        sa.Column("location_type", sa.String(length=60), nullable=False, server_default="custom"),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("address", sa.Text()),
        sa.Column("suburb", sa.String(length=120)),
        sa.Column("city", sa.String(length=120), nullable=False, server_default="Gweru"),
        sa.Column("incident_id", sa.Integer()),
        sa.Column("asset_id", sa.Integer()),
        sa.Column("dumping_report_id", sa.Integer()),
        sa.Column("sensor_id", sa.Integer()),
        sa.Column("crew_id", sa.Integer()),
        sa.Column("source", sa.String(length=80), server_default="dashboard"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_map_locations_city_type", "map_locations", ["city", "location_type"])
    op.create_index("ix_map_locations_lat_lng", "map_locations", ["latitude", "longitude"])
    op.create_index(
        "ix_map_locations_refs",
        "map_locations",
        ["incident_id", "asset_id", "dumping_report_id", "sensor_id", "crew_id"],
    )

    op.create_table(
        "route_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("start_label", sa.String(length=160)),
        sa.Column("start_lat", sa.Float(), nullable=False),
        sa.Column("start_lng", sa.Float(), nullable=False),
        sa.Column("destination_label", sa.String(length=160)),
        sa.Column("destination_lat", sa.Float(), nullable=False),
        sa.Column("destination_lng", sa.Float(), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=False, server_default="Gweru"),
        sa.Column("routing_provider", sa.String(length=80), server_default="osrm"),
        sa.Column("route_profile", sa.String(length=40), server_default="driving"),
        sa.Column("distance_meters", sa.Float()),
        sa.Column("duration_seconds", sa.Float()),
        sa.Column("route_geometry", sa.Text()),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="completed"),
        sa.Column("error_message", sa.Text()),
        sa.Column("requested_by", sa.String(length=120)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_route_requests_created_at", "route_requests", ["created_at"])
    op.create_index("ix_route_requests_city_status", "route_requests", ["city", "status"])
    op.create_index(
        "ix_route_requests_points",
        "route_requests",
        ["start_lat", "start_lng", "destination_lat", "destination_lng"],
    )

    op.create_table(
        "route_cache",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cache_key", sa.String(length=255), nullable=False, unique=True),
        sa.Column("start_lat", sa.Float(), nullable=False),
        sa.Column("start_lng", sa.Float(), nullable=False),
        sa.Column("destination_lat", sa.Float(), nullable=False),
        sa.Column("destination_lng", sa.Float(), nullable=False),
        sa.Column("routing_provider", sa.String(length=80), server_default="osrm"),
        sa.Column("route_profile", sa.String(length=40), server_default="driving"),
        sa.Column("distance_meters", sa.Float(), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("route_geometry", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_route_cache_key", "route_cache", ["cache_key"])
    op.create_index(
        "ix_route_cache_start_destination",
        "route_cache",
        ["start_lat", "start_lng", "destination_lat", "destination_lng"],
    )


def downgrade() -> None:
    for table_name in (
        "route_cache",
        "route_requests",
        "map_locations",
        "map_geofences",
        "water_incidents",
        "water_sensor_readings",
        "dumping_reports",
        "detection_results",
        "sensor_readings",
        "alerts",
        "incidents",
        "detection_sessions",
        "assets",
        "users",
    ):
        op.drop_table(table_name)

    bind = op.get_bind()
    for enum_type in (
        dumping_source,
        dumping_status,
        anomaly_type,
        sensor_type,
        incident_source,
        incident_status,
        severity,
        incident_type,
        risk_category,
        asset_type,
        department,
        user_role,
    ):
        enum_type.drop(bind, checkfirst=True)
