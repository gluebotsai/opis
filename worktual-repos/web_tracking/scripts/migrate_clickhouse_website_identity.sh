#!/usr/bin/env bash
# One-time ClickHouse migration: domain_id/domain_name -> website_id/website_url, organization_id UUID -> UInt32
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

ch_file() {
  local path="$1"
  echo "==> Applying file: $(basename "$path")"
  python3 - "$path" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
sql = path.read_text(encoding="utf-8")
# strip full-line comments
lines = []
for line in sql.splitlines():
    if line.strip().startswith("--"):
        continue
    if "--" in line:
        line = line.split("--", 1)[0]
    lines.append(line)
sql = "\n".join(lines)
statements = [s.strip() for s in sql.split(";") if s.strip()]
for stmt in statements:
    print(stmt + ";")
PY
}

run_sql() {
  ch_query "$1" >/dev/null
  echo "  OK: ${1:0:90}..."
}

substitute_dict() {
  sed \
    -e "s/__CH_DICT_PG_HOST__/${CH_DICT_PG_HOST:-${DB_HOST:-10.180.0.126}}/g" \
    -e "s/__CH_DICT_PG_PORT__/${CH_DICT_PG_PORT:-${DB_PORT:-5432}}/g" \
    -e "s/__CH_DICT_PG_DB__/${CH_DICT_PG_DB:-${DB_NAME:-worktual}}/g" \
    -e "s/__CH_DICT_PG_USER__/${CH_DICT_PG_USER:-ch_sync}/g" \
    -e "s/__CH_DICT_PG_PASSWORD__/${CH_DICT_PG_PASSWORD:-}/g" \
    -e "s/__CH_DICT_PG_SCHEMA__/${CH_DICT_PG_SCHEMA:-${DB_SCHEMA:-public}}/g" \
    -e "s/__CH_DICT_PG_TABLE__/${CH_DICT_PG_TABLE:-admin_accounts}/g"
}

echo "Target ClickHouse: ${CH_HOST}:${CH_PORT}/${CH_DB}"
echo "Pre-flight row count raw_payloads: $(ch_query 'SELECT count() FROM raw_payloads FORMAT TabSeparated')"

MVs=(
  mv_agg_page_daily
  mv_agg_product_daily
  mv_agg_web_daily_conversions
  mv_agg_web_daily_interactions
  mv_agg_web_daily_pageviews
  mv_agg_web_daily_sessions
  mv_dim_domains
  mv_dim_sessions
  mv_dim_visitors
  mv_fact_conversions
  mv_fact_custom
  mv_fact_errors
  mv_fact_form_events
  mv_fact_interactions
  mv_fact_page_views
  mv_fact_performance
  mv_fact_product
  mv_parse_events
  mv_fact_replay_chunks
  mv_dim_websites
)

echo "==> Step 1: Drop materialized views"
for mv in "${MVs[@]}"; do
  run_sql "DROP VIEW IF EXISTS ${CH_DB}.${mv}" || true
done

echo "==> Step 2: Rename domain_id/domain_name columns"
RENAME_TABLES=(
  raw_payloads
  events_staging
  dim_visitors
  dim_sessions
  fact_page_views
  fact_interaction_events
  fact_form_events
  fact_conversion_events
  fact_custom_events
  fact_product_interactions
  fact_performance_events
  fact_error_events
  fact_cookie_operations
  fact_heap_snapshots
  agg_web_daily
  agg_page_daily
  agg_product_daily
)

for tbl in "${RENAME_TABLES[@]}"; do
  exists=$(ch_query "EXISTS TABLE ${CH_DB}.${tbl} FORMAT TabSeparated" || echo "0")
  [[ "$exists" == "1" ]] || continue
  cols=$(ch_query "SELECT name FROM system.columns WHERE database='${CH_DB}' AND table='${tbl}' AND name IN ('domain_id','domain_name') FORMAT TabSeparated")
  if echo "$cols" | grep -q domain_id; then
    run_sql "ALTER TABLE ${CH_DB}.${tbl} RENAME COLUMN domain_id TO website_id"
  fi
  if echo "$cols" | grep -q domain_name; then
    run_sql "ALTER TABLE ${CH_DB}.${tbl} RENAME COLUMN domain_name TO website_url"
  fi
done

# dim_domains -> dim_websites
if [[ "$(ch_query "EXISTS TABLE ${CH_DB}.dim_domains FORMAT TabSeparated")" == "1" ]]; then
  if [[ "$(ch_query "EXISTS TABLE ${CH_DB}.dim_websites FORMAT TabSeparated")" == "1" ]]; then
    echo "  dim_websites already exists; skipping rename from dim_domains"
  else
    run_sql "RENAME TABLE ${CH_DB}.dim_domains TO ${CH_DB}.dim_websites"
  fi
  cols=$(ch_query "SELECT name FROM system.columns WHERE database='${CH_DB}' AND table='dim_websites' FORMAT TabSeparated")
  if echo "$cols" | grep -q domain_id; then
    run_sql "ALTER TABLE ${CH_DB}.dim_websites RENAME COLUMN domain_id TO website_id"
  fi
  if echo "$cols" | grep -q domain_name; then
    run_sql "ALTER TABLE ${CH_DB}.dim_websites RENAME COLUMN domain_name TO website_url"
  fi
