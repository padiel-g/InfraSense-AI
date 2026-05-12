# InfraSense-AI
AI-powered municipal infrastructure monitoring system with FastAPI, Next.js, anomaly detection, leak detection, water quality simulation, GIS dashboards, and YOLOv8 illegal dumping detection.
## Features
- Sensor anomaly detection for municipal infrastructure readings
- Leak and overflow detection using sequence-aware ML workflows
- Water quality monitoring for pH, turbidity, flow, contamination, and corrosion signals
- Illegal dumping detection from uploaded images using YOLOv8
- GIS dashboard with map-based infrastructure and incident views
- Incident, alert, asset, resident report, and crew management workflows
- FastAPI backend with OpenAPI documentation
- Next.js dashboard frontend with React Query, Tailwind CSS, Recharts, and Leaflet/Mapbox
## Tech Stack
- **Frontend:** Next.js 14, React, TypeScript, Tailwind CSS, React Query, Recharts, Leaflet, Mapbox
- **Backend:** FastAPI, SQLAlchemy, Pydantic, PostgreSQL, Redis
- **Machine Learning:** Scikit-learn, XGBoost, TensorFlow, PyTorch, Ultralytics YOLOv8
- **Tooling:** Docker Compose, Uvicorn, Alembic
## Project Structure
```text
backend/   FastAPI API, database models, ML services, routers, datasets, and model weights
frontend/  Next.js web dashboard and user-facing workflows
tools/     Utility and smoke-test scripts
```
## Quick Start
### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API docs are available at:
```text
http://localhost:8000/docs
```
### Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at:
```text
http://localhost:3000
```
## Docker Backend
```bash
cd backend
docker-compose up -d
```
## ML Models
Model files are loaded from `backend/app/ml/weights/` when available:
- `xgboost_risk.json`
- `rf_risk.joblib`
- `lstm_anomaly.pt`
- `sklearn_anomaly.joblib`
- `yolov8_dumping.pt`
- `leak_lstm.pt`
The application can fall back to heuristic or statistical workflows when some model files are unavailable.
## API
The FastAPI backend exposes endpoints for authentication, assets, incidents, sensors, anomaly detection, dumping detection, dashboard data, alerts, water monitoring, water quality, leak detection, and crew routing.

Health check:
```text
GET /
```
Default local API base:

```text
http://localhost:8000
```
