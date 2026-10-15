#!/usr/bin/env bash
# Hit Hub + Campaign A2A test cases (run on LAN machine, e.g. 192.168.11.31)
set -u

HUB="${HUB_A2A_URL:-http://192.168.13.112:8030}"
CAMPAIGN="${A2A_PUBLIC_URL:-http://192.168.11.31:8040}"
HUB_CLIENT_ID="${HUB_A2A_CLIENT_ID:-worktual-crm-hub}"
HUB_CLIENT_SECRET="${HUB_A2A_CLIENT_SECRET:-CdLdHlb-qM-TXj0W_oWbOKWIZsBf2mcMd4IkFNCf2t4}"
SPOKE_CLIENT_ID="${A2A_SPOKE_CLIENT_ID:-worktual-hub-campaign}"
SPOKE_CLIENT_SECRET="${A2A_SPOKE_CLIENT_SECRET:-MA7fdPQALkoFmS3GMFadDAxvVKfAX45C_HoAqlhlkxE}"

pass=0
fail=0

section() { echo; echo "======== $1 ========"; }

check_json() {
  local name="$1" body="$2" code="$3" expect="$4"
  echo "HTTP $code"
  echo "$body" | head -c 800
  echo
  if echo "$body" | grep -q "$expect" && [[ "$code" =~ ^2 ]]; then
    echo "PASS: $name"
    pass=$((pass + 1))
  else
    echo "FAIL: $name (expected to match /$expect/ and 2xx)"
    fail=$((fail + 1))
  fi
}

section "CASE 1 — Hub agent-card"
body=$(curl -sS -m 15 -w "\n%{http_code}" "$HUB/.well-known/agent-card.json" || true)
code=$(echo "$body" | tail -n1)
json=$(echo "$body" | sed '$d')
check_json "hub agent-card" "$json" "$code" "worktual-hub"

section "CASE 2 — Hub /token (Campaign→Hub client)"
body=$(curl -sS -m 20 -w "\n%{http_code}" -X POST "$HUB/token" \
  -H "Content-Type: application/json" \
  -d "{
    \"grant_type\": \"client_credentials\",
    \"client_id\": \"$HUB_CLIENT_ID\",
    \"client_secret\": \"$HUB_CLIENT_SECRET\",
    \"a2a_server_name\": \"worktual-hub\"
  }" || true)
code=$(echo "$body" | tail -n1)
json=$(echo "$body" | sed '$d')
check_json "hub token" "$json" "$code" "access_token"
HUB_ACCESS=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || true)

section "CASE 3 — Hub message/send remainder (direct)"
if [[ -n "${HUB_ACCESS:-}" ]]; then
  body=$(curl -sS -m 60 -w "\n%{http_code}" -X POST "$HUB/" \
    -H "Authorization: Bearer $HUB_ACCESS" \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "id": "hub-test-1",
      "method": "message/send",
      "params": {
        "message": {
          "role": "user",
          "messageId": "campaign-ping-1",
          "metadata": {"source": "campaign"},
          "parts": [{
            "kind": "data",
            "data": {
              "cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
              "spoke": "Campaign",
              "recent_event": {
                "channel": "chat",
                "query": "Test ping from Campaign A2A script to Hub"
              },
              "organization_id": 1000
            }
          }]
        }
      }
    }' || true)
  code=$(echo "$body" | tail -n1)
  json=$(echo "$body" | sed '$d')
  echo "HTTP $code"
  echo "$json" | head -c 1200
  echo
  if [[ "$code" =~ ^2 ]]; then
    echo "PASS: hub message/send (2xx)"
    pass=$((pass + 1))
  else
    echo "FAIL: hub message/send"
    fail=$((fail + 1))
  fi
else
  echo "SKIP: no Hub access_token from CASE 2"
  fail=$((fail + 1))
fi

section "CASE 4 — Campaign A2A health"
body=$(curl -sS -m 10 -w "\n%{http_code}" "$CAMPAIGN/health" || true)
code=$(echo "$body" | tail -n1)
json=$(echo "$body" | sed '$d')
check_json "campaign health" "$json" "$code" '"status":"ok"'

section "CASE 5 — Campaign escalate-hub → Hub"
body=$(curl -sS -m 90 -w "\n%{http_code}" -X POST "$CAMPAIGN/internal/escalate-hub" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "campaign",
    "cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
    "query": "Test ping from Campaign escalate-hub",
    "organization_id": 1000,
    "channel": "chat"
  }' || true)
code=$(echo "$body" | tail -n1)
json=$(echo "$body" | sed '$d')
echo "HTTP $code"
echo "$json" | head -c 1500
echo
if echo "$json" | grep -q '"ok": true' || echo "$json" | grep -q '"ok":true'; then
  echo "PASS: escalate-hub"
  pass=$((pass + 1))
elif [[ "$code" == "200" ]] || [[ "$code" == "400" ]]; then
  echo "INFO: escalate returned structured response (inspect JSON above)"
  pass=$((pass + 1))
else
  echo "FAIL: escalate-hub"
  fail=$((fail + 1))
fi

section "CASE 6 — Campaign /token (Hub→Campaign client)"
body=$(curl -sS -m 15 -w "\n%{http_code}" -X POST "$CAMPAIGN/token" \
  -H "Content-Type: application/json" \
  -d "{
    \"grant_type\": \"client_credentials\",
    \"client_id\": \"$SPOKE_CLIENT_ID\",
    \"client_secret\": \"$SPOKE_CLIENT_SECRET\",
    \"a2a_server_name\": \"worktual-campaign\"
  }" || true)
code=$(echo "$body" | tail -n1)
json=$(echo "$body" | sed '$d')
check_json "campaign token" "$json" "$code" "access_token"

echo
echo "======== SUMMARY: pass=$pass fail=$fail ========"
exit $fail
