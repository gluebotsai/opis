#!/usr/bin/env bash
# Start/stop the full local CCaaS dev stack in detached background processes.
# Use this instead of running turbo + gateway + ngrok in Cursor chat (those die when the shell exits).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs/dev-stack"
PID_FILE="$LOG_DIR/pids"
PORTS=(5173 5174 3000 3001 3002 3003 3004 8000 8020 8080 4040)

mkdir -p "$LOG_DIR"

usage() {
  cat <<EOF
Local dev stack (turbo + gateway proxy + ngrok).

Usage:
  $(basename "$0") start     Kill stale ports, start all services detached
  $(basename "$0") stop      Stop stack (ports + recorded pids)
  $(basename "$0") restart   stop then start
  $(basename "$0") status    Health checks + port listeners

Logs: $LOG_DIR/
EOF
}

kill_ports() {
  for port in "${PORTS[@]}"; do
    lsof -ti :"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  pkill -f "turbo dev --concurrency=" 2>/dev/null || true
  pkill -f "dev-gateway-proxy.mjs" 2>/dev/null || true
  pkill -f "ngrok http" 2>/dev/null || true
  pkill -f "ngrok start" 2>/dev/null || true
  pkill -f "uvicorn cc_a2a.main:app" 2>/dev/null || true
}

kill_pids() {
  if [[ -f "$PID_FILE" ]]; then
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
  sleep 2
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
  echo "$!" >> "$PID_FILE"
  echo "  started $name (pid $!, log $log)"
}

wait_for_core() {
  local max_wait=${1:-120}
  for ((i = 1; i <= max_wait; i++)); do
    local ok=0
    curl -sf http://localhost:3000/health >/dev/null && ok=$((ok + 1))
    curl -sf http://localhost:3001/health >/dev/null && ok=$((ok + 1))
    curl -sf http://localhost:3002/health >/dev/null && ok=$((ok + 1))
    curl -sf http://localhost:3003/health >/dev/null && ok=$((ok + 1))
    curl -sf http://localhost:3004/health >/dev/null && ok=$((ok + 1))
    curl -sf http://localhost:8000/health >/dev/null && ok=$((ok + 1))
    curl -sf http://localhost:8020/health >/dev/null && ok=$((ok + 1))
    if curl -sf http://localhost:5173/ >/dev/null 2>&1 || curl -sf http://localhost:5174/ >/dev/null 2>&1; then
      ok=$((ok + 1))
    fi
    if [[ "$ok" -ge 8 ]]; then
      echo "  core services ready (${i}s)"
      return 0
    fi
    if (( i % 15 == 0 )); then
      echo "  waiting... ${i}s ($ok/8)"
    fi
    sleep 1
  done
  echo "  ERROR: core services did not become ready. See $LOG_DIR/turbo.log" >&2
  tail -20 "$LOG_DIR/turbo.log" >&2 || true
  return 1
}

start_stack() {
  echo "Starting dev stack..."
  stop_stack
  : > "$PID_FILE"

  cd "$ROOT"
  run_detached turbo npm run dev
  wait_for_core 120

  run_detached gateway npm run dev:gateway-proxy
  for ((i = 1; i <= 20; i++)); do
    curl -sf http://localhost:8080/health >/dev/null && break
    sleep 1
  done
  if ! curl -sf http://localhost:8080/health >/dev/null; then
    echo "  ERROR: gateway not ready. See $LOG_DIR/gateway.log" >&2
    return 1
  fi

  echo "  starting ngrok..."
  if ! npm run ngrok:gateway >> "$LOG_DIR/ngrok-start.log" 2>&1; then
    echo "  ERROR: ngrok failed. See $LOG_DIR/ngrok-start.log and /tmp/ngrok.log" >&2
    return 1
  fi

  echo "Dev stack started."
  status_stack
}

status_stack() {
  echo ""
  echo "=== ports ==="
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
    "http://localhost:5173/"
    "http://localhost:3000/health"
    "http://localhost:3002/health"
    "http://localhost:8000/health"
    "http://localhost:8020/health"
    "http://localhost:8080/health"
  )
  for url in "${urls[@]}"; do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url" 2>/dev/null || echo 000)
    echo "  $code  $url"
  done

  if curl -sf http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
    curl -s http://127.0.0.1:4040/api/tunnels | python3 -c "
import json, sys
for t in json.load(sys.stdin).get('tunnels', []):
    print('  ngrok', t.get('public_url'), '->', t.get('config', {}).get('addr'))
" 2>/dev/null || true
    local pub_code
    pub_code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H 'ngrok-skip-browser-warning: 1' \
      https://uninvited-skinless-eel.ngrok-free.dev/health 2>/dev/null || echo 000)
    echo "  $pub_code  https://uninvited-skinless-eel.ngrok-free.dev/health"
  else
    echo "  ngrok admin (:4040): down"
  fi
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
