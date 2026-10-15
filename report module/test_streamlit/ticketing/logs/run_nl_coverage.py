"""Ticketing NL coverage via pack turn (same path as Streamlit 8503)."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/vectone/Uday/report module")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "test_streamlit/ticketing"))
os.chdir(ROOT)

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from reports_analytics_agent_ticketing_v2.core.loader import merge_effective
from reports_analytics_agent_ticketing_v2.core.run_kpi import run_kpi
from reports_analytics_agent_ticketing_v2.core.run_sql import run_sql
from test_streamlit.ticketing.turn import queues_for_identity, run_turn

ORG, USER, ROLE = 1012, 1033, "admin"
DSN = os.getenv("DATABASE_URL")
OUT = ROOT / "test_streamlit/ticketing/logs"
OUT.mkdir(parents=True, exist_ok=True)

KPI_NL = [
    ("ticket_count", "How many tickets are there?"),
    ("avg_tickets_per_day", "What is the average tickets per day?"),
    ("avg_open_ticket_age", "What is the average open ticket age?"),
    ("days_since_last_ticket", "How many days since the last ticket?"),
    ("resolution_rate", "What is the ticket resolution rate?"),
    ("assignment_rate", "What is the assignment rate?"),
    ("reopen_count", "How many tickets were reopened?"),
    ("reopen_rate", "What is the reopen rate?"),
    ("escalation_rate", "What is the escalation rate?"),
    ("reassignment_rate", "What is the reassignment rate?"),
    ("avg_first_response_time", "What is the average first response time?"),
    ("avg_resolution_time", "What is the average resolution time?"),
    ("avg_resolution_variance_vs_sla", "What is average resolution variance versus SLA?"),
    ("first_response_sla_compliance", "What is first response SLA compliance?"),
    ("resolution_sla_compliance", "What is resolution SLA compliance?"),
    ("sla_breach_rate", "What is the SLA breach rate?"),
    ("first_response_at_risk_count", "How many tickets are at risk for first response SLA?"),
    ("resolution_at_risk_count", "How many tickets are at risk for resolution SLA?"),
    ("no_sla_count", "How many tickets have no SLA?"),
    ("queues_at_risk", "Which queues are at risk?"),
    ("average_overdue_hours", "What is the average overdue hours?"),
    ("avg_csat", "What is the average CSAT?"),
    ("csat_response_rate", "What is the CSAT response rate?"),
    ("csat_distribution_rate", "What is the CSAT distribution?"),
    ("customers_served", "How many customers were served?"),
    ("accounts_served", "How many accounts were served?"),
    ("active_customers", "How many active customers are there?"),
    ("total_customers", "How many total customers are there?"),
    ("active_agents", "How many active agents are there?"),
    ("total_users", "How many total users are there?"),
    ("queue_count", "How many queues are there?"),
    ("queue_coverage", "What is queue coverage?"),
    ("distinct_agents_in_queues", "How many distinct agents are in queues?"),
    ("distinct_queues_covered", "How many distinct queues are covered?"),
    ("note_count", "How many ticket notes are there?"),
    ("escalation_count", "How many escalations are there?"),
    ("reassignment_count", "How many reassignments are there?"),
    ("kb_article_count", "How many knowledge base articles are there?"),
    ("kb_views", "How many KB views are there?"),
    ("recommendation_count", "How many recommendations are there?"),
    ("recommendation_acceptance_rate", "What is the recommendation acceptance rate?"),
    ("approval_count", "How many approvals are there?"),
    ("approval_rate", "What is the approval rate?"),
    ("unread_notifications", "How many unread notifications are there?"),
]

DIM_NL = [
    ("ticket_count", "queue", "How many tickets by queue?"),
    ("ticket_count", "agent", "How many tickets by agent?"),
    ("ticket_count", "resolver", "Ticket count by resolver"),
    ("ticket_count", "status", "Ticket count by status"),
    ("ticket_count", "priority", "Tickets by priority"),
    ("ticket_count", "channel", "Tickets by channel"),
    ("ticket_count", "category", "Tickets by category"),
    ("ticket_count", "customer", "Tickets by customer"),
    ("ticket_count", "created_by", "Tickets by created by"),
    ("ticket_count", "month", "Ticket volume by month"),
    ("ticket_count", "week", "Ticket volume by week"),
    ("ticket_count", "day", "Ticket volume by day"),
    ("resolution_rate", "queue", "Resolution rate by queue"),
    ("avg_csat", "agent", "Average CSAT by agent"),
    ("sla_breach_rate", "priority", "SLA breach rate by priority"),
]

TIME_NL = [
    ("How many tickets in the last 7 days?", "last 7 days"),
    ("How many tickets in the last 30 days?", "last 30 days"),
    ("How many tickets in the last 1 day?", "last 1 day"),
    ("How many tickets from 2026-09-01 to 2026-09-15?", "2026-09-01 to 2026-09-15"),
]

FREE_NL = [
    "List queues",
    "Find teams named billing",
    "List all ticket statuses",
    "List agents",
    "List open tickets",
    "Find ticket number 104",
]

KG_NL = [
    "Why are tickets stuck or overdue?",
    "Walk the staffing path for a queue",
    "Show the neighborhood around a ticket",
    "Who wrote notes on recent tickets?",
]


def conv(q: str) -> dict:
    try:
        out = run_turn(q, organization_id=ORG, user_id=USER, role=ROLE)
    except Exception as exc:
        return {
            "question": q,
            "plan": [],
            "status": "error",
            "kpi": None,
            "dim": None,
            "tool": None,
            "n": 0,
            "err": "EXC",
            "error": str(exc)[:300],
            "answer": "",
            "grounded": False,
            "executors": [],
        }
    trace = out.get("trace") or {}
    plan = (trace.get("plan") or {}).get("tasks") or []
    tasks = trace.get("tasks") or []
    t0 = tasks[0] if tasks else {}
    return {
        "question": q,
        "plan": [{k: x.get(k) for k in ("executor", "kpi", "dimension", "time", "goal")} for x in plan if isinstance(x, dict)],
        "status": t0.get("status"),
        "kpi": t0.get("kpi_id") or (t0.get("task") or {}).get("kpi"),
        "dim": t0.get("requested_dimension") or (t0.get("task") or {}).get("dimension"),
        "tool": t0.get("tool"),
        "n": len(t0.get("rows") or []),
        "err": t0.get("error_type"),
        "error": (t0.get("error") or "")[:300],
        "answer": (out.get("answer") or "")[:350],
        "grounded": trace.get("grounded"),
        "executors": [(t.get("task") or {}).get("executor") for t in tasks],
    }


def main() -> None:
    queues = queues_for_identity(organization_id=ORG, user_id=USER, role=ROLE, dsn=DSN)
    catalog = merge_effective(ORG)
    kpis = catalog.get("kpis") or {}
    rows = []
    rows.append(f"# Ticketing NL coverage report")
    rows.append(f"Generated: {datetime.now(timezone.utc).isoformat()}")
    rows.append(f"Gate: `test_streamlit/ticketing` Streamlit **http://localhost:8503**")
    rows.append(f"Identity used for automated turns (typed into the same gate contract): org `{ORG}`, user `{USER}`, role `{ROLE}`, queues `{queues}`")
    rows.append("")

    rows.append("## 1. Certified KPI `run_kpi` matrix (live Postgres)")
    fail_m = 0
    for kpi_id, meta in kpis.items():
        dims = [None] + list(meta.get("allowed_dimensions") or [])
        for dim in dims:
            res = run_kpi(
                kpi_id,
                organization_id=ORG,
                user_id=USER,
                role=ROLE,
                queue_ids=queues,
                dimension=dim,
                dsn=DSN,
            )
            ok = res.get("status") in {"ok", "success"}
            if not ok:
                fail_m += 1
            mark = "OK" if ok else "FAIL"
            rows.append(
                f"- {mark} `{kpi_id}` dim=`{dim or '-'}` status={res.get('status')} "
                f"err={res.get('error_type')} rows={len(res.get('rows') or [])} {(res.get('error') or '')[:120]}"
            )
    rows.append(f"**matrix_fails={fail_m}**")
    rows.append("")
    (OUT / "nl_coverage_report.md").write_text("\n".join(rows) + "\n")
    print("section1_done", fail_m, flush=True)

    rows.append("## 2. Live SELECT checks")
    for label, sql in [
        ("ticket_count", "SELECT COUNT(*)::bigint AS n FROM rpt.tickets"),
        ("by_status", "SELECT status, COUNT(*)::bigint AS n FROM rpt.tickets GROUP BY 1 ORDER BY 2 DESC"),
        ("queues", "SELECT id, queue_name FROM rpt.queues ORDER BY queue_name LIMIT 10"),
    ]:
        res = run_sql(sql, organization_id=ORG, user_id=USER, role=ROLE, queue_ids=queues, dsn=DSN)
        rows.append(f"- `{label}` status={res.get('status')} n={len(res.get('rows') or [])} sample={res.get('rows', [])[:3]}")
    rows.append("")
    (OUT / "nl_coverage_report.md").write_text("\n".join(rows) + "\n")
    print("section2_done", flush=True)

    rows.append("## 3. Conversational KPI NL")
    kpi_miss = 0
    recs = []
    for expected, q in KPI_NL:
        r = conv(q)
        recs.append(r)
        hit = r["kpi"] == expected
        if not hit:
            kpi_miss += 1
        mark = "HIT" if hit and r["status"] in {"ok", "success"} else ("OK_OTHER" if r["status"] in {"ok", "success"} else "FAIL")
        rows.append(f"- {mark} expect=`{expected}` got=`{r['kpi']}` dim={r['dim']} n={r['n']} err={r['err']} | {q}")
        rows.append(f"  - plan={r['plan']}")
        rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:220]}")
        print("kpi_nl", mark, expected, r["kpi"], r["status"], flush=True)
        (OUT / "nl_coverage_report.md").write_text("\n".join(rows) + "\n")
    rows.append(f"**kpi_id_misses={kpi_miss}/{len(KPI_NL)}**")
    rows.append("")

    rows.append("## 4. Conversational dimensions")
    dim_miss = 0
    for expected, dim, q in DIM_NL:
        r = conv(q)
        recs.append(r)
        cert = (r["kpi"] == expected) and (str(r["dim"] or "").lower() == dim)
        grouped = r["n"] > 1 and r["status"] in {"ok", "success"}
        if cert:
            mark = "CERT"
        elif grouped:
            mark = "SQL_GROUPED"
            dim_miss += 1
        else:
            mark = "FAIL"
            dim_miss += 1
        rows.append(f"- {mark} `{expected}` want_dim=`{dim}` got_kpi=`{r['kpi']}` got_dim=`{r['dim']}` n={r['n']} err={r['err']} | {q}")
        rows.append(f"  - plan={r['plan']}")
    rows.append(f"**dimension_checks_not_ok={dim_miss}/{len(DIM_NL)}**")
    rows.append("")

    rows.append("## 5. Time windows")
    for q, _hint in TIME_NL:
        r = conv(q)
        recs.append(r)
        mark = "OK" if r["status"] in {"ok", "success"} else "FAIL"
        t = r["plan"][0].get("time") if r["plan"] else None
        rows.append(f"- {mark} time_plan=`{t}` n={r['n']} err={r['err']} | {q}")
        rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:200]}")
    rows.append("")

    rows.append("## 6. Free-flow list/find SQL")
    for q in FREE_NL:
        r = conv(q)
        recs.append(r)
        mark = "OK" if r["status"] in {"ok", "success"} else "FAIL"
        rows.append(f"- {mark} tool=`{r['tool']}` kpi=`{r['kpi']}` n={r['n']} err={r['err']} | {q}")
        rows.append(f"  - plan={r['plan']}")
        rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:200]}")
    rows.append("")

    rows.append("## 7. Knowledge graph NL")
    for q in KG_NL:
        r = conv(q)
        recs.append(r)
        kg = "kg" in (r.get("executors") or []) or r.get("tool") == "run_cypher"
        mark = "KG" if kg else "NOT_KG"
        if r["status"] not in {"ok", "success"}:
            mark = "FAIL"
        rows.append(f"- {mark} exec={r.get('executors')} tool=`{r['tool']}` n={r['n']} err={r['err']} | {q}")
        rows.append(f"  - plan={r['plan']}")
        rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:240]}")
    rows.append("")

    (OUT / "nl_coverage.json").write_text(json.dumps(recs, default=str, indent=2))
    report = "\n".join(rows) + "\n"
    (OUT / "nl_coverage_report.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
