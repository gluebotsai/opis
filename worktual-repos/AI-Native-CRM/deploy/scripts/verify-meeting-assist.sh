#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ (or pass DEPLOY_ROOT).
# Checks Path B meeting-service + Meet add-on wiring.
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

FRONTEND="$(env_value FRONTEND_ORIGIN)"
PUBLIC_URL="$(env_value MEETING_SERVICE_PUBLIC_URL)"
JWT_SECRET="$(env_value CRM_SERVICE_JWT_SECRET)"
WEBHOOK_SECRET="$(env_value MEETING_SERVICE_WEBHOOK_SECRET)"
BOT_KEY="$(env_value CRM_BOT_API_KEY)"
ADDON_CLIENT_EXPLICIT="$(env_value GOOGLE_ADDON_CLIENT_ID)"
GOOGLE_CLIENT="$(env_value GOOGLE_CLIENT_ID)"
ADDON_CLIENT="${ADDON_CLIENT_EXPLICIT}"
PROJECT_NUMBER="$(env_value GOOGLE_ADDON_CLOUD_PROJECT_NUMBER)"
# OAuth client id prefix should match GOOGLE_ADDON_CLOUD_PROJECT_NUMBER when both set.
VITE_NUMBER="$(env_value VITE_GOOGLE_CLOUD_PROJECT_NUMBER)"
VEXA_KEY="$(env_value VEXA_API_KEY)"
PROVIDER="$(env_value NOTETAKER_PROVIDER)"

if [[ -z "${PUBLIC_URL}" ]]; then
  PUBLIC_URL="${FRONTEND}"
fi
if [[ -z "${ADDON_CLIENT}" ]]; then
  ADDON_CLIENT="${GOOGLE_CLIENT}"
  echo "WARN: GOOGLE_ADDON_CLIENT_ID unset — compose falls back to GOOGLE_CLIENT_ID (Meet origin_mismatch risk)."
fi
if [[ -z "${PROJECT_NUMBER}" ]]; then
  PROJECT_NUMBER="${VITE_NUMBER}"
fi

echo "=== Path B Meet add-on config (.env) ==="
echo "NOTETAKER_PROVIDER=${PROVIDER:-<empty>}"
echo "MEETING_SERVICE_PUBLIC_URL=${PUBLIC_URL:-<empty>}"
echo "CRM_SERVICE_JWT_SECRET=$([[ -n "${JWT_SECRET}" ]] && echo '<set>' || echo '<empty>')"
echo "MEETING_SERVICE_WEBHOOK_SECRET=$([[ -n "${WEBHOOK_SECRET}" ]] && echo '<set>' || echo '<empty>')"
echo "CRM_BOT_API_KEY=$([[ -n "${BOT_KEY}" ]] && echo '<set>' || echo '<empty>')"
if [[ -n "${ADDON_CLIENT_EXPLICIT}" ]]; then
  echo "GOOGLE_ADDON_CLIENT_ID=${ADDON_CLIENT_EXPLICIT}"
else
  echo "GOOGLE_ADDON_CLIENT_ID=<empty>"
fi
echo "GOOGLE_ADDON_CLOUD_PROJECT_NUMBER=${PROJECT_NUMBER:-<empty>}"
echo "VEXA_API_KEY=$([[ -n "${VEXA_KEY}" ]] && echo '<set>' || echo '<empty>')"
echo "Expected sidePanelUrl: ${PUBLIC_URL%/}/addons/meet/"

missing=0
if [[ -z "${JWT_SECRET}" ]]; then
  echo "ERROR: CRM_SERVICE_JWT_SECRET is empty."
  missing=1
fi
if [[ -z "${WEBHOOK_SECRET}" ]]; then
  echo "ERROR: MEETING_SERVICE_WEBHOOK_SECRET is empty."
  missing=1
fi
if [[ -z "${BOT_KEY}" ]]; then
  echo "ERROR: CRM_BOT_API_KEY is empty."
  missing=1
fi
if [[ -z "${ADDON_CLIENT_EXPLICIT}" ]]; then
  echo "ERROR: Set GOOGLE_ADDON_CLIENT_ID (or ACCOUNTS_GOOGLE_CLIENT_ID) — editable Web client with JS origin = FRONTEND_ORIGIN."
  missing=1
fi
if [[ -n "${ADDON_CLIENT_EXPLICIT}" && "${ADDON_CLIENT_EXPLICIT}" == *4p9g* ]]; then
  echo "WARN: …4p9g… Marketplace client cannot add JS origins — use ACCOUNTS_GOOGLE / Web client 1 instead."
fi
if [[ -z "${PROJECT_NUMBER}" ]]; then
  echo "ERROR: GOOGLE_ADDON_CLOUD_PROJECT_NUMBER (or VITE_GOOGLE_CLOUD_PROJECT_NUMBER) is empty."
  missing=1
