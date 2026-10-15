#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILE="${BACKUP_DIR}/worktual_db_${TIMESTAMP}.sql"

mkdir -p "${BACKUP_DIR}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-worktual}"
PGDATABASE="${PGDATABASE:-worktual_db}"

echo "Backing up ${PGDATABASE} to ${FILE}"
pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -F p -f "${FILE}"
echo "Done: ${FILE}"
