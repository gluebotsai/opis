# Python orchestrator (:8000) and MCP (:8010). Same image, different compose command.
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
  && rm -rf /var/lib/apt/lists/*

COPY ai-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ai-service/app ./app

ENV PYTHONPATH=/app
ENV APP_ENV=production
ENV MCP_MOUNT_IN_API=false
ENV PYTHONUNBUFFERED=1

EXPOSE 8000 8010 8020

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
