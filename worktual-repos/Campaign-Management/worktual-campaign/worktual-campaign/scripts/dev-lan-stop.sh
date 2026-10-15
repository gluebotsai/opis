#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping port $port (pids: $pids)"
    kill $pids 2>/dev/null || true
    sleep 1
    kill -9 $pids 2>/dev/null || true
  fi
}

for port in 5173 3001 3002 8005 8040; do
  kill_port "$port"
done
pkill -f 'tsx watch src/index.ts' 2>/dev/null || true
pkill -f 'vite --host 0.0.0.0 --port 5173' 2>/dev/null || true
pkill -f 'python3.14 -m app.main' 2>/dev/null || true
pkill -f 'uvicorn app.a2a_main:app' 2>/dev/null || true
rm -f /tmp/campaign-{agents,backend,frontend}.pid
echo "All campaign dev services stopped."
