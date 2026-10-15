#!/usr/bin/env bash
# Reload in-memory caches on a running Context Layer API (no process restart).
set -euo pipefail
BASE="${CONTEXT_API:-http://127.0.0.1:8765}"
SECRET="${CONTEXT_RELOAD_SECRET:?Set CONTEXT_RELOAD_SECRET in env or .env}"
curl -sS -X POST "${BASE}/v1/admin/reload" \
  -H "X-Reload-Secret: ${SECRET}" \
  -H "Content-Type: application/json"
echo
