#!/usr/bin/env bash
# Start CRM dev in a new Terminal window (survives Cursor / IDE shell exit).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUP="$ROOT/scripts/dev-supervisor.sh"
chmod +x "$SUP"

if [[ "$(uname -s)" != Darwin ]]; then
  echo "Use ./scripts/up-dev.sh on non-macOS."
  exit 1
fi

"$ROOT/scripts/down-dev.sh" 2>/dev/null || true

osascript <<EOF
tell application "Terminal"
  activate
  do script "cd $(printf '%q' "$ROOT") && exec $(printf '%q' "$SUP")"
end tell
EOF

echo "Opened Terminal with dev-supervisor.sh — wait ~10s, then run: ./scripts/status-dev.sh"
