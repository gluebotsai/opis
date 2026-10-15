"""A-Z live audit: all certified KPIs, free SQL, mixed NL + KG."""

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
OUT = ROOT / "testing_scripts" / "crm_a2z_audit.json"


def canon(rows):
    out = []
    for r in rows or []:
        item = {}
        for k, v in r.items():
            item[k] = float(v) if isinstance(v, Decimal) else v
        out.append(item)
    return out


def matrix():
    kpis = load_kpis()
    rows = []
    for kpi_id in sorted(kpis):
        meta = kpis[kpi_id]
        dims = [None] + [d for d in (meta.get("allowed_dimensions") or []) if d]
        # smoke: null dim only for speed; plus owner if allowed
        check_dims = [None]
        if "owner" in (meta.get("allowed_dimensions") or []):
            check_dims.append("owner")
        for dim in check_dims:
            res = run_kpi(kpi_id, organization_id=ORG, user_id=USER, role=ROLE, dimension=dim)
            st = res.get("status")
            err = res.get("error_type") or ""
            ok = st in {"ok", "success"} or kpi_id in REFUSAL_KPIS or err == "UNAVAILABLE_KPI"
            rows.append(
                {
                    "kpi": kpi_id,
                    "dim": dim,
                    "ok": ok,
                    "status": st,
                    "err": err,
                    "n": len(res.get("rows") or []),
                    "error": (res.get("error") or "")[:180],
                }
            )
    return rows


def sql_checks():
    q = [
        ("open_deals", "SELECT COUNT(*)::bigint AS n FROM rpt.deals WHERE is_open = TRUE"),
        ("contacts", "SELECT COUNT(*)::bigint AS n FROM rpt.contacts WHERE is_active = TRUE"),
        ("quotes_by_status", "SELECT status, COUNT(*)::bigint AS n FROM rpt.quotes GROUP BY status ORDER BY n DESC"),
        ("invoices", "SELECT status, COUNT(*)::bigint AS n FROM rpt.invoices GROUP BY status"),
        ("activities", "SELECT type, COUNT(*)::bigint AS n FROM rpt.activities GROUP BY type ORDER BY n DESC"),
    ]
    out = []
    for label, sql in q:
        res = run_sql(sql, organization_id=ORG, user_id=USER, role=ROLE)
        out.append({"label": label, "status": res.get("status"), "err": res.get("error_type"), "rows": canon(res.get("rows"))[:8]})
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
                "filter": (t.get("task") or {}).get("status_filter") or (t.get("task") or {}).get("owner_name"),
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
                "answer_type": t.get("answer_type"),
            }
            for t in plan
            if isinstance(t, dict)
        ],
        "tasks": slim_tasks,
        "answer": (out.get("answer") or "")[:500],
        "domain_error": (out.get("trace") or {}).get("domain_error"),
    }


QUESTIONS = [
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
    "Why did we lose deals?",
    "360 on Orange",
    "Quota attainment for the team",
]


def main():
    report = {"matrix": matrix(), "sql": sql_checks(), "nl": []}
    mx_fail = [r for r in report["matrix"] if not r["ok"]]
    print(f"KPI matrix {len(report['matrix'])} cells, fails={len(mx_fail)}")
    for r in mx_fail[:20]:
        print(" FAIL", r["kpi"], r["dim"], r["err"], r["error"])
    print("SQL checks:")
    for s in report["sql"]:
        print(" ", s["label"], s["status"], s["rows"][:3])
    for q in QUESTIONS:
        print("NL", q)
        try:
            row = conv(q)
        except Exception as exc:
            row = {"q": q, "error": str(exc)}
        report["nl"].append(row)
        plan = row.get("plan") or []
        print(" ", json.dumps(plan)[:240], "|", (row.get("answer") or row.get("error") or "")[:160].replace("\n", " "))
    OUT.write_text(json.dumps(report, indent=2, default=str))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
