#!/usr/bin/env bash
# Run on your Mac (VPN on if you use nlp-webtracking). No paste on the server.
# Usage: SSH_HOST=root@nlp-webtracking bash deploy/scripts/push-vexa-live-pcm-to-server.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH_HOST="${SSH_HOST:-root@nlp-webtracking}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/worktual/AI-Native-CRM}"
SRC="$ROOT/meeting-service/patches/vexa-live-pcm-forward.ts"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC — run from repo checkout on Mac." >&2
  exit 1
fi

echo "Installing live-PCM forwarder on $SSH_HOST ($REMOTE_ROOT) ..."
B64="$(base64 <"$SRC" | tr -d '\n')"

ssh "$SSH_HOST" "python3 -c \"
import base64, pathlib
d = base64.b64decode('${B64}')
root = pathlib.Path('${REMOTE_ROOT}')
for rel in (
    'vendor/vexa/core/meetings/services/bot/src/live-pcm-forward.ts',
    'meeting-service/patches/vexa-live-pcm-forward.ts',
):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(d)
    print('wrote', p, len(d), 'bytes')
\""

echo "Done. On the server run patch + restart vexa-lite (see docs/vexa-server-bootstrap.md)."
