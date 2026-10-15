#!/usr/bin/env bash
# Run ON THE QA SERVER from deploy/ (or pass DEPLOY_ROOT).
# Checks LLM env inside ai-orchestrator and performs a tiny completion.
set -euo pipefail

ROOT="${DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

COMPOSE=(docker compose --env-file .env)
if [[ -f .env.images ]]; then
  COMPOSE+=(--env-file .env.images)
fi

env_value() {
  local key="$1"
  local raw
  raw="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

MODEL="$(env_value LLM_MODEL)"
BASE="$(env_value LLM_BASE_URL)"

echo "=== LLM config (.env) ==="
echo "LLM_MODEL=${MODEL:-<empty>}"
echo "LLM_BASE_URL=${BASE:-<empty>}"

if [[ -z "${MODEL}" || -z "${BASE}" ]]; then
  echo "ERROR: Set LLM_MODEL and LLM_BASE_URL in $ROOT/.env"
  echo "  LLM_MODEL=worktual-qwen-27B"
  echo "  LLM_BASE_URL=http://81.17.61.149:8066/v1"
  exit 1
fi

echo ""
echo "=== ai-orchestrator env (runtime) ==="
"${COMPOSE[@]}" exec -T ai-orchestrator python - <<'PY'
from app.config import get_settings
s = get_settings()
print(f"llm_model={s.llm_model}")
print(f"llm_base_url={s.llm_base_url}")
PY

echo ""
echo "=== LLM completion probe ==="
if ! "${COMPOSE[@]}" exec -T ai-orchestrator python - <<'PY'
import sys
from openai import OpenAI
from app.config import get_settings

s = get_settings()
base = s.llm_base_url.strip().rstrip("/")
model = s.llm_model.strip()
if not base or not model:
    print("ERROR: llm_model or llm_base_url empty inside container")
    sys.exit(1)

client = OpenAI(api_key=(s.llm_api_key.strip() or "EMPTY"), base_url=base)
try:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Reply with JSON only."},
            {"role": "user", "content": '{"ping":true}'},
        ],
        max_tokens=64,
        temperature=0,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    content = (resp.choices[0].message.content or "").strip()
    if not content:
        print("ERROR: LLM returned empty content")
        sys.exit(1)
    print(f"OK model={model} content_len={len(content)}")
    print(content[:200])
except Exception as exc:
    print(f"ERROR: LLM call failed: {exc}")
    sys.exit(1)
PY
then
  echo ""
  echo "LLM probe FAILED — chat and proposal patterns will not work."
  echo "Fix $ROOT/.env then run: bash scripts/patch-llm-env.sh"
  exit 1
fi

echo ""
echo "LLM probe OK."
