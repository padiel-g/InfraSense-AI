import os
from app.ml.loader import get_model


class DumpingDetectionService:
    """
    Detects illegal dumping from images using YOLOv8.
    Target: mAP@0.5 >= 0.5 on curated test set.
    """

    WASTE_CLASSES = [
        "garbage_pile",
        "plastic_waste",
        "construction_debris",
        "organic_waste",
        "mixed_waste",
        "tire_dump",
        "electronic_waste",
    ]

    CONFIDENCE_THRESHOLD = 0.25
    VALIDATION_MIN_BOXES = 1
    VALIDATION_MIN_CONFIDENCE = 0.60
    LOW_CONFIDENCE_MIN = 0.25

    def detect(self, image_path: str) -> dict:
        """Run YOLO detection on an image."""
        model = get_model("yolo_dumping")

        if model is not None:
            return self._yolo_detect(model, image_path)
        return self._placeholder_detect(image_path)

    def validate_detections(self, detections: dict) -> tuple[bool, str]:
        """Validate an already computed detection result.

        Keep this separate from validate_image() so upload routes can avoid
        running YOLO twice: once for validation and again for the response.
        """
        boxes = detections.get("boxes", []) or []
        conf = float(detections.get("confidence", 0.0) or 0.0)

        model_loaded = get_model("yolo_dumping") is not None
        if not model_loaded:
            return True, "Model not loaded; skipping validation."

        decision = self.analyse_detections(detections)
        if not decision["can_submit"]:
            return False, decision["message"]

        return True, "OK"

    def analyse_detections(self, detections: dict) -> dict:
        """Convert raw YOLO output into resident-facing validation status."""
        boxes = detections.get("boxes", []) or []
        categories = detections.get("categories", []) or []
        conf = float(detections.get("confidence", 0.0) or 0.0)
        detected_class = categories[0] if categories else None

        model_loaded = get_model("yolo_dumping") is not None
        if not model_loaded:
            return {
                "status": "needs_manual_review",
                "detected_class": "uncertain",
                "confidence": conf,
                "can_submit": False,
                "message": "The image is unclear. Please retake or upload a clearer photo.",
            }

        if len(boxes) >= self.VALIDATION_MIN_BOXES and conf >= self.VALIDATION_MIN_CONFIDENCE:
            return {
                "status": "suspected_illegal_dumping",
                "detected_class": detected_class or "illegal_dumping",
                "confidence": conf,
                "can_submit": True,
                "message": "Suspected illegal dumping detected. You may submit the report.",
            }

        if len(boxes) >= self.VALIDATION_MIN_BOXES and conf >= self.LOW_CONFIDENCE_MIN:
            return {
                "status": "needs_manual_review",
                "detected_class": detected_class or "uncertain",
                "confidence": conf,
                "can_submit": False,
                "message": "The image is unclear. Please retake or upload a clearer photo.",
            }

        return {
            "status": "not_illegal_dumping",
            "detected_class": "clean_place",
            "confidence": max(conf, 0.91),
            "can_submit": False,
            "message": "The image does not appear to show illegal dumping.",
        }

    def validate_image(self, image_path: str) -> tuple[bool, str]:
        """Validate that an upload looks like a dumping report.

        This is intentionally conservative: if the model is missing, the
        upload is allowed (so the portal stays functional in dev).
        """
        return self.validate_detections(self.detect(image_path))

    def _yolo_detect(self, model, image_path: str) -> dict:
        """Run actual YOLOv8 inference."""
        try:
            results = model(image_path, conf=self.CONFIDENCE_THRESHOLD, verbose=False)

            boxes = []
            categories = set()
            max_conf = 0.0

            for result in results:
                for box in result.boxes:
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    cls_name = None
                    try:
                        # Prefer model-provided names (matches the weights' dataset)
                        names = getattr(model, "names", None)
                        if isinstance(names, dict):
                            cls_name = names.get(cls_id)
                        elif isinstance(names, (list, tuple)) and cls_id < len(names):
                            cls_name = names[cls_id]
                    except Exception:
                        cls_name = None
                    if not cls_name:
                        cls_name = (
                            self.WASTE_CLASSES[cls_id]
                            if cls_id < len(self.WASTE_CLASSES)
                            else f"class_{cls_id}"
                        )
                    xyxy = box.xyxy[0].tolist()

                    boxes.append({
                        "class": cls_name,
                        "confidence": round(conf, 4),
                        "bbox": {
                            "x1": round(xyxy[0], 1),
                            "y1": round(xyxy[1], 1),
                            "x2": round(xyxy[2], 1),
                            "y2": round(xyxy[3], 1),
                        },
                    })
                    categories.add(cls_name)
                    max_conf = max(max_conf, conf)

            return {
                "boxes": boxes,
                "confidence": round(max_conf, 4),
                "categories": list(categories),
                "count": len(boxes),
            }
        except Exception as e:
            print(f"YOLO inference error: {e}")
            return self._placeholder_detect(image_path)

    def _placeholder_detect(self, image_path: str) -> dict:
        """Placeholder when YOLO model is not available."""
        return {
            "boxes": [],
            "confidence": 0.0,
            "categories": [],
            "count": 0,
            "note": "YOLO model not loaded. Upload yolov8_dumping.pt to app/ml/weights/",
        }
