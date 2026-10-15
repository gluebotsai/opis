#!/usr/bin/env bash
# Start the Context Layer API from repo root. MetricFlow engines always warm.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="."

if [[ -z "${PYTHON:-}" ]]; then
  if [[ -x "${HOME}/miniconda3/envs/myenv/bin/python" ]]; then
    PYTHON="${HOME}/miniconda3/envs/myenv/bin/python"
  else
    PYTHON="python3"
  fi
fi
export PYTHON
PYTHON_BIN="$(dirname "$PYTHON")"
export PATH="${PYTHON_BIN}:${PATH}"
if [[ -z "${DBT_EXE:-}" && -x "${PYTHON_BIN}/dbt" ]]; then
  export DBT_EXE="${PYTHON_BIN}/dbt"
fi

export MF_WARM=1
PORT="${PORT:-8765}"

if [[ "${SKIP_DBT_RUN:-}" != "1" ]]; then
  echo "Ensuring warehouse marts exist (set SKIP_DBT_RUN=1 to skip)..."
  "$PYTHON" scripts/ensure_warehouse_marts.py
fi

echo "Context Layer API → http://0.0.0.0:${PORT}"
echo "MetricFlow engines warm on startup (crm, ccaas, ticketing, campaign) before traffic."
exec "$PYTHON" -m uvicorn api.main:app --host 0.0.0.0 --port "$PORT" "$@"
