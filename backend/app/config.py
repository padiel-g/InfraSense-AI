from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database — async URL is the primary; sync is for Alembic
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/municipal.db"
    DATABASE_URL_SYNC: str = "sqlite:///./data/municipal.db"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Auth (JWT)
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    # Access token lifetime. Kept generous in development so users do not
    # get logged out mid-session while debugging. The refresh-token rotation
    # in /api/auth/refresh handles silent renewal regardless of this value.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    REMEMBER_ME_REFRESH_EXPIRE_DAYS: int = 30
    FRONTEND_URL: str = "http://localhost:3000"

    # ML Model Paths
    XGBOOST_MODEL_PATH: str = "app/ml/weights/xgboost_risk.json"
    RF_MODEL_PATH: str = "app/ml/weights/rf_risk.joblib"
    LSTM_MODEL_PATH: str = "app/ml/weights/lstm_anomaly.pt"
    SKLEARN_AE_MODEL_PATH: str = "app/ml/weights/sklearn_anomaly.joblib"
    YOLO_MODEL_PATH: str = "app/ml/weights/yolov8_dumping.pt"

    # YOLO training data (illegal dumping)
    YOLO_DATASET_YAML: str = "data/data.yaml"
    YOLO_AUTO_TRAIN: bool = False
    EAGER_LOAD_ML_MODELS: bool = False
    EAGER_LOAD_LEAK_LSTM: bool = False
    # Use 6 while the manual workflow is being validated. For production LSTM
    # inference, prefer a default of 12+ readings to give the model more context.
    MIN_SEQUENCE_LENGTH: int = 6

    # Storage (local filesystem)
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 10

    # App
    APP_NAME: str = "Municipal Infrastructure Monitor"
    DEBUG: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
