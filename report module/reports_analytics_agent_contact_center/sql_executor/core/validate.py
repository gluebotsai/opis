"""Validation harness for Contact Center Reporting V2.

python -m reports_analytics_agent_contact_center.sql_executor.core.validate

Validates:
  1. Access matrix completeness (2-tier: admin, agent)
  2. KPI/SQL file pairing integrity (all certified KPIs have templates)
  3. Virtual view schema consistency (all 16 rpt.* views)
  4. sql_guard produces scoped CTEs for each role
  5. sql_guard rejects forbidden SQL patterns
  6. run_kpi scope enforcement (admin org, agent queue/own, agent denial for org)
  7. time resolver functionality
"""

from __future__ import annotations

import sys

from .loader import merge_effective, PACK_ROOT, PRODUCT_DIR
from reports_analytics_agent_contact_center.core.access import AccessDenied
from .views import cte_body
from .sql_guard import guard_sql, GuardError
from .run_kpi import run_kpi
from reports_analytics_agent_contact_center.core.time import resolve_expression


def _admin_ctx() -> dict:
    return dict(organization_id=1000, user_id=1005, role="admin", queue_ids=[401, 402])


def _agent_ctx() -> dict:
    return dict(organization_id=1000, user_id=1005, role="agent", queue_ids=[401])


def main() -> int:
    catalog = merge_effective(None)
    kpis = catalog["kpis"]
    errors: list[str] = []

    # --- 1. Access matrix exists ---
    if "matrix" not in catalog["access"]:
        errors.append("access.yml missing matrix")

    # --- 2. KPI/SQL file integrity ---
    sql_files = catalog.get("sql_files") or {}
    missing_sql = set(kpis) - set(sql_files)
    extra_sql = set(sql_files) - set(kpis)
    if missing_sql:
        errors.append(f"KPIs missing SQL templates: {sorted(missing_sql)}")
    if extra_sql:
        errors.append(f"SQL templates with no KPI card: {sorted(extra_sql)}")

    # --- 3. Virtual view CTEs for each role ---
    for role in ("admin", "agent"):
        views_to_test = (
            "conversations", "conversation_facts", "assignments", "transfers",
            "presence", "messages", "bot_turns", "copilot_turns",
            "missed_contacts", "calls", "agents", "queues",
            "sentiment", "tasks", "capacity", "routing_attempts"
        )
        for view in views_to_test:
            try:
                body = cte_body(view, role, PRODUCT_DIR)
                if "SELECT" not in body.upper():
                    errors.append(f"cte_body {role}/{view}: no SELECT")
            except Exception as exc:
                errors.append(f"cte_body {role}/{view}: {exc}")

    # --- 4. sql_guard: admin SELECT on rpt.conversations ---
    ctx = _admin_ctx()
    try:
        guarded = guard_sql(
            "SELECT id, channel, status FROM rpt.conversations LIMIT 10",
            role="admin",
            organization_id=ctx["organization_id"],
            user_id=ctx["user_id"],
            queue_ids=ctx["queue_ids"],
        )
        if "rpt_conversations" not in guarded.sql:
            errors.append("sql_guard: rpt_conversations CTE missing from admin query")
    except GuardError as exc:
        errors.append(f"sql_guard admin basic query rejected: {exc}")

    # --- 5. sql_guard: forbidden SQL ---
    for bad_sql, label in [
        ("DROP TABLE ccass.conversations", "DROP"),
        ("SELECT * FROM ccass.conversations", "physical table"),
        ("SELECT pg_sleep(1)", "dangerous function"),
    ]:
        try:
            guard_sql(
                bad_sql,
                role="admin",
                organization_id=1000,
                user_id=1005,
                queue_ids=[],
            )
            errors.append(f"sql_guard: '{label}' should be rejected")
        except GuardError:
            pass  # expected

    # --- 6. run_kpi: admin org scope ---
    kpi_result = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="admin",
        scope_level="org",
        time_start=None,
        time_end=None,
    )
    if kpi_result.get("status") not in ("compiled", "ok"):
        errors.append(f"run_kpi admin org conversation_count: {kpi_result.get('error')}")

    # --- 7. run_kpi: agent denied org scope ---
    denied = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401],
        scope_level="org",
    )
    if denied.get("error_type") != "DENY":
        errors.append("run_kpi: agent org scope should be DENY")

    # --- 8. run_kpi: agent queue scope ---
    agent_queue = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401],
        scope_level="queue",
    )
    if agent_queue.get("error_type") == "DENY":
        errors.append("run_kpi: agent queue scope should NOT be DENY")
    elif agent_queue.get("status") not in ("compiled", "ok"):
        errors.append(f"run_kpi: agent queue scope error: {agent_queue.get('error')}")

    # --- 9. run_kpi: agent own scope ---
    agent_own = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401],
        scope_level="own",
    )
    if agent_own.get("status") not in ("compiled", "ok"):
        errors.append(f"run_kpi: agent own scope error: {agent_own.get('error')}")
    if agent_own.get("sql") and "assigned_agent_id" not in agent_own["sql"]:
        errors.append("run_kpi: agent own scope must filter assigned_agent_id")

    # --- 10. time resolver ---
    for expr in ("all time", "this month", "last 7 days"):
        try:
            tb = resolve_expression(expr)
            if expr == "all time" and tb.start is not None:
                errors.append(f"time: 'all time' should have no start bound, got {tb.start}")
        except Exception as exc:
            errors.append(f"time: '{expr}' failed: {exc}")

    if errors:
        print("\n".join(errors))
        return 1

    print(
        f"ok: {len(kpis)} KPIs, sql_guard checks, run_kpi scope checks (admin org, agent queue/own, agent deny), "
        f"virtual view CTEs, time resolver"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
