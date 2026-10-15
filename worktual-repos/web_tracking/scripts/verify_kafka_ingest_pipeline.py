#!/usr/bin/env python3
"""End-to-end Kafka ingest verification: Kafka publish → ClickHouse raw_payloads.

Checks that a test payload:
  1. Is published to Kafka with the correct envelope shape
  2. Appears on topic cdp.ingestion.webtracking (or KAFKA_TOPIC)
  3. Is written to ClickHouse raw_payloads (by running consumer or existing worker)

Usage (from project root):

  # Direct Kafka publish + inline consumer insert + CH verify (no ingest API needed)
  python scripts/verify_kafka_ingest_pipeline.py --consume-one

  # Publish via ingest API (requires INGEST_WRITE_MODE=kafka or dual + running ingest)
  python scripts/verify_kafka_ingest_pipeline.py --via-api

  # Publish to Kafka, wait for your running kafka consumer to insert into ClickHouse
  python scripts/verify_kafka_ingest_pipeline.py

  # Custom marker in Kafka JSON (grep topic logs for this string)
  python scripts/verify_kafka_ingest_pipeline.py --consume-one --sdk-version dnalnlafn

  # JSON field: organization_id (same as DB column name)
  python scripts/verify_kafka_ingest_pipeline.py --consume-one --organization-id 987654321

Requires .env with KAFKA_* and CLICKHOUSE_* (see .env.example).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ETL = ROOT / "etl"

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ETL))

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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify Kafka → ClickHouse ingest pipeline.")
    parser.add_argument(
        "--via-api",
        action="store_true",
        help="POST test payload to ingest API instead of publishing directly to Kafka.",
    )
    parser.add_argument(
        "--consume-one",
        action="store_true",
        help="Insert the Kafka message into ClickHouse inline (no long-running consumer needed).",
    )
    parser.add_argument(
        "--ingest-url",
        default="",
        help="Ingest URL for --via-api (default: INGEST_PUBLIC_URL or localhost:INGEST_PORT).",
    )
    parser.add_argument(
        "--kafka-timeout",
        type=float,
        default=30.0,
        help="Seconds to wait for message on Kafka topic.",
    )
    parser.add_argument(
        "--clickhouse-timeout",
        type=float,
        default=30.0,
        help="Seconds to wait for row in raw_payloads.",
    )
    parser.add_argument(
        "--sdk-version",
        default="dnalnlafn",
        help='Value for payload sdkVersion (default: dnalnlafn — easy to find in Kafka logs).',
    )
    parser.add_argument(
        "--website-id",
        type=int,
        default=12345,
        help="websiteId in test payload (default: 12345).",
    )
    parser.add_argument(
        "--website-url",
        default="https://beta.worktual.co.uk",
        help="websiteUrl in test payload.",
    )
    parser.add_argument(
        "--organization-id",
        type=int,
        default=None,
        help=(
            "Optional client organization_id (must match dict_admin_accounts for --website-id). "
            "Omit to simulate the SDK — server injects org on insert."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full result JSON on success.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    from config import get_settings, uses_kafka
    from kafka.verify import VerificationError, run_pipeline_verification

    settings = get_settings()
    print("Kafka ingest pipeline verification")
    print(f"  brokers:  {settings.kafka_bootstrap_servers}")
    print(f"  topic:    {settings.kafka_topic}")
    print(f"  mode:     INGEST_WRITE_MODE={settings.ingest_write_mode}")
    print(f"  via_api:  {args.via_api}")
    print(f"  consume:  {'inline (--consume-one)' if args.consume_one else 'wait for running consumer'}")
    print(f"  sdkVersion: {args.sdk_version!r}  (grep Kafka logs for this string)")
    org_label = args.organization_id if args.organization_id is not None else "(omitted — server adds from website)"
    print(f"  organization_id: {org_label}")
    print("")

    if args.via_api and not uses_kafka(settings):
        print(
            "WARNING: INGEST_WRITE_MODE=direct — ingest API will not publish to Kafka. "
            "Set INGEST_WRITE_MODE=kafka or dual.",
            file=sys.stderr,
        )

    if not args.consume_one and not args.via_api:
        print(
            "Tip: use --consume-one to insert into ClickHouse without a running kafka consumer, "
            "or start: python etl/run_kafka_consumer.py",
        )
        print("")

    try:
        result = run_pipeline_verification(
            via_api=args.via_api,
            ingest_url=args.ingest_url or None,
            consume_one=args.consume_one,
            kafka_timeout_s=args.kafka_timeout,
            clickhouse_timeout_s=args.clickhouse_timeout,
            settings=settings,
            log=print,
            sdk_version=args.sdk_version,
            website_id=args.website_id,
            website_url=args.website_url,
            organization_id=args.organization_id,
        )
    except VerificationError as exc:
        print(f"\nFAILED: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        from ingest.service import PayloadRejectedError

        if isinstance(exc, PayloadRejectedError):
            print(f"\nFAILED: {exc}", file=sys.stderr)
            print(
                "Tip: omit --organization-id (server injects from admin) or use the registered org "
                "for your --website-id.",
                file=sys.stderr,
            )
            return 1
        print(f"\nERROR: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 2

    print("\nPASSED — Kafka → ClickHouse pipeline verified")
    print(f"  payload_id: {result['payload_id']}")
    print(f"  organization_id: {result.get('organization_id')}")
    for step, detail in result.get("steps", {}).items():
        print(f"  {step}: {detail}")

    if args.json:
        print(json.dumps(result, indent=2, default=str))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
