#!/usr/bin/env bash
# Smoke: calendar push URL config + webhook multiplexer (Pub/Sub + calendar headers).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${CRM_API_URL:-http://127.0.0.1:4000}"
fail=0

check_http() {
  local name="$1"
  local method="$2"
  local url="$3"
  local data="${4:-}"
  local expect="$5"
  local code
  if [[ "$method" == "POST" ]]; then
    code="$(curl -sS -o /tmp/sm-capture-body -w '%{http_code}' -X POST "$url" \
      -H 'Content-Type: application/json' \
      ${data:+-d "$data"} || true)"
  else
    code="$(curl -sS -o /tmp/sm-capture-body -w '%{http_code}' "$url" || true)"
  fi
  if [[ "$code" != "200" ]]; then
    echo "FAIL $name HTTP $code  $url"
    fail=1
    return
  fi
  if [[ -n "$expect" ]] && ! grep -q "$expect" /tmp/sm-capture-body; then
    echo "FAIL $name missing '$expect'  $url"
    cat /tmp/sm-capture-body | head -3
    fail=1
    return
  fi
  echo "OK   $name"
}

echo "=== Config hints (from env / .env not loaded here) ==="
if [[ -z "${CALENDAR_PUSH_WEBHOOK_URL:-}" && -z "${CRM_API_PUBLIC_URL:-}" ]]; then
  echo "WARN Set CALENDAR_PUSH_WEBHOOK_URL or CRM_API_PUBLIC_URL for calendar watch registration"
else
  echo "OK   public calendar push URL env present"
fi
if [[ -z "${GMAIL_PUBSUB_TOPIC:-}" ]]; then
  echo "WARN GMAIL_PUBSUB_TOPIC unset (Gmail push watch will skip)"
else
  echo "OK   GMAIL_PUBSUB_TOPIC=${GMAIL_PUBSUB_TOPIC}"
fi

echo ""
echo "=== API multiplexer $API ==="
check_http "health" GET "$API/health" "" '"service"'

PUBSUB_PAYLOAD='{"message":{"data":"eyJ0ZXN0IjoidHJ1ZSJ9","messageId":"verify-smoke-1"},"subscription":"projects/test/subscriptions/mcp-push"}'
check_http "pubsub ignored payload" POST "$API/api/webhooks/google-calendar/push" "$PUBSUB_PAYLOAD" '"kind":"gmail_pubsub"'
check_http "gmail alias route" POST "$API/api/webhooks/gmail/push" "$PUBSUB_PAYLOAD" '"kind":"gmail_pubsub"'

check_http "calendar headers missing channel" POST "$API/api/webhooks/google-calendar/push" '{}' '"kind":"ignored"'

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "Scheduled meet capture smoke failed. Start CRM API and retry."
  exit 1
fi
echo "Scheduled meet capture smoke passed."
echo "Next: connect Google in Configuration, set public HTTPS URL, create a Calendar event with Meet link."
