#!/usr/bin/env python3
"""Full-matrix webtracking semantic smoke (Commit 7).

Loads entitled (org, website) pairs from ClickHouse at runtime — no hardcoded
tenant ids in application code. Sample ids appear only as CH query results.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.query import QueryValidationError, SemanticQuery, execute  # noqa: E402
from semantic.sql.db import run_clickhouse_query  # noqa: E402

SMOKE_METRICS = [
    "web_session_volume",
    "unique_visitors",
    "bounce_rate",
    "online_visitors",
    "page_views",
]
PERIODS = ["week", "month", "overall"]


def load_tenant_matrix() -> list[dict]:
    """Entitled sites from mart_web_sites, with session counts for cost ranking."""
    rows = run_clickhouse_query(
        """
        SELECT
            s.organization_id AS organization_id,
            s.website_id AS website_id,
            count() AS session_rows
        FROM webtracking_marts.mart_web_sites AS s
        LEFT JOIN webtracking_marts.mart_web_sessions AS sess
            ON sess.organization_id = s.organization_id
           AND sess.website_id = s.website_id
        GROUP BY s.organization_id, s.website_id
        ORDER BY session_rows DESC, s.organization_id, s.website_id
        """,
        [],
    )
    return [
        {
            "organization_id": int(r["organization_id"]),
            "website_id": int(r["website_id"]),
            "session_rows": int(r["session_rows"] or 0),
        }
        for r in rows
    ]


def _scalar(result: dict, metric: str):
    rows = result.get("rows") or []
    if not rows:
        return 0
    row = rows[0]
    return row.get(metric, row.get(list(row.keys())[0] if row else None))


def smoke_pair(org: int, website: int) -> list[dict]:
    out: list[dict] = []
    for metric in SMOKE_METRICS:
        for period in PERIODS:
            t0 = time.perf_counter()
            try:
                res = execute(
                    SemanticQuery(
                        organization_id=org,
                        user_id=1,
                        product="webtracking",
                        agent="webtracking.analytics",
                        website_id=website,
                        metrics=[metric],
                        time={"period": period},
                    )
                )
                elapsed = time.perf_counter() - t0
                src = res.get("source") or (res.get("meta") or {}).get("source")
                out.append(
                    {
                        "organization_id": org,
                        "website_id": website,
                        "metric": metric,
                        "period": period,
                        "status": "ok",
                        "value": _scalar(res, metric),
                        "source": src,
                        "elapsed_s": round(elapsed, 3),
                    }
                )
            except Exception as exc:  # noqa: BLE001 — smoke report
                out.append(
                    {
                        "organization_id": org,
                        "website_id": website,
                        "metric": metric,
                        "period": period,
                        "status": "error",
                        "error": f"{type(exc).__name__}: {exc}",
                        "elapsed_s": round(time.perf_counter() - t0, 3),
                    }
                )
    # device filter on unique_visitors
    t0 = time.perf_counter()
    try:
        res = execute(
            SemanticQuery(
                organization_id=org,
                user_id=1,
                product="webtracking",
                agent="webtracking.analytics",
                website_id=website,
                metrics=["unique_visitors"],
                time={"period": "overall"},
                filters=[{"dimension": "device", "op": "=", "values": ["mobile"]}],
            )
        )
        out.append(
            {
                "organization_id": org,
                "website_id": website,
                "metric": "unique_visitors",
                "period": "overall",
                "filter": "device=mobile",
                "status": "ok",
                "value": _scalar(res, "unique_visitors"),
                "source": res.get("source"),
                "elapsed_s": round(time.perf_counter() - t0, 3),
            }
        )
    except Exception as exc:  # noqa: BLE001
        out.append(
            {
                "organization_id": org,
                "website_id": website,
                "metric": "unique_visitors",
                "filter": "device=mobile",
                "status": "error",
                "error": f"{type(exc).__name__}: {exc}",
            }
        )
    return out


def smoke_cross_tenant(matrix: list[dict]) -> dict | None:
    """Pick two different orgs; request org A's JWT with org B's website."""
    by_org: dict[int, list[int]] = {}
    for row in matrix:
        by_org.setdefault(row["organization_id"], []).append(row["website_id"])
    if len(by_org) < 2:
        return {"status": "skip", "reason": "need ≥2 orgs in matrix"}
    orgs = sorted(by_org.keys())
    org_a, org_b = orgs[0], orgs[1]
    foreign_site = by_org[org_b][0]
    try:
        execute(
            SemanticQuery(
                organization_id=org_a,
                user_id=1,
                product="webtracking",
                agent="webtracking.analytics",
                website_id=foreign_site,
                metrics=["web_session_volume"],
                time={"period": "overall"},
            )
        )
        return {
            "status": "fail",
            "error": "expected website_not_entitled",
            "organization_id": org_a,
            "website_id": foreign_site,
        }
    except QueryValidationError as exc:
        if exc.code == "website_not_entitled":
            return {
                "status": "ok",
                "code": exc.code,
                "organization_id": org_a,
                "website_id": foreign_site,
            }
        return {"status": "error", "error": f"QueryValidationError:{exc.code}:{exc}"}
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "website_not_entitled" in msg:
            return {
                "status": "ok",
                "code": "website_not_entitled",
                "organization_id": org_a,
                "website_id": foreign_site,
            }
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    matrix = load_tenant_matrix()
    if not matrix:
        print("FAIL: empty tenant matrix from mart_web_sites", file=sys.stderr)
        return 1

    report: dict = {
        "matrix": matrix,
        "largest": matrix[0],
        "cross_tenant": smoke_cross_tenant(matrix),
        "results": [],
        "cost_largest": [],
    }

    for pair in matrix:
        report["results"].extend(
            smoke_pair(pair["organization_id"], pair["website_id"])
        )

    # Cost: unique_visitors overall + month on largest pair
    largest = matrix[0]
    for period in ("overall", "month"):
        t0 = time.perf_counter()
        res = execute(
            SemanticQuery(
                organization_id=largest["organization_id"],
                user_id=1,
                product="webtracking",
                agent="webtracking.analytics",
                website_id=largest["website_id"],
                metrics=["unique_visitors"],
                time={"period": period},
            )
        )
        report["cost_largest"].append(
            {
                "organization_id": largest["organization_id"],
                "website_id": largest["website_id"],
                "metric": "unique_visitors",
                "period": period,
                "session_rows": largest["session_rows"],
                "value": _scalar(res, "unique_visitors"),
                "wall_s": round(time.perf_counter() - t0, 3),
                "note": "audit tenants are tiny; rows scanned ≈ session_rows for this grain",
            }
        )

    errors = [r for r in report["results"] if r.get("status") == "error"]
    ct = report["cross_tenant"] or {}
    failed = bool(errors) or ct.get("status") in ("fail", "error")

    out_path = ROOT / "scripts" / "webtracking_matrix_smoke_report.json"
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    print(f"matrix pairs: {len(matrix)}")
    for p in matrix:
        print(
            f"  org={p['organization_id']} site={p['website_id']} "
            f"sessions={p['session_rows']}"
        )
    print(f"cross_tenant: {ct.get('status')} code={ct.get('code')}")
    print(f"smoke rows: {len(report['results'])} errors: {len(errors)}")
    print(f"cost_largest: {report['cost_largest']}")
    print(f"wrote {out_path}")
    if failed:
        for e in errors[:10]:
            print(f"  ERR {e}", file=sys.stderr)
        return 1
    print("OK: webtracking tenant matrix smoke passed")
    return 0


if __name__ == "__main__":
    # Prefer rolling month when smoke runs against go config
    os.environ.setdefault("WEBTRACKING_MONTH_ROLLING", "0")
    raise SystemExit(main())
