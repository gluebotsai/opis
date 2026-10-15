#!/usr/bin/env bash
# Local Path B smoke: CRM Vite + meeting-service on this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

MS_URL="${MEETING_SERVICE_URL:-}"
if [[ -z "$MS_URL" && -f "$ROOT/.env" ]]; then
  MS_URL="$(grep -E '^MEETING_SERVICE_URL=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true)"
fi
MS_URL="${MS_URL:-http://127.0.0.1:8030}"
MS_PORT="${MS_URL##*:}"
MS_PORT="${MS_PORT%%/*}"

check() {
  local name="$1"
  local url="$2"
  local expect="$3"
  local code
  code="$(curl -sS -o /tmp/ms-local-body -w '%{http_code}' "$url" || true)"
  if [[ "$code" != "200" ]]; then
    echo "FAIL $name HTTP $code  $url"
    fail=1
    return
  fi
  if [[ -n "$expect" ]] && ! grep -q "$expect" /tmp/ms-local-body; then
    echo "FAIL $name missing '$expect'  $url"
    fail=1
    return
  fi
  echo "OK   $name"
}

echo "=== meeting-service :${MS_PORT} (MEETING_SERVICE_URL) ==="
check "healthz" "${MS_URL%/}/healthz" '"status"'
check "add-on HTML" "${MS_URL%/}/addons/meet/" "Worktual Assist"
check "add-on config" "${MS_URL%/}/addons/meet/config" "google_client_id"

echo ""
echo "=== Vite proxy :5173 (same paths as production nginx) ==="
check "proxied add-on" "http://127.0.0.1:5173/addons/meet/" "Worktual Assist"
check "proxied config" "http://127.0.0.1:5173/addons/meet/config" "google_client_id"

if grep -q '"google_client_id":""' /tmp/ms-local-body 2>/dev/null; then
  echo "FAIL add-on config has empty google_client_id"
  fail=1
fi

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "Local add-on is not ready. Path B uses :8050 (not default :8030):"
  echo "  $ROOT/scripts/up-meeting-docker-local.sh"
  echo "  # root .env: MEETING_SERVICE_URL=http://127.0.0.1:8050"
  echo "  $ROOT/scripts/down-dev.sh && $ROOT/scripts/up-dev.sh"
  echo "  $ROOT/scripts/verify-meeting-assist-local.sh"
  echo ""
  echo "Default local Docker (:8030, no QA tunnel):  $ROOT/scripts/up-meeting-docker.sh"
  exit 1
fi

echo "Local Path B smoke passed."
echo "Open http://127.0.0.1:5173/addons/meet/  (Sign in with Google — same email as a CRM user)"
echo "Inside a real Meet, Google needs HTTPS — use ngrok after this smoke is green."
