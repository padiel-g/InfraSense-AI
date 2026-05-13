"""Alert ORM model.

Each row in the `incidents` table that originates from the resident portal
(or any other reporter) gets a corresponding row here so the Alerts page,
notification center, and downstream dispatch logic have a stable, indexable
view of "things that need attention" without having to re-derive them on
every request.

The previous implementation derived alerts on-the-fly from SensorReading +
Incident inside the dashboard router. That endpoint still exists for
backward compat, but the resident-portal workflow now writes to this table
directly so newly reported incidents appear immediately on the Alerts page.
"""

import uuid
from sqlalchemy import Column, String, Float, DateTime, Text, ForeignKey, Boolean, func

from app.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Foreign key to the originating incident. Nullable because future
    # alert sources (sensor anomalies, manual ops alerts) may not have a
    # corresponding incident row.
    incident_id = Column(
        String(36),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Free-text classification used by the UI for filtering / icon choice.
    # Examples: "incident", "anomaly", "dumping", "water_leak", "burst_pipe".
    alert_type = Column(String(60), nullable=False, index=True)

    # Severity is a free-text string mirroring the incident severity; the
    # IncidentSeverity enum has a CHECK constraint that this column does not,
    # so future expansions (e.g. "emergency") don't require a destructive
    # migration here.
    severity = Column(String(20), nullable=False, default="medium", index=True)

    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=True)

    # Denormalised location for the Alerts page so it can render a map
    # without joining back to the incidents table on every fetch.
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Lifecycle
    is_read = Column(Boolean, nullable=False, default=False, index=True)
    status = Column(String(30), nullable=False, default="open", index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
