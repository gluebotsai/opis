#!/usr/bin/env bash
# Stable proactive-agent E2E: restart dev stack, wait for health, run both suites.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WAIT_SEC="${E2E_BOOT_WAIT_SEC:-25}"

cd "$ROOT"
./scripts/up-dev.sh
sleep "$WAIT_SEC"

for i in $(seq 1 24); do
  ai="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health 2>/dev/null || echo 0)"
  api="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/health 2>/dev/null || echo 0)"
  if [[ "$ai" == "200" && "$api" == "200" ]]; then
    break
  fi
  sleep 5
done

curl -sf http://127.0.0.1:8000/health >/dev/null
curl -sf http://127.0.0.1:4000/health >/dev/null

echo "=== e2e-proactive-agents ==="
cd "$ROOT/backend"
npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/e2e-proactive-agents.ts

echo
echo "=== demo-readiness-e2e ==="
npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/demo-readiness-e2e.ts

echo
echo "All agent E2E suites passed."
