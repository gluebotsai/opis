#!/usr/bin/env bash
# Measure /api/analytics/live latency (p95 target < 500ms at 5s dashboard poll).
# Usage:
#   export API_BASE=http://127.0.0.1:7861
#   export AUTH_TOKEN='Bearer …'   # admin JWT from login
#   ./scripts/benchmark_analytics_live.sh

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:7861}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
N="${N:-40}"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Set AUTH_TOKEN (e.g. Bearer eyJ… from browser devtools after login)." >&2
  exit 1
fi

url="${API_BASE%/}/api/analytics/live"
times=()
for ((i = 1; i <= N; i++)); do
  ms=$(curl -sS -o /dev/null -w '%{time_total}' \
    -H "Authorization: ${AUTH_TOKEN}" \
    "$url" | awk '{printf "%.0f", $1 * 1000}')
  times+=("$ms")
done

printf '%s\n' "${times[@]}" | sort -n | awk '
  { a[NR] = $1; sum += $1 }
  END {
    n = NR
    p50 = a[int(n * 0.50) + 1]
    p95 = a[int(n * 0.95) + 1]
    printf "samples=%d mean_ms=%.0f p50_ms=%s p95_ms=%s\n", n, sum/n, p50, p95
  }'
