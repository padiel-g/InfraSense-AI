import numpy as np
from datetime import datetime
from app.ml.loader import get_model


class RiskPredictionService:
    """
    Predicts pipe/sewer failure risk using XGBoost or Random Forest.
    Falls back to a rule-based heuristic if models are not loaded.
    """

    RISK_THRESHOLDS = {
        "critical": 0.8,
        "high": 0.6,
        "medium": 0.3,
        "low": 0.0,
    }

    MATERIAL_RISK = {
        "asbestos_cement": 0.9,
        "cast_iron": 0.7,
        "galvanized_steel": 0.6,
        "steel": 0.5,
        "ductile_iron": 0.3,
        "pvc": 0.2,
        "hdpe": 0.1,
    }

    def predict_risk(self, asset) -> dict:
        """Predict risk for a single asset. Returns score, category, factors."""
        model = get_model("xgboost_risk")

        if model is not None:
            return self._model_predict(model, asset)
        return self._heuristic_predict(asset)

    def _model_predict(self, model, asset) -> dict:
        features = self._extract_features(asset)
        feature_array = np.array([list(features.values())])
        score = float(model.predict_proba(feature_array)[0][1])
        category = self._score_to_category(score)

        importances = model.feature_importances_ if hasattr(model, "feature_importances_") else []
        top_factors = self._get_top_factors(features, importances)

        return {
            "risk_score": round(score, 4),
            "risk_category": category,
            "top_risk_factors": top_factors,
            "recommended_action": self._recommend_action(category),
        }

    def _heuristic_predict(self, asset) -> dict:
        """Fallback rule-based scoring when ML model is unavailable."""
        score = 0.0
        factors = []

        # Age factor
        age = asset.age_years or 0
        if age > 40:
            score += 0.35
            factors.append({"factor": "pipe_age", "value": age, "impact": "high"})
        elif age > 25:
            score += 0.2
            factors.append({"factor": "pipe_age", "value": age, "impact": "medium"})

        # Material factor
        material = (asset.material or "").lower().replace(" ", "_")
        mat_risk = self.MATERIAL_RISK.get(material, 0.4)
        score += mat_risk * 0.25
        factors.append({"factor": "material", "value": asset.material, "impact": "medium"})

        # Failure history
        failures = asset.failure_count or 0
        if failures > 3:
            score += 0.25
            factors.append({"factor": "failure_history", "value": failures, "impact": "high"})
        elif failures > 0:
            score += 0.1
            factors.append({"factor": "failure_history", "value": failures, "impact": "low"})

        # Condition rating
        condition = asset.condition_rating or 3
        if condition >= 4:
            score += 0.15
            factors.append({"factor": "condition_rating", "value": condition, "impact": "high"})

        score = min(score, 1.0)
        category = self._score_to_category(score)

        return {
            "risk_score": round(score, 4),
            "risk_category": category,
            "top_risk_factors": factors[:5],
            "recommended_action": self._recommend_action(category),
        }

    def _extract_features(self, asset) -> dict:
        age = asset.age_years or 0
        material = (asset.material or "unknown").lower().replace(" ", "_")
        return {
            "age_years": age,
            "diameter_mm": asset.diameter_mm or 150,
            "depth_m": asset.depth_m or 1.0,
            "failure_count": asset.failure_count or 0,
            "condition_rating": asset.condition_rating or 3,
            "material_risk": self.MATERIAL_RISK.get(material, 0.5),
            "is_wet_season": 1 if datetime.utcnow().month in [11, 12, 1, 2, 3] else 0,
        }

    def _score_to_category(self, score: float) -> str:
        for cat, threshold in self.RISK_THRESHOLDS.items():
            if score >= threshold:
                return cat
        return "low"

    def _get_top_factors(self, features: dict, importances) -> list:
        if len(importances) == 0:
            return [{"factor": k, "value": v, "impact": "unknown"} for k, v in features.items()]
        paired = sorted(zip(features.keys(), importances), key=lambda x: x[1], reverse=True)
        return [
            {"factor": name, "value": features[name], "impact": round(float(imp), 4)}
            for name, imp in paired[:5]
        ]

    def _recommend_action(self, category: str) -> str:
        actions = {
            "critical": "Immediate inspection and emergency repair scheduling required",
            "high": "Schedule priority inspection within 7 days",
            "medium": "Include in next quarterly maintenance cycle",
            "low": "Continue routine monitoring",
        }
        return actions.get(category, "Monitor")
