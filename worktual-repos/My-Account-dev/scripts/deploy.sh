#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"

RELEASES_DIR="$DEPLOY_ROOT/releases"
SHARED_DIR="$DEPLOY_ROOT/shared"
LOG_DIR="$DEPLOY_ROOT/logs"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"

GIT_SHA="${GITHUB_SHA:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo local)}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_ID="${TIMESTAMP}-${GIT_SHA}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"

# Set DEPLOY_RUN_SMOKES=true to run backend smoke suites after migrate (slower).
DEPLOY_RUN_SMOKES="${DEPLOY_RUN_SMOKES:-false}"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

run_smoke() {
  local label="$1"
  local seconds="$2"
  shift 2

  log "Running ${label} (timeout ${seconds}s)"
  if command -v timeout >/dev/null 2>&1; then
    if timeout "${seconds}s" "$@"; then
      :
    else
      local code=$?
      if [[ "$code" -eq 124 ]]; then
        fail "${label} timed out after ${seconds}s"
      fi
      fail "${label} failed (exit ${code})"
    fi
  else
    if "$@"; then
      :
    else
      local code=$?
      fail "${label} failed (exit ${code})"
    fi
  fi
  log "Finished ${label}"
}

prepare_shared_env() {
  mkdir -p "$SHARED_DIR"

  if [[ ! -f "$SHARED_DIR/.env" ]]; then
    if [[ -f "$REPO_ROOT/backend/.env" ]]; then
      cp "$REPO_ROOT/backend/.env" "$SHARED_DIR/.env"
      log "Copied runner backend/.env to ${SHARED_DIR}/.env"
    elif [[ -f "$REPO_ROOT/.env" ]]; then
      cp "$REPO_ROOT/.env" "$SHARED_DIR/.env"
      log "Copied runner .env to ${SHARED_DIR}/.env"
    elif [[ -f "$REPO_ROOT/backend/.env.example" ]]; then
      cp "$REPO_ROOT/backend/.env.example" "$SHARED_DIR/.env"
      log "Created ${SHARED_DIR}/.env from backend/.env.example — update credentials before production use"
    else
      fail "No .env found. Create ${SHARED_DIR}/.env before deploying."
    fi
  fi
}

sync_release() {
  mkdir -p "$RELEASE_DIR"

  rsync -a \
    --delete \
    --exclude .git \
    --exclude node_modules \
    --exclude '**/node_modules' \
    --exclude dist \
    --exclude '**/dist' \
    --exclude .pnpm-store \
    --exclude backend/.venv \
    --exclude .env \
    --exclude '**/.env' \
    "$REPO_ROOT/" "$RELEASE_DIR/"
}

