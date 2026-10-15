#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker/docker-compose.yml"

usage() {
  cat <<EOF
Start local Docker infrastructure for development.

Usage:
  $(basename "$0")              Start redis + kafka (default)
  $(basename "$0") --all        Start postgres + redis + kafka
  $(basename "$0") <service...> Start specific services

Then run app services on the host:
  npm run dev
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--all" ]]; then
  SERVICES=(postgres redis kafka)
elif [[ $# -gt 0 ]]; then
  SERVICES=("$@")
else
  SERVICES=(redis kafka)
fi

cd "$ROOT"
docker compose -f "$COMPOSE_FILE" up -d "${SERVICES[@]}"
docker compose -f "$COMPOSE_FILE" ps
