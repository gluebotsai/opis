#!/usr/bin/env python3
"""Capture MetricFlow rendered SQL into metric_templates.yml (run after dbt parse).

Usage:
  PYTHONPATH=. python3 scripts/generate_metric_sql_templates.py --org 1000 --product ccaas

Requires: dbt-metricflow, manifests, API credentials in .env
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DEFAULT_METRICS = [
    "total_conversations",
    "open_conversations",
    "ai_containment_rate",
    "average_handle_time",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", type=int, default=1000)
    parser.add_argument("--product", default="contact_centre")
    parser.add_argument("--agent", default="cc.reporting")
    parser.add_argument("--metrics", nargs="*", default=DEFAULT_METRICS)
    args = parser.parse_args()

    from semantic.query import SemanticQuery, execute

    captured: dict[str, dict] = {}
    for mid in args.metrics:
        try:
            result = execute(
                SemanticQuery(
                    organization_id=args.org,
                    user_id=1001,
                    product=args.product,
                    agent=args.agent,
                    metrics=[mid],
                )
            )
            sql = result.get("sql")
            if sql:
                captured[mid] = {
                    "product": "ccaas",
                    "result_column": mid,
                    "sql": sql,
                    "captured_from": "metricflow",
                }
                print(f"  captured {mid}")
            else:
                print(f"  skip {mid} (no sql in response)")
        except Exception as exc:
            print(f"  fail {mid}: {exc}")

    if not captured:
        print("No SQL captured — check MetricFlow install and manifests.")
        return 1

    out_path = ROOT / "semantic/sql/metric_templates_captured.yml"
    try:
        import yaml

        out_path.write_text(
            yaml.safe_dump({"metrics": captured}, sort_keys=False),
            encoding="utf-8",
        )
    except ImportError:
        out_path.write_text(str(captured), encoding="utf-8")

    print(f"Wrote {out_path} ({len(captured)} metrics)")
    print("Review and merge into semantic/sql/metric_templates.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
