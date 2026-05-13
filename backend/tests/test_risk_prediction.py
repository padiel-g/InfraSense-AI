"""Tests for risk prediction service."""
from unittest.mock import MagicMock
from app.services.risk_prediction import RiskPredictionService


def test_heuristic_old_pipe():
    service = RiskPredictionService()
    asset = MagicMock()
    asset.age_years = 45
    asset.material = "Asbestos Cement"
    asset.failure_count = 5
    asset.condition_rating = 4
    asset.diameter_mm = 150
    asset.depth_m = 1.5

    result = service._heuristic_predict(asset)
    assert result["risk_category"] in ["high", "critical"]
    assert result["risk_score"] > 0.5
    assert len(result["top_risk_factors"]) > 0


def test_heuristic_new_pipe():
    service = RiskPredictionService()
    asset = MagicMock()
    asset.age_years = 3
    asset.material = "HDPE"
    asset.failure_count = 0
    asset.condition_rating = 1
    asset.diameter_mm = 200
    asset.depth_m = 1.0

    result = service._heuristic_predict(asset)
    assert result["risk_category"] == "low"
    assert result["risk_score"] < 0.3


def test_score_to_category():
    service = RiskPredictionService()
    assert service._score_to_category(0.9) == "critical"
    assert service._score_to_category(0.7) == "high"
    assert service._score_to_category(0.4) == "medium"
    assert service._score_to_category(0.1) == "low"
