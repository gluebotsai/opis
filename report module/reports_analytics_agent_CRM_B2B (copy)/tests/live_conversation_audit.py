"""Live Postgres audit: certified KPIs × dimensions, then conversational turns."""

from __future__ import annotations

import json
import os
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from reports_analytics_agent_CRM_B2B.core.loader import load_kpis
from reports_analytics_agent_CRM_B2B.core.run_kpi import REFUSAL_KPIS, run_kpi
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql
from reports_analytics_agent_CRM_B2B.core.time import resolve_expression
from test_streamlit.crm_b2b.turn import run_turn

ORG, USER, ROLE = 1003, 1017, "admin"

DASHBOARD = [
    "total_opportunities", "active_opportunities", "total_pipeline", "weighted_pipeline",
    "won_revenue", "won_deal_count", "lost_revenue", "lost_deal_count", "win_rate",
    "average_deal_size", "average_probability", "average_aging", "high_probability_deals",
    "new_pipeline_month", "sales_velocity", "pipeline_by_stage", "win_loss_split",
    "aging_bands", "deal_size_bands", "pipeline_by_owner", "lost_reasons",
    "won_revenue_trend", "top_open_opportunities",
]
TIER2 = [
    "avg_sales_cycle", "quote_acceptance_rate", "open_quote_value", "expected_close_value",
    "lead_status_mix", "unassigned_leads", "days_since_last_touch", "activity_volume",
    "open_task_count", "invoice_outstanding", "overdue_amount", "collected_revenue",
    "approval_queue", "contract_arr", "renewal_book", "product_revenue", "average_discount",
]
TIER3 = [
    "forecast_vs_target", "territory_performance", "lead_source_conversion",
    "attach_rate", "customer_retention", "meeting_completion", "agent_operations",
]


def _canon(rows):
    out = []
    for r in rows or []:
        item = {}
        for k, v in r.items():
            if isinstance(v, Decimal):
                item[k] = float(v)
            else:
                item[k] = v
        out.append(item)
    return out


def kpi_matrix() -> list[str]:
    lines = ["=== run_kpi live matrix (org 1003 admin) ==="]
    kpis = load_kpis()
    fails = 0
    for kpi_id in DASHBOARD + TIER2 + TIER3:
        meta = kpis.get(kpi_id) or {}
        dims = [None] + list(meta.get("allowed_dimensions") or [])
        for dim in dims:
            res = run_kpi(
                kpi_id,
                organization_id=ORG,
                user_id=USER,
                role=ROLE,
                dimension=dim,
            )
            st = res.get("status")
            n = len(res.get("rows") or [])
            err = res.get("error_type") or ""
            ok = st in {"ok", "success"} or err in {"UNAVAILABLE_KPI"}
            if not ok:
                fails += 1
            mark = "OK" if ok else "FAIL"
            lines.append(f"{mark} {kpi_id} dim={dim or '-'} status={st} err={err} rows={n}")
            if not ok:
                lines.append(f"     {res.get('error')}")
    lines.append(f"matrix_fails={fails}")
    return lines


def sql_check(label: str, sql: str) -> str:
    res = run_sql(sql, organization_id=ORG, user_id=USER, role=ROLE)
    rows = _canon(res.get("rows"))
    return f"{label} status={res.get('status')} rows={json.dumps(rows, default=str)[:500]}"


def conv(question: str) -> dict:
    out = run_turn(question, organization_id=ORG, user_id=USER, role=ROLE)
    plan = ((out.get("trace") or {}).get("plan") or {}).get("tasks") or []
    tasks = (out.get("trace") or {}).get("tasks") or []
    first = tasks[0] if tasks else {}
    return {
        "q": question,
        "plan": [{k: t.get(k) for k in ("executor", "kpi", "dimension", "time")} for t in plan if isinstance(t, dict)],
        "status": first.get("status"),
        "kpi": first.get("kpi_id") or (first.get("task") or {}).get("kpi"),
        "dim": first.get("requested_dimension") or first.get("dimension") or (first.get("task") or {}).get("dimension"),
        "tool": first.get("tool"),
        "n": len(first.get("rows") or []),
        "rows": _canon(first.get("rows")),
        "err": first.get("error_type"),
        "answer": (out.get("answer") or "")[:400],
        "time_echo": first.get("time_echo"),
        "sql": (first.get("sql") or "")[:180],
    }


