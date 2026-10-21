# syntax=docker/dockerfile:1.7
# docker build --build-context pipeline=../DSprojects/reel-pipeline -t reel-studio .
FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 studio \
    && mkdir -p /data && chown studio:studio /data
WORKDIR /app
COPY --from=pipeline /requirements.txt /opt/reel-pipeline/requirements.txt
COPY --from=pipeline /requirements-url.txt /opt/reel-pipeline/requirements-url.txt
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /opt/reel-pipeline/requirements.txt -r /opt/reel-pipeline/requirements-url.txt -r /app/backend/requirements.txt \
    && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless==5.0.0.93
COPY --from=pipeline /reelkit/ /opt/reel-pipeline/reelkit/
COPY --from=pipeline /library/ /opt/reel-pipeline/library/
COPY backend/ /app/backend/
COPY --from=frontend /src/frontend/dist/ /app/frontend/dist/
ENV PYTHONPATH=/app/backend REEL_PIPELINE_PATH=/opt/reel-pipeline REELKIT_DATA=/data/pipeline \
    REELKIT_MODELS=/opt/reel-pipeline/.models STUDIO_ROOT=/data/studio \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 PYTHONUNBUFFERED=1
USER studio
EXPOSE 8000
CMD ["python", "-m", "studio", "--host", "0.0.0.0", "--port", "8000"]
