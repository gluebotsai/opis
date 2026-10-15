#!/usr/bin/env bash
# Read-only smoke: LAN services + agents CAMPAIGN_API_BASE alignment for template batch save.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

detect_lan_ip() {
  for iface in en0 en1 en2; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [ -n "$ip" ]; then echo "$ip"; return 0; fi
  done
  echo "127.0.0.1"
}

LAN_IP="$(detect_lan_ip)"
API="http://${LAN_IP}:3001"
FE="http://${LAN_IP}:5173"
AGENTS="http://${LAN_IP}:8005"
FAIL=0

check() {
  local url="$1"
  local label="$2"
  code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "  OK  $label ($code)"
  else
    echo "  FAIL $label (HTTP $code) — $url"
    FAIL=1
  fi
}

echo "LAN template persist flow check"
echo "  LAN IP: $LAN_IP"
echo

echo "Services:"
check "${API}/health" "backend API"
check "${AGENTS}/health" "agents"
check "${FE}/" "frontend"

echo
echo "Agents env (template batch target):"
if [ -f "$ROOT/agents/.env" ]; then
  base="$(grep -E '^CAMPAIGN_API_BASE=' "$ROOT/agents/.env" | tail -1 | cut -d= -f2- || true)"
  pub="$(grep -E '^CAMPAIGN_API_PUBLIC_BASE=' "$ROOT/agents/.env" | tail -1 | cut -d= -f2- || true)"
  echo "  CAMPAIGN_API_BASE=${base:-<missing>}"
  echo "  CAMPAIGN_API_PUBLIC_BASE=${pub:-<missing>}"
  if [ -n "$base" ] && echo "$base" | grep -q '127.0.0.1'; then
    echo "  WARN: agents use 127.0.0.1 — OK only if agents run on same host as API."
    echo "        For LAN clients use: npm run dev:lan (sets http://${LAN_IP}:3001/api)"
  fi
  if [ -n "$base" ] && ! echo "$base" | grep -q "${LAN_IP}"; then
    if ! echo "$base" | grep -q '127.0.0.1'; then
      echo "  WARN: CAMPAIGN_API_BASE does not match detected LAN IP."
    fi
  fi
  if [ -n "$base" ] && echo "$base" | grep -q "${LAN_IP}"; then
    if [ -n "$pub" ] && echo "$pub" | grep -q 'rebuild-campaign-api'; then
      echo "  WARN: CAMPAIGN_API_PUBLIC_BASE still points at rebuild CDN."
      echo "        Run: npm run dev:lan  (sets LAN media + API public bases)"
    fi
  fi
else
  echo "  WARN: agents/.env missing — copy agents/.env.example and run dev-lan.sh"
  FAIL=1
fi

echo
echo "Frontend proxy:"
if [ -f "$ROOT/frontend/.env.local" ]; then
  grep -E '^VITE_API_PROXY_TARGET=' "$ROOT/frontend/.env.local" | tail -1 || true
else
  echo "  (no frontend/.env.local)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "Flow check passed. Open ${FE}/campaigns/create and generate; templates POST to:"
  echo "  ${API}/api/channel-templates/session/<sessionId>/batch"
  exit 0
fi
echo "Fix failures above, then restart backend + agents."
exit 1
