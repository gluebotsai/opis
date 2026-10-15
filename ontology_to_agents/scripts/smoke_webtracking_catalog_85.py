#!/usr/bin/env python3
"""Execute all webtracking templates for every entitled (org, website) pair.

Loads pairs from mart_web_sites. Uses template_execute (not full allowlist)
so the 85 × periods × sites gate is ClickHouse-bound.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.sql.db import run_clickhouse_query  # noqa: E402
from semantic.sql.template_execute import execute_prepared_templates  # noqa: E402
from semantic.sql.webtracking_dim_catalog import webtracking_catalog_dims  # noqa: E402

TPL = ROOT / "semantic" / "sql" / "metric_templates" / "webtracking.yml"
PERIODS = ["week", "overall"]
# today/month share the same templates + extra_where; week covers bounded time,
# overall covers unbounded. Full four-pill matrix is too slow on mart views.
REP_DIMS = ["device", "city", "page_path", "utm_source", "form_id", "country"]
REP_METRICS = [
    "unique_visitors",
    "web_session_volume",
    "form_abandons",
    "total_revenue",
]


def _load_metrics() -> list[str]:
    data = yaml.safe_load(TPL.read_text(encoding="utf-8")) or {}
    return sorted((data.get("metrics") or {}).keys())


def _load_pairs() -> list[dict]:
    rows = run_clickhouse_query(
        """
        SELECT organization_id, website_id
        FROM webtracking_marts.mart_web_sites
        ORDER BY organization_id, website_id
        """,
        [],
    )
    return [
        {
            "organization_id": int(r["organization_id"]),
            "website_id": int(r["website_id"]),
        }
        for r in rows
    ]


def _prepared(org: int, website: int, metric: str, period: str, **extra) -> dict:
    body = {
        "organizationId": org,
        "organization_id": org,
        "userId": 1,
        "product": "webtracking",
        "execution_product": "webtracking",
        "agent": "webtracking.analytics",
        "metrics": [metric],
        "time": {"period": period},
        "websiteId": website,
        "website_id": website,
        "user_filters": [],
        "group_by_requested": [],
        "limit": 20,
    }
    body.update(extra)
    return body


def main() -> int:
    os.environ.setdefault("WEBTRACKING_MONTH_ROLLING", "1")
    metrics = _load_metrics()
    pairs = _load_pairs()
    if not pairs:
        print("FAIL: no mart_web_sites pairs", file=sys.stderr)
        return 1
    if len(metrics) < 80:
        print(f"FAIL: expected ~85 metrics, got {len(metrics)}", file=sys.stderr)
        return 1

    errors: list[dict] = []
    ok = 0
    for pair in pairs:
        org, wid = pair["organization_id"], pair["website_id"]
        for mid in metrics:
            for period in PERIODS:
                try:
                    res = execute_prepared_templates(
                        _prepared(org, wid, mid, period)
                    )
                    rows = res.get("rows") or []
                    if not rows:
                        errors.append(
                            {
                                "organization_id": org,
                                "website_id": wid,
                                "metric": mid,
                                "period": period,
                                "error": "empty rows",
                            }
                        )
                    else:
                        ok += 1
                except Exception as exc:  # noqa: BLE001
                    errors.append(
                        {
                            "organization_id": org,
                            "website_id": wid,
                            "metric": mid,
                            "period": period,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    )
            print(f"  done {org}/{wid} {mid} errors={len(errors)}", flush=True)

        dim_cases = [
            ("unique_visitors", "device"),
            ("unique_visitors", "page_path"),
            ("web_session_volume", "country"),
            ("form_abandons", "form_id"),
            ("form_abandons", "device"),
            ("total_revenue", "country"),
        ]
        for mid, dim in dim_cases:
                try:
                    execute_prepared_templates(
                        _prepared(
                            org,
                            wid,
                            mid,
                            "overall",
                            group_by_requested=[dim],
                        )
                    )
                    ok += 1
                except Exception as exc:  # noqa: BLE001
                    errors.append(
                        {
                            "organization_id": org,
                            "website_id": wid,
                            "metric": mid,
                            "dim": dim,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    )

    catalog = webtracking_catalog_dims()
    from semantic.lookup import get_allowed_dims

    allowed = set(get_allowed_dims("web_session_volume", product="webtracking"))
    missing_allow = [d for d in catalog if d not in allowed]
    if missing_allow:
        errors.append({"error": "catalog dims not allowed", "dims": missing_allow[:20]})

    # Commerce: semantic 0 is a fail if fact_conversion_events has rows.
    for pair in pairs:
        org, wid = pair["organization_id"], pair["website_id"]
        try:
            facts = run_clickhouse_query(
                """
                SELECT count() AS n, sum(value) AS revenue
                FROM web_tracking.fact_conversion_events
                WHERE organization_id = %s AND website_id = %s
                """,
                [org, wid],
            )
        except Exception:
            facts = run_clickhouse_query(
                """
                SELECT count() AS n, sum(value) AS revenue
                FROM webtracking_marts.mart_conversion_events
                WHERE organization_id = %s AND website_id = %s
                """,
                [org, wid],
            )
        n = int((facts[0] or {}).get("n") or 0)
        revenue = (facts[0] or {}).get("revenue") or 0
        sem = execute_prepared_templates(
            _prepared(org, wid, "total_conversions", "overall")
        )
        sem_n = int((sem.get("rows") or [{}])[0].get("total_conversions") or 0)
        if n > 0 and sem_n == 0:
            errors.append(
                {
                    "organization_id": org,
                    "website_id": wid,
                    "metric": "total_conversions",
                    "error": f"CH conversions={n} semantic=0",
                }
            )
        if float(revenue or 0) > 0:
            sem_r = execute_prepared_templates(
                _prepared(org, wid, "total_revenue", "overall")
            )
            sval = float((sem_r.get("rows") or [{}])[0].get("total_revenue") or 0)
            if sval == 0:
                errors.append(
                    {
                        "organization_id": org,
                        "website_id": wid,
                        "metric": "total_revenue",
                        "error": f"CH revenue={revenue} semantic=0",
                    }
                )

    report = {
        "pairs": pairs,
        "metric_count": len(metrics),
        "ok": ok,
        "errors": errors[:80],
        "error_count": len(errors),
        "catalog_dim_count": len(catalog),
    }
    out = ROOT / "scripts" / "webtracking_catalog_85_report.json"
    out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(
        f"pairs={len(pairs)} metrics={len(metrics)} ok={ok} "
        f"errors={len(errors)} catalog_dims={len(catalog)}"
    )
    print(f"wrote {out}")
    if errors:
        for e in errors[:15]:
            print(" ERR", e, file=sys.stderr)
        return 1
    print("OK: 85-metric entitled-site catalog smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
