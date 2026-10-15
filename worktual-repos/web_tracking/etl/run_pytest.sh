#!/usr/bin/env bash
# Run ETL unit tests from anywhere.
set -euo pipefail
ETL="$(cd "$(dirname "$0")" && pwd)"
cd "$ETL"
exec pytest tests/test_kafka_envelope.py tests/test_replay_validation.py -v "$@"
