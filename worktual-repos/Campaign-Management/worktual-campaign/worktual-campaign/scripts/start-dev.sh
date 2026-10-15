#!/usr/bin/env bash
# Start Campaign FE / BE / agents on the real host (not Cursor sandbox).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fuser -k 5173/tcp 3001/tcp 8005/tcp 2>/dev/null || true
sleep 1

mkdir -p /tmp
nohup npm run dev:backend > /tmp/campaign-backend.log 2>&1 &
nohup npm run dev:frontend > /tmp/campaign-frontend.log 2>&1 &
(
  cd "$ROOT/agents"
  nohup .venv/bin/python3.14 -m app.main > /tmp/campaign-agents.log 2>&1 &
)

echo "Waiting for ports…"
for _ in $(seq 1 30); do
  if ss -tln | grep -q ':5173 ' && ss -tln | grep -q ':3001 ' && ss -tln | grep -q ':8005 '; then
    break
  fi
  sleep 1
done

echo
ss -tln | grep -E ':5173|:3001|:8005' || true
echo
curl -s -o /dev/null -w "frontend http://127.0.0.1:5173/  -> %{http_code}\n" http://127.0.0.1:5173/ || true
curl -s http://127.0.0.1:3001/health || true
echo
curl -s http://127.0.0.1:8005/health || true
echo
echo "Open: http://127.0.0.1:5173/  (prefer 127.0.0.1 over localhost)"
echo "Logs: /tmp/campaign-frontend.log /tmp/campaign-backend.log /tmp/campaign-agents.log"
