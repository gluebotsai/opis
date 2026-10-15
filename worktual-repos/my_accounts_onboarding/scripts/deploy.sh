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

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

prepare_shared_env() {
  mkdir -p "$SHARED_DIR"

  if [[ ! -f "$SHARED_DIR/.env" ]]; then
    if [[ -f "$REPO_ROOT/.env" ]]; then
      cp "$REPO_ROOT/.env" "$SHARED_DIR/.env"
      log "Copied runner .env to ${SHARED_DIR}/.env"
    elif [[ -f "$REPO_ROOT/.env.example" ]]; then
      cp "$REPO_ROOT/.env.example" "$SHARED_DIR/.env"
      log "Created ${SHARED_DIR}/.env from .env.example — update credentials before production use"
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
    --exclude dist \
    --exclude .pnpm-store \
    --exclude backend/.venv \
    --exclude .env \
    "$REPO_ROOT/" "$RELEASE_DIR/"
}

install_and_build() {
  cd "$RELEASE_DIR"

  ln -sfn "$SHARED_DIR/.env" .env

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/ensure-prerequisites.sh"
  postgres_is_reachable || fail "Local Postgres is not reachable on localhost:5432"

  pnpm install --frozen-lockfile
  pnpm run build

  [[ -d dist ]] || fail "dist/ missing after build"

  log "Verifying server module imports"
  node --input-type=module -e "import('./server/db/migrate.js')" \
    || fail "Server import check failed — fix module paths before deploying"

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/load-shared-env.sh"
  load_shared_env "$SHARED_DIR/.env"

  node --input-type=module -e "import('./server/db/migrate.js').then((m) => m.migrateDatabase())"
  node scripts/smoke-test-db.mjs
  node scripts/smoke-test-payments.mjs
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