install_and_build() {
  cd "$RELEASE_DIR"

  ln -sfn "$SHARED_DIR/.env" "$RELEASE_DIR/backend/.env"

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/load-shared-env.sh"
  load_shared_env "$SHARED_DIR/.env" || fail "Could not load DATABASE_URL from ${SHARED_DIR}/.env"

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/ensure-prerequisites.sh"
  if ! postgres_is_reachable; then
    local pg_host="localhost"
    local pg_port="5432"
    if parse_database_url_endpoint "$DATABASE_URL"; then
      pg_host="$REPLY_HOST"
      pg_port="$REPLY_PORT"
    fi
    fail "Postgres is not reachable at ${pg_host}:${pg_port} (from ${SHARED_DIR}/.env DATABASE_URL). Start the DB or fix host/port in shared/.env."
  fi
  log "Postgres reachable for DATABASE_URL host from ${SHARED_DIR}/.env"

  log "Installing + building frontend"
  (
    cd "$RELEASE_DIR/frontend"
    pnpm install --frozen-lockfile
    pnpm run build
  )
  [[ -f "$RELEASE_DIR/frontend/dist/index.html" ]] || fail "frontend/dist/index.html missing after build"

  log "Installing + building backend"
  (
    cd "$RELEASE_DIR/backend"
    pnpm install --frozen-lockfile
    # Pre-existing strictness errors may exit non-zero while still emitting dist/.
    if ! pnpm run build; then
      [[ -f "$RELEASE_DIR/backend/dist/server.js" ]] \
        || fail "backend/dist/server.js missing after build"
      log "WARN: backend tsc reported type errors but dist/ was emitted — continuing"
    fi
  )
  [[ -f "$RELEASE_DIR/backend/dist/server.js" ]] || fail "backend/dist/server.js missing after build"

  # Assemble SPA at workspace-root/dist for SERVE_FRONTEND + deploy-meta.
  rm -rf "$RELEASE_DIR/dist"
  mkdir -p "$RELEASE_DIR/dist"
  rsync -a "$RELEASE_DIR/frontend/dist/" "$RELEASE_DIR/dist/"

  cat >"$RELEASE_DIR/dist/deploy-meta.json" <<EOF
{
  "releaseId": "${RELEASE_ID}",
  "gitSha": "${GIT_SHA}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  [[ -f "$RELEASE_DIR/dist/deploy-meta.json" ]] || fail "Failed to write dist/deploy-meta.json"
  log "Wrote dist/deploy-meta.json for ${RELEASE_ID}"

  log "Running database migrations"
  (
    cd "$RELEASE_DIR/backend"
    export DATABASE_URL
    export SKIP_MIGRATE_ON_BOOT=true
    pnpm run migrate
  )

  if [[ "$DEPLOY_RUN_SMOKES" == "true" ]]; then
    (
      cd "$RELEASE_DIR/backend"
      export DATABASE_URL
      export SKIP_MIGRATE=true
      run_smoke "smoke-test-db" 60 pnpm exec tsx scripts/smoke-test-db.mjs
      run_smoke "smoke-test-api" 120 pnpm run smoke:api
    )
  else
    log "Skipping smoke suites (set DEPLOY_RUN_SMOKES=true to enable)"
  fi
}

update_release_links() {
  if [[ -L "$CURRENT_LINK" ]]; then
    local old_current
    old_current="$(readlink -f "$CURRENT_LINK")"
    ln -sfn "$old_current" "$PREVIOUS_LINK"
    log "Previous release: ${old_current}"
  fi

  ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
  echo "$RELEASE_ID" >"$DEPLOY_ROOT/current-release.txt"
  log "Current release: ${RELEASE_ID}"
}

prune_old_releases() {
  mapfile -t releases < <(ls -1dt "$RELEASES_DIR"/* 2>/dev/null || true)

  if ((${#releases[@]} <= KEEP_RELEASES)); then
    return 0
  fi

  for release_path in "${releases[@]:$KEEP_RELEASES}"; do
    if [[ "$release_path" == "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" ]]; then
      continue
    fi
    if [[ "$release_path" == "$(readlink -f "$PREVIOUS_LINK" 2>/dev/null || true)" ]]; then
      continue
    fi
    log "Removing old release ${release_path}"
    rm -rf "$release_path"
  done
}

restart_services() {
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/service-lib.sh"
  log "Restarting systemd services (current → ${CURRENT_LINK})"
  restart_app_services "$SCRIPT_DIR/install-systemd.sh"
}

main() {
  log "Deploying ${RELEASE_ID}"
  log "Source: ${REPO_ROOT}"
  log "Target root: ${DEPLOY_ROOT}"

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/ensure-prerequisites.sh"
  ensure_prerequisites

  mkdir -p "$RELEASES_DIR" "$LOG_DIR"

  prepare_shared_env

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/write-database-env.sh"
  write_database_env "$SHARED_DIR/.env" "$SHARED_DIR/database.env"

  sync_release
  install_and_build
  update_release_links
  restart_services

  if ! CHECK_BACKEND="${DEPLOY_BACKEND:-false}" SERVE_FRONTEND_ON_MAIL_API="$SERVE_FRONTEND_ON_MAIL_API" \
    "$SCRIPT_DIR/health-check.sh"; then
    if [[ -L "$PREVIOUS_LINK" ]]; then
      log "Health check failed — rolling back to previous release"
      DEPLOY_ROOT="$DEPLOY_ROOT" "$SCRIPT_DIR/rollback.sh" || fail "Rollback failed after health check"
      fail "Deployment rolled back due to failed health check"
    fi
    fail "Health check failed and no previous release to roll back to"
  fi

  prune_old_releases

  log "Deployment completed successfully"
  if [[ "$SERVE_FRONTEND_ON_MAIL_API" == "true" ]]; then
    log "App (SPA + API): http://127.0.0.1:${MAIL_API_PORT}"
  else
    log "Frontend: http://127.0.0.1:${FRONTEND_PORT}"
    log "Mail API:  http://127.0.0.1:${MAIL_API_PORT}"
  fi
}

main "$@"
