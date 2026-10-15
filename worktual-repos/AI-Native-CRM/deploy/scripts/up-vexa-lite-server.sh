#!/usr/bin/env bash
# Start Vexa Lite on the QA/production host and wire it to worktual-crm compose.
# Run from repo root (not deploy/):  bash deploy/scripts/up-vexa-lite-server.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$ROOT/deploy"
VEXA_ROOT="$ROOT/vendor/vexa"
LITE="$VEXA_ROOT/deploy/lite"
CRM_NET="${CRM_DOCKER_NETWORK:-worktual-crm_default}"
GATEWAY_PORT="${VEXA_HOST_GATEWAY_PORT:-18056}"

env_value() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

ensure_vexa_vendor() {
  if [[ -f "$LITE/Makefile" ]]; then
    return 0
  fi
  echo "vendor/vexa not present — initializing..."
  if [[ -f "$ROOT/.gitmodules" ]]; then
    git -C "$ROOT" submodule update --init --depth 1 vendor/vexa 2>/dev/null || true
  fi
  if [[ -f "$LITE/Makefile" ]]; then
    return 0
  fi
  VEXA_PIN="${VEXA_VENDOR_COMMIT:-59e2c413a53479125b70b712ade12ab470d55512}"
  rm -rf "$VEXA_ROOT"
  git clone --depth 1 https://github.com/Vexa-ai/vexa.git "$VEXA_ROOT"
  git -C "$VEXA_ROOT" fetch --depth 1 origin "$VEXA_PIN" 2>/dev/null || git -C "$VEXA_ROOT" fetch origin
  git -C "$VEXA_ROOT" checkout "$VEXA_PIN"
}

ensure_vexa_vendor
if [[ ! -f "$LITE/Makefile" ]]; then
  echo "ERROR: could not install vendor/vexa (need git + network)." >&2
  exit 1
fi

CRM_BOT_KEY="$(env_value "$DEPLOY/.env" CRM_BOT_API_KEY)"
if [[ -z "$CRM_BOT_KEY" ]]; then
  echo "WARN: CRM_BOT_API_KEY empty in deploy/.env — live PCM may fail auth."
fi

VEXA_ENV="$VEXA_ROOT/.env"
if [[ ! -f "$VEXA_ENV" ]]; then
  echo "Seeding $VEXA_ENV from vendor/vexa/deploy/compose/.env.example"
  cp "$VEXA_ROOT/deploy/compose/.env.example" "$VEXA_ENV"
fi

upsert_vexa() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$VEXA_ENV" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$VEXA_ENV"
  else
    echo "${key}=${val}" >>"$VEXA_ENV"
  fi
}

upsert_vexa INTERNAL_API_SECRET "$(openssl rand -hex 32 2>/dev/null || echo dev-internal-secret)"
upsert_vexa ADMIN_TOKEN "$(grep -E '^ADMIN_TOKEN=' "$VEXA_ENV" | cut -d= -f2- | sed 's/[[:space:]]+#.*//' || openssl rand -hex 32)"
upsert_vexa TRANSCRIPTION_SERVICE_URL "http://meeting-whisper:8000"
upsert_vexa TRANSCRIPTION_SERVICE_TOKEN "EMPTY"
upsert_vexa TRANSCRIPTION_MODEL "worktual-large-v3"
upsert_vexa VEXA_LIVE_PCM_WS_BASE "ws://meeting-service:8030"
upsert_vexa VEXA_LIVE_PCM_BOT_KEY "${CRM_BOT_KEY:-local-meeting-bot-key}"
upsert_vexa DEFAULT_BOT_NAME "Worktual Notetaker"
upsert_vexa IMAGE_TAG "v012"

echo "=== Starting Vexa Lite (host gateway :${GATEWAY_PORT}) ==="
VEXA_ENV="$VEXA_ENV" HOST_GATEWAY_PORT="$GATEWAY_PORT" \
  bash "$ROOT/deploy/scripts/vexa-lite-docker-up.sh"

echo "=== Join CRM Docker network (${CRM_NET}) ==="
if ! docker network inspect "$CRM_NET" >/dev/null 2>&1; then
  echo "ERROR: network $CRM_NET not found — start CRM compose first (cd deploy && docker compose up -d)." >&2
  exit 1
fi
docker network connect "$CRM_NET" vexa-lite 2>/dev/null || true

echo "=== Live PCM patch (meeting-service forwarder in bot) ==="
VEXA_CONTAINER=vexa-lite CRM_BOT_API_KEY="$CRM_BOT_KEY" \
  "$ROOT/meeting-service/scripts/patch-vexa-live-pcm.sh" || echo "WARN: patch failed — check vexa-lite logs"
docker restart vexa-lite >/dev/null

echo "=== Waiting for gateway ==="
for _ in $(seq 1 36); do
  curl -sf -o /dev/null "http://127.0.0.1:${GATEWAY_PORT}/health" 2>/dev/null && break
  sleep 5
done

KEY=""
for _ in $(seq 1 30); do
  KEY="$(docker exec vexa-lite sh -c 'grep -E "^VEXA_API_KEY=" /run/vexa/key.env 2>/dev/null | head -1 | cut -d= -f2-' || true)"
  [[ -n "$KEY" ]] && break
  sleep 2
done

echo ""
echo "=== Vexa Lite ==="
echo "  curl http://127.0.0.1:${GATEWAY_PORT}/health"
if [[ -n "$KEY" ]]; then
  echo "  Minted API key (add to deploy/.env):"
  echo "  VEXA_API_KEY=${KEY}"
  echo ""
  echo "  Then:"
  echo "    cd $DEPLOY"
  echo "    # upsert VEXA_API_KEY and VEXA_API_BASE=http://host.docker.internal:${GATEWAY_PORT}"
  echo "    docker compose --env-file .env --env-file .env.images up -d --force-recreate meeting-service meeting-worker"
else
  echo "  Could not read /run/vexa/key.env yet — check: docker logs vexa-lite | tail -50"
  echo "  Or mint manually via admin API (see vendor/vexa/deploy/lite/README.md)."
fi