fi

# fact_replay_chunks if present
if [[ "$(ch_query "EXISTS TABLE ${CH_DB}.fact_replay_chunks FORMAT TabSeparated")" == "1" ]]; then
  cols=$(ch_query "SELECT name FROM system.columns WHERE database='${CH_DB}' AND table='fact_replay_chunks' AND name='domain_id' FORMAT TabSeparated" || true)
  if [[ -n "$cols" ]]; then
    run_sql "ALTER TABLE ${CH_DB}.fact_replay_chunks RENAME COLUMN domain_id TO website_id"
  fi
fi

echo "==> Step 3: Convert organization_id UUID -> UInt32"
ORG_TABLES=(
  dim_websites
  dim_visitors
  dim_sessions
  events_staging
  fact_page_views
  fact_interaction_events
  fact_form_events
  fact_conversion_events
  fact_custom_events
  fact_product_interactions
  fact_performance_events
  fact_error_events
  fact_replay_chunks
)

for tbl in "${ORG_TABLES[@]}"; do
  exists=$(ch_query "EXISTS TABLE ${CH_DB}.${tbl} FORMAT TabSeparated" || echo "0")
  [[ "$exists" == "1" ]] || continue
  has_org=$(ch_query "SELECT count() FROM system.columns WHERE database='${CH_DB}' AND table='${tbl}' AND name='organization_id' FORMAT TabSeparated")
  if [[ "$has_org" == "1" ]]; then
    run_sql "ALTER TABLE ${CH_DB}.${tbl} DROP COLUMN organization_id"
  fi
  if [[ "$tbl" == "dim_websites" ]]; then
    run_sql "ALTER TABLE ${CH_DB}.${tbl} ADD COLUMN IF NOT EXISTS organization_id UInt32 DEFAULT 0"
  else
    run_sql "ALTER TABLE ${CH_DB}.${tbl} ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32)"
  fi
done

echo "==> Step 4: Recreate pipeline MVs"
while IFS= read -r stmt; do
  [[ -z "$stmt" ]] && continue
  run_sql "$stmt"
done < <(ch_file "${ROOT}/clickhouse/ddl/05_materialized_views_pipeline.sql")

echo "==> Step 5: Apply profile-fix MV overrides"
while IFS= read -r stmt; do
  [[ -z "$stmt" ]] && continue
  run_sql "$stmt"
done < <(ch_file "${ROOT}/clickhouse/ddl/06_recreate_mv_profile_fix.sql")

echo "==> Step 6: Replay chunks table + MV"
while IFS= read -r stmt; do
  [[ -z "$stmt" ]] && continue
  run_sql "$stmt"
done < <(ch_file "${ROOT}/clickhouse/ddl/07_replay_chunks.sql")

echo "==> Step 7: Gold aggregate MVs"
while IFS= read -r stmt; do
  [[ -z "$stmt" ]] && continue
  case "$stmt" in
    CREATE\ TABLE*) continue ;;
  esac
  if [[ "$stmt" == CREATE\ MATERIALIZED\ VIEW* ]]; then
    run_sql "$stmt"
  fi
done < <(ch_file "${ROOT}/clickhouse/ddl/04_gold_aggs.sql")

echo "==> Step 8: Recreate dictionary (organization_id UInt32)"
run_sql "DROP DICTIONARY IF EXISTS ${CH_DB}.dict_admin_accounts"
dict_sql=$(substitute_dict < "${ROOT}/clickhouse/ddl/02b_dict_admin_accounts.sql" | python3 -c "
import sys
from pathlib import Path
sql = sys.stdin.read()
lines = [l for l in sql.splitlines() if not l.strip().startswith('--')]
text = '\n'.join(lines)
for stmt in [s.strip() for s in text.split(';') if s.strip()]:
    print(stmt + ';')
")
while IFS= read -r stmt; do
  [[ -z "$stmt" ]] && continue
  run_sql "$stmt"
done <<< "$dict_sql"

run_sql "SYSTEM RELOAD DICTIONARY ${CH_DB}.dict_admin_accounts"

echo "==> Post-flight verification"
ch_query "SELECT table, name, type FROM system.columns WHERE database='${CH_DB}' AND name IN ('website_id','website_url','organization_id') ORDER BY table, name FORMAT PrettyCompact"
echo "MV count: $(ch_query "SELECT count() FROM system.tables WHERE database='${CH_DB}' AND engine LIKE '%MaterializedView%' FORMAT TabSeparated")"
echo "raw_payloads columns: $(ch_query "SELECT name FROM system.columns WHERE database='${CH_DB}' AND table='raw_payloads' ORDER BY name FORMAT TabSeparated")"
echo "Migration complete."
