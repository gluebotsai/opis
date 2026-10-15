#!/usr/bin/env bash
# Point vexa-lite bot at host meeting-service :8030 (run after up-meeting-docker.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/meeting-service"
./scripts/patch-vexa-live-pcm.sh
docker restart vexa-lite 2>/dev/null || {
  echo "vexa-lite container not found — start Vexa Lite separately, then re-run this script."
  exit 1
}
echo "vexa-lite restarted with VEXA_LIVE_PCM_WS_BASE → meeting-service"
