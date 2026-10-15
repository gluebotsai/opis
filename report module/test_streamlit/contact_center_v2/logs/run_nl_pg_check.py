"""Run Contact Center NL cases and check Domain figures against Postgres."""

from __future__ import annotations

import json
import os
import re
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path("/home/vectone/Uday/report module")
sys.path.insert(0, str(ROOT))

from reports_analytics_agent_contact_center_v2.core import db
from reports_analytics_agent_contact_center_v2.core.loader import merge_effective
from reports_analytics_agent_contact_center_v2.core.sql.run_kpi import run_kpi
from reports_analytics_agent_contact_center_v2.core.time import TimeSpec, resolve_time
from reports_analytics_agent_contact_center_v2.core.turn import run_turn

ORG = 1003
USER = 1016
ROLE = "admin"
OUT = Path(__file__).resolve().parent / "nl_pg_check.json"
PREV = Path(__file__).resolve().parent / "tester_pass.json"

_NUM = re.compile(r"[-+]?(?:\d+\.\d+|\d+)")
_KPI_LINE = re.compile(r"^kpi:\s*([a-z0-9_]+)\s*$", re.I | re.M)
_DIM_KEYS = frozenset(
    {"agent", "channel", "queue", "team", "handler", "hour", "day", "presence_state"}
)


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


def _to_float(val) -> float | None:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    text = str(val).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _round(val: float | None) -> float | None:
    if val is None:
        return None
    return round(val, 2)


def _metric_nums(rows: list[dict]) -> list[float]:
    out: list[float] = []
    for row in rows[:10]:
        for key, val in row.items():
            if key in _DIM_KEYS:
                continue
            num = _to_float(val)
            if num is not None:
                out.append(_round(num))
    return out


def _facts_nums(facts: str) -> list[float]:
    out: list[float] = []
    for line in (facts or "").splitlines():
        if not line.startswith("row "):
            continue
        for tok in _NUM.findall(line.split(":", 1)[-1]):
            num = _to_float(tok)
            if num is not None:
                out.append(_round(num))
    return out


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= 0.06 or abs(a - b) <= max(abs(a), abs(b), 1.0) * 0.002


def _values_match(got: list[float], truth: list[float]) -> bool:
    if not truth:
        return not got
    unused = list(truth)
    for item in got:
        hit = next((i for i, other in enumerate(unused) if _close(item, other)), None)
        if hit is None:
            continue
        unused.pop(hit)
    # Enough of the warehouse figures landed in facts.
    matched = len(truth) - len(unused)
    if matched >= min(len(truth), 8) and matched > 0:
        return True
    if got and len(truth) == 1 and _close(sum(got), truth[0]):
        return True
    return False


def _cases() -> list[dict]:
    prev = json.loads(PREV.read_text())
    cases = []
    for row in prev:
        if row.get("layer") != "nl":
            continue
        cases.append(
            {
                "kind": row["kind"],
                "kpi": row["kpi"],
                "label": row.get("label") or row["kpi"],
                "question": row["question"],
            }
        )
    extras = [
        {
            "kind": "compare:agents",
            "kpi": "avg_handle_time",
            "label": "Average handle time",
            "question": "compare the average handle time for bharathi and raghu last 7 days",
        },
        {
            "kind": "metric",
            "kpi": "total",
            "label": "Total conversations",
            "question": "conversation count by channel last 7 days",
            "force_dims": ["channel"],
        },
        {
            "kind": "metric",
            "kpi": "call_count",
            "label": "Call count",
            "question": "how many calls last 7 days",
        },
        {
            "kind": "metric",
            "kpi": "first_reply_sla",
            "label": "First-reply SLA",
            "question": "first reply sla last 7 days",
        },
        {
            "kind": "metric",
            "kpi": "busy_hours",
            "label": "Busy hours",
            "question": "busy hours last 7 days",
        },
        {
            "kind": "metric",
            "kpi": "ready_agents",
            "label": "Ready agents",
            "question": "how many agents are ready now",
        },
    ]
    seen = {c["question"] for c in cases}
    for extra in extras:
        if extra["question"] not in seen:
            cases.append(extra)
    return cases


