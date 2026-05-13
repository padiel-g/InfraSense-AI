from datetime import datetime
from typing import Optional


class AlertService:
    """Generates and dispatches alerts for detected anomalies and incidents."""

    SEVERITY_MAP = {
        "spike": "critical",
        "drop": "high",
        "drift": "medium",
        "flatline": "high",
    }

    def create_anomaly_alert(
        self,
        sensor_id: str,
        anomaly_type: str,
        anomaly_score: float,
        metric: str,
        value: float,
    ) -> dict:
        severity = self.SEVERITY_MAP.get(anomaly_type, "medium")
        if anomaly_score > 0.9:
            severity = "critical"

        return {
            "type": "anomaly",
            "severity": severity,
            "sensor_id": sensor_id,
            "anomaly_type": anomaly_type,
            "metric": metric,
            "value": value,
            "score": anomaly_score,
            "message": f"[{severity.upper()}] {anomaly_type} detected on sensor {sensor_id}: "
                       f"{metric}={value}",
            "timestamp": datetime.utcnow().isoformat(),
            "requires_dispatch": severity in ["critical", "high"],
        }

    def create_dumping_alert(
        self,
        report_id: str,
        latitude: float,
        longitude: float,
        confidence: float,
        categories: list[str],
    ) -> dict:
        severity = "high" if confidence > 0.7 else "medium"
        return {
            "type": "dumping",
            "severity": severity,
            "report_id": report_id,
            "latitude": latitude,
            "longitude": longitude,
            "confidence": confidence,
            "categories": categories,
            "message": f"Illegal dumping detected ({', '.join(categories)}) "
                       f"at ({latitude:.5f}, {longitude:.5f}) - confidence: {confidence:.0%}",
            "timestamp": datetime.utcnow().isoformat(),
            "requires_dispatch": confidence > 0.6,
        }

    async def dispatch_alert(self, alert: dict) -> bool:
        """
        Send alert via configured channels (push notification, SMS, dashboard).
        Placeholder for integration with notification services.
        """
        print(f"[ALERT] {alert['message']}")
        # TODO: Integrate with SMS gateway, Firebase push, or WebSocket
        return True
