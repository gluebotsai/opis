#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ — set Gemini keys for proposal learn/generate.
# Usage:
#   PROPOSAL_LLM_API_KEY='AIza…' bash scripts/patch-proposal-gemini-env.sh
# Or pass the key as the first argument (avoid shell history if you can):
#   bash scripts/patch-proposal-gemini-env.sh 'AIza…'
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/.env.example first."
  exit 1
fi

KEY="${1:-${PROPOSAL_LLM_API_KEY:-}}"
MODEL="${PROPOSAL_LLM_MODEL:-gemini-3.5-flash}"
THINKING="${PROPOSAL_LLM_THINKING_LEVEL:-high}"

if [[ -z "$KEY" || "$KEY" == "EMPTY" ]]; then
  echo "ERROR: pass PROPOSAL_LLM_API_KEY (env or \$1). Refusing to clear an existing key."
  exit 1
fi

upsert_env() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Use | delimiter — API keys never contain it; avoid sed escaping issues.
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

echo "Patching proposal Gemini keys in $ENV_FILE (key length ${#KEY}) ..."
upsert_env PROPOSAL_LLM_API_KEY "$KEY"
upsert_env GEMINI_API_KEY "$KEY"
upsert_env PROPOSAL_LLM_MODEL "$MODEL"
upsert_env PROPOSAL_LLM_THINKING_LEVEL "$THINKING"

COMPOSE=(docker compose --env-file .env)
if [[ -f .env.images ]]; then
  COMPOSE+=(--env-file .env.images)
fi

echo "Recreating ai-orchestrator (proposal extract runs here) ..."
"${COMPOSE[@]}" up -d --force-recreate ai-orchestrator

echo "Waiting for ai-orchestrator health ..."
for _ in $(seq 1 20); do
  if "${COMPOSE[@]}" exec -T ai-orchestrator python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"; then
    break
  fi
  sleep 3
done

echo "Verifying Gemini is configured inside the container ..."
"${COMPOSE[@]}" exec -T ai-orchestrator python -c \
  "from app.services.proposal_gemini import proposal_gemini_configured; \
import sys; ok=proposal_gemini_configured(); print('proposal_gemini_configured', ok); \
sys.exit(0 if ok else 1)"

echo "Done. Retry the failed upload on Configuration → Proposal patterns."
