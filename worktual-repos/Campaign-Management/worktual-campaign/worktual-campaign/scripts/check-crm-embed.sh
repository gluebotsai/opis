#!/usr/bin/env bash
# LAN / prod sanity: HTTP health, agents-socket poll, CRM JWT parity (local .env).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/env-crm-jwt.sh
source "$ROOT/scripts/lib/env-crm-jwt.sh"

HOST="${1:-127.0.0.1}"
FE="http://${HOST}:5173"
API="http://${HOST}:3001"
AGENTS="http://${HOST}:8005"

check_http() {
  local label="$1"
  local url="$2"
  shift 2
  local code
  code="$(curl -sS -m 4 -o /dev/null -w '%{http_code}' "$@" "$url" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ] || [ "$code" = "204" ]; then
    echo "  OK   $label ($code)"
    return 0
  fi
  echo "  FAIL $label ($code) $url"
  return 1
}

fail=0
echo "Campaign CRM embed check — host ${HOST}"
echo
echo "HTTP:"
check_http "frontend" "$FE/" || fail=1
check_http "backend /health" "$API/health" || fail=1
check_http "agents /health" "$AGENTS/health" || fail=1
check_http "agents-socket (via UI proxy)" \
  "$FE/agents-socket/?EIO=4&transport=polling" -H "Origin: $FE" || fail=1

echo
echo "Local env (this repo checkout):"
BE="$ROOT/backend/.env"
AG="$ROOT/agents/.env"
if [ ! -f "$BE" ] || [ ! -f "$AG" ]; then
  echo "  SKIP  backend/.env or agents/.env missing in this tree"
else
  if crm_jwt_secrets_match "$BE" "$AG"; then
    echo "  OK   CRM_JWT_ACCESS_SECRET matches (backend ↔ agents)"
  else
    rc=$?
    if [ "$rc" = "2" ]; then
      echo "  FAIL CRM JWT secret missing in backend and/or agents"
    else
      echo "  FAIL CRM_JWT_ACCESS_SECRET mismatch — run: npm run sync:crm-jwt"
    fi
    fail=1
  fi
  bi="$(env_file_get CRM_JWT_ISSUER "$BE" 2>/dev/null || true)"
  ai="$(env_file_get CRM_JWT_ISSUER "$AG" 2>/dev/null || true)"
  if [ "$bi" != "$ai" ]; then
    echo "  FAIL CRM_JWT_ISSUER mismatch (backend=$bi agents=$ai)"
    fail=1
  else
    echo "  OK   CRM_JWT_ISSUER=${bi:-worktual-crm}"
  fi
fi

echo
echo "Socket auth (CRM-style JWT minted from agents/.env in this repo):"
SMOKE_PY="$ROOT/agents/.venv/bin/python3.14"
[ -x "$SMOKE_PY" ] || SMOKE_PY="$ROOT/agents/.venv/bin/python3"
SMOKE_OUT=""
if SMOKE_OUT="$(cd "$ROOT/agents" && PYTHONPATH=. "$SMOKE_PY" \
  scripts/smoke_crm_socket_connect.py \
  --fe-origin "$FE" \
  --socket-path agents-socket \
  --join 2>&1)"; then
  echo "  OK   CRM JWT connect via $FE/agents-socket"
else
  echo "  FAIL CRM JWT Socket.IO connect"
  echo "       $SMOKE_OUT" | sed 's/^/       /'
  echo "       Fix: npm run sync:crm-jwt && restart agents (:8005) on $HOST"
  fail=1
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All checks passed."
  exit 0
fi
echo "One or more checks failed."
exit 1
