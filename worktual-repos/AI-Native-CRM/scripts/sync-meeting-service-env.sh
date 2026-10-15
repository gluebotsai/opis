#!/usr/bin/env bash
# Copy Meet add-on + CRM bot keys from root .env into meeting-service/.env (local Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/.env}"
DEST="${2:-$ROOT/meeting-service/.env}"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC"
  exit 1
fi

if [[ ! -f "$DEST" ]]; then
  cp "$ROOT/meeting-service/.env.example" "$DEST"
  echo "Created $DEST from .env.example"
fi

load_key() {
  grep -E "^${1}=" "$SRC" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

set_dest_kv() {
  local key="$1"
  local val="$2"
  if [[ -z "$val" ]]; then
    return
  fi
  local esc="${val//\\/\\\\}"
  esc="${esc//&/\\&}"
  if grep -qE "^${key}=" "$DEST"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$DEST"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$DEST"
  fi
}

for key in \
  GOOGLE_ADDON_CLIENT_ID \
  GOOGLE_ADDON_CLOUD_PROJECT_NUMBER \
  GOOGLE_CLIENT_ID \
  GOOGLE_OAUTH_EXTRA_CLIENT_IDS \
  CRM_BOT_API_KEY \
  CRM_USERS_API_KEY \
  CRM_SERVICE_JWT_SECRET \
  MEETING_SERVICE_WEBHOOK_SECRET \
  WEBHOOK_SECRET; do
  set_dest_kv "$key" "$(load_key "$key")"
done

# Local Docker stack: meeting-service reaches CRM on the host.
if ! grep -qE '^CRM_BOT_BASE_URL=' "$DEST" || grep -qE '^CRM_BOT_BASE_URL=internal' "$DEST"; then
  set_dest_kv "CRM_BOT_BASE_URL" "http://host.docker.internal:4000"
fi
if ! grep -qE '^CRM_USERS_BASE_URL=' "$DEST"; then
  set_dest_kv "CRM_USERS_BASE_URL" "http://host.docker.internal:4000"
fi

rm -f "${DEST}.bak"
echo "Synced Meet add-on env from $SRC → $DEST"
