"""Illegal dumping detection latency regressions."""

from app.services.dumping_detection import DumpingDetectionService


def test_validate_detections_does_not_run_inference(monkeypatch):
    service = DumpingDetectionService()

    def fail_detect(_image_path):
        raise AssertionError("validate_detections should not call detect()")

    monkeypatch.setattr(service, "detect", fail_detect)
    monkeypatch.setattr(
        "app.services.dumping_detection.get_model",
        lambda name: object() if name == "yolo_dumping" else None,
    )

    ok, message = service.validate_detections({
        "boxes": [{"class": "mixed_waste", "confidence": 0.9}],
        "confidence": 0.9,
    })

    assert ok is True
    assert message == "OK"

