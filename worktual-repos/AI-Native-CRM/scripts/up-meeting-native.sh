#!/usr/bin/env bash
# meeting-service API + worker on the host (no Docker). Uses meeting-service/.env.
# First time: cd meeting-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
#             ./scripts/download-live-pcm-models.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MS="$ROOT/meeting-service"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

VENV="$MS/.venv/bin"
if [[ ! -x "$VENV/uvicorn" ]]; then
  echo "Missing $MS/.venv — run:"
  echo "  cd meeting-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  echo "  ./scripts/download-live-pcm-models.sh"
  exit 1
fi

if [[ ! -f "$MS/.env" ]]; then
  echo "Copy meeting-service/.env.example → meeting-service/.env and set CRM_BOT_API_KEY, WHISPER_BASE_URL, VEXA_API_BASE."
  exit 1
fi

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping port $port ($pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

start_detached() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/${name}.log"
  local pid_file="$LOG_DIR/${name}.pid"
  echo "Starting $name → $log_file"
  nohup "$@" </dev/null >>"$log_file" 2>&1 &
  echo "$!" >"$pid_file"
}

echo "Starting meeting-service (native)..."
stop_port 8030
pkill -f "$MS/.venv/bin/uvicorn app.main:app" 2>/dev/null || true
pkill -f "$MS/app.worker" 2>/dev/null || true
sleep 1

cd "$MS"
export PYTHONPATH="$MS"
"$VENV/alembic" upgrade head

start_detached meeting-api \
  "$VENV/uvicorn" app.main:app --host 0.0.0.0 --port 8030 --reload

start_detached meeting-worker \
  "$VENV/python" -m app.worker

echo "Waiting for :8030..."
for _ in $(seq 1 25); do
  if curl -fsS --max-time 2 http://127.0.0.1:8030/healthz >/dev/null 2>&1; then
    echo "Meeting API  http://127.0.0.1:8030/healthz"
    echo "Meet add-on   http://127.0.0.1:5173/addons/meet/  (set root .env MEETING_SERVICE_URL=http://127.0.0.1:8030)"
    echo "Logs          $LOG_DIR/meeting-api.log $LOG_DIR/meeting-worker.log"
    exit 0
  fi
  sleep 1
done

echo "ERROR: meeting-service did not start — tail -f $LOG_DIR/meeting-api.log"
exit 1
