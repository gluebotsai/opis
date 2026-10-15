#!/usr/bin/env bash
# Reinstall api-node deps on the server (fixes missing bcryptjs and esbuild EACCES).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_NODE="${ROOT}/api-node"

if [[ ! -f "${API_NODE}/package.json" ]]; then
  echo "ERROR: ${API_NODE}/package.json not found" >&2
  exit 1
fi

cd "${API_NODE}"

echo "==> Enabling corepack (Yarn 4 from package.json)..."
corepack enable 2>/dev/null || true

echo "==> Removing stale node_modules (do not copy node_modules between machines)..."
rm -rf node_modules

echo "==> Installing api-node dependencies..."
if [[ -f yarn.lock ]]; then
  yarn install
else
  npm install
fi

echo "==> Generating Prisma client..."
if [[ -f yarn.lock ]]; then
  yarn prisma generate
else
  npx prisma generate
fi

echo "==> Fixing execute permissions on native binaries..."
find node_modules/.bin -maxdepth 1 -type f -exec chmod u+x {} + 2>/dev/null || true
find node_modules/@esbuild -path '*/bin/esbuild' -type f -exec chmod u+x {} + 2>/dev/null || true

echo "==> Verifying bcryptjs..."
node --input-type=module -e "import('bcryptjs').then(() => console.log('bcryptjs OK'))"

echo "==> Done. Start API with: cd ${ROOT} && python run_backend.py --all"
