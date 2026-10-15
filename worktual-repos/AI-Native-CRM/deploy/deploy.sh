#!/usr/bin/env bash
# Run on the QA server after images are in GHCR. Invoked by GitHub Actions over SSH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

: "${IMAGE_REGISTRY:?IMAGE_REGISTRY is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env — copy deploy/.env.example to this path on the server and fill secrets."
  exit 1
fi

# Campaign Marketing embed — fail fast if QA .env is missing required keys.
env_value() {
  local key="$1"
  # last matching assignment; strip optional quotes
  local raw
  raw="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

missing_campaign=0
CAMPAIGN_UI_URL_VAL="$(env_value CAMPAIGN_UI_URL)"
MARKETING_MS_URL_VAL="$(env_value MARKETING_MS_URL)"
JWT_ACCESS_SECRET_VAL="$(env_value JWT_ACCESS_SECRET)"
CRM_JWT_ISSUER_VAL="$(env_value CRM_JWT_ISSUER)"

if [[ -z "${CAMPAIGN_UI_URL_VAL}" ]]; then
  echo "ERROR: CAMPAIGN_UI_URL is empty in $ROOT/.env (set https://rebuild-campaign.worktual.com)."
  missing_campaign=1
fi
if [[ -z "${MARKETING_MS_URL_VAL}" ]]; then
  echo "ERROR: MARKETING_MS_URL is empty in $ROOT/.env (set https://rebuild-campaign.worktual.com)."
  missing_campaign=1
fi
if [[ -z "${JWT_ACCESS_SECRET_VAL}" ]]; then
  echo "ERROR: JWT_ACCESS_SECRET is empty in $ROOT/.env (must match Campaign CRM_JWT_ACCESS_SECRET)."
  missing_campaign=1
fi
if [[ "${missing_campaign}" -ne 0 ]]; then
  echo "Fill Campaign embed vars in deploy/.env (see deploy/.env.example), then re-run deploy."
  exit 1
fi

LLM_MODEL_VAL="$(env_value LLM_MODEL)"
LLM_BASE_URL_VAL="$(env_value LLM_BASE_URL)"
if [[ -z "${LLM_MODEL_VAL}" || -z "${LLM_BASE_URL_VAL}" ]]; then
  echo "ERROR: LLM_MODEL and LLM_BASE_URL must be set in $ROOT/.env"
  echo "  Recommended (Qwen): LLM_MODEL=worktual-qwen-27B LLM_BASE_URL=http://81.17.61.149:8066/v1"
  echo "  Or run: bash scripts/patch-llm-env.sh"
  exit 1
fi
echo "LLM: model=${LLM_MODEL_VAL} base=${LLM_BASE_URL_VAL}"

echo "Campaign embed: UI=${CAMPAIGN_UI_URL_VAL} API=${MARKETING_MS_URL_VAL} issuer=${CRM_JWT_ISSUER_VAL:-worktual-crm}"

cat > .env.images <<EOF
IMAGE_REGISTRY=${IMAGE_REGISTRY}
IMAGE_TAG=${IMAGE_TAG}
EOF

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-github}" --password-stdin
fi

echo "Pulling ${IMAGE_REGISTRY}/{web,api,ai,meeting,whisper-adapter}:${IMAGE_TAG}"
docker compose --env-file .env --env-file .env.images pull

if [[ "${RUN_MIGRATIONS:-true}" == "true" ]]; then
  echo "Running prisma migrate deploy"
  docker compose --env-file .env --env-file .env.images run --rm --no-deps --workdir /app api \
    npx prisma migrate deploy --schema=prisma/schema.prisma
fi

# A standalone vexa-lite (from deploy/scripts/up-vexa-lite-server.sh) uses the
# same container name. Replace it so this stack owns the notetaker.
if docker inspect vexa-lite >/dev/null 2>&1; then
  vexa_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' vexa-lite 2>/dev/null || true)"
  if [[ "$vexa_project" != "worktual-crm" ]]; then
    echo "Removing standalone vexa-lite so Compose can start it on the CRM network."
    docker rm -f vexa-lite >/dev/null
  fi
fi

docker compose --env-file .env --env-file .env.images up -d --remove-orphans

# Same live path as local: patch Meet audio into meeting-service, then point
# CRM at this Vexa and store the minted API key. Customer and internal assist
# both need that transcript.
echo "Wiring Vexa live PCM for meeting assist..."
for _ in $(seq 1 40); do
  vexa_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' vexa-lite 2>/dev/null || true)"
  if [[ "$vexa_health" == "healthy" ]]; then
    break
  fi
  sleep 5
done
PATCH="$ROOT/meeting-service/scripts/patch-vexa-live-pcm.sh"
if [[ ! -x "$PATCH" ]]; then
  echo "ERROR: $PATCH missing — Meet audio will not reach assist" >&2
  exit 1
fi
CRM_BOT_KEY="$(env_value CRM_BOT_API_KEY)"
if [[ -z "$CRM_BOT_KEY" ]]; then
  echo "ERROR: CRM_BOT_API_KEY is empty — live audio will fail bot auth" >&2
  exit 1
fi
VEXA_CONTAINER=vexa-lite CRM_BOT_API_KEY="${CRM_BOT_KEY}" bash "$PATCH"

# shellcheck disable=SC1091
source "$ROOT/scripts/env-upsert.sh"
ENV_FILE="$ROOT/.env"
upsert_env VEXA_API_BASE "http://vexa-lite:8056"
VEXA_KEY="$(docker exec vexa-lite sh -c 'grep -E "^VEXA_API_KEY=" /run/vexa/key.env 2>/dev/null | head -1 | cut -d= -f2-' || true)"
if [[ -n "$VEXA_KEY" ]]; then
  upsert_env VEXA_API_KEY "$VEXA_KEY"
  echo "VEXA_API_KEY synced from vexa-lite"
else
  echo "WARNING: vexa-lite has no /run/vexa/key.env yet — notetaker cannot join until the key is set"
fi
docker compose --env-file .env --env-file .env.images up -d --force-recreate --no-deps meeting-service meeting-worker

# Bots are child processes of vexa-lite. They load dist/*.js at spawn, so a
# notetaker already in a Meet keeps the stock pipeline until this restart.
echo "Restarting vexa-lite so the notetaker loads live PCM."
docker restart vexa-lite >/dev/null
vexa_health="none"
for _ in $(seq 1 40); do
  vexa_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' vexa-lite 2>/dev/null || true)"
  if [[ "$vexa_health" == "healthy" ]]; then
    break
  fi
  sleep 5
done
if [[ "$vexa_health" != "healthy" ]]; then
  echo "ERROR: vexa-lite did not become healthy after the live-PCM restart" >&2
  exit 1
fi

echo "Waiting for API health..."
for i in $(seq 1 30); do
  if docker compose --env-file .env --env-file .env.images exec -T api \
    node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "API healthy."
    if [[ -x "$ROOT/scripts/verify-llm.sh" ]]; then
      echo "Verifying LLM from ai-orchestrator ..."
      if DEPLOY_ROOT="$ROOT" bash "$ROOT/scripts/verify-llm.sh"; then
        echo "LLM OK."
      else
        echo "WARNING: LLM probe failed — run: bash scripts/patch-llm-env.sh"
      fi
    fi
    docker compose --env-file .env --env-file .env.images ps
    exit 0
  fi
  sleep 4
done

echo "API did not become healthy in time."
docker compose --env-file .env --env-file .env.images ps
docker compose --env-file .env --env-file .env.images logs --tail=80 api ai-orchestrator ai-mcp
exit 1
