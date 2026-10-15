#!/usr/bin/env bash
# Start the local Ticketing stack once. Re-running this file first frees the ports
# so leftover processes do not hit Postgres 53300 (too many clients).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORTS=(3001 5173 8012 8020 8021 8040)
PIDS=()

stop_ports() {
  local port
  for port in "${PORTS[@]}"; do
    if command -v lsof >/dev/null 2>&1; then
      lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
    fi
  done
}

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  stop_ports
}

trap cleanup EXIT INT TERM

echo "Stopping leftover listeners on ${PORTS[*]}..."
stop_ports
sleep 1

start() {
  local name="$1"
  shift
  echo "Starting $name..."
  "$@" &
  PIDS+=("$!")
}

start api       npm run dev:api
start kb-embed  npm run dev:kb-embed
start mcp       npm run dev:mcp
start agents    npm run dev:agents
start a2a       npm run dev:a2a
start frontend  npm run dev:frontend

echo
echo "Stack starting. When ready:"
echo "  Staff UI     http://127.0.0.1:5173/"
echo "  Support      http://127.0.0.1:5173/support/booxoo"
echo "  API health   http://127.0.0.1:3001/api/health"
echo
echo "Ctrl+C stops this stack. Do not run this file a second time in another terminal."

wait
