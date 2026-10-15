FROM python:3.12.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY scripts/download-live-pcm-models.sh ./scripts/
RUN chmod +x ./scripts/download-live-pcm-models.sh \
    && ./scripts/download-live-pcm-models.sh

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .
COPY scripts ./scripts
RUN chmod +x /app/scripts/entrypoint.sh /app/scripts/preflight_whisper.sh

EXPOSE 8030

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8030/healthz || exit 1

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8030"]
