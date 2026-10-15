"""Live matrix: every Contact Center certified KPI × time × dimensions.

Read-only. Uses pack run_kpi (same path as the Streamlit gate).
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from reports_analytics_agent_contact_center.sql_executor.core.loader import merge_effective  # noqa: E402
from reports_analytics_agent_contact_center.sql_executor.core.run_kpi import run_kpi  # noqa: E402
from reports_analytics_agent_contact_center.core.time import resolve_expression  # noqa: E402

DSN = os.getenv("DATABASE_URL") or os.getenv("PG_DSN")
ORG = int(os.getenv("CC_TEST_ORG", "1003"))
USER = int(os.getenv("CC_TEST_USER", "1006"))
ROLE = os.getenv("CC_TEST_ROLE", "admin")
WORKERS = int(os.getenv("CC_TEST_WORKERS", "4"))
OUT = Path(os.getenv("CC_TEST_OUT", str(ROOT / "testing_scripts" / "cc_kpi_live_matrix.json")))

WINDOWS: list[tuple[str, str | None]] = [
    ("overall", "all time"),
    ("1_day", "last 1 day"),
    ("last_7_days", "last 7 days"),
    ("last_30_days", "last 30 days"),
    ("custom_14_days", "last 14 days"),
    ("custom_iso", None),  # explicit bounds below
]

CUSTOM_ISO = (
    datetime(2026, 8, 1, tzinfo=timezone.utc),
    datetime(2026, 9, 1, tzinfo=timezone.utc),
)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat().replace("+00:00", "Z")


def _bounds(label: str, expr: str | None) -> tuple[str | None, str | None, str]:
    if label == "custom_iso":
        start, end = CUSTOM_ISO
        return _iso(start), _iso(end), "2026-08-01–2026-09-01 UTC"
    tb = resolve_expression(expr)
    return _iso(tb.start), _iso(tb.end), tb.echo


def _job(
    *,
    kpi_id: str,
    window: str,
    start: str | None,
    end: str | None,
    echo: str,
    dimension: str | None,
) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "kpi_id": kpi_id,
        "window": window,
        "dimension": dimension,
        "time_echo": echo,
        "time_start": start,
        "time_end": end,
    }
    try:
        res = run_kpi(
            kpi_id,
            organization_id=ORG,
            user_id=USER,
            role=ROLE,
            scope_level="org",
            time_start=start,
            time_end=end,
            dimension=dimension,
            dsn=DSN,
        )
        rec["status"] = res.get("status")
        rec["error_type"] = res.get("error_type")
        rec["error"] = res.get("error")
        rec["row_count"] = len(res.get("rows") or [])
        rows = res.get("rows") or []
        rec["sample"] = rows[:3]
        rec["sql_ok"] = bool(res.get("sql"))
    except Exception as exc:
        rec["status"] = "error"
        rec["error_type"] = "EXCEPTION"
        rec["error"] = f"{type(exc).__name__}: {exc}"
        rec["traceback"] = traceback.format_exc()[-1500:]
        rec["row_count"] = 0
    return rec


def main() -> int:
    if not DSN:
        print("No DATABASE_URL / PG_DSN")
        return 2
    catalog = merge_effective(ORG)
    kpis = catalog["kpis"]
    jobs: list[dict[str, Any]] = []
    windows_resolved: dict[str, tuple[str | None, str | None, str]] = {}
    for label, expr in WINDOWS:
        windows_resolved[label] = _bounds(label, expr)

    # All KPIs × every time window, no dimension.
    for kpi_id, card in kpis.items():
        levels = card.get("allowed_scope_levels") or []
        if levels and "org" not in levels:
            continue
        for label, (start, end, echo) in windows_resolved.items():
            jobs.append(
                dict(
                    kpi_id=kpi_id,
                    window=label,
                    start=start,
                    end=end,
                    echo=echo,
                    dimension=None,
                )
            )

    # All KPIs × every allowed dimension on last 7 days and overall.
    dim_windows = ("overall", "last_7_days")
    for kpi_id, card in kpis.items():
        levels = card.get("allowed_scope_levels") or []
        if levels and "org" not in levels:
            continue
        dims = [str(d) for d in (card.get("allowed_dimensions") or []) if d]
        for dim in dims:
            for label in dim_windows:
                start, end, echo = windows_resolved[label]
                jobs.append(
                    dict(
                        kpi_id=kpi_id,
                        window=label,
                        start=start,
                        end=end,
                        echo=echo,
                        dimension=dim,
                    )
                )

    print(f"org={ORG} user={USER} role={ROLE} jobs={len(jobs)} kpis={len(kpis)}")
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = [pool.submit(_job, **j) for j in jobs]
        done = 0
        for fut in as_completed(futs):
            results.append(fut.result())
            done += 1
            if done % 50 == 0 or done == len(jobs):
                fails = sum(1 for r in results if r["status"] not in ("ok", "compiled"))
                print(f"  {done}/{len(jobs)} done, failures={fails}", flush=True)

    ok = [r for r in results if r["status"] == "ok"]
    compiled = [r for r in results if r["status"] == "compiled"]
    fail = [r for r in results if r["status"] not in ("ok", "compiled")]
    empty_ok = [r for r in ok if r["row_count"] == 0]

    by_kpi: dict[str, dict[str, int]] = {}
    for r in results:
        slot = by_kpi.setdefault(r["kpi_id"], {"ok": 0, "fail": 0, "empty": 0})
        if r["status"] == "ok":
            slot["ok"] += 1
            if r["row_count"] == 0:
                slot["empty"] += 1
        else:
            slot["fail"] += 1

    fail_msgs: dict[str, int] = {}
    for r in fail:
        key = f"{r['kpi_id']}|{r.get('dimension')}|{r['window']}|{r.get('error_type')}|{str(r.get('error') or '')[:240]}"
        fail_msgs[key] = fail_msgs.get(key, 0) + 1

    report = {
        "org": ORG,
        "user": USER,
        "role": ROLE,
        "windows": {k: {"start": v[0], "end": v[1], "echo": v[2]} for k, v in windows_resolved.items()},
        "job_count": len(jobs),
        "ok": len(ok),
        "compiled_no_exec": len(compiled),
        "fail": len(fail),
        "empty_ok": len(empty_ok),
        "by_kpi": by_kpi,
        "failures": sorted(fail, key=lambda r: (r["kpi_id"], r["window"], str(r.get("dimension")))),
        "fail_msgs": fail_msgs,
    }
    OUT.write_text(json.dumps(report, default=str, indent=2))
    print(f"ok={len(ok)} fail={len(fail)} empty_ok={len(empty_ok)} wrote {OUT}")
    for key, n in sorted(fail_msgs.items())[:80]:
        print(f"FAIL {n}x {key}")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
