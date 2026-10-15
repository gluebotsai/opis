#!/usr/bin/env bash
# Start/stop the local CRM dev stack in detached background processes.
# Same shape as ai_contact_centre/scripts/dev-stack.sh.
# Web :5173, API :4000, AI :8000, A2A :8020. Meeting-service stays on the server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"
PID_FILE="$LOG_DIR/dev-stack.pids"
PORTS=(5173 4000 8000 8020)

mkdir -p "$LOG_DIR"

usage() {
  cat <<EOF
Local CRM dev stack (Vite, Fastify, ai-service, A2A).

Usage:
  $(basename "$0") start     Kill stale ports, start all services detached
  $(basename "$0") stop      Stop stack (ports + recorded pids)
  $(basename "$0") restart   stop then start
  $(basename "$0") status    Health checks + port listeners

Logs: $LOG_DIR/
EOF
}

uvicorn_bin() {
  if [[ -x "$ROOT/ai-service/.venv/bin/uvicorn" ]]; then
    echo "$ROOT/ai-service/.venv/bin/uvicorn"
    return 0
  fi
  echo "No uvicorn found. Run: cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  return 1
}

kill_ports() {
  local port pids
  for port in "${PORTS[@]}"; do
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
    fi
  done
  sleep 1
  for port in "${PORTS[@]}"; do
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  done
  pkill -f "$ROOT/backend/node_modules/.bin/tsx watch" 2>/dev/null || true
  pkill -f "$ROOT/frontend/node_modules/.bin/vite" 2>/dev/null || true
  pkill -f "$ROOT/ai-service/.venv/bin/uvicorn" 2>/dev/null || true
}

kill_pids() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    sleep 1
    while read -r pid; do
      [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
}

stop_stack() {
  echo "Stopping dev stack..."
  kill_pids
  kill_ports
  echo "Stopped."
}

run_detached() {
  local name=$1
  shift
  local log="$LOG_DIR/$name.log"
  : > "$log"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >> "$log" 2>&1 < /dev/null &
  else
    nohup "$@" >> "$log" 2>&1 < /dev/null &
  fi
  local pid=$!
  disown -h "$pid" 2>/dev/null || true
  echo "$pid" >> "$PID_FILE"
  echo "  started $name (pid $pid, log $log)"
}

wait_for_core() {
  local max_wait=${1:-90}
  local i ok
  for ((i = 1; i <= max_wait; i++)); do
    ok=0
    curl -sf --max-time 2 http://127.0.0.1:5173/ >/dev/null && ok=$((ok + 1))
    curl -sf --max-time 2 http://127.0.0.1:4000/health >/dev/null && ok=$((ok + 1))
    curl -sf --max-time 2 http://127.0.0.1:8000/health >/dev/null && ok=$((ok + 1))
    curl -sf --max-time 2 http://127.0.0.1:8020/health >/dev/null && ok=$((ok + 1))
    if [[ "$ok" -ge 4 ]]; then
      echo "  core services ready (${i}s)"
      return 0
    fi
    if (( i % 15 == 0 )); then
      echo "  waiting... ${i}s ($ok/4)"
    fi
    sleep 1
  done
  echo "  ERROR: core services did not become ready. See $LOG_DIR/" >&2
  return 1
}

start_stack() {
  local uvicorn
  uvicorn="$(uvicorn_bin)"
  echo "Starting dev stack..."
  stop_stack
  : > "$PID_FILE"

  export CRON_SCHEDULER_VERBOSE="${CRON_SCHEDULER_VERBOSE:-true}"
  export PYTHONPATH="$ROOT/ai-service"
  export SEMRUSH_MCP_ENABLED=true

  run_detached web bash -c "
    cd '$ROOT/frontend'
    while true; do
      echo \"[\$(date '+%Y-%m-%dT%H:%M:%S')] vite starting\"
      ./node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort
      echo \"[\$(date '+%Y-%m-%dT%H:%M:%S')] vite exited \$? — restart in 2s\"
      sleep 2
    done
  "
  run_detached api bash -c "cd '$ROOT/backend' && exec env -u DATABASE_URL -u ACCOUNT_DATABASE_URL ./node_modules/.bin/tsx watch --tsconfig tsconfig.json --env-file=../.env src/index.ts"
  run_detached ai "$uvicorn" app.main:app --host 0.0.0.0 --port 8000 --reload
  run_detached a2a "$uvicorn" app.a2a_main:app --host 0.0.0.0 --port 8020 --reload

  wait_for_core 90
  echo "Dev stack started."
  status_stack
}

status_stack() {
  echo ""
  echo "=== ports ==="
  local port
  for port in "${PORTS[@]}"; do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "  $port: up"
    else
      echo "  $port: down"
    fi
  done

  echo ""
  echo "=== health ==="
  local urls=(
    "http://127.0.0.1:5173/"
    "http://127.0.0.1:4000/health"
    "http://127.0.0.1:8000/health"
    "http://127.0.0.1:8020/health"
  )
  local url code
  for url in "${urls[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url" 2>/dev/null || echo 000)
    echo "  $code  $url"
  done
  echo ""
}

cmd="${1:-}"
case "$cmd" in
  start) start_stack ;;
  stop) stop_stack ;;
  restart) stop_stack; start_stack ;;
  status) status_stack ;;
  -h | --help | help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
