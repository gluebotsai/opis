#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"

check_port() {
  local port="$1"
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  port $port: LISTEN ($(lsof -tiTCP:"$port" -sTCP:LISTEN | tr '\n' ' '))"
  else
    echo "  port $port: down"
  fi
}

check_pid_file() {
  local name="$1"
  local pid_file="$LOG_DIR/${name}.pid"
  if [[ ! -f "$pid_file" ]]; then
    echo "  $name: no pid file"
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    echo "  $name: empty pid file"
    return
  fi
  if ps -p "$pid" -o pid=,comm=,etime= >/dev/null 2>&1; then
    echo "  $name: alive pid $pid $(ps -p "$pid" -o comm=,etime= 2>/dev/null | tr -s ' ')"
  else
    echo "  $name: STALE pid $pid (process gone — run ./scripts/up-dev.sh)"
  fi
}

echo "CRM dev status ($ROOT)"
echo
check_port 5173
check_port 4000
check_port 8000
check_port 8020
echo
check_pid_file web
check_pid_file api
echo
if curl -fsS --max-time 2 http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo "  http://127.0.0.1:5173 → OK"
else
  echo "  http://127.0.0.1:5173 → unreachable"
fi
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -n "$LAN_IP" ]]; then
  if curl -fsS --max-time 2 "http://${LAN_IP}:5173/" >/dev/null 2>&1; then
    echo "  http://${LAN_IP}:5173 → OK"
  else
    echo "  http://${LAN_IP}:5173 → unreachable"
  fi
fi
