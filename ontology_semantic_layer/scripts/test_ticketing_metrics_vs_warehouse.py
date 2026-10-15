#!/usr/bin/env python3
"""Compare pack execute_frame to independent SELECT-only warehouse SQL.

Usage (from repo root, with DATABASE_URL):

  .venv/bin/python scripts/test_ticketing_metrics_vs_warehouse.py

Org defaults to 1012. Read-only SELECTs only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from reports_analytics_agent_ticketing.core.dims import DIMENSIONS, catalog_label
from reports_analytics_agent_ticketing.core.loader import merge_effective
from reports_analytics_agent_ticketing.core.query_frame import Identity
from reports_analytics_agent_ticketing.core.run_analytics import execute_frame

ORG = int(os.getenv("TICKETING_TEST_ORG", "1012"))
IDENTITY = Identity(organization_id=ORG, user_id=1, role="admin")
T = f"ticketing.tickets t WHERE t.organization_id = {ORG}"


def _dsn() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    env = ROOT / "ticketing_reports_test_setup" / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL is not set")


def _fetch(dsn: str, sql: str) -> list[dict]:
    from reports_analytics_agent_ticketing.core import db as pg

    return pg.fetchall(dsn, sql, ())


def _num(rows: list[dict]) -> float | None:
    if not rows:
        return None
    from decimal import Decimal

    for val in rows[0].values():
        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float, Decimal)):
            return float(val)
    return None


def _close(a: float | None, b: float | None, *, rel: float = 1e-6, abs_tol: float = 1e-4) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if abs(a - b) <= abs_tol:
        return True
    denom = max(abs(a), abs(b), 1e-12)
    return abs(a - b) / denom <= rel


def sla_ticket_cte(org: int) -> str:
    """Independent ticket grain with the same SLA flags as product/_base_ticket.sql."""
    return f"""
