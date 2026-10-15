#!/usr/bin/env bash
# Register the Debezium PostgreSQL source connector with Kafka Connect.
# Kafka Connect's REST API accepts JSON only -- it does not accept YAML.
set -euo pipefail

if [ -f "$(dirname "$0")/../.env" ]; then set -a; . "$(dirname "$0")/../.env"; set +a; fi

CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"
CONFIG="${1:-$(dirname "$0")/../docker/connectors/postgres-source.json}"

[ -f "${CONFIG}" ] || { echo "config not found: ${CONFIG}" >&2; exit 1; }

# Debezium connects from INSIDE a container, so its address for PostgreSQL is
# not necessarily the consumer's. Full Docker stack: DEBEZIUM_PG_HOST=postgres
# while PG_HOST=localhost. External PostgreSQL: both are the same host.
export DEBEZIUM_PG_HOST="${DEBEZIUM_PG_HOST:-${PG_HOST}}"
export DEBEZIUM_PG_PORT="${DEBEZIUM_PG_PORT:-${PG_PORT:-5432}}"
echo "Debezium will connect to ${DEBEZIUM_PG_HOST}:${DEBEZIUM_PG_PORT}"

: "${PG_USER:?PG_USER must be set}"
: "${PG_PASSWORD:?PG_PASSWORD must be set}"
: "${PG_DATABASE:?PG_DATABASE must be set}"

echo "waiting for Kafka Connect at ${CONNECT_URL}..."
for _ in $(seq 1 60); do
  curl -sf "${CONNECT_URL}/connectors" >/dev/null 2>&1 && break
  sleep 2
done

if command -v envsubst >/dev/null 2>&1; then
  BODY="$(envsubst < "${CONFIG}")"
else
  # envsubst ships with gettext, which is absent on minimal Linux images and on
  # macOS without brew. python3 is already required below, so fall back to it
  # rather than failing with "envsubst: not found" at the last step.
  BODY="$(python3 -c '
import os, re, sys
raw = open(sys.argv[1]).read()
sys.stdout.write(re.sub(r"\$\{(\w+)(?::-([^}]*))?\}",
                        lambda m: os.environ.get(m.group(1), m.group(2) or ""),
                        raw))' "${CONFIG}")"
fi
NAME="$(printf '%s' "${BODY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"

if curl -sf "${CONNECT_URL}/connectors/${NAME}" >/dev/null 2>&1; then
  echo "connector ${NAME} exists; updating config"
  printf '%s' "${BODY}" \
    | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["config"]))' \
    | curl -sS -X PUT -H 'Content-Type: application/json' \
        --data @- "${CONNECT_URL}/connectors/${NAME}/config" | python3 -m json.tool
else
  echo "creating connector ${NAME}"
  printf '%s' "${BODY}" | curl -sS -X POST -H 'Content-Type: application/json' \
    --data @- "${CONNECT_URL}/connectors" | python3 -m json.tool
fi

echo
echo "status:"
sleep 3
curl -sS "${CONNECT_URL}/connectors/${NAME}/status" | python3 -m json.tool
