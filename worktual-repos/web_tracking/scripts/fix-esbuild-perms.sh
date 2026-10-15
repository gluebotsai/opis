#!/usr/bin/env bash
# Fix EACCES on esbuild native binaries after yarn install (common on Linux deploys).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fix_tree() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  echo "Fixing esbuild permissions under: $dir"
  find "$dir" \( -path '*/@esbuild/*/bin/esbuild' -o -path '*/esbuild/bin/esbuild' \) -type f 2>/dev/null | while read -r bin; do
    chmod +x "$bin" || true
  done
}

fix_tree "$ROOT/api-node/node_modules"
fix_tree "$ROOT/web/node_modules"
fix_tree "$ROOT/web/.yarn/unplugged"
fix_tree "$ROOT/sdk/node_modules"

echo "Done. Retry: cd api-node && yarn dev   OR   cd web && yarn dev"
