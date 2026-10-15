# Create-campaign agents — Python Socket.IO + LLM tool loop
FROM python:3.12-slim AS production

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY agents/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/app ./app

RUN mkdir -p /data

EXPOSE 8005 8040

CMD ["python", "-m", "app.main"]
