#!/usr/bin/env bash
# Run on server from deploy/ — confirms vexa-lite bot will send PCM to meeting-service.
set -euo pipefail

COMPOSE=(docker compose --env-file .env)
[[ -f .env.images ]] && COMPOSE+=(--env-file .env.images)

echo "=== vexa-lite live-PCM patch ==="
for f in \
  /app/core/meetings/services/bot/dist/live-pcm-forward.js \
  /app/core/meetings/services/bot/dist/pipeline.js \
  /usr/local/bin/vexa-bot-launch; do
  if docker exec vexa-lite test -f "$f" 2>/dev/null; then
    echo "  exists $f"
  else
    echo "  MISSING $f"
  fi
done

if docker exec vexa-lite grep -q buildLivePcmJoinUrl /app/core/meetings/services/bot/dist/pipeline.js 2>/dev/null; then
  echo "OK dist/pipeline.js has live-pcm join"
else
  echo "FAIL dist/pipeline.js NOT patched — re-run meeting-service/scripts/patch-vexa-live-pcm.sh"
fi

docker exec vexa-lite grep VEXA_LIVE_PCM /usr/local/bin/vexa-bot-launch 2>/dev/null || echo "WARN vexa-bot-launch missing VEXA_LIVE_PCM_*"

echo ""
echo "=== meeting-service keys ==="
"${COMPOSE[@]}" exec -T meeting-service sh -c 'echo LIVE_PCM_ENABLED=${LIVE_PCM_ENABLED:-default}; echo CRM_BOT len $(printenv CRM_BOT_API_KEY | wc -c)'

echo ""
echo "=== network ==="
docker exec vexa-lite curl -fsS http://meeting-service:8030/healthz && echo "OK vexa-lite → meeting-service" || echo "FAIL DNS/network"

MEET="${1:-}"
if [[ -n "$MEET" ]]; then
  CRM_BOT="$(grep -E '^CRM_BOT_API_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '"')"
  echo ""
  echo "=== WS join smoke google_meet/$MEET ==="
  "${COMPOSE[@]}" exec -T meeting-service python3 - <<PY
import asyncio, os, sys
try:
    import websockets
except ImportError:
    sys.exit(2)
meet = "${MEET}"
key = "${CRM_BOT}"
async def main():
    uri = f"ws://127.0.0.1:8030/v1/live-pcm/join/google_meet/{meet}?bot_key={key}"
    async with websockets.connect(uri, open_timeout=8) as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=8)
        assert "ready" in msg, msg[:200]
        print("OK live-pcm join ready")
asyncio.run(main())
PY
fi

echo ""
echo "During a call: docker logs vexa-lite 2>&1 | grep -i 'live-pcm'"
echo "And: docker compose logs meeting-service | grep live_pcm"
