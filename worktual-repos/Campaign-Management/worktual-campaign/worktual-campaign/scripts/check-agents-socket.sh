#!/usr/bin/env bash
# Verify agents Socket.IO through the same path the browser uses (GET sid + POST handshake).
set -euo pipefail

ORIGIN="${1:-https://rebuild-campaign.worktual.com}"
BASE="${2:-$ORIGIN/agents-socket}"

echo "Origin: $ORIGIN"
echo "Agents path: $BASE"

BODY="$(curl -sS -m 10 -H "Origin: $ORIGIN" "${BASE}/?EIO=4&transport=polling")"
SID="$(printf '%s' "$BODY" | sed -n 's/.*"sid":"\([^"]*\)".*/\1/p')"
if [ -z "$SID" ]; then
  echo "FAIL: no sid in GET response:"
  echo "$BODY" | head -c 400
  echo
  exit 1
fi
echo "GET sid=$SID"

POST_CODE="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -X POST \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: text/plain;charset=UTF-8" \
  -d "40" \
  "${BASE}/?EIO=4&transport=polling&sid=${SID}")"
echo "POST handshake: $POST_CODE"

if [ "$POST_CODE" != "200" ]; then
  echo "FAIL: POST must be 200 (400 often = edge nginx or stale sid)."
  exit 1
fi

echo "OK: agents Socket.IO polling path works."
