#!/usr/bin/env bash
set -euo pipefail

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
  else
    echo "Port $port already down"
  fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping local CRM stack..."
for port in 5173 4000 8000 8020 8030; do
  stop_port "$port"
done
pkill -f "$ROOT/meeting-service/.venv/bin/uvicorn app.main:app" 2>/dev/null || true
pkill -f "$ROOT/meeting-service/app.worker" 2>/dev/null || true
echo "Down."
