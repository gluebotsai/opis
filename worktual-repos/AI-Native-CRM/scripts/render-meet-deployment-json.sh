#!/usr/bin/env bash
# Write Google Meet HTTP add-on deployment.json from public HTTPS origin in .env.
# Meet sidePanelUrl must match nginx/FRONTEND_ORIGIN (CRM SPA), not the API-only host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"

load_env_key() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

FRONTEND="$(load_env_key FRONTEND_ORIGIN)"
MEET_PUBLIC="$(load_env_key MEETING_SERVICE_PUBLIC_URL)"
API_PUBLIC="$(load_env_key CRM_API_PUBLIC_URL)"

# Local Meet: prefer CRM_API_PUBLIC_URL / OAUTH ngrok (API :4000 proxies /addons/meet).
ORIGIN="${MEET_PUBLIC:-${API_PUBLIC:-${FRONTEND}}}"
ORIGIN="${ORIGIN%/}"

if [[ -z "$ORIGIN" ]]; then
  echo "Set FRONTEND_ORIGIN or MEETING_SERVICE_PUBLIC_URL (preferred) or CRM_API_PUBLIC_URL in $ENV_FILE"
  echo "Production example: FRONTEND_ORIGIN=https://rebuild-crm.worktual.com"
  exit 1
fi

if [[ "$ORIGIN" != https://* ]]; then
  echo "WARN: Meet requires HTTPS sidePanelUrl; got: $ORIGIN"
fi

export MEET_DEPLOY_ORIGIN="$ORIGIN"
export MEET_DEPLOY_ROOT="$ROOT"
node <<'NODE'
const fs = require("fs");
const path = require("path");
const origin = process.env.MEET_DEPLOY_ORIGIN.replace(/\/$/, "");
const root = process.env.MEET_DEPLOY_ROOT || process.cwd();
const doc = {
  oauthScopes: ["https://www.googleapis.com/auth/userinfo.email"],
  addOns: {
    common: {
      name: "AI sales Assist",
      logoUrl: `${origin}/addons/meet/logo.png`,
      layoutProperties: { primaryColor: "#7423D7" },
    },
    meet: {
      web: {
        sidePanelUrl: `${origin}/addons/meet/`,
        supportsScreenSharing: false,
        addOnOrigins: [origin],
        logoUrl: `${origin}/addons/meet/logo.png`,
        darkModeLogoUrl: `${origin}/addons/meet/logo.png`,
      },
    },
  },
};
const targets = [
  path.join(root, "meeting-service/addons/google-meet/deployment.json"),
  path.join(root, "meet-addon/deployment.json"),
];
for (const file of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out =
    file.includes("meet-addon")
      ? { addOns: doc.addOns }
      : doc;
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("Wrote", file);
}
NODE

echo "Google Cloud: paste meeting-service/addons/google-meet/deployment.json (HTTP add-on deployment)."
echo "sidePanelUrl must be exactly: ${ORIGIN}/addons/meet/"
