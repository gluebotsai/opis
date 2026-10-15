"""Run every certified KPI across the time windows used in Streamlit testing."""

from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path("/home/vectone/Uday/report module")
sys.path.insert(0, str(ROOT))

from reports_analytics_agent_contact_center_v2.core import loader
from reports_analytics_agent_contact_center_v2.core.sql.run_kpi import run_kpi
from reports_analytics_agent_contact_center_v2.core.time import resolve_expression

ORG = 1003
USER = 1016
ROLE = "admin"
OUT = Path(__file__).resolve().parent / "kpi_window_matrix.json"

WINDOWS = [
    "all time",
    "last 1 day",
    "last 7 days",
    "last 30 days",
    "this month",
    "this quarter",
]
LIVE = {
    "waiting",
    "active",
    "bot_active",
    "ready_agents",
    "logged_in_agents",
    "offers_ringing",
    "sla_at_risk",
    "sla_breached_live",
}
COUNT_KEYS = {
    "total",
    "call_count",
    "social_count",
    "handled",
    "resolved",
    "transferred",
    "abandoned",
    "first_replies",
    "missed_contacts",
    "callback_count",
}


def _load_env() -> str:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return os.environ["DATABASE_URL"]


def _jsonable(val):
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, dict):
        return {k: _jsonable(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_jsonable(v) for v in val]
    return val


def _group_dim(card: dict) -> str | None:
    allowed = [str(x) for x in (card.get("allowed_dimensions") or [])]
    for cand in ("channel", "presence_state", "agent"):
        if cand in allowed:
            return cand
    return None


def _headline(rows: list[dict]) -> dict:
    if not rows:
        return {}
    row = rows[0]
    skip = {
        "channel",
        "agent",
        "queue",
        "team",
        "handler",
        "day",
        "week",
        "month",
        "hour",
        "presence_state",
    }
    out = {}
    for key, val in row.items():
        if key in skip:
            continue
        if isinstance(val, Decimal):
            out[key] = float(val)
        elif isinstance(val, (int, float)) or val is None:
            out[key] = val
        else:
            out[key] = str(val)
    return out


def main() -> None:
    dsn = _load_env()
    catalog = loader.merge_effective(ORG)
    loader.merge_effective = lambda *a, **k: catalog
    kpis = catalog["kpis"]
    now = datetime.now(timezone.utc)
    window_echo = {}
    for phrase in WINDOWS:
        b = resolve_expression(phrase, now=now)
        window_echo[phrase] = {
            "start": b.start.isoformat() if b.start else None,
            "end": b.end.isoformat() if b.end else None,
            "echo": b.echo,
        }

    results: list[dict] = []
    failures: list[str] = []
    total_runs = 0
    kids = list(kpis)
    print(f"kpis={len(kids)} windows={WINDOWS}", flush=True)
    print("window_echo", json.dumps(window_echo, indent=2), flush=True)

    for kid in kids:
        card = kpis[kid]
        live = kid in LIVE or str(card.get("time_kind") or "") == "live"
        phrases = ["now"] if live else list(WINDOWS)
        dim = _group_dim(card)
        jobs = [(p, None) for p in phrases]
        if dim:
            jobs.append((phrases[0], dim))
        for phrase, dimension in jobs:
            total_runs += 1
            label = f"{kid} | {phrase}" + (f" | by {dimension}" if dimension else "")
            try:
                out = run_kpi(
                    kid,
                    organization_id=ORG,
                    user_id=USER,
                    role=ROLE,
                    time_window=phrase,
                    dimensions=[dimension] if dimension else None,
                    dsn=dsn,
                )
            except Exception as exc:
                out = {
                    "status": "error",
                    "error": f"{type(exc).__name__}: {exc}",
                    "rows": [],
                    "traceback": traceback.format_exc(),
                }
            status = out.get("status")
            rows = out.get("rows") or []
            rec = {
                "kpi": kid,
                "window": phrase,
                "dimension": dimension,
                "status": status,
                "error": out.get("error"),
                "time_echo": out.get("time_echo"),
                "row_count": len(rows),
                "headline": _headline(rows),
                "channels": [
                    r.get("channel")
                    for r in rows
                    if isinstance(r, dict) and r.get("channel") is not None
                ]
                if dimension == "channel"
                else [],
            }
            results.append(rec)
            ok = status == "ok"
            if not ok:
                failures.append(f"FAIL {label}: {out.get('error')}")
            # Fix-specific checks
            if kid in {"resolution_rate", "transfer_rate"} and phrase == "all time" and not dimension:
                rate = rec["headline"].get("rate_pct")
                if rate is None and (rec["headline"].get("handled_n") or 0) > 0:
                    failures.append(f"FAIL {label}: rate_pct is None with handled rows")
                    ok = False
            if kid == "avg_first_response" and phrase == "all time" and not dimension:
                val = rec["headline"].get("avg_first_response")
                if val is not None and float(val) < 0:
                    failures.append(f"FAIL {label}: negative first response {val}")
                    ok = False
            if kid == "asa" and dimension == "channel" and phrase in {"all time", "now"}:
                names = set(rec["channels"])
                for missing in ("call", "email"):
                    if missing not in names and rec["row_count"] > 0:
                        failures.append(f"FAIL {label}: {missing} omitted from channel split")
                        ok = False
            if phrase == "last 7 days" and not live:
                echo = str(out.get("time_echo") or "")
                if "calendar" not in echo.lower() and "previous 6" not in echo.lower():
                    failures.append(f"WARN {label}: last 7 days echo is not calendar ({echo})")
            mark = "OK" if ok else "FAIL"
            print(
                f"{mark} {label} rows={rec['row_count']} echo={out.get('time_echo')} "
                f"head={rec['headline']} err={out.get('error')}",
                flush=True,
            )

    # Monotonic counts: last 1 day <= last 7 <= last 30 <= all time
    by_kpi: dict[str, dict[str, float]] = {}
    for rec in results:
        if rec["dimension"] or rec["kpi"] not in COUNT_KEYS:
            continue
        head = rec["headline"]
        num = None
        for key in ("total", "call_count", "social_count", "handled", "resolved", "transferred", "abandoned", "first_replies", "missed_contacts", "callback_count"):
            if key in head and head[key] is not None:
                num = float(head[key])
                break
        if num is None:
            continue
        by_kpi.setdefault(rec["kpi"], {})[rec["window"]] = num
    for kid, vals in by_kpi.items():
        chain = ["last 1 day", "last 7 days", "last 30 days", "all time"]
        prev = None
        prev_name = None
        for name in chain:
            if name not in vals:
                continue
            if prev is not None and vals[name] + 1e-9 < prev:
                failures.append(
                    f"FAIL {kid}: {name}={vals[name]} is smaller than {prev_name}={prev}"
                )
            prev = vals[name]
            prev_name = name

    payload = {
        "ran_at": now.isoformat(),
        "org": ORG,
        "windows": window_echo,
        "runs": total_runs,
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "failed": sum(1 for r in results if r["status"] != "ok"),
        "failures": failures,
        "results": _jsonable(results),
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str))
    print(f"\nDONE runs={total_runs} ok={payload['ok']} failed={payload['failed']}", flush=True)
    print(f"wrote {OUT}", flush=True)
    for line in failures:
        print(line, flush=True)


if __name__ == "__main__":
    main()
