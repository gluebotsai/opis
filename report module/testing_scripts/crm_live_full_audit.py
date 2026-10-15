"""Live CRM audit: all KPIs × dims × time, free SQL, NL + KG. Org 1003 admin."""

from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from reports_analytics_agent_CRM_B2B.core.loader import load_kpis
from reports_analytics_agent_CRM_B2B.core.run_kpi import REFUSAL_KPIS, run_kpi
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql
from test_streamlit.crm_b2b.turn import run_turn

ORG, USER, ROLE = 1003, 1017, "admin"
OUT = ROOT / "testing_scripts" / "crm_live_full_audit.json"

TIME_WINDOWS = [None, "last 7 days", "last 30 days", "this month"]


def canon(rows, n=6):
    out = []
    for r in (rows or [])[:n]:
        item = {}
        for k, v in r.items():
            item[k] = float(v) if isinstance(v, Decimal) else v
        out.append(item)
    return out


def ok_res(kpi_id, res):
    st = res.get("status")
    err = res.get("error_type") or ""
    return st in {"ok", "success"} or kpi_id in REFUSAL_KPIS or err == "UNAVAILABLE_KPI"


def kpi_matrix():
    kpis = load_kpis()
    cells = []
    for kpi_id in sorted(kpis):
        meta = kpis[kpi_id]
        dims = [None] + [d for d in (meta.get("allowed_dimensions") or []) if d]
        for dim in dims:
            res = run_kpi(kpi_id, organization_id=ORG, user_id=USER, role=ROLE, dimension=dim)
            cells.append(
                {
                    "kpi": kpi_id,
                    "dim": dim,
                    "ok": ok_res(kpi_id, res),
                    "status": res.get("status"),
                    "err": res.get("error_type") or "",
                    "n": len(res.get("rows") or []),
                    "rows": canon(res.get("rows")),
                    "error": (res.get("error") or "")[:200],
                }
            )
    return cells


def time_matrix():
    kpis = load_kpis()
    cells = []
    for kpi_id in sorted(kpis):
        if kpi_id in REFUSAL_KPIS:
            continue
        for tw in TIME_WINDOWS:
            res = run_kpi(
                kpi_id,
                organization_id=ORG,
                user_id=USER,
                role=ROLE,
                time_window=tw,
            )
            cells.append(
                {
                    "kpi": kpi_id,
                    "time": tw or "all_time",
                    "ok": ok_res(kpi_id, res),
                    "status": res.get("status"),
                    "err": res.get("error_type") or "",
                    "n": len(res.get("rows") or []),
                    "rows": canon(res.get("rows"), 3),
                    "error": (res.get("error") or "")[:200],
                }
            )
    return cells


def sql_checks():
    q = [
        ("open_deals", "SELECT COUNT(*)::bigint AS n FROM rpt.deals WHERE is_open = TRUE"),
        ("open_by_owner", "SELECT COALESCE(owner_name, 'Unassigned') AS owner, COUNT(*)::bigint AS n FROM rpt.deals WHERE is_open = TRUE GROUP BY 1 ORDER BY 2 DESC"),
        ("contacts", "SELECT COUNT(*)::bigint AS n FROM rpt.contacts WHERE is_active = TRUE"),
        ("quotes_by_status", "SELECT status, COUNT(*)::bigint AS n FROM rpt.quotes GROUP BY status ORDER BY n DESC"),
        ("invoices", "SELECT status, COUNT(*)::bigint AS n FROM rpt.invoices GROUP BY status"),
        ("activities", "SELECT type, COUNT(*)::bigint AS n FROM rpt.activities GROUP BY type ORDER BY n DESC"),
        ("deals_last_30d", "SELECT COUNT(*)::bigint AS n FROM rpt.deals WHERE created_at >= (NOW() AT TIME ZONE 'utc') - INTERVAL '30 days'"),
        ("won_deals", "SELECT COUNT(*)::bigint AS n, COALESCE(SUM(amount),0) AS amt FROM rpt.deals WHERE stage = 'closed_won'"),
        ("expansion_deals", "SELECT deal_id, name, stage, amount FROM rpt.deals WHERE name ILIKE '%expansion%' LIMIT 10"),
    ]
    out = []
    for label, sql in q:
        res = run_sql(sql, organization_id=ORG, user_id=USER, role=ROLE)
        out.append(
            {
                "label": label,
                "status": res.get("status"),
                "err": res.get("error_type"),
                "rows": canon(res.get("rows"), 10),
                "error": (res.get("error") or "")[:180],
            }
        )
    return out