def main() -> None:
    print("\n".join(kpi_matrix()))
    print()
    print("=== live SELECT/WITH checks ===")
    print(sql_check(
        "open_deals",
        "SELECT COUNT(*)::bigint AS n FROM rpt.deals WHERE is_open = TRUE",
    ))
    print(sql_check(
        "open_by_owner",
        "SELECT COALESCE(owner_name, 'Unassigned') AS owner, COUNT(*)::bigint AS n "
        "FROM rpt.deals WHERE is_open = TRUE GROUP BY 1 ORDER BY 2 DESC",
    ))
    print(sql_check(
        "quotes",
        "SELECT status, COUNT(*)::bigint AS n FROM rpt.quotes GROUP BY status ORDER BY n DESC",
    ))
    print(sql_check(
        "last_7_created",
        "SELECT COUNT(*)::bigint AS n FROM rpt.deals "
        "WHERE created_at >= (NOW() AT TIME ZONE 'utc') - INTERVAL '7 days'",
    ))
    print()
    for phrase in ("today", "1 day", "last 7 days", "last 30 days", "2026-09-01 to 2026-09-15"):
        tb = resolve_expression(phrase)
        print(f"TIME {phrase!r} status={tb.status} echo={tb.echo} start={tb.start} end={tb.end}")

    questions = [
        ("How many deals are there?", "total_opportunities"),
        ("How many open deals are there?", "active_opportunities"),
        ("What is the total pipeline value?", "total_pipeline"),
        ("What is weighted pipeline?", "weighted_pipeline"),
        ("What is won revenue?", "won_revenue"),
        ("How many won deals?", "won_deal_count"),
        ("How much lost revenue?", "lost_revenue"),
        ("How many lost deals?", "lost_deal_count"),
        ("What is the deal win rate?", "win_rate"),
        ("What is the average deal size?", "average_deal_size"),
        ("What is average probability?", "average_probability"),
        ("What is average aging of open deals?", "average_aging"),
        ("How many high probability deals?", "high_probability_deals"),
        ("What is new pipeline this month?", "new_pipeline_month"),
        ("What is sales velocity?", "sales_velocity"),
        ("Break down pipeline by stage", "pipeline_by_stage"),
        ("Win loss split", "win_loss_split"),
        ("Aging bands for open deals", "aging_bands"),
        ("Deal size bands", "deal_size_bands"),
        ("Pipeline by sales rep", "pipeline_by_owner"),
        ("Lost reasons", "lost_reasons"),
        ("Won revenue trend", "won_revenue_trend"),
        ("Top open opportunities", "top_open_opportunities"),
        ("What is average sales cycle?", "avg_sales_cycle"),
        ("What is quote acceptance rate?", "quote_acceptance_rate"),
        ("What is open quote value?", "open_quote_value"),
        ("Expected close value", "expected_close_value"),
        ("Lead status mix", "lead_status_mix"),
        ("How many unassigned leads?", "unassigned_leads"),
        ("Days since last touch", "days_since_last_touch"),
        ("Activity volume", "activity_volume"),
        ("How many open tasks?", "open_task_count"),
        ("Invoice outstanding", "invoice_outstanding"),
        ("Overdue amount", "overdue_amount"),
        ("Collected revenue", "collected_revenue"),
        ("Approval queue", "approval_queue"),
        ("Contract ARR", "contract_arr"),
        ("Renewal book", "renewal_book"),
        ("Product revenue", "product_revenue"),
        ("Average discount", "average_discount"),
        ("Total deals by stage", "total_opportunities"),
        ("Open deals by agent", "active_opportunities"),
        ("Total pipeline by company", "total_pipeline"),
        ("Won revenue by industry", "won_revenue"),
        ("Open pipeline by currency", "total_pipeline"),
        ("Total deals by month", "total_opportunities"),
        ("Lost deals by lost reason", "lost_deal_count"),
        ("How many deals in the last 7 days?", "total_opportunities"),
        ("How many deals in the last 30 days?", "total_opportunities"),
        ("How many deals in the last 1 day?", "total_opportunities"),
        ("How many deals from 2026-09-01 to 2026-09-15?", "total_opportunities"),
        ("List quotes", None),
        ("Find open deals named expansion", None),
        ("List unassigned leads", "unassigned_leads"),
        ("Quota attainment for the team", "quota_attainment"),
    ]
    print("\n=== conversational ===")
    mismatches = 0
    for q, expect in questions:
        r = conv(q)
        hit = expect is None or r["kpi"] == expect or r["err"] == "UNAVAILABLE_KPI"
        if expect and r["kpi"] != expect and r["err"] != "UNAVAILABLE_KPI":
            mismatches += 1
        mark = "OK" if r["status"] in {"ok", "success"} and hit else "CHECK"
        print(
            f"{mark} kpi={r['kpi']} dim={r['dim']} time={r['plan'][0].get('time') if r['plan'] else None} "
            f"echo={r['time_echo']} n={r['n']} err={r['err']} | {q}"
        )
        print(f"     plan={r['plan']}")
        if r["rows"][:3]:
            print(f"     rows={r['rows'][:3]}")
        print(f"     ans={r['answer'][:220].replace(chr(10), ' ')}")
        if expect and r["kpi"] == expect and r["status"] in {"ok", "success"}:
            truth = run_kpi(
                expect,
                organization_id=ORG,
                user_id=USER,
                role=ROLE,
                dimension=r["dim"] if r["dim"] not in (None, "", "null") else None,
                time_window=r["plan"][0].get("time") if r["plan"] else None,
            )
            if _canon(truth.get("rows")) != r["rows"]:
                # time_window vs bound start/end may differ; still flag
                print(f"     DB_DIFF truth_n={len(truth.get('rows') or [])} conv_n={r['n']}")
    print(f"kpi_id_mismatches={mismatches}")


if __name__ == "__main__":
    main()
