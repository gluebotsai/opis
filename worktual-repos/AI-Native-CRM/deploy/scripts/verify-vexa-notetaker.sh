#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ — Vexa notetaker path (NOTETAKER_PROVIDER=vexa).
set -euo pipefail

ROOT="${DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

COMPOSE=(docker compose --env-file .env)
if [[ -f .env.images ]]; then
  COMPOSE+=(--env-file .env.images)
fi

env_value() {
  local key="$1"
  local raw
  raw="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

PROVIDER="$(env_value NOTETAKER_PROVIDER)"
JWT="$(env_value CRM_SERVICE_JWT_SECRET)"
MS_URL="$(env_value MEETING_SERVICE_URL)"
VEXA_BASE="$(env_value VEXA_API_BASE)"
VEXA_KEY="$(env_value VEXA_API_KEY)"
BOT_NAME="$(env_value MEETING_CAPTURE_BOT_DISPLAY_NAME)"

echo "=== Vexa notetaker (.env) ==="
echo "NOTETAKER_PROVIDER=${PROVIDER:-<empty>}"
echo "MEETING_SERVICE_URL=${MS_URL:-<empty>} (api uses http://meeting-service:8030 in compose)"
echo "CRM_SERVICE_JWT_SECRET=$([[ -n "${JWT}" ]] && echo '<set>' || echo '<empty>')"
echo "VEXA_API_BASE=${VEXA_BASE:-http://host.docker.internal:18056}"
echo "VEXA_API_KEY=$([[ -n "${VEXA_KEY}" ]] && echo '<set>' || echo '<empty>')"
echo "MEETING_CAPTURE_BOT_DISPLAY_NAME=${BOT_NAME:-Worktual Notetaker}"
echo "Bot display name in Google Meet lobby: ${BOT_NAME:-Worktual Notetaker}"

fail=0
if [[ "${PROVIDER}" != "vexa" ]]; then
  echo "WARN: NOTETAKER_PROVIDER is not vexa."
fi
if [[ -z "${JWT}" ]]; then
  echo "ERROR: CRM_SERVICE_JWT_SECRET is empty."
  fail=1
fi
if [[ -z "${VEXA_KEY}" ]]; then
  echo "ERROR: VEXA_API_KEY is empty — meeting-service cannot call Vexa to join Meet."
  fail=1
fi

echo ""
echo "=== meeting-service → Vexa (from container) ==="
if ! "${COMPOSE[@]}" exec -T meeting-service python - <<'PY'
from app.config import settings
from app.services import vexa
print(f"vexa_api_base={settings.vexa_api_base}")
print(f"vexa_api_key={'<set>' if (settings.vexa_api_key or '').strip() else '<empty>'}")
print(f"vexa_ping={vexa.ping()}")
PY
then
  echo "ERROR: could not exec meeting-service"
  fail=1
fi

echo ""
echo "=== meeting-service logs (last vexa/join errors) ==="
"${COMPOSE[@]}" logs meeting-service --tail 40 2>/dev/null | grep -iE 'vexa|join|bot|error' | tail -15 || true

if [[ "${fail}" -ne 0 ]]; then
  echo ""
  echo "Fix deploy/.env then:"
  echo "  docker compose --env-file .env --env-file .env.images up -d --force-recreate meeting-service meeting-worker api scheduler worker"
  echo "Redispatch one meeting:"
  echo "  docker compose run --rm --no-deps api npx tsx scripts/redispatch-meeting-capture.ts <activityId>"
  exit 1
fi

echo ""
echo "Vexa env looks set. If bot still does not join: admit '${BOT_NAME:-Worktual Notetaker}' in Meet lobby; check Vexa Lite on host port 18056."