def conv(question: str) -> dict:
    out = run_turn(question, organization_id=ORG, user_id=USER, role=ROLE)
    plan = ((out.get("trace") or {}).get("plan") or {}).get("tasks") or []
    tasks = (out.get("trace") or {}).get("tasks") or []
    slim_tasks = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        slim_tasks.append(
            {
                "executor": (t.get("task") or {}).get("executor") or t.get("tool"),
                "kpi": t.get("kpi_id") or (t.get("task") or {}).get("kpi"),
                "dim": t.get("requested_dimension") or (t.get("task") or {}).get("dimension"),
                "status": t.get("status"),
                "err": t.get("error_type"),
                "n": len(t.get("rows") or []),
                "rows": canon(t.get("rows"), 4),
            }
        )
    return {
        "q": question,
        "plan": [
            {
                "executor": t.get("executor"),
                "kpi": t.get("kpi"),
                "dimension": t.get("dimension"),
                "time": t.get("time"),
                "status_filter": t.get("status_filter"),
                "owner_name": t.get("owner_name"),
            }
            for t in plan
            if isinstance(t, dict)
        ],
        "tasks": slim_tasks,
        "answer": (out.get("answer") or "")[:700],
        "domain_error": (out.get("trace") or {}).get("domain_error"),
    }


NL = [
    "How many deals are there?",
    "How many open deals are there?",
    "How many leads are there?",
    "How many unassigned leads?",
    "List unassigned leads",
    "Contacted leads by owner",
    "What is the total pipeline value?",
    "What is raghuram total pipeline?",
    "What is won revenue?",
    "What is the deal win rate?",
    "Pipeline by sales rep",
    "Lead status mix",
    "Show me quotes that are still open",
    "What is quote acceptance rate?",
    "How much is outstanding on invoices?",
    "Collected revenue",
    "How many open tasks?",
    "Activity volume this month",
    "Average discount on quotes",
    "Find open deals named expansion",
    "How many deals in the last 7 days?",
    "How many deals in the last 30 days?",
    "Total deals by stage",
    "Open deals by agent",
    "Won revenue by industry",
]

KG = [
    "Why did we lose deals?",
    "360 on Orange",
    "What is blocking the Orange deal?",
    "Who owns the relationship with Orange?",
]


def main():
    report = {"matrix": kpi_matrix()}
    mx_fail = [r for r in report["matrix"] if not r["ok"]]
    print(f"KPI×dim {len(report['matrix'])} cells, fails={len(mx_fail)}")
    for r in mx_fail:
        print(" FAIL", r["kpi"], r["dim"], r["err"], r["error"])

    report["time"] = time_matrix()
    tw_fail = [r for r in report["time"] if not r["ok"]]
    print(f"KPI×time {len(report['time'])} cells, fails={len(tw_fail)}")
    for r in tw_fail[:30]:
        print(" FAIL", r["kpi"], r["time"], r["err"], r["error"])

    report["sql"] = sql_checks()
    print("SQL:")
    for s in report["sql"]:
        print(" ", s["label"], s["status"], s["rows"][:3], s.get("error", "")[:80])

    report["nl"] = []
    for q in NL:
        print("NL", q)
        try:
            row = conv(q)
        except Exception as exc:
            row = {"q": q, "error": str(exc)}
        report["nl"].append(row)
        print(" ", json.dumps(row.get("plan") or [])[:200], "|", (row.get("answer") or row.get("error") or "")[:140].replace("\n", " "))

    report["kg"] = []
    for q in KG:
        print("KG", q)
        try:
            row = conv(q)
        except Exception as exc:
            row = {"q": q, "error": str(exc)}
        report["kg"].append(row)
        print(" ", json.dumps(row.get("plan") or [])[:200], "|", (row.get("answer") or row.get("error") or "")[:140].replace("\n", " "))

    OUT.write_text(json.dumps(report, indent=2, default=str))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
