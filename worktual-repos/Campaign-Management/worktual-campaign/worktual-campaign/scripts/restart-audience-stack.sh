#!/usr/bin/env bash
# Restart local Audience stack so contact create/update panel fixes load.
# Run on the machine that serves http://192.168.11.31:5173 (or localhost).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"

echo "APP=$APP"
fuser -k 8005/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
pkill -f 'python -m app.main' 2>/dev/null || true
pkill -f 'vite --host 0.0.0.0 --port 5173' 2>/dev/null || true
sleep 2

cd "$APP/agents"
nohup .venv/bin/python3.14 -m app.main >> "$APP/agents/agents.log" 2>&1 &
echo "agents_pid=$!"

cd "$APP"
if ! curl -sS -m 2 http://127.0.0.1:3001/health >/dev/null 2>&1; then
  nohup npm run dev:backend >> "$APP/backend.log" 2>&1 &
  echo "backend_pid=$!"
fi
nohup npm run dev:frontend >> "$APP/frontend/frontend-vite.log" 2>&1 &
echo "frontend_pid=$!"

for i in $(seq 1 40); do
  a=$(curl -sS -m 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:8005/health 2>/dev/null || echo 000)
  f=$(curl -sS -m 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null || echo 000)
  echo "try=$i agents=$a fe=$f"
  if [ "$a" = "200" ] && [ "$f" = "200" ]; then
    echo READY
    break
  fi
  sleep 1
done

cd "$APP/agents"
.venv/bin/python3.14 - <<'PY'
from app.agents.contacts.prompts import welcome_text
w = welcome_text(campaign_profile={"mode": "b2b"})
assert "Anything else is optional" not in w, w
print("welcome_ok:", w)
PY

curl -sS -m 2 http://127.0.0.1:8005/health; echo
curl -sS -m 2 -o /dev/null -w 'frontend=%{http_code}\n' http://127.0.0.1:5173/
echo "Hard-refresh the browser on /audience (Ctrl+Shift+R), then start a new chat."
