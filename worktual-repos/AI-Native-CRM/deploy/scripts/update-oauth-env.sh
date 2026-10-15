#!/usr/bin/env bash
# Patch OAuth keys in deploy/.env on the QA server (secrets via env vars — never commit).
#
# Usage on server:
#   cd /path/to/deploy
#   export GOOGLE_CLIENT_ID='...'
#   export GOOGLE_CLIENT_SECRET='...'
#   export MICROSOFT_CLIENT_ID='...'
#   export MICROSOFT_CLIENT_SECRET='...'
#   bash scripts/update-oauth-env.sh
#   docker compose --env-file .env up -d api scheduler worker
#
# Optional overrides:
#   DEPLOY_ENV_FILE=.env  MICROSOFT_MAIL_TENANT=7187d92d-...

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/.env.example first."
  exit 1
fi

set_kv() {
  local key="$1"
  local val="$2"
  if [[ -z "$val" ]]; then
    echo "Skip empty $key"
    return
  fi
  # Escape for sed replacement
  local esc="${val//\\/\\\\}"
  esc="${esc//&/\\&}"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
  echo "Set $key"
}

# Required — pass via export before running
set_kv GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
set_kv GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
set_kv GOOGLE_ADDON_CLIENT_ID "${GOOGLE_ADDON_CLIENT_ID:-}"
set_kv GOOGLE_ADDON_CLOUD_PROJECT_NUMBER "${GOOGLE_ADDON_CLOUD_PROJECT_NUMBER:-714138144506}"
set_kv MICROSOFT_CLIENT_ID "${MICROSOFT_CLIENT_ID:-}"
set_kv MICROSOFT_CLIENT_SECRET "${MICROSOFT_CLIENT_SECRET:-}"

# QA defaults (override with env if needed)
set_kv FRONTEND_ORIGIN "${FRONTEND_ORIGIN:-https://rebuild-crm.worktual.com}"
set_kv NEXT_PUBLIC_APP_URL "${NEXT_PUBLIC_APP_URL:-https://rebuild-crm.worktual.com}"
set_kv OAUTH_CALLBACK_ORIGIN "${OAUTH_CALLBACK_ORIGIN:-https://rebuild-crm-api.worktual.com}"
set_kv GOOGLE_REDIRECT_URI "${GOOGLE_REDIRECT_URI:-https://rebuild-crm-api.worktual.com/api/google/oauth/callback}"
set_kv MICROSOFT_REDIRECT_URI "${MICROSOFT_REDIRECT_URI:-https://rebuild-crm-api.worktual.com/api/microsoft/oauth/callback}"
set_kv MEETING_SERVICE_PUBLIC_URL "${MEETING_SERVICE_PUBLIC_URL:-https://rebuild-crm.worktual.com}"
set_kv MICROSOFT_TENANT_ID "${MICROSOFT_TENANT_ID:-7187d92d-dcd9-4b36-9a5e-d30a0da3ccd1}"
set_kv MICROSOFT_MAIL_TENANT "${MICROSOFT_MAIL_TENANT:-7187d92d-dcd9-4b36-9a5e-d30a0da3ccd1}"

rm -f "${ENV_FILE}.bak"
echo "Done. Restart API: docker compose --env-file .env up -d api scheduler worker"
