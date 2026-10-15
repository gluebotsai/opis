#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ — Path B Meet add-on (OAuth client + meeting secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"

# shellcheck source=env-upsert.sh
source "$ROOT/scripts/env-upsert.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/.env.example first."
  exit 1
fi

FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-https://rebuild-crm.worktual.com}"
MEETING_SERVICE_PUBLIC_URL="${MEETING_SERVICE_PUBLIC_URL:-${FRONTEND_ORIGIN}}"
# Editable OAuth Web client (same as ACCOUNTS_GOOGLE_* / inbox on server). Not the locked Marketplace …4p9g… client.
GOOGLE_ADDON_CLIENT_ID="${GOOGLE_ADDON_CLIENT_ID:-$(env_last_value ACCOUNTS_GOOGLE_CLIENT_ID)}"
GOOGLE_ADDON_CLIENT_ID="${GOOGLE_ADDON_CLIENT_ID:-$(env_last_value GOOGLE_CLIENT_ID)}"
GOOGLE_ADDON_CLOUD_PROJECT_NUMBER="${GOOGLE_ADDON_CLOUD_PROJECT_NUMBER:-714138144506}"
NOTETAKER_PROVIDER="${NOTETAKER_PROVIDER:-vexa}"

CRM_SERVICE_JWT_SECRET="${CRM_SERVICE_JWT_SECRET:-$(env_last_value CRM_SERVICE_JWT_SECRET)}"
MEETING_SERVICE_WEBHOOK_SECRET="${MEETING_SERVICE_WEBHOOK_SECRET:-$(env_last_value MEETING_SERVICE_WEBHOOK_SECRET)}"
CRM_BOT_API_KEY="${CRM_BOT_API_KEY:-$(env_last_value CRM_BOT_API_KEY)}"
CRM_USERS_API_KEY="${CRM_USERS_API_KEY:-$(env_last_value CRM_USERS_API_KEY)}"

if [[ -z "${GOOGLE_ADDON_CLIENT_ID}" ]]; then
  echo "ERROR: Set GOOGLE_ADDON_CLIENT_ID or ACCOUNTS_GOOGLE_CLIENT_ID in $ENV_FILE (editable Web client with JS origin = FRONTEND_ORIGIN)."
  exit 1
fi

missing=0
for key in CRM_SERVICE_JWT_SECRET MEETING_SERVICE_WEBHOOK_SECRET CRM_BOT_API_KEY; do
  val="${!key}"
  if [[ -z "$val" ]]; then
    echo "ERROR: $key is empty. Export it or add once to $ENV_FILE, then re-run."
    missing=1
  fi
done
if [[ "${missing}" -ne 0 ]]; then
  echo "Example (use your real secrets, same as local meeting-service):"
  echo "  export CRM_SERVICE_JWT_SECRET='...'"
  echo "  export MEETING_SERVICE_WEBHOOK_SECRET='...'"
  echo "  export CRM_BOT_API_KEY='...'"
  exit 1
fi

if [[ -z "${CRM_USERS_API_KEY}" ]]; then
  CRM_USERS_API_KEY="${CRM_BOT_API_KEY}"
fi

echo "Patching Meet add-on keys in $ENV_FILE (deduped) ..."
echo "  FRONTEND_ORIGIN=${FRONTEND_ORIGIN}"
echo "  MEETING_SERVICE_PUBLIC_URL=${MEETING_SERVICE_PUBLIC_URL}"
echo "  GOOGLE_ADDON_CLIENT_ID=${GOOGLE_ADDON_CLIENT_ID}"
echo "  GOOGLE_ADDON_CLOUD_PROJECT_NUMBER=${GOOGLE_ADDON_CLOUD_PROJECT_NUMBER}"

upsert_env FRONTEND_ORIGIN "${FRONTEND_ORIGIN}"
upsert_env NEXT_PUBLIC_APP_URL "${FRONTEND_ORIGIN}"
upsert_env MEETING_SERVICE_PUBLIC_URL "${MEETING_SERVICE_PUBLIC_URL}"
upsert_env GOOGLE_ADDON_CLIENT_ID "${GOOGLE_ADDON_CLIENT_ID}"
upsert_env GOOGLE_ADDON_CLOUD_PROJECT_NUMBER "${GOOGLE_ADDON_CLOUD_PROJECT_NUMBER}"
upsert_env NOTETAKER_PROVIDER "${NOTETAKER_PROVIDER}"
upsert_env CRM_SERVICE_JWT_SECRET "${CRM_SERVICE_JWT_SECRET}"
upsert_env MEETING_SERVICE_WEBHOOK_SECRET "${MEETING_SERVICE_WEBHOOK_SECRET}"
upsert_env CRM_BOT_API_KEY "${CRM_BOT_API_KEY}"
upsert_env CRM_USERS_API_KEY "${CRM_USERS_API_KEY}"

COMPOSE=(docker compose --env-file .env)
if [[ -f .env.images ]]; then
  COMPOSE+=(--env-file .env.images)
fi

echo "Recreating meeting-service, api, web (nginx proxies /addons/meet → meeting-service) ..."
"${COMPOSE[@]}" up -d --force-recreate meeting-service api web

echo "Waiting for meeting-service health ..."
for _ in $(seq 1 24); do
  if "${COMPOSE[@]}" exec -T meeting-service curl -fsS http://127.0.0.1:8030/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

DEPLOY_ROOT="$ROOT" bash "$ROOT/scripts/verify-meeting-assist.sh"

PUB="${MEETING_SERVICE_PUBLIC_URL%/}"
echo ""
echo "=== Public config (what Meet uses) ==="
if curl -fsS --max-time 12 "${PUB}/addons/meet/config"; then
  echo ""
  echo "Google Cloud: OAuth client ${GOOGLE_ADDON_CLIENT_ID}"
  echo "  Authorized JavaScript origins: ${PUB}"
  echo "  HTTP deployment sidePanelUrl: ${PUB}/addons/meet/"
else
  echo "WARN: could not curl ${PUB}/addons/meet/config from this host (DNS/firewall?)"
fi