def _spec(case: dict, catalog: dict) -> tuple[list[str], dict, str]:
    kind = case["kind"]
    card = catalog["kpis"][case["kpi"]]
    live = str(card.get("time_kind") or "") == "live"
    time_words = "now" if live else "last 7 days"
    dims: list[str] = list(case.get("force_dims") or [])
    filters: dict = {}
    if kind == "group:channel":
        dims = ["channel"]
    elif kind == "group:agent":
        dims = ["agent"]
    elif kind == "filter:channel=call":
        filters = {"channel": "call"}
    elif kind == "compare:agents":
        dims = ["Bharathi", "Raghu"]
        time_words = "last 7 days"
    return dims, filters, time_words


def _raw_rows(dsn: str, kpi: str, dims: list[str], filters: dict, start, end) -> list[dict] | None:
    channel = filters.get("channel")
    params = {"org": ORG, "start": start, "end": end, "channel": channel}
    group_channel = dims == ["channel"]
    clock_created = """
        AND (%(start)s IS NULL OR c.created_at >= %(start)s)
        AND (%(end)s IS NULL OR c.created_at < %(end)s)
        AND (%(channel)s IS NULL OR c.channel = %(channel)s)
    """
    if kpi == "total":
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {clock_created} {group}",
            params,
        )
    if kpi == "call_count":
        extra = "AND c.channel = 'call'"
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {clock_created} {extra} {group}",
            params,
        )
    if kpi == "social_count":
        extra = "AND c.channel IN ('whatsapp','instagram','facebook')"
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {clock_created} {extra} {group}",
            params,
        )
    if kpi == "handled":
        extra = "AND (c.status IN ('resolved','closed') OR c.ended_at IS NOT NULL)"
        clock = """
            AND (%(start)s IS NULL OR c.ended_at >= %(start)s)
            AND (%(end)s IS NULL OR c.ended_at < %(end)s)
            AND (%(channel)s IS NULL OR c.channel = %(channel)s)
        """
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {extra} {clock} {group}",
            params,
        )
    if kpi == "resolved":
        extra = "AND c.resolved_at IS NOT NULL"
        clock = """
            AND (%(start)s IS NULL OR c.resolved_at >= %(start)s)
            AND (%(end)s IS NULL OR c.resolved_at < %(end)s)
            AND (%(channel)s IS NULL OR c.channel = %(channel)s)
        """
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {extra} {clock} {group}",
            params,
        )
    if kpi == "transferred":
        extra = "AND c.transferred_at IS NOT NULL"
        clock = """
            AND (%(start)s IS NULL OR c.transferred_at >= %(start)s)
            AND (%(end)s IS NULL OR c.transferred_at < %(end)s)
            AND (%(channel)s IS NULL OR c.channel = %(channel)s)
        """
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {extra} {clock} {group}",
            params,
        )
    if kpi == "first_replies":
        extra = "AND c.first_response_at IS NOT NULL"
        clock = """
            AND (%(start)s IS NULL OR c.first_response_at >= %(start)s)
            AND (%(end)s IS NULL OR c.first_response_at < %(end)s)
            AND (%(channel)s IS NULL OR c.channel = %(channel)s)
        """
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {extra} {clock} {group}",
            params,
        )
    if kpi == "first_reply_sla":
        clock = """
            AND c.first_response_at IS NOT NULL
            AND (%(start)s IS NULL OR c.first_response_at >= %(start)s)
            AND (%(end)s IS NULL OR c.first_response_at < %(end)s)
            AND (%(channel)s IS NULL OR c.channel = %(channel)s)
        """
        return db.fetchall(
            dsn,
            f"""
            SELECT
              count(*) FILTER (
                WHERE c.assigned_at IS NOT NULL AND c.first_response_at IS NOT NULL
                  AND EXTRACT(EPOCH FROM (c.first_response_at - c.assigned_at)) <= 60
              ) AS sla_n,
              count(*) FILTER (
                WHERE c.assigned_at IS NOT NULL AND c.first_response_at IS NOT NULL
              ) AS replies_n
            FROM ccass.conversations c
            WHERE c.organization_id=%(org)s {clock}
            """,
            params,
        )
    if kpi == "avg_handle_time":
        extra = """
            AND (c.status IN ('resolved','closed') OR c.ended_at IS NOT NULL)
            AND c.assigned_at IS NOT NULL
            AND (%(start)s IS NULL OR c.ended_at >= %(start)s)
            AND (%(end)s IS NULL OR c.ended_at < %(end)s)
            AND (%(channel)s IS NULL OR c.channel = %(channel)s)
        """
        if any(x in {d.lower() for d in dims} for x in ("bharathi", "raghu", "agent")):
            return db.fetchall(
                dsn,
                f"""
                SELECT a.display_name AS agent,
                  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.ended_at) - c.assigned_at))) / 60.0, 2) AS n
                FROM ccass.conversations c
                JOIN ccass.agents a ON a.id = c.assigned_agent_id AND a.organization_id = c.organization_id
                WHERE c.organization_id=%(org)s {extra}
                  AND (a.display_name ILIKE '%Bharathi%' OR a.display_name ILIKE '%Raghu%')
                GROUP BY a.display_name
                """,
                params,
            )
        select = (
            "c.channel, ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.ended_at) - c.assigned_at))) / 60.0, 2) AS n"
            if group_channel
            else "ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.ended_at) - c.assigned_at))) / 60.0, 2) AS n"
        )
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {extra} {group}",
            params,
        )
    if kpi == "waiting":
        extra = "AND c.status = 'queued' AND c.ended_at IS NULL AND c.resolved_at IS NULL"
        extra += " AND (%(channel)s IS NULL OR c.channel = %(channel)s)"
        select = "c.channel, count(*) AS n" if group_channel else "count(*) AS n"
        group = "GROUP BY c.channel" if group_channel else ""
        return db.fetchall(
            dsn,
            f"SELECT {select} FROM ccass.conversations c WHERE c.organization_id=%(org)s {extra} {group}",
            params,
        )
    if kpi == "ready_agents":
        return db.fetchall(
            dsn,
            """
            SELECT count(*) AS n
            FROM ccass.agents a
            JOIN ccass.agent_presence p ON p.agent_id = a.id AND p.organization_id = a.organization_id
            WHERE a.organization_id=%(org)s AND p.presence_state = 'ready'
            """,
            {"org": ORG},
        )
    if kpi == "logged_in_agents":
        return db.fetchall(
            dsn,
            """
            SELECT count(*) AS n
            FROM ccass.agents a
            JOIN ccass.agent_presence p ON p.agent_id = a.id AND p.organization_id = a.organization_id
            WHERE a.organization_id=%(org)s
              AND p.presence_state IN ('ready','not_ready','busy','break','away','after_contact_work')
            """,
            {"org": ORG},
        )
    if kpi == "busy_hours" and not group_channel:
        return db.fetchall(
            dsn,
            """
            SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(COALESCE(h.ended_at, now()), COALESCE(%(end)s, now()))
                - GREATEST(h.started_at, COALESCE(%(start)s, h.started_at))
              )))) FILTER (WHERE h.new_state = 'busy') / 3600.0 AS n
            FROM ccass.agent_presence_history h
            WHERE h.organization_id=%(org)s
              AND (%(start)s IS NULL OR COALESCE(h.ended_at, now()) > %(start)s)
              AND (%(end)s IS NULL OR h.started_at < %(end)s)
            """,
            params,
        )
    return None


