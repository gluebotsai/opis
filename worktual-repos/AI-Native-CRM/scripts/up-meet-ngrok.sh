#!/usr/bin/env bash
# HTTPS tunnel for Google Meet Assist (sidePanelUrl must match CRM_API_PUBLIC_URL).
# Proxies to Fastify :4000, which forwards /addons/meet/* → MEETING_SERVICE_URL (:8030).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env_key() {
  local key="$1"
  grep -E "^${key}=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

PUBLIC="${CRM_API_PUBLIC_URL:-$(load_env_key CRM_API_PUBLIC_URL)}"
if [[ -z "$PUBLIC" ]]; then
  PUBLIC="$(load_env_key OAUTH_CALLBACK_ORIGIN)"
fi
if [[ -z "$PUBLIC" ]]; then
  echo "Set CRM_API_PUBLIC_URL or OAUTH_CALLBACK_ORIGIN in root .env (https://….ngrok-free.dev)"
  exit 1
fi

HOST="${PUBLIC#https://}"
HOST="${HOST#http://}"
HOST="${HOST%%/*}"

meet_config_ok() {
  curl -fsS --max-time 10 -H "ngrok-skip-browser-warning: 1" \
    "https://${HOST}/addons/meet/config" >/dev/null 2>&1
}

# Wait for the CRM API (ngrok's proxy target) instead of failing instantly —
# up-dev.sh / up-meeting-docker.sh may still be booting when this runs as
# part of a `&&` chain.
API_READY=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/health >/dev/null 2>&1; then
    API_READY=1
    break
  fi
  sleep 1
done
if [[ "$API_READY" -ne 1 ]]; then
  echo "ERROR: CRM API not on :4000 after 20s — run ./scripts/up-dev.sh first, then re-run this script"
  exit 1
fi
if ! curl -fsS --max-time 2 http://127.0.0.1:8030/healthz >/dev/null 2>&1; then
  echo "WARN: meeting-service :8030 down — run ./scripts/up-meeting-docker.sh"
fi

# Do not tear down a tunnel that already serves the add-on (restarts often hit
# ERR_NGROK_802 when ngrok cloud has not released the previous session yet).
if meet_config_ok; then
  echo "Meet Assist HTTPS OK (existing tunnel)  https://${HOST}/addons/meet/"
  echo "Google Cloud sidePanelUrl must be exactly that path (trailing slash)."
  exit 0
fi

LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# Only one ngrok agent session is allowed on this account — any other ngrok
# process (started manually in a different terminal, pointed at a different
# tunnel, etc.) will fight over that single session and can knock this one
# offline (ERR_NGROK_3200 / ERR_NGROK_108). Kill every other ngrok process
# first so this script always owns the one allowed session.
OTHER_NGROK_PIDS="$(pgrep -f '^ngrok ' 2>/dev/null | grep -v -w "$$" || true)"
if [[ -n "$OTHER_NGROK_PIDS" ]]; then
  echo "Stopping other ngrok process(es) so this tunnel owns the single allowed session: $OTHER_NGROK_PIDS"
  # shellcheck disable=SC2086
  kill $OTHER_NGROK_PIDS 2>/dev/null || true
  sleep 2
  # shellcheck disable=SC2086
  kill -9 $OTHER_NGROK_PIDS 2>/dev/null || true
  sleep 2
fi

echo "Starting ngrok → http://127.0.0.1:4000 as https://${HOST}"

NGROK_OK=0
for attempt in 1 2 3; do
  if [[ "$attempt" -gt 1 ]]; then
    echo "Retry ngrok start (attempt ${attempt}/3) after ERR_NGROK_802 or slow bind…"
    sleep 3
  fi

  nohup ngrok http 4000 --url "https://${HOST}" </dev/null >>"$LOG_DIR/ngrok.log" 2>&1 &
  echo $! >"$LOG_DIR/ngrok.pid"
  disown -h "$!" 2>/dev/null || true

  for _ in $(seq 1 15); do
    if meet_config_ok; then
      NGROK_OK=1
      break 2
    fi
    if ! pgrep -f "ngrok http 4000" >/dev/null 2>&1; then
      echo "WARN: ngrok process exited — see tail of $LOG_DIR/ngrok.log"
      tail -n 8 "$LOG_DIR/ngrok.log" 2>/dev/null || true
      break
    fi
    sleep 2
  done
done

if [[ "$NGROK_OK" -eq 1 ]]; then
  echo "Meet Assist HTTPS OK  https://${HOST}/addons/meet/"
  echo "Google Cloud sidePanelUrl must be exactly that path (trailing slash)."
  exit 0
fi

echo "ERROR: https://${HOST}/addons/meet/config not reachable — tail -f $ROOT/.dev-logs/ngrok.log"
echo "Local check: curl -sS http://127.0.0.1:4000/addons/meet/config  (should be 200)"
echo "If ngrok shows ERR_NGROK_802, wait ~30s and re-run this script (do not kill ngrok manually)."
exit 1
