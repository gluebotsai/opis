#!/usr/bin/env bash
# Run from Live_web_tracking_folder root (same folder as scripts/).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
exec python scripts/verify_kafka_ingest_pipeline.py "$@"
