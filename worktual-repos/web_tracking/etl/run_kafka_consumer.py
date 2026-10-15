#!/usr/bin/env python3
"""Run Kafka → ClickHouse consumer (INGEST_WRITE_MODE=kafka or dual)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ETL_DIR = Path(__file__).resolve().parent
ROOT = ETL_DIR.parent

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ETL_DIR))
os.chdir(ETL_DIR)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv(ROOT / ".env")
elif (ROOT / ".env").exists():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    from config import get_settings, uses_kafka
    from kafka.consumer import run_consumer

    settings = get_settings()
    if not uses_kafka(settings):
        print(
            f"INGEST_WRITE_MODE={settings.ingest_write_mode!r} — "
            "Kafka consumer is not required (set kafka or dual to run).",
            file=sys.stderr,
        )
        return 1

    print(
        f"Kafka consumer → topic {settings.kafka_topic} "
        f"(group {settings.kafka_consumer_group})"
    )
    run_consumer(settings)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