WITH bt AS (
    SELECT
        t.id AS ticket_id,
        t.organization_id,
        t.status,
        t.customer_id,
        t.queue_id,
        t.due_at,
        t.first_response_at,
        t.resolved_at,
        t.csat_score,
        t.created_at,
        t.assignee_id,
        EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 AS resolution_hours,
        EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0 AS first_response_hours,
        EXTRACT(EPOCH FROM (t.resolved_at - t.due_at)) / 3600.0 AS resolution_variance_hours,
        EXTRACT(EPOCH FROM (COALESCE(t.resolved_at, NOW()) - t.due_at)) / 3600.0 AS overdue_hours_so_far,
        (
            t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at
        ) AS resolution_sla_met,
        (
            t.due_at IS NOT NULL AND (
                (t.resolved_at IS NOT NULL AND t.resolved_at > t.due_at)
                OR (t.status NOT IN ('Closed', 'Resolved') AND NOW() > t.due_at)
                OR (t.status IN ('Closed', 'Resolved') AND t.resolved_at IS NULL AND NOW() > t.due_at)
            )
        ) AS resolution_sla_missed,
        (
            t.due_at IS NOT NULL
            AND t.status NOT IN ('Closed', 'Resolved')
            AND NOW() <= t.due_at
            AND EXTRACT(EPOCH FROM (t.due_at - NOW()))
                <= 0.20 * EXTRACT(EPOCH FROM (t.due_at - t.created_at))
            AND EXTRACT(EPOCH FROM (t.due_at - t.created_at)) > 0
        ) AS resolution_at_risk,
        (t.due_at IS NULL) AS resolution_no_sla,
        (
            t.first_response_at IS NOT NULL
            AND sp.first_response_hours IS NOT NULL
            AND t.first_response_at <= t.created_at + (sp.first_response_hours * INTERVAL '1 hour')
        ) AS first_response_sla_met,
        (
            sp.first_response_hours IS NOT NULL
            AND (
                (t.first_response_at IS NOT NULL
                    AND t.first_response_at > t.created_at + (sp.first_response_hours * INTERVAL '1 hour'))
                OR (t.first_response_at IS NULL
                    AND NOW() > t.created_at + (sp.first_response_hours * INTERVAL '1 hour'))
            )
        ) AS first_response_sla_missed,
        (
            t.first_response_at IS NULL
            AND sp.first_response_hours IS NOT NULL
            AND t.status NOT IN ('Closed', 'Resolved')
            AND NOW() <= t.created_at + (sp.first_response_hours * INTERVAL '1 hour')
            AND EXTRACT(EPOCH FROM (
                (t.created_at + (sp.first_response_hours * INTERVAL '1 hour')) - NOW()
            )) <= 0.20 * (sp.first_response_hours * 3600.0)
        ) AS first_response_at_risk
    FROM ticketing.tickets t
    LEFT JOIN LATERAL (
        SELECT sp.resolution_hours, sp.first_response_hours
        FROM ticketing.sla_policies sp
        WHERE sp.organization_id = t.organization_id
          AND sp.priority = t.priority
          AND sp.active = true
        ORDER BY sp.id DESC
        LIMIT 1
    ) sp ON true
    WHERE t.organization_id = {int(org)}
)
"""


def warehouse_kpis(org: int) -> dict[str, str]:
    """Independent SELECT-only checks for every certified KPI."""
    o = int(org)
    bt = sla_ticket_cte(o)
    return {
        "ticket_count": f"SELECT COUNT(*)::bigint AS v FROM ticketing.tickets WHERE organization_id = {o}",
        "avg_tickets_per_day": (
            f"SELECT COUNT(*)::float / NULLIF(GREATEST(1.0, EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 86400.0), 0) AS v "
            f"FROM ticketing.tickets WHERE organization_id = {o}"
        ),
        "avg_open_ticket_age": (
            f"SELECT AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0) AS v "
            f"FROM ticketing.tickets WHERE organization_id = {o} AND status = 'Open'"
        ),
        "days_since_last_ticket": (
            f"SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400.0 AS v "
            f"FROM ticketing.tickets WHERE organization_id = {o}"
        ),
        "resolution_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE status IN ('Resolved','Closed'))::float "
            f"/ NULLIF(COUNT(*)::float, 0)) AS v FROM ticketing.tickets WHERE organization_id = {o}"
        ),
        "assignment_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE EXISTS ("
            f" SELECT 1 FROM ticketing.audit_events ae WHERE ae.organization_id = t.organization_id "
            f" AND ae.ticket_id::text = t.id::text AND ae.action = 'ticket.assigned'"
            f"))::float / NULLIF(COUNT(*)::float, 0)) AS v "
            f"FROM ticketing.tickets t WHERE t.organization_id = {o}"
        ),
        "reopen_count": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.tickets "
            f"WHERE organization_id = {o} AND status = 'Reopened'"
        ),
        "reopen_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE status = 'Reopened')::float "
            f"/ NULLIF(COUNT(*) FILTER (WHERE status IN ('Resolved','Closed','Reopened'))::float, 0)) AS v "
            f"FROM ticketing.tickets WHERE organization_id = {o}"
        ),
        "escalation_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE EXISTS ("
            f" SELECT 1 FROM ticketing.audit_events ae WHERE ae.organization_id = t.organization_id "
            f" AND ae.ticket_id::text = t.id::text AND ae.action = 'ticket.escalated'"
            f"))::float / NULLIF(COUNT(*)::float, 0)) AS v "
            f"FROM ticketing.tickets t WHERE t.organization_id = {o}"
        ),
        "reassignment_rate": (
            bt
            + """
SELECT (COUNT(*) FILTER (WHERE assigned.assigned_events > 1)::float
    / NULLIF(COUNT(*) FILTER (WHERE assigned.assigned_events >= 1)::float, 0)) AS v
FROM bt
LEFT JOIN (
    SELECT ae.ticket_id, ae.organization_id, COUNT(*) AS assigned_events
    FROM ticketing.audit_events ae
    WHERE ae.action = 'ticket.assigned'
    GROUP BY ae.ticket_id, ae.organization_id
) assigned
    ON assigned.ticket_id::text = bt.ticket_id::text
   AND assigned.organization_id = bt.organization_id
