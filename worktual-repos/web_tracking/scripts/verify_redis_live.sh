#!/usr/bin/env bash
# Test Redis reachability for Web Tracking live presence (run on app server, e.g. nlp-crm).
# Usage:
#   bash scripts/verify_redis_live.sh
#   REDIS_URL='redis://:pass@82.113.92.44:6379' bash scripts/verify_redis_live.sh
#   bash scripts/verify_redis_live.sh 82.113.92.44
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
fi

HOST="${1:-}"
PORT="6379"
PASS=""

if [[ -n "${REDIS_URL:-}" ]]; then
  # redis://[:password@]host:port[/db]
  REST="${REDIS_URL#redis://}"
  if [[ "$REST" == *"@"* ]]; then
    PASS="${REST%%@*}"
    PASS="${PASS#:}"
    REST="${REST#*@}"
  fi
  HOST_PORT="${REST%%/*}"
  HOST="${HOST:-${HOST_PORT%%:*}}"
  PORT="${HOST_PORT##*:}"
  [[ "$PORT" == "$HOST" ]] && PORT="6379"
fi

HOST="${HOST:-82.113.92.44}"

echo "Testing Redis at ${HOST}:${PORT} (from app server: $(hostname -f 2>/dev/null || hostname))"

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "Install redis-tools: sudo apt install -y redis-tools" >&2
  exit 1
fi

if [[ -n "$PASS" ]]; then
  OUT="$(redis-cli -h "$HOST" -p "$PORT" -a "$PASS" ping 2>&1)" || true
else
  OUT="$(redis-cli -h "$HOST" -p "$PORT" ping 2>&1)" || true
fi

echo "$OUT"

if [[ "$OUT" != *PONG* ]]; then
  echo ""
  echo "FAIL — fix Redis host/firewall/bind before setting REDIS_URL in .env."
  echo "See docs/REDIS_LIVE_PRESENCE.md (Remote Redis + DevOps checklist)."
  exit 1
fi

echo "OK — set REDIS_URL in .env and restart ingest + api-node."
if [[ -n "$PASS" ]]; then
  echo "Sample keys after site traffic:"
  redis-cli -h "$HOST" -p "$PORT" -a "$PASS" KEYS 'wt:live:*' 2>/dev/null | head -20 || true
fi
