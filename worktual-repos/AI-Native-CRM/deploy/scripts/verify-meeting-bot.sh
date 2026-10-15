#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ (or pass DEPLOY_ROOT).
# Checks Recall meeting-capture env and probes the Recall API token.
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

API_KEY="$(env_value MEETING_BOT_API_KEY)"
WEBHOOK_BASE="$(env_value MEETING_BOT_WEBHOOK_BASE_URL)"
RECALL_BASE="$(env_value MEETING_BOT_API_BASE_URL)"
PUBLIC_API="$(env_value CRM_API_PUBLIC_URL)"
OAUTH_ORIGIN="$(env_value OAUTH_CALLBACK_ORIGIN)"

if [[ -z "${RECALL_BASE}" ]]; then
  RECALL_BASE="https://us-east-1.recall.ai/api/v1"
fi
if [[ -z "${WEBHOOK_BASE}" && -n "${PUBLIC_API}" ]]; then
  WEBHOOK_BASE="${PUBLIC_API}"
fi
if [[ -z "${WEBHOOK_BASE}" && -n "${OAUTH_ORIGIN}" ]]; then
  WEBHOOK_BASE="${OAUTH_ORIGIN}"
fi

echo "=== Meeting capture config (.env) ==="
echo "MEETING_BOT_API_KEY=$([[ -n "${API_KEY}" ]] && echo '<set>' || echo '<empty>')"
echo "MEETING_BOT_WEBHOOK_BASE_URL=${WEBHOOK_BASE:-<empty>}"
echo "MEETING_BOT_API_BASE_URL=${RECALL_BASE}"
echo "Expected webhook: ${WEBHOOK_BASE%/}/api/webhooks/meeting-bot/recall"

if [[ -z "${API_KEY}" ]]; then
  echo ""
  echo "ERROR: MEETING_BOT_API_KEY is not set in $ROOT/.env"
  echo "  1) Create a Recall.ai API token (Worktual ops)"
  echo "  2) Add to deploy/.env:"
  echo "     MEETING_BOT_API_KEY=<recall-token>"
  echo "     MEETING_BOT_WEBHOOK_BASE_URL=https://rebuild-crm-api.worktual.com"
  echo "  3) In Recall dashboard, subscribe webhook POST /api/webhooks/meeting-bot/recall"
  echo "  4) docker compose up -d --force-recreate api worker scheduler"
  echo "  5) Redispatch capture for existing meetings:"
  echo "     docker compose run --rm --no-deps api npx tsx scripts/redispatch-meeting-capture.ts <activityId>"
  exit 1
fi

if [[ -z "${WEBHOOK_BASE}" ]]; then
  echo ""
  echo "ERROR: MEETING_BOT_WEBHOOK_BASE_URL (or CRM_API_PUBLIC_URL) is not set."
  echo "  Set MEETING_BOT_WEBHOOK_BASE_URL=https://rebuild-crm-api.worktual.com"
  exit 1
fi

if [[ "${WEBHOOK_BASE}" != https://* ]]; then
  echo ""
  echo "WARN: MEETING_BOT_WEBHOOK_BASE_URL should be public HTTPS (Recall cannot reach http://127.0.0.1)."
fi

echo ""
echo "=== API container env (runtime) ==="
"${COMPOSE[@]}" exec -T api node - <<'NODE'
const keys = [
  "MEETING_BOT_API_KEY",
  "MEETING_BOT_WEBHOOK_BASE_URL",
  "MEETING_BOT_API_BASE_URL",
  "MEETING_CAPTURE_BOT_ENABLED",
];
for (const k of keys) {
  const v = process.env[k];
  console.log(`${k}=${k.includes("KEY") ? (v ? "<set>" : "<empty>") : (v || "<empty>")}`);
}
NODE

echo ""
echo "=== Recall API token probe ==="
HTTP_CODE="$(curl -sS -o /tmp/recall-probe.json -w '%{http_code}' \
  -H "Authorization: Token ${API_KEY}" \
  -H "Accept: application/json" \
  "${RECALL_BASE%/}/bot/?limit=1")"

if [[ "${HTTP_CODE}" == "401" || "${HTTP_CODE}" == "403" ]]; then
  echo "ERROR: Recall rejected the API token (HTTP ${HTTP_CODE})"
  head -c 400 /tmp/recall-probe.json 2>/dev/null || true
  echo ""
  exit 1
fi

if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "WARN: Recall probe returned HTTP ${HTTP_CODE} (check MEETING_BOT_API_BASE_URL region)"
  head -c 400 /tmp/recall-probe.json 2>/dev/null || true
  echo ""
else
  echo "OK Recall token accepted (HTTP 200)"
fi

echo ""
echo "Meeting capture config looks usable."
echo "After fixing env, redispatch failed meetings with:"
echo "  docker compose run --rm --no-deps api npx tsx scripts/redispatch-meeting-capture.ts <activityId>"
