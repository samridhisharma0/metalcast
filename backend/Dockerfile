# ---------------- Stage 1: build the SPA ----------------
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------- Stage 2: Python runtime ----------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Minimal build dependencies for numpy/scipy wheels + curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so image layers cache well
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# Application code
COPY backend/ ./

# Built SPA lands in the directory the FastAPI SPA fallback reads from.
COPY --from=frontend /app/dist ./static

# Run as an unprivileged user
RUN useradd --create-home --uid 1000 metalcast && \
    chown -R metalcast:metalcast /app
USER metalcast

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
