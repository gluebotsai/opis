#!/usr/bin/env bash
# One-time ClickHouse migration: populate organization_id on all tables (MV recreate + backfill).
# Fixes live servers where CREATE MATERIALIZED VIEW IF NOT EXISTS kept old MV definitions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

CH_HOST="${CLICKHOUSE_HOST:-localhost}"
CH_PORT="${CLICKHOUSE_PORT:-8123}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"
CH_DB="${CLICKHOUSE_DATABASE:-web_tracking}"
DDL="${ROOT}/clickhouse/ddl"

ch_query() {
  local sql="$1"
  local resp
  resp=$(curl -sS "http://${CH_HOST}:${CH_PORT}/?database=${CH_DB}" \
    --user "${CH_USER}:${CH_PASS}" \
    --data-binary "$sql")
  if echo "$resp" | grep -qE '^Code: [0-9]+'; then
    echo "CLICKHOUSE ERROR: $resp" >&2
    return 1
  fi
  echo "$resp"
}

apply_sql_file() {
  local path="$1"
  local skip_on_missing="${2:-0}"
  if [[ ! -f "$path" ]]; then
    if [[ "$skip_on_missing" == "1" ]]; then
      echo "  SKIP: file not found" >&2
      return 0
    fi
    echo "Missing file: $path" >&2
    return 1
  fi
  python3 - "$path" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
sql = path.read_text(encoding="utf-8")
lines = []
for line in sql.splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("--"):
        continue
    if "--" in line:
        line = line.split("--", 1)[0]
    lines.append(line)
for stmt in "\n".join(lines).split(";"):
    stmt = " ".join(stmt.split())
    if stmt:
        print(stmt + ";")
PY
}

run_file() {
  local path="$1"
  local skip_on_missing="${2:-0}"
  echo "==> Applying $(basename "$path")"
  while IFS= read -r stmt; do
    [[ -n "$stmt" ]] || continue
    ch_query "$stmt" >/dev/null
    echo "  OK: ${stmt:0:100}..."
  done < <(apply_sql_file "$path" "$skip_on_missing")
}

table_exists() {
  local tbl="$1"
  [[ "$(ch_query "EXISTS TABLE ${CH_DB}.${tbl} FORMAT TabSeparated" 2>/dev/null || echo 0)" == "1" ]]
}

echo "Target ClickHouse: ${CH_HOST}:${CH_PORT}/${CH_DB}"
echo "Pre-flight payloads with org:"
ch_query "
SELECT
  count() AS total_payloads,
  countIf(
    JSONExtractUInt(payload, 'organization_id') > 0
    OR JSONExtractUInt(payload, 'organizationId') > 0
  ) AS with_org
FROM ${CH_DB}.raw_payloads
FORMAT Pretty
"

echo "==> Step 1: Ensure organization_id columns exist (04b)"
run_file "${DDL}/04b_organization_id_columns.sql"

echo "==> Step 2: Drop stale materialized views (12)"
run_file "${DDL}/12_recreate_mv_organization_id.sql"

echo "==> Step 2b: dim_sessions campaign columns if 05 MV references them (10, optional)"
run_file "${DDL}/10_session_campaign_attribution.sql" "1"

echo "==> Step 3: Recreate MVs (05, 06, 07)"
run_file "${DDL}/05_materialized_views_pipeline.sql"
run_file "${DDL}/06_recreate_mv_profile_fix.sql"
run_file "${DDL}/07_replay_chunks.sql" "1"

echo "==> Step 4: Reload dict_admin_accounts (Postgres org mapping)"
ch_query "SYSTEM RELOAD DICTIONARY ${CH_DB}.dict_admin_accounts" >/dev/null || \
  echo "  WARN: dict reload failed — backfill may skip rows until dict is loaded"

echo "==> Step 5: Backfill NULL organization_id on historical rows (12b)"
if table_exists "fact_replay_chunks"; then
  run_file "${DDL}/12b_backfill_organization_id.sql"
else
  echo "  fact_replay_chunks not found — applying 12b without replay chunk statement"
  tmp="$(mktemp)"
  grep -v 'fact_replay_chunks' "${DDL}/12b_backfill_organization_id.sql" > "$tmp"
  run_file "$tmp"
  rm -f "$tmp"
fi

echo "==> Step 6: Wait for mutations (up to 120s)"
for _ in $(seq 1 24); do
  pending="$(ch_query "
    SELECT count()
    FROM system.mutations
    WHERE database = '${CH_DB}'
      AND is_done = 0
      AND create_time > now() - INTERVAL 1 HOUR
    FORMAT TabSeparated
  " 2>/dev/null || echo 0)"
  if [[ "${pending:-0}" == "0" ]]; then
    break
  fi
  echo "  Pending mutations: ${pending} — waiting 5s..."
  sleep 5
done

echo "Post-flight organization_id coverage:"
ch_query "
SELECT 'events_staging' AS tbl,
       countIf(organization_id IS NOT NULL) AS with_org,
       count() AS total
FROM ${CH_DB}.events_staging
UNION ALL
SELECT 'fact_page_views', countIf(organization_id IS NOT NULL), count()
FROM ${CH_DB}.fact_page_views
UNION ALL
SELECT 'dim_sessions', countIf(organization_id IS NOT NULL), count()
FROM ${CH_DB}.dim_sessions FINAL
UNION ALL
SELECT 'dim_visitors', countIf(organization_id IS NOT NULL), count()
FROM ${CH_DB}.dim_visitors FINAL
FORMAT Pretty
"

echo ""
echo "Done. Send a test pageview and re-run the post-flight query to confirm new rows have organization_id."
