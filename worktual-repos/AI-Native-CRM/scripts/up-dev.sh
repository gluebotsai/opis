#!/usr/bin/env bash
# Local CRM only: Vite :5173, Fastify :4000, AI :8000, A2A :8020.
# Do not start meeting-service, Vexa, or the Meet add-on here. Those run on the
# server. Use the server credentials (MEETING_SERVICE_URL and related keys).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# This machine keeps Node outside the default PATH. Child processes (Vite, API)
# inherit this export.
if ! command -v node >/dev/null 2>&1; then
  if [[ -x "${HOME}/.local/node-v20.19.4-linux-x64/bin/node" ]]; then
    export PATH="${HOME}/.local/node-v20.19.4-linux-x64/bin:${PATH}"
  fi
fi

UVICORN=""
if [[ -x "$ROOT/ai-service/.venv/bin/uvicorn" ]]; then
  UVICORN="$ROOT/ai-service/.venv/bin/uvicorn"
elif [[ -x "/Users/macbook/Desktop/CRM REBUILD/ai-service/.venv/bin/uvicorn" ]]; then
  UVICORN="/Users/macbook/Desktop/CRM REBUILD/ai-service/.venv/bin/uvicorn"
  echo "WARN: ai-service/.venv missing uvicorn — using CRM REBUILD venv."
  echo "      Fix: cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
else
  echo "No uvicorn found. Run: cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
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
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

# Detached start — survives parent shell exit (macOS has no setsid).
start_detached() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/${name}.log"
  local pid_file="$LOG_DIR/${name}.pid"
  echo "Starting $name → $log_file"
  nohup "$@" </dev/null >>"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"
  disown -h "$pid" 2>/dev/null || true
}

# Cursor/agent shells often kill nohup children when the tool exits — use Terminal on macOS.
if [[ "$(uname -s)" == Darwin ]] && [[ "${CRM_DEV_NO_TERMINAL:-}" != "1" ]] && [[ -n "${CURSOR_TRACE_ID:-}${CURSOR_AGENT:-}" || "${CRM_DEV_TERMINAL:-}" == "1" ]]; then
  exec "$ROOT/scripts/up-dev-terminal.sh"
fi

echo "Restarting local CRM stack..."
for port in 5173 4000 8000 8020; do
  stop_port "$port"
done

# Orphaned repo dev processes (tsx watch without listening port, Cursor shells, etc.)
pkill -f "$ROOT/backend/node_modules/.bin/tsx watch" 2>/dev/null || true
pkill -f "AI-Native-CRM-old/backend/node_modules/.bin/tsx watch" 2>/dev/null || true
pkill -f "$ROOT/frontend/node_modules/.bin/vite" 2>/dev/null || true
pkill -f "AI-Native-CRM-old/frontend/node_modules/.bin/vite" 2>/dev/null || true
pkill -f "$ROOT/ai-service/.venv/bin/uvicorn" 2>/dev/null || true
sleep 1

cd "$ROOT"
export CRON_SCHEDULER_VERBOSE="${CRON_SCHEDULER_VERBOSE:-true}"
# exec the real listeners (npm parent exits immediately and breaks pid tracking).
# Restart loop — Vite sometimes exits silently; keep 5173 reachable for LAN testing.
start_detached web bash -c "cd '$ROOT/frontend' && while true; do
  echo \"[\$(date '+%Y-%m-%dT%H:%M:%S')] vite starting\" >> '$LOG_DIR/web.log'
  ./node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort >>'$LOG_DIR/web.log' 2>&1
  code=\$?
  echo \"[\$(date '+%Y-%m-%dT%H:%M:%S')] vite exited \$code — restart in 2s\" >> '$LOG_DIR/web.log'
  sleep 2
done"
# Node's --env-file stops on the prose lines in .env, so login never sees
# ACCOUNT_DATABASE_URL. dotenv skips those lines and still loads the keys.
start_detached api bash -c "cd '$ROOT/backend' && exec env -u DATABASE_URL -u ACCOUNT_DATABASE_URL NODE_PATH='$ROOT/node_modules' NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH='$ROOT/.env' ./node_modules/.bin/tsx watch --tsconfig tsconfig.json src/index.ts"

