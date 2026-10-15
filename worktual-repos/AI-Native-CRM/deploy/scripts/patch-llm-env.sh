#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ — point all AI containers at Qwen and recreate them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/.env.example first."
  exit 1
fi

# shellcheck source=env-upsert.sh
source "$ROOT/scripts/env-upsert.sh"

LLM_MODEL="${LLM_MODEL:-worktual-qwen-27B}"
LLM_BASE_URL="${LLM_BASE_URL:-http://81.17.61.149:8066/v1}"
LLM_API_KEY="${LLM_API_KEY:-EMPTY}"

echo "Patching LLM + corpus storage in $ENV_FILE ..."
echo "  LLM_MODEL=${LLM_MODEL}"
echo "  LLM_BASE_URL=${LLM_BASE_URL}"
upsert_env LLM_API_KEY "${LLM_API_KEY}"
upsert_env LLM_MODEL "${LLM_MODEL}"
upsert_env LLM_BASE_URL "${LLM_BASE_URL}"
upsert_env CORPUS_STORAGE_DIR /app/backend/data/proposal-corpus

COMPOSE=(docker compose --env-file .env)
if [[ -f .env.images ]]; then
  COMPOSE+=(--env-file .env.images)
fi

echo "Recreating ai-orchestrator, ai-mcp, ai-a2a ..."
"${COMPOSE[@]}" up -d --force-recreate ai-orchestrator ai-mcp ai-a2a

echo "Waiting for ai-orchestrator health ..."
for _ in $(seq 1 20); do
  if "${COMPOSE[@]}" exec -T ai-orchestrator python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"; then
    break
  fi
  sleep 3
done

DEPLOY_ROOT="$ROOT" bash "$ROOT/scripts/verify-llm.sh"
