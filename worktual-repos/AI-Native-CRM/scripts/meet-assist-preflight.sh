#!/usr/bin/env bash
# Meet Assist Layer-1 preflight: live PCM → CRM live-caption → add-on SSE path.
# Run before demos or after changing meeting-service / Vexa / CRM env.
#
# Usage:
#   ./scripts/meet-assist-preflight.sh
#   MEET_ASSIST_PREFLIGHT_MEET_CODE=abc-defg-hij ./scripts/meet-assist-preflight.sh
#
# Optional env (loaded from repo root .env when unset):
#   MEETING_SERVICE_URL   default http://127.0.0.1:8030
#   CRM_API_URL           default http://127.0.0.1:4000
#   MEET_ASSIST_PREFLIGHT_MEET_CODE  google meet code for live-pcm WS smoke
#   VEXA_CONTAINER        default vexa-lite
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env_key() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(MEETING_SERVICE_URL|CRM_BOT_API_KEY|CRM_BOT_BASE_URL)=' "$ROOT/.env" 2>/dev/null | sed 's/^/export /') || true
  set +a
fi
if [[ -f "$ROOT/meeting-service/.env" ]]; then
  MS_KEY="$(load_env_key "$ROOT/meeting-service/.env" CRM_BOT_API_KEY)"
  if [[ -n "$MS_KEY" && -z "${CRM_BOT_API_KEY:-}" ]]; then
    export CRM_BOT_API_KEY="$MS_KEY"
  fi
fi

MEETING_SERVICE_URL="${MEETING_SERVICE_URL:-http://127.0.0.1:8030}"
CRM_API_URL="${CRM_API_URL:-http://127.0.0.1:4000}"
MEET_CODE="${MEET_ASSIST_PREFLIGHT_MEET_CODE:-}"
VEXA_CONTAINER="${VEXA_CONTAINER:-vexa-lite}"

fail=0
ok() { echo "  OK  $*"; }
warn() { echo "  WARN $*"; }
bad() { echo "  FAIL $*"; fail=1; }

echo "Meet Assist preflight"
echo "  meeting-service: $MEETING_SERVICE_URL"
echo "  CRM API:         $CRM_API_URL"
echo ""

echo "[1] meeting-service health"
if curl -fsS --max-time 5 "$MEETING_SERVICE_URL/healthz" >/dev/null 2>&1; then
  ok "healthz"
else
  bad "healthz unreachable at $MEETING_SERVICE_URL/healthz"
fi

echo "[2] live_pcm router wired in source"
if grep -q 'app.include_router(live_pcm_router)' "$ROOT/meeting-service/app/main.py" 2>/dev/null; then
  ok "main.py includes live_pcm_router"
else
  bad "meeting-service/app/main.py missing app.include_router(live_pcm_router) — rebuild image after fix"
fi

echo "[3] CRM bot API key configured (length only)"
if [[ -n "${CRM_BOT_API_KEY:-}" ]]; then
  ok "CRM_BOT_API_KEY set (len=${#CRM_BOT_API_KEY})"
else
  bad "CRM_BOT_API_KEY unset — set in root .env and meeting-service/.env"
fi

echo "[4] CRM API reachable (live-caption target)"
if curl -fsS --max-time 5 "$CRM_API_URL/health" >/dev/null 2>&1; then
  ok "GET /health"
else
  bad "CRM not reachable at $CRM_API_URL/health (meeting-service CRM_BOT_BASE_URL must reach this from Docker)"
fi

echo "[5] Whisper adapter (via meeting-service /readyz if available)"
if curl -fsS --max-time 8 "$MEETING_SERVICE_URL/readyz" 2>/dev/null | grep -qi whisper; then
  ok "readyz mentions whisper"
elif curl -fsS --max-time 5 "$MEETING_SERVICE_URL/readyz" >/dev/null 2>&1; then
  ok "readyz"
else
  warn "readyz not available or whisper not reported — check WHISPER_BASE_URL in meeting-service"
fi

echo "[6] Vexa live-PCM patch (optional)"
if docker inspect "$VEXA_CONTAINER" >/dev/null 2>&1; then
  if docker exec "$VEXA_CONTAINER" grep -q VEXA_LIVE_PCM_WS_BASE /usr/local/bin/vexa-bot-launch 2>/dev/null; then
    ok "$VEXA_CONTAINER vexa-bot-launch has VEXA_LIVE_PCM_*"
  else
    bad "run: cd meeting-service && ./scripts/patch-vexa-live-pcm.sh && docker restart $VEXA_CONTAINER"
  fi
else
  warn "$VEXA_CONTAINER not running — skip Vexa check"
fi

echo "[7] live-pcm WebSocket join (optional)"
if [[ -z "$MEET_CODE" ]]; then
  warn "set MEET_ASSIST_PREFLIGHT_MEET_CODE=xxx-xxxx-xxx to test WS (meeting must exist in meeting-service DB)"
elif [[ -z "${CRM_BOT_API_KEY:-}" ]]; then
  warn "skip WS — no CRM_BOT_API_KEY"
else
  export MEET_CODE CRM_BOT_API_KEY MEETING_SERVICE_URL
  if python3 - <<'PY'
import asyncio, os, sys
try:
    import websockets
except ImportError:
    sys.exit(2)

meet = os.environ["MEET_CODE"]
key = os.environ["CRM_BOT_API_KEY"]
base = os.environ["MEETING_SERVICE_URL"].rstrip("/")
host = base.replace("http://", "").replace("https://", "")
scheme = "wss" if base.startswith("https://") else "ws"
uri = f"{scheme}://{host}/v1/live-pcm/join/google_meet/{meet}?bot_key={key}"

async def main():
    async with websockets.connect(uri, open_timeout=5) as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=5)
        if "ready" not in msg:
            raise RuntimeError(msg[:200])

asyncio.run(main())
PY
  then
    ok "live-pcm join → ready for google_meet/$MEET_CODE"
  else
    rc=$?
    if [[ "$rc" -eq 2 ]]; then
      warn "install websockets (pip install websockets) for WS smoke"
    else
      bad "live-pcm WS failed for google_meet/$MEET_CODE (403=key mismatch, 404=no meeting row)"
    fi
  fi
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "Preflight passed. Admit notetaker in Meet after Vexa changes; sign into add-on with CRM email."
  exit 0
fi
echo "Preflight failed — fix FAIL items before tuning latency or UI."
exit 1
