#!/usr/bin/env bash
# Live Meet Assist path: Vexa bot PCM → meeting-service → CRM /assist/live-caption → add-on SSE.
# Run from deploy/ during or right after a test call.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$(dirname "$0")/.."
source scripts/env-upsert.sh 2>/dev/null || true

COMPOSE=(docker compose --env-file .env)
[[ -f .env.images ]] && COMPOSE+=(--env-file .env.images)

MEET_CODE="${MEET_ASSIST_PREFLIGHT_MEET_CODE:-}"
CRM_KEY="$(grep -E '^CRM_BOT_API_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')"
VEXA_PCM_KEY="$(grep -E '^VEXA_LIVE_PCM_BOT_KEY=' "$ROOT/vendor/vexa/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')"
VEXA_WS="$(grep -E '^VEXA_LIVE_PCM_WS_BASE=' "$ROOT/vendor/vexa/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')"

echo "=== Live Assist prerequisites ==="
echo "CRM_BOT_API_KEY=$([[ -n "$CRM_KEY" ]] && echo '<set>' || echo '<empty>')"
echo "VEXA_LIVE_PCM_BOT_KEY=$([[ -n "$VEXA_PCM_KEY" ]] && echo '<set>' || echo '<empty>')"
echo "VEXA_LIVE_PCM_WS_BASE=${VEXA_WS:-<empty>}"
if [[ -n "$CRM_KEY" && -n "$VEXA_PCM_KEY" && "$CRM_KEY" != "$VEXA_PCM_KEY" ]]; then
  echo "ERROR: CRM_BOT_API_KEY and VEXA_LIVE_PCM_BOT_KEY must match (bot WS auth + CRM live-caption)."
  echo "  Fix vendor/vexa/.env, restart vexa-lite, redispatch bot (new Meet admit)."
fi
if [[ "$VEXA_WS" != "ws://meeting-service:8030" ]]; then
  echo "WARN: expected VEXA_LIVE_PCM_WS_BASE=ws://meeting-service:8030 when vexa-lite is on worktual-crm_default"
fi

if docker inspect vexa-lite >/dev/null 2>&1; then
  if docker network inspect worktual-crm_default >/dev/null 2>&1; then
    if docker inspect vexa-lite --format '{{json .NetworkSettings.Networks}}' | grep -q worktual-crm_default; then
      echo "OK vexa-lite on worktual-crm_default"
    else
      echo "ERROR: docker network connect worktual-crm_default vexa-lite"
    fi
  fi
  if docker exec vexa-lite grep -q VEXA_LIVE_PCM_WS_BASE /usr/local/bin/vexa-bot-launch 2>/dev/null; then
    echo "OK vexa-bot-launch live-PCM patch"
  else
    echo "ERROR: run VEXA_CONTAINER=vexa-lite $ROOT/meeting-service/scripts/patch-vexa-live-pcm.sh && docker restart vexa-lite"
  fi
else
  echo "WARN: vexa-lite container not running"
fi

echo ""
echo "=== meeting-service /readyz ==="
"${COMPOSE[@]}" exec -T meeting-service curl -fsS http://127.0.0.1:8030/readyz 2>/dev/null | head -c 500 || echo "readyz failed"
echo ""

echo "=== Recent live PCM / CRM caption logs ==="
"${COMPOSE[@]}" logs meeting-service --tail 120 2>/dev/null | grep -iE 'live_pcm|crm_live_caption|whisper' | tail -20 || true
"${COMPOSE[@]}" logs api --tail 80 2>/dev/null | grep -iE 'live-caption|assist|heard' | tail -15 || true

if [[ -n "$MEET_CODE" && -n "$CRM_KEY" ]]; then
  echo ""
  echo "=== WS join smoke (google_meet/$MEET_CODE) ==="
  CODE="$("${COMPOSE[@]}" exec -T meeting-service curl -sS -o /tmp/ws-probe.txt -w '%{http_code}' \
    -H "Connection: Upgrade" -H "Upgrade: websocket" \
    "http://127.0.0.1:8030/v1/live-pcm/join/google_meet/${MEET_CODE}?bot_key=${CRM_KEY}" 2>/dev/null || echo "000")
  echo "HTTP $CODE (101 = upgrade ok; 404 = no meeting row for this Meet code)"
fi

echo ""
echo "During a call you should see meeting-service: live_pcm_connected"
echo "If captions fail: crm_live_caption_failed status=404 → assist session not linked to meeting-service id"
echo "After any vexa patch/restart: leave Meet, redispatch activity, admit bot again."
