# Deployment Guide

This project deploys as two services:

- Backend API: FastAPI on Railway
- Frontend web app: Next.js on Vercel

## 1. Railway Backend

Create a Railway project from the GitHub repository and select the `backend` directory as the service root.

Add Railway services:

- PostgreSQL
- Redis

Set backend environment variables:

```text
APP_NAME=Municipal Infrastructure Monitor
DEBUG=false
SECRET_KEY=<long-random-secret>
ALGORITHM=HS256
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE
DATABASE_URL_SYNC=postgresql+psycopg://USER:PASSWORD@HOST:PORT/DATABASE
REDIS_URL=redis://default:PASSWORD@HOST:PORT
FRONTEND_URL=https://your-vercel-app.vercel.app
CORS_ORIGINS=https://your-vercel-app.vercel.app
COOKIE_SECURE=true
COOKIE_SAMESITE=none
EAGER_LOAD_ML_MODELS=false
EAGER_LOAD_LEAK_LSTM=false
YOLO_AUTO_TRAIN=false
UPLOAD_DIR=uploads
MAX_UPLOAD_SIZE_MB=10
```

The backend Docker command runs migrations before starting FastAPI:

```text
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## 2. Vercel Frontend

Create a Vercel project from the same GitHub repository and select the `frontend` directory as the project root.

Set frontend environment variables:

```text
NEXT_PUBLIC_API_URL=https://your-railway-api.up.railway.app
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=<optional-mapbox-token>
```

After Vercel deploys, copy the Vercel domain into Railway:

```text
FRONTEND_URL=https://your-vercel-app.vercel.app
CORS_ORIGINS=https://your-vercel-app.vercel.app
```

Then redeploy the Railway backend.

## 3. Health Checks

Backend:

```text
https://your-railway-api.up.railway.app/
```

Expected response:

```json
{
  "status": "healthy"
}
```

Frontend:

```text
https://your-vercel-app.vercel.app
```

## Notes

- `node_modules`, `.next`, local env files, and dev logs are ignored by Git.
- Auth uses HttpOnly cookies. In production, keep `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` because the frontend and backend are hosted on different HTTPS domains.
- Uploaded images use local container storage. For long-term production use, move uploads to object storage such as S3, Cloudinary, or Railway volume-backed storage.
