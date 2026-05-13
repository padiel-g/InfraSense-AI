# Real-time Sensor Anomaly Detection

End-to-end pipeline for flagging probable leaks, overflows and water-quality
contamination from a municipal sensor stream.

## Architecture

```
        ┌───────────────┐
        │ Sensor Input  │
        └──────┬────────┘
               ↓
       FastAPI /api/v1/anomaly/analyze
               ↓
       Per-sensor rolling buffer  (window = 30 samples)
               ↓
        LSTM autoencoder (PyTorch)         <-- canonical model
            or
        Sklearn autoencoder fallback       <-- runtime, no torch needed
            or
        SPC (EWMA + 3-sigma)               <-- last-resort fallback
               ↓
       Reconstruction error vs precision-tuned threshold
               ↓
       Water-quality module (turbidity / pH / flow)
               ↓
   ┌───────────┴────────────┐
   ↓                        ↓
 Normal                Anomaly + type
                            ↓
                       Redis Queue
                            ↓
                      Alert Service
                            ↓
                  DB + Notifications
```

## Files

| File | Purpose |
| --- | --- |
| `scripts/generate_synthetic_data.py` | Generate labeled multivariate sensor streams (leaks, overflows, contamination, faults). |
| `app/ml/lstm_autoencoder.py`         | PyTorch LSTM autoencoder + training CLI (`python -m app.ml.lstm_autoencoder train ...`). |
| `app/ml/sklearn_autoencoder.py`      | Lightweight MLP autoencoder used as runtime fallback. Same scoring contract. |
| `scripts/train_anomaly_detector.py`  | Train the runtime model and report precision / recall / latency on the labeled pilot test set. |
| `app/ml/water_quality.py`            | Stateful water-quality detector (rolling z-score + corrosion signature). |
| `app/services/anomaly_detection.py`  | Service layer combining sequence model + water quality + SPC. |
| `app/routers/anomaly.py`             | FastAPI endpoints `/api/v1/anomaly/analyze` and `/anomaly/reading`. |
| `tests/test_anomaly_pipeline.py`     | End-to-end validation of the whole pipeline. |

## Targets vs measured

| Objective | Target | Measured (pilot) |
| --- | --- | --- |
| LSTM leak/overflow precision | ≥ 0.70 | **0.797** |
| Detection latency (median)   | < 60 minutes | **6 minutes** |
| Water quality module accuracy | ≥ 70–75% | **97.7% overall accuracy** |
| Recall on labeled pilot | informational | **0.916** |
| F1 | informational | **0.852** |
| Events detected | informational | **8 / 8** |

## How to run

```bash
# 1. Generate synthetic dataset
python scripts/generate_synthetic_data.py --out data/synthetic --sensors 8 --minutes 4320

# 2. Train sklearn AE runtime model (works without PyTorch)
python scripts/train_anomaly_detector.py

# 3. (Optional) Train the full PyTorch LSTM AE
python -m app.ml.lstm_autoencoder train \
    --train data/synthetic/sensor_train.csv \
    --val   data/synthetic/sensor_val.csv \
    --out   app/ml/weights/lstm_anomaly.pt

# 4. Run end-to-end tests
python tests/test_anomaly_pipeline.py

# 5. Start the API
uvicorn app.main:app --reload
```

## API

### `POST /api/v1/anomaly/analyze`

```json
{
  "sensor_id": "S-101",
  "sequence": [
    [3.0, 5.0, 1.2, 1.5, 7.2],
    [3.0, 5.0, 1.2, 1.5, 7.2],
    ...
  ]
}
```

Each row is `[pressure_bar, flow_rate_lps, water_level_m, turbidity_ntu?, ph?]`.
Turbidity and pH are optional - if omitted, water-quality scoring is skipped.

Response:

```json
{
  "status": "anomaly",
  "score": 1.0,
  "reconstruction_error": 10.23,
  "threshold": 0.98,
  "type": "leak",
  "model": "sklearn_ae",
  "water_quality": {
    "is_contamination": false,
    "score": 0.0,
    "reasons": []
  }
}
```

### `POST /api/v1/anomaly/reading`

Single-reading endpoint that feeds a per-sensor rolling buffer. Use this when
the sensor stream pushes one sample at a time.