"""
        ),
        "avg_first_response_time": (
            f"SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600.0) AS v "
            f"FROM ticketing.tickets WHERE organization_id = {o} AND first_response_at IS NOT NULL"
        ),
        "avg_resolution_time": (
            f"SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0) AS v "
            f"FROM ticketing.tickets WHERE organization_id = {o} AND resolved_at IS NOT NULL"
        ),
        "avg_resolution_variance_vs_sla": (
            bt + "SELECT AVG(resolution_variance_hours) AS v FROM bt WHERE resolved_at IS NOT NULL AND due_at IS NOT NULL"
        ),
        "first_response_sla_compliance": (
            bt
            + "SELECT (COUNT(*) FILTER (WHERE first_response_sla_met)::float "
            "/ NULLIF(COUNT(*) FILTER (WHERE first_response_sla_met OR first_response_sla_missed)::float, 0)) AS v FROM bt"
        ),
        "resolution_sla_compliance": (
            bt
            + "SELECT (COUNT(*) FILTER (WHERE resolution_sla_met)::float "
            "/ NULLIF(COUNT(*) FILTER (WHERE resolution_sla_met OR resolution_sla_missed)::float, 0)) AS v FROM bt"
        ),
        "sla_breach_rate": (
            bt
            + "SELECT (COUNT(*) FILTER (WHERE resolution_sla_missed)::float "
            "/ NULLIF(COUNT(*) FILTER (WHERE resolution_sla_met OR resolution_sla_missed)::float, 0)) AS v FROM bt"
        ),
        "first_response_at_risk_count": bt + "SELECT COUNT(*)::bigint AS v FROM bt WHERE first_response_at_risk",
        "resolution_at_risk_count": bt + "SELECT COUNT(*)::bigint AS v FROM bt WHERE resolution_at_risk",
        "no_sla_count": bt + "SELECT COUNT(*)::bigint AS v FROM bt WHERE resolution_no_sla",
        "queues_at_risk": (
            bt + "SELECT COUNT(DISTINCT queue_id)::bigint AS v FROM bt WHERE resolution_at_risk AND queue_id IS NOT NULL"
        ),
        "average_overdue_hours": (
            bt + "SELECT AVG(overdue_hours_so_far) AS v FROM bt WHERE resolution_sla_missed AND due_at IS NOT NULL"
        ),
        "avg_csat": (
            f"SELECT AVG(csat_score)::float AS v FROM ticketing.tickets "
            f"WHERE organization_id = {o} AND csat_score IS NOT NULL"
        ),
        "csat_response_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float "
            f"/ NULLIF(COUNT(*)::float, 0)) AS v FROM ticketing.tickets "
            f"WHERE organization_id = {o} AND status = 'Resolved'"
        ),
        "csat_distribution_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE csat_score >= 4)::float "
            f"/ NULLIF(COUNT(*)::float, 0)) AS v FROM ticketing.tickets "
            f"WHERE organization_id = {o} AND csat_score IS NOT NULL"
        ),
        "customers_served": (
            f"SELECT COUNT(DISTINCT customer_id)::bigint AS v FROM ticketing.tickets "
            f"WHERE organization_id = {o} AND customer_id IS NOT NULL"
        ),
        "accounts_served": (
            f"SELECT COUNT(DISTINCT cp.account_id)::bigint AS v FROM ticketing.tickets t "
            f"JOIN ticketing.contact_profile cp ON cp.id = t.customer_id AND cp.organization_id = t.organization_id "
            f"WHERE t.organization_id = {o} AND cp.account_id IS NOT NULL"
        ),
        "active_customers": (
            f"SELECT COUNT(DISTINCT cp.id)::bigint AS v FROM ticketing.tickets t "
            f"JOIN ticketing.contact_profile cp ON cp.id = t.customer_id AND cp.organization_id = t.organization_id "
            f"WHERE t.organization_id = {o} AND cp.status = 'Active'"
        ),
        "total_customers": (
            f"SELECT CASE WHEN EXISTS (SELECT 1 FROM accounts.active_products ap "
            f"WHERE ap.organization_id = {o} AND ap.product_id = 'ticketing') "
            f"THEN (SELECT COUNT(*)::bigint FROM cdp.customer_profile p "
            f"WHERE p.organization_id = {o} AND p.contact_type IN ('lead', 'customer')) "
            f"ELSE 0::bigint END AS v"
        ),
        "active_agents": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.agents "
            f"WHERE organization_id = {o} AND status = 'Active' AND role = 'agent'"
        ),
        "total_users": f"SELECT COUNT(*)::bigint AS v FROM ticketing.agents WHERE organization_id = {o}",
        "queue_count": f"SELECT COUNT(*)::bigint AS v FROM ticketing.agent_queues WHERE organization_id = {o}",
        "queue_coverage": f"SELECT COUNT(*)::bigint AS v FROM ticketing.agent_queue_members WHERE organization_id = {o}",
        "distinct_agents_in_queues": (
            f"SELECT COUNT(DISTINCT user_id)::bigint AS v FROM ticketing.agent_queue_members WHERE organization_id = {o}"
        ),
        "distinct_queues_covered": (
            f"SELECT COUNT(DISTINCT queue_id)::bigint AS v FROM ticketing.agent_queue_members WHERE organization_id = {o}"
        ),
        "note_count": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.ticket_notes n "
            f"JOIN ticketing.tickets t ON t.id::text = n.ticket_id::text AND t.organization_id = n.organization_id "
            f"WHERE n.organization_id = {o}"
        ),
        "escalation_count": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.audit_events ae "
            f"JOIN ticketing.tickets t ON t.id::text = ae.ticket_id::text AND t.organization_id = ae.organization_id "
            f"WHERE ae.organization_id = {o} AND ae.action = 'ticket.escalated'"
        ),
        "reassignment_count": (
            f"SELECT COUNT(*)::bigint AS v FROM ("
            f" SELECT ae.ticket_id, ROW_NUMBER() OVER ("
            f"  PARTITION BY ae.organization_id, ae.ticket_id ORDER BY ae.created_at, ae.id) AS assign_n"
            f" FROM ticketing.audit_events ae"
            f" JOIN ticketing.tickets t ON t.id::text = ae.ticket_id::text AND t.organization_id = ae.organization_id"
            f" WHERE ae.action = 'ticket.assigned' AND ae.organization_id = {o}"
            f") ranked WHERE assign_n > 1"
        ),
        "kb_article_count": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.kb_articles "
            f"WHERE organization_id = {o} AND status = 'Published'"
        ),
        "kb_views": (
            f"SELECT COALESCE(SUM(views), 0)::bigint AS v FROM ticketing.kb_articles WHERE organization_id = {o}"
        ),
        "recommendation_count": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.proactive_recommendations WHERE organization_id = {o}"
        ),
        "recommendation_acceptance_rate": (
            f"SELECT COALESCE(COUNT(*) FILTER (WHERE status = 'accepted')::float "
            f"/ NULLIF(COUNT(*)::float, 0), 0) AS v "
            f"FROM ticketing.proactive_recommendations WHERE organization_id = {o}"
        ),
        "approval_count": f"SELECT COUNT(*)::bigint AS v FROM ticketing.proactive_approvals WHERE organization_id = {o}",
        "approval_rate": (
            f"SELECT (COUNT(*) FILTER (WHERE status = 'approved')::float "
            f"/ NULLIF(COUNT(*) FILTER (WHERE status IN ('approved', 'rejected'))::float, 0)) AS v "
            f"FROM ticketing.proactive_approvals WHERE organization_id = {o}"
        ),
        "unread_notifications": (
            f"SELECT COUNT(*)::bigint AS v FROM ticketing.notifications "
            f"WHERE organization_id = {o} AND is_read = false"
        ),
    }


PACK_FILTERS = {
    "csat_distribution_rate": [{"field": "bucket", "mention": "promoter"}],
}


def dim_sql(dim: str, org: int) -> str:
    expr, alias = catalog_label(dim, "created_at")
    return (
        f"SELECT {expr} AS {alias}, COUNT(*)::bigint AS ticket_count "
        f"FROM ticketing.tickets t WHERE t.organization_id = {org} "
        f"GROUP BY {expr} ORDER BY ticket_count DESC"
    )


def pack_kpi(dsn: str, kpi_id: str) -> tuple[float | None, str]:
    frame = {
        "shape": "kpi",
        "measure": kpi_id,
        "path": "certified",
        "scope": {"level": "org"},
        "filters": PACK_FILTERS.get(kpi_id) or [],
    }
    job = execute_frame(frame, IDENTITY, dsn=dsn, run=True)
    if job.get("error"):
        return None, str(job["error"])
    return _num(job.get("rows") or []), ""


def pack_dim(dsn: str, dim: str) -> tuple[list[dict], str]:
    job = execute_frame(
        {
            "shape": "breakdown",
            "measure": "ticket_count",
            "path": "certified",
            "scope": {"level": "org"},
            "group_by": [dim],
        },
        IDENTITY,
        dsn=dsn,
        run=True,
    )
    if job.get("error"):
        return [], str(job["error"])
    return list(job.get("rows") or []), ""


def pack_top(dsn: str, dim: str, n: int) -> tuple[list[dict], str]:
    job = execute_frame(
        {
            "shape": "ranking",
            "measure": "ticket_count",
            "path": "catalog",
            "scope": {"level": "org"},
            "group_by": [dim],
            "limit": n,
        },
        IDENTITY,
        dsn=dsn,
        run=True,
    )
    if job.get("error"):
        return [], str(job["error"])
    return list(job.get("rows") or []), ""


def main() -> int:
    dsn = _dsn()
    catalog = merge_effective(ORG)
    kpis = catalog["kpis"]
    warehouse = warehouse_kpis(ORG)
    fails: list[str] = []
    print(f"org={ORG} warehouse vs pack execute_frame\n")

    print("== certified KPIs (org, no time window) ==")
    for kpi_id in sorted(kpis):
        if kpi_id not in warehouse:
            print(f"  SKIP  {kpi_id} (no independent SELECT yet)")
            continue
        try:
            wh_rows = _fetch(dsn, warehouse[kpi_id])
            wh = _num(wh_rows)
        except Exception as exc:
            print(f"  FAIL  {kpi_id} warehouse SQL: {exc}")
            fails.append(kpi_id)
            continue
        pk, err = pack_kpi(dsn, kpi_id)
        if err:
            print(f"  FAIL  {kpi_id} pack error: {err}")
            fails.append(kpi_id)
            continue
        # AVG(NOW()-created_at) and similar move between sequential queries.
        now_tol = kpi_id in {
            "avg_open_ticket_age",
            "days_since_last_ticket",
            "average_overdue_hours",
            "avg_tickets_per_day",
        }
        ok = _close(pk, wh, abs_tol=0.01 if now_tol else 1e-4)
        mark = "OK  " if ok else "FAIL"
        print(f"  {mark} {kpi_id}: pack={pk} warehouse={wh}")
        if not ok:
            fails.append(kpi_id)

    print("\n== ticket_count dimensions ==")
    for dim in kpis["ticket_count"].get("allowed_dimensions") or []:
        if dim not in DIMENSIONS:
            print(f"  SKIP  dim {dim}")
            continue
        try:
            wsql = dim_sql(dim, ORG)
            wh_rows = _fetch(dsn, wsql)
        except Exception as exc:
            print(f"  FAIL  dim {dim} warehouse SQL: {exc}")
            fails.append(f"dim:{dim}")
            continue
        pk_rows, err = pack_dim(dsn, dim)
        if err:
            print(f"  FAIL  dim {dim} pack: {err}")
            fails.append(f"dim:{dim}")
            continue
        # Certified breakdown has no default LIMIT; compare full maps.
        def keyrow(rows: list[dict], dim_name: str) -> dict[str, float]:
            out: dict[str, float] = {}
            for row in rows:
                label = row.get(dim_name)
                if label is None and dim_name not in row:
                    vals = [v for k, v in row.items() if k != "ticket_count"]
                    label = vals[0] if vals else None
                count = row.get("ticket_count")
                out[str(label)] = float(count or 0)
            return out

        a = keyrow(pk_rows, dim)
        b = keyrow(wh_rows, dim)
        ok = a == b
        if not ok and set(a) == set(b):
            ok = all(_close(a[k], b[k]) for k in a)
        mark = "OK  " if ok else "FAIL"
        print(f"  {mark} {dim}: pack_groups={len(pk_rows)} warehouse_groups={len(wh_rows)}")
        if not ok:
            fails.append(f"dim:{dim}")
            extra_p = set(a) - set(b)
            extra_w = set(b) - set(a)
            if extra_p or extra_w:
                print(f"        pack_only={list(extra_p)[:5]} warehouse_only={list(extra_w)[:5]}")

    print("\n== top-N ranking (limit 5) ==")
    for dim in ("agent", "queue", "customer", "status"):
        expr, alias = catalog_label(dim, "created_at")
        wsql = (
            f"SELECT {expr} AS {alias}, COUNT(*)::bigint AS ticket_count "
            f"FROM ticketing.tickets t WHERE t.organization_id = {ORG} "
            f"GROUP BY {expr} ORDER BY ticket_count DESC LIMIT 5"
        )
        wh_rows = _fetch(dsn, wsql)
        pk_rows, err = pack_top(dsn, dim, 5)
        if err:
            print(f"  FAIL  top5 {dim}: {err}")
            fails.append(f"top5:{dim}")
            continue
        ok = len(pk_rows) == len(wh_rows) == min(5, len(wh_rows)) and len(pk_rows) <= 5
        if ok:
            for p, w in zip(pk_rows, wh_rows):
                if float(p.get("ticket_count") or 0) != float(w.get("ticket_count") or 0):
                    ok = False
                    break
        mark = "OK  " if ok else "FAIL"
        print(f"  {mark} top5 {dim}: pack={len(pk_rows)} warehouse={len(wh_rows)}")
        if not ok:
            fails.append(f"top5:{dim}")

    print("\n== summary ==")
    if fails:
        print("FAILED:", ", ".join(fails))
        return 1
    print("all compared checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