fi
if [[ -z "${PUBLIC_URL}" || "${PUBLIC_URL}" != https://* ]]; then
  echo "ERROR: MEETING_SERVICE_PUBLIC_URL / FRONTEND_ORIGIN must be public HTTPS (Meet will not load http)."
  missing=1
fi
if [[ "${PROVIDER}" == "vexa" && -z "${VEXA_KEY}" ]]; then
  echo "ERROR: VEXA_API_KEY is empty — Worktual Notetaker will not join. Run: bash scripts/verify-vexa-notetaker.sh"
  missing=1
fi
if [[ "${missing}" -ne 0 ]]; then
  echo "Fill deploy/.env from deploy/.env.example Path B section, then recreate api + meeting-service."
  exit 1
fi

echo ""
echo "=== meeting-service /healthz ==="
if ! "${COMPOSE[@]}" exec -T meeting-service curl -fsS http://127.0.0.1:8030/healthz >/tmp/meeting-healthz.json; then
  echo "ERROR: meeting-service is not healthy."
  "${COMPOSE[@]}" ps meeting-service || true
  exit 1
fi
echo "OK $(cat /tmp/meeting-healthz.json)"

echo ""
echo "=== meeting-service direct (host :8030) ==="
DIRECT_CODE="$(curl -sS -o /tmp/meet-direct-config.json -w '%{http_code}' http://127.0.0.1:8030/addons/meet/config 2>/dev/null || echo "000")"
if [[ "${DIRECT_CODE}" != "200" ]]; then
  echo "ERROR: GET http://127.0.0.1:8030/addons/meet/config returned HTTP ${DIRECT_CODE}"
  echo "       Check: docker compose ps meeting-service && docker compose logs meeting-service --tail 40"
  exit 1
fi
echo "OK $(cat /tmp/meet-direct-config.json)"

echo ""
echo "=== web → meeting-service (docker network) ==="
if ! "${COMPOSE[@]}" exec -T web curl -fsS http://meeting-service:8030/healthz >/dev/null 2>&1; then
  echo "ERROR: web container cannot reach http://meeting-service:8030 — recreate web + meeting-service on same compose network."
  exit 1
fi
echo "OK web → meeting-service:8030"

echo ""
echo "=== Add-on via CRM nginx (localhost:5173) ==="
ADDON_CODE="$(curl -sS -o /tmp/meet-addon.html -w '%{http_code}' http://127.0.0.1:5173/addons/meet/ || true)"
if [[ "${ADDON_CODE}" != "200" ]]; then
  echo "ERROR: GET /addons/meet/ via web nginx returned HTTP ${ADDON_CODE}"
  head -c 400 /tmp/meet-addon.html 2>/dev/null || true
  echo ""
  exit 1
fi
if ! grep -q "Worktual Assist" /tmp/meet-addon.html; then
  echo "ERROR: add-on HTML is missing Worktual Assist"
  exit 1
fi
echo "OK add-on HTML"

CFG_CODE="$(curl -sS -o /tmp/meet-addon-config.json -w '%{http_code}' http://127.0.0.1:5173/addons/meet/config || true)"
if [[ "${CFG_CODE}" != "200" ]]; then
  echo "ERROR: GET /addons/meet/config returned HTTP ${CFG_CODE}"
  exit 1
fi
echo "OK $(cat /tmp/meet-addon-config.json)"

LIVE_CLIENT="$(python3 -c "import json; print(json.load(open('/tmp/meet-addon-config.json')).get('google_client_id',''))" 2>/dev/null || true)"
if [[ -z "${LIVE_CLIENT}" ]]; then
  echo "ERROR: could not read google_client_id from /addons/meet/config"
  exit 1
fi
if [[ -n "${ADDON_CLIENT_EXPLICIT}" && "${LIVE_CLIENT}" != "${ADDON_CLIENT_EXPLICIT}" ]]; then
  echo "ERROR: running meeting-service advertises ${LIVE_CLIENT}"
  echo "       but deploy/.env GOOGLE_ADDON_CLIENT_ID=${ADDON_CLIENT_EXPLICIT}"
  echo "       Recreate meeting-service: docker compose --env-file .env up -d --force-recreate meeting-service"
  exit 1
fi
if [[ "${LIVE_CLIENT}" == "${GOOGLE_CLIENT}" && -n "${GOOGLE_CLIENT}" && "${LIVE_CLIENT}" != "${ADDON_CLIENT_EXPLICIT}" ]]; then
  echo "ERROR: /addons/meet/config returns CRM GOOGLE_CLIENT_ID — set GOOGLE_ADDON_CLIENT_ID and recreate meeting-service."
  exit 1
fi
if [[ "${LIVE_CLIENT}" == *672189196887* ]]; then
  echo "ERROR: config still uses Gmail/CRM OAuth client (672189…). Set GOOGLE_ADDON_CLIENT_ID to Marketplace …4p9g… and recreate meeting-service."
  exit 1
fi

echo ""
echo "Path B add-on looks reachable."
echo "In Google Cloud HTTP deployment, paste:"
echo "  sidePanelUrl: ${PUBLIC_URL%/}/addons/meet/"
echo "  addOnOrigins: ${PUBLIC_URL}"
echo "Then Meet → Activities → Worktual Assist."
