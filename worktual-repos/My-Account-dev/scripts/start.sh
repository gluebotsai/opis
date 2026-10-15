#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/service-lib.sh"

[[ -L "$DEPLOY_ROOT/current" ]] || {
  echo "ERROR: No deployment at ${DEPLOY_ROOT}/current. Run ./scripts/deploy.sh first." >&2
  exit 1
}

mkdir -p "$DEPLOY_ROOT/logs"
restart_app_services "$SCRIPT_DIR/install-systemd.sh"
"$SCRIPT_DIR/status.sh"

echo "Services restarted via systemd"
if [[ "${SERVE_FRONTEND_ON_MAIL_API:-true}" == "true" ]]; then
  echo "App (SPA + API): http://localhost:${MAIL_API_PORT}"
else
  echo "Frontend: http://localhost:${FRONTEND_PORT}"
  echo "Mail API:  http://localhost:${MAIL_API_PORT}"
fi
