#!/usr/bin/env bash
# Roll back git by one commit on the server, rebuild images, and restart stack.
# Does NOT touch backend/.env, agents/.env, or root .env (not in git).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repo: $ROOT" >&2
  exit 1
fi

echo "Current commit:"
git log -2 --oneline

PREV="$(git rev-parse HEAD~1)"
echo
echo "Rolling back to: $(git log -1 --oneline "$PREV")"
git reset --hard "$PREV"

echo
echo "Rebuilding and starting (web + backend + agents)…"
docker compose build web backend agents
docker compose up -d

echo
echo "Done. Running at:"
git log -1 --oneline
docker compose ps