export PYTHONPATH="$ROOT/ai-service"
export SEMRUSH_MCP_ENABLED=true
start_detached ai "$UVICORN" app.main:app --host 0.0.0.0 --port 8000 --reload
start_detached a2a "$UVICORN" app.a2a_main:app --host 0.0.0.0 --port 8020 --reload

echo "Waiting for ports..."
ready=0
for _ in $(seq 1 30); do
  ready=0
  for port in 5173 4000 8000 8020; do
    lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && ready=$((ready + 1)) || true
  done
  if [[ "$ready" -eq 4 ]]; then
    break
  fi
  sleep 1
done

echo "Waiting for API HTTP..."
api_http=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/health >/dev/null 2>&1; then
    api_http=1
    break
  fi
  sleep 1
done
if [[ "$api_http" -ne 1 ]]; then
  echo "WARN: API port is open but /health did not respond — login via :5173 may 500 until API finishes booting."
fi

echo
echo "Web  http://127.0.0.1:5173  (LAN http://192.168.13.159:5173)"
echo "API  http://127.0.0.1:4000"
echo "AI   http://127.0.0.1:8000"
echo "A2A  http://127.0.0.1:8020"
if curl -fsS http://127.0.0.1:8030/healthz >/dev/null 2>&1; then
  echo "Meet add-on  http://127.0.0.1:5173/addons/meet/  (proxied to meeting-service :8030)"
  meet_pub=""
  if [[ -f "$ROOT/.env" ]]; then
    for key in MEETING_SERVICE_PUBLIC_URL FRONTEND_ORIGIN CRM_API_PUBLIC_URL; do
      line="$(grep -E "^${key}=https://" "$ROOT/.env" 2>/dev/null | head -1 || true)"
      if [[ -n "$line" ]]; then
        meet_pub="$(echo "$line" | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' | sed 's:/*$::')"
        break
      fi
    done
  fi
  if [[ -n "$meet_pub" ]]; then
    curl_args=(--max-time 3)
    if [[ "$meet_pub" == *ngrok-free.* ]]; then
      curl_args+=(-H "ngrok-skip-browser-warning: 1")
    fi
    if curl -fsS "${curl_args[@]}" "${meet_pub}/addons/meet/config" >/dev/null 2>&1; then
      echo "Meet Assist (Meet iframe)  ${meet_pub}/addons/meet/"
    else
      echo "Meet Assist (Meet iframe)  ${meet_pub}/addons/meet/ — config not reachable (nginx/API/meeting-service?)"
    fi
  else
    echo "Meet Assist (Meet iframe)  set MEETING_SERVICE_PUBLIC_URL or FRONTEND_ORIGIN in .env (prod HTTPS)"
  fi
else
  echo "Meeting stack stays on the server (meeting-service, Vexa, Meet add-on). Not started locally."
fi
echo "Logs $LOG_DIR"
echo "PIDs $(cat "$LOG_DIR"/*.pid 2>/dev/null | tr '\n' ' ')"
echo
for port in 5173 4000 8000 8020; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  port $port: up"
  else
    echo "  port $port: DOWN — tail -f $LOG_DIR/*.log"
  fi
done
echo
if grep -q '\[cron-scheduler\] started' "$LOG_DIR/api.log" 2>/dev/null; then
  echo "Cron scheduler: started (see api.log)"
elif grep -q 'standby' "$LOG_DIR/api.log" 2>/dev/null; then
  echo "Cron scheduler: STANDBY — run ./scripts/down-dev.sh && ./scripts/up-dev.sh again"
else
  echo "Cron scheduler: booting — tail -f $LOG_DIR/api.log"
fi

if [[ "$ready" -ne 4 ]]; then
  echo
  echo "ERROR: not all services are listening. Check logs in $LOG_DIR"
  exit 1
fi
