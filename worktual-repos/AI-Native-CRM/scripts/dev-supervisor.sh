#!/usr/bin/env bash
# Run inside Terminal.app — keeps CRM dev servers alive (Ctrl+C stops all).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

UVICORN=""
if [[ -x "$ROOT/ai-service/.venv/bin/uvicorn" ]]; then
  UVICORN="$ROOT/ai-service/.venv/bin/uvicorn"
elif [[ -x "/Users/macbook/Desktop/CRM REBUILD/ai-service/.venv/bin/uvicorn" ]]; then
  UVICORN="/Users/macbook/Desktop/CRM REBUILD/ai-service/.venv/bin/uvicorn"
else
  echo "Missing uvicorn — cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

cleanup() {
  echo
  echo "Stopping CRM dev processes..."
  jobs -p | xargs kill 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "CRM dev supervisor (leave this Terminal window open)"
echo "  Web  http://127.0.0.1:5173"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -n "$LAN_IP" ]]; then
  echo "  LAN  http://${LAN_IP}:5173"
fi
echo "  API  http://127.0.0.1:4000"
echo

export CRON_SCHEDULER_VERBOSE="${CRON_SCHEDULER_VERBOSE:-true}"
export PYTHONPATH="$ROOT/ai-service"
export SEMRUSH_MCP_ENABLED=true

cd "$ROOT/frontend"
./node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort 2>&1 | tee -a "$LOG_DIR/web.log" &
WEB=$!

cd "$ROOT/backend"
env -u DATABASE_URL -u ACCOUNT_DATABASE_URL \
  ./node_modules/.bin/tsx watch --tsconfig tsconfig.json --env-file=../.env src/index.ts \
  2>&1 | tee -a "$LOG_DIR/api.log" &
API=$!

cd "$ROOT/ai-service"
"$UVICORN" app.main:app --host 0.0.0.0 --port 8000 --reload 2>&1 | tee -a "$LOG_DIR/ai.log" &
AI=$!

"$UVICORN" app.a2a_main:app --host 0.0.0.0 --port 8020 --reload 2>&1 | tee -a "$LOG_DIR/a2a.log" &
A2A=$!

echo "PIDs web=$WEB api=$API ai=$AI a2a=$A2A"
wait
