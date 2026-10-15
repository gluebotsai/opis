#!/usr/bin/env bash
# Copy CRM JWT verifier settings from backend/.env → agents/.env (CRM embed chat).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/env-crm-jwt.sh
source "$ROOT/scripts/lib/env-crm-jwt.sh"

BACKEND_ENV="${BACKEND_ENV:-$ROOT/backend/.env}"
AGENTS_ENV="${AGENTS_ENV:-$ROOT/agents/.env}"

if [ ! -f "$BACKEND_ENV" ]; then
  echo "Missing $BACKEND_ENV — set CRM_JWT_* on backend first." >&2
  exit 1
fi

SECRET="$(backend_crm_jwt_secret "$BACKEND_ENV")"
if [ -z "$SECRET" ]; then
  echo "No CRM_JWT_ACCESS_SECRET (or JWT_ACCESS_SECRET) in $BACKEND_ENV." >&2
  echo "CRM embed chat will reject Socket.IO connect until this is set." >&2
  exit 1
fi

ISSUER="$(env_file_get CRM_JWT_ISSUER "$BACKEND_ENV" 2>/dev/null || echo worktual-crm)"
CLAIM="$(env_file_get CRM_JWT_USER_ID_CLAIM "$BACKEND_ENV" 2>/dev/null || echo sub)"
ALGO="$(env_file_get CRM_JWT_ALGORITHM "$BACKEND_ENV" 2>/dev/null || echo HS256)"

touch "$AGENTS_ENV"
tmp="$(mktemp)"
grep -v -E '^(CRM_JWT_ACCESS_SECRET|CRM_JWT_ISSUER|CRM_JWT_USER_ID_CLAIM|CRM_JWT_ALGORITHM|JWT_ACCESS_SECRET)=' \
  "$AGENTS_ENV" > "$tmp" || true
{
  cat "$tmp"
  echo "CRM_JWT_ACCESS_SECRET=${SECRET}"
  echo "CRM_JWT_ISSUER=${ISSUER}"
  echo "CRM_JWT_USER_ID_CLAIM=${CLAIM}"
  echo "CRM_JWT_ALGORITHM=${ALGO}"
} > "$AGENTS_ENV"
rm -f "$tmp"

echo "Synced CRM JWT settings from backend → agents ($AGENTS_ENV)."
echo "Restart agents (:8005) if it is already running."
