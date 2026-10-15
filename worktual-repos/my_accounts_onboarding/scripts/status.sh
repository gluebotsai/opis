#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"
BACKEND_PORT="${BACKEND_PORT:-8000}"

echo "=== Systemd ==="
# shellcheck disable=SC1091
source "$SCRIPT_DIR/service-lib.sh" 2>/dev/null || true
if declare -f systemd_units_installed >/dev/null 2>&1 && systemd_units_installed; then
  status_app_services || true
else
  echo "Systemd units not installed. Run: ./scripts/install-systemd.sh"
fi

echo ""
echo "=== Ports ==="
ss -ltn 2>/dev/null | grep -E ":${MAIL_API_PORT}|:${FRONTEND_PORT}|:${BACKEND_PORT}" || echo "(none listening)"

echo ""
echo "=== Deployment ==="
if [[ -L "$DEPLOY_ROOT/current" ]]; then
  echo "current → $(readlink -f "$DEPLOY_ROOT/current")"
else
  echo "current: not found"
fi

echo ""
echo "=== Quick health ==="
curl -fsS --max-time 3 "http://127.0.0.1:${MAIL_API_PORT}/api/payments/config" >/dev/null \
  && echo "mail-api: OK" || echo "mail-api: FAIL"
if [[ "${SERVE_FRONTEND_ON_MAIL_API:-true}" == "true" ]]; then
  curl -fsS --max-time 3 "http://127.0.0.1:${MAIL_API_PORT}/" >/dev/null \
    && echo "app (SPA+API on ${MAIL_API_PORT}): OK" || echo "app (SPA+API on ${MAIL_API_PORT}): FAIL"
else
  curl -fsS --max-time 3 "http://127.0.0.1:${FRONTEND_PORT}/" >/dev/null \
    && echo "frontend: OK" || echo "frontend: FAIL"
fi