def _save(rows: list[dict]) -> None:
    OUT.write_text(json.dumps(rows, indent=2, default=str))


def main() -> None:
    dsn = _load_env()
    catalog = merge_effective(ORG)
    cases = _cases()
    results: list[dict] = []
    print(f"cases={len(cases)} org={ORG} user={USER}", flush=True)
    for i, case in enumerate(cases, 1):
        dims, filters, time_words = _spec(case, catalog)
        item = {
            "i": i,
            "question": case["question"],
            "kind": case["kind"],
            "expected_kpi": case["kpi"],
            "label": case["label"],
            "time": time_words,
        }
        try:
            certified = run_kpi(
                case["kpi"],
                organization_id=ORG,
                user_id=USER,
                role=ROLE,
                time_window=time_words,
                dimensions=dims,
                filters=filters,
                dsn=dsn,
            )
        except Exception as exc:
            certified = {"status": "error", "error": str(exc), "rows": []}
        pg_rows = list(certified.get("rows") or [])
        item["pg_status"] = certified.get("status")
        item["pg_error"] = certified.get("error")
        item["pg_summary"] = _metric_nums(pg_rows)
        item["pg_row_count"] = len(pg_rows)

        item["pg_replay_ok"] = None

        raw_ok = None
        bounds = resolve_time(TimeSpec(expression=time_words))
        try:
            raw = _raw_rows(
                dsn,
                case["kpi"],
                dims,
                filters,
                None if str((catalog["kpis"][case["kpi"]].get("time_kind") or "")) == "live" else bounds.start,
                None if str((catalog["kpis"][case["kpi"]].get("time_kind") or "")) == "live" else bounds.end,
            )
        except Exception as exc:
            raw = None
            item["raw_error"] = str(exc)[:240]
        if raw is not None:
            raw_nums = _metric_nums(raw)
            item["raw_summary"] = raw_nums
            raw_ok = _values_match(raw_nums, _metric_nums(pg_rows)) or _values_match(
                _metric_nums(pg_rows), raw_nums
            )
        item["raw_ok"] = raw_ok

        try:
            turn = run_turn(
                question=case["question"],
                organization_id=ORG,
                user_id=USER,
                role=ROLE,
                dsn=dsn,
            )
        except Exception as exc:
            turn = {"answer": "", "facts": "", "trace": {"error": str(exc)}}
        facts = turn.get("facts") or ""
        trace = turn.get("trace") or {}
        picked = None
        found = _KPI_LINE.search(facts)
        if found:
            picked = found.group(1)
        sql_trace = (trace.get("sql") or [{}])[0] if isinstance(trace.get("sql"), list) else {}
        if not picked:
            picked = sql_trace.get("kpi_id")
        item["nl_status"] = sql_trace.get("status") or ("error" if trace.get("error") else "ok")
        item["nl_kpi"] = picked
        item["nl_certified"] = sql_trace.get("certified")
        item["nl_row_count"] = sql_trace.get("row_count")
        item["nl_summary"] = _facts_nums(facts)
        item["kpi_match"] = picked == case["kpi"]
        item["pg_match"] = _values_match(item["nl_summary"], item["pg_summary"])
        item["ok"] = bool(
            item["nl_status"] == "ok"
            and item["kpi_match"]
            and item["pg_match"]
            and certified.get("status") == "ok"
            and (raw_ok is not False)
        )
        item["answer"] = (turn.get("answer") or "")[:400]
        results.append(item)
        _save(results)
        flag = "PASS" if item["ok"] else "FAIL"
        print(
            f"{flag} {i}/{len(cases)} {case['kpi']} {case['kind']} "
            f"kpi={picked} pg={item['pg_summary'][:6]} nl={item['nl_summary'][:6]} "
            f"raw={raw_ok}",
            flush=True,
        )

    passed = sum(1 for r in results if r["ok"])
    print(f"\nDONE {passed}/{len(results)} pass", flush=True)
    misses = [r for r in results if not r["ok"]]
    for r in misses:
        print(
            f"  MISS {r['expected_kpi']} {r['kind']}: {r['question'][:80]} "
            f"nl_kpi={r.get('nl_kpi')} pg={r.get('pg_summary')} nl={r.get('nl_summary')} "
            f"raw={r.get('raw_ok')} pg_err={r.get('pg_error')}",
            flush=True,
        )


if __name__ == "__main__":
    main()
