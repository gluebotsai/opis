#!/usr/bin/env bash
# Copy main-tree api-node, web, clickhouse DDL, AI_CHAT, and shared/ into
# live_web_tracking_folder_2 for deploy (git push → live server pull).
# Run from repo root: bash scripts/sync_main_to_live_web_tracking.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="$ROOT/live_web_tracking_folder_2"

if [[ ! -d "$LIVE" ]]; then
  echo "Missing $LIVE" >&2
  exit 1
fi

sync_dir_tar() {
  local src_rel="$1"
  local live_rel="$2"
  local src="$ROOT/$src_rel"
  local dst="$LIVE/$live_rel"
  if [[ ! -d "$src" ]]; then
    echo "Skip missing $src_rel"
    return 0
  fi
  mkdir -p "$dst"
  echo "Syncing $src_rel (tar) ..."
  ( cd "$src" && tar -cf - . ) | ( cd "$dst" && tar -xf - )
}

# tar is faster/reliable here (see docs/DEPLOY_LIVE_SYNC.md)
sync_dir_tar "api-node/src" "api-node/src"
sync_dir_tar "web/src" "web/src"
sync_dir_tar "etl/ingest" "etl/ingest"
for etl_file in config.py requirements.txt pytest.ini run_ingest.py run_kafka_consumer.py run_pytest.sh; do
  if [[ -f "$ROOT/etl/$etl_file" ]]; then
    echo "Syncing etl/$etl_file ..."
    cp "$ROOT/etl/$etl_file" "$LIVE/etl/$etl_file"
  fi
done
if [[ -d "$ROOT/etl/kafka" ]]; then
  sync_dir_tar "etl/kafka" "etl/kafka"
fi
if [[ -d "$ROOT/etl/tests" ]]; then
  sync_dir_tar "etl/tests" "etl/tests"
fi
sync_dir_tar "clickhouse/ddl" "clickhouse/ddl"
sync_dir_tar "shared" "shared"

sync_sdk() {
  local src="$ROOT/sdk"
  local dst="$LIVE/sdk"
  if [[ ! -d "$src" ]]; then
    echo "Skip missing sdk"
    return 0
  fi
  mkdir -p "$dst"
  echo "Syncing sdk (tar; no node_modules) ..."
  (
    cd "$src"
    tar -cf - \
      --exclude='./node_modules' \
      src dist types package.json package-lock.json rollup.config.js tests
  ) | ( cd "$dst" && tar -xf - )
}

sync_sdk

sync_ai_chat() {
  local src="$ROOT/AI_CHAT"
  local dst="$LIVE/AI_CHAT"
  if [[ ! -d "$src" ]]; then
    echo "Skip missing AI_CHAT"
    return 0
  fi
  mkdir -p "$dst"
  echo "Syncing AI_CHAT (tar; legacy live-only files under AI_CHAT/ may remain) ..."
  (
    cd "$src"
    tar -cf - \
      --exclude='./.env' \
      --exclude='./logs' \
      --exclude='./.pytest_cache' \
      --exclude='./__pycache__' \
      --exclude='./.venv' \
      --exclude='./venv' \
      .
  ) | ( cd "$dst" && tar -xf - )
}

sync_ai_chat

echo "Restore live-only api-node/src/routes/env.ts if present in git ..."
( cd "$LIVE" && git checkout HEAD -- api-node/src/routes/env.ts 2>/dev/null ) || true

echo "Restore live-only AI_CHAT/.env if tracked (never overwrite secrets from main) ..."
( cd "$LIVE" && git checkout HEAD -- AI_CHAT/.env 2>/dev/null ) || true

echo "Syncing docs (optional session replay / deploy notes) ..."
mkdir -p "$LIVE/docs"
for f in SESSION_REPLAY_MOBILE_DESKTOP_DISPLAY.md DEPLOY_LIVE_SYNC.md REDIS_LIVE_PRESENCE.md; do
  if [[ -f "$ROOT/docs/$f" ]]; then
    cp "$ROOT/docs/$f" "$LIVE/docs/$f"
  fi
done

if [[ -f "$ROOT/.env.example" ]]; then
  echo "Syncing .env.example (do not overwrite live .env) ..."
  cp "$ROOT/.env.example" "$LIVE/.env.example"
fi

for web_root_file in package.json package-lock.json vite.config.js index.html; do
  if [[ -f "$ROOT/web/$web_root_file" ]]; then
    echo "Syncing web/$web_root_file ..."
    cp "$ROOT/web/$web_root_file" "$LIVE/web/$web_root_file"
  fi
done

mkdir -p "$LIVE/scripts"
for f in sync_main_to_live_web_tracking.sh benchmark_analytics_live.sh verify_redis_live.sh; do
  if [[ -f "$ROOT/scripts/$f" ]]; then
    cp "$ROOT/scripts/$f" "$LIVE/scripts/$f"
    chmod +x "$LIVE/scripts/$f" 2>/dev/null || true
  fi
done

echo ""
echo "Done. Next:"
echo "  cd live_web_tracking_folder_2"
echo "  git status"
echo "  git add -A && git reset HEAD .env AI_CHAT/.env 2>/dev/null; git commit -m '...' && git push origin main"
echo "On live server: git pull && rebuild api-node, web, restart AI_CHAT if changed."
echo "Optional local verify after sync:"
echo "  (cd live_web_tracking_folder_2/sdk && npm ci && npm run build)"
echo "  (cd live_web_tracking_folder_2/web && npm ci && npm run build)"
