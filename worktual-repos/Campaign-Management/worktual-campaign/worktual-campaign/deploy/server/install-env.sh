#!/bin/sh
# Install server env templates (run from monorepo root on 82.113.92.49).
# Backs up existing .env files before overwrite. Does NOT generate secrets.
set -e
cd "$(dirname "$0")/../.."
TS="$(date +%Y%m%d-%H%M%S)"

backup_if_exists() {
  path="$1"
  if [ -f "$path" ]; then
    cp "$path" "${path}.bak.${TS}"
    echo "Backed up $path -> ${path}.bak.${TS}"
  fi
}

backup_if_exists .env
backup_if_exists backend/.env
backup_if_exists agents/.env

cp deploy/server/root.env .env
cp deploy/server/backend.env backend/.env
cp deploy/server/agents.env agents/.env

echo "Installed .env, backend/.env, agents/.env from deploy/server/* (templates)."
echo ""
echo "REQUIRED for email send (edit backend/.env on server — then recreate backend):"
echo "  - MS_TOKEN_ENCRYPTION_KEY (match My Accounts Setup Workspace)"
echo "  - GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET"
echo "  - MICROSOFT_OAUTH_* if org mailbox is Microsoft"
echo "  - curl https://rebuild-campaign-api.worktual.com/health  # all three *Configured true"
echo ""
echo "REQUIRED before Hub A2A go-live (edit agents/.env on server only):"
echo "  - JWT_SECRET must match backend/.env"
echo "  - A2A_SPOKE_CLIENT_SECRET (openssl rand -base64 32) + Hub + accounts DB row"
echo "  - A2A_HUB_JWT_SECRET (openssl rand -base64 48), not shared with Hub"
echo "  - docker compose up -d --force-recreate a2a"
echo "  - curl http://127.0.0.1:8080/a2a/health  # expect token_store: db"
echo ""
echo "See deploy/server/README.md and docs/CAMPAIGN_HUB_GO_LIVE.md"
echo "Next: docker compose build && docker compose up -d"
