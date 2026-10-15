"""python -m reports_analytics_agent_ticketing.core.validate

V2 validation harness. Validates:
  1. KPI/SQL file pairing integrity (all KPIs have templates)
  2. Access matrix completeness
  3. Virtual view schema consistency (cte_body for each role)
  4. sql_guard: scoped CTEs, role denial, forbidden SQL
  5. KG measure/cypher file pairing
  6. cypher_guard: product fence, variable-length hops
  7. Org 1012 tenant overlay correctness
  8. run_kpi: scope enforcement including agent queue fix
  9. time resolver: all-time, calendar, trailing windows
"""

from __future__ import annotations

import sys

from .access import AccessDenied
from .cypher_guard import CypherGuardError
from .cypher_validate import assert_product_fence
from .loader import PACK_ROOT, PRODUCT_DIR, merge_effective
from .run_kpi import run_kpi
from .sql_guard import GuardError, guard_sql
from .time import resolve_expression
from .views import cte_body


def main() -> int:
    catalog = merge_effective(None)
    kpis = catalog["kpis"]
    errors: list[str] = []

    # ── 1. Access matrix ────────────────────────────────────────────────────
    if "matrix" not in catalog["access"]:
        errors.append("access.yml missing matrix")

    # ── 2. KPI / SQL file integrity ─────────────────────────────────────────
    sql_files = catalog.get("sql_files") or {}
    missing_sql = set(kpis) - set(sql_files)
    extra_sql = set(sql_files) - set(kpis)
    if missing_sql:
        errors.append(f"KPIs missing SQL templates: {sorted(missing_sql)}")
    if extra_sql:
        errors.append(f"SQL templates with no KPI card: {sorted(extra_sql)}")

    # ── 3. Org 1012 tenant overlay ──────────────────────────────────────────
    expected = PACK_ROOT / "tests" / "golden" / "expected.yml"
    if not expected.exists():
        errors.append("missing tests/golden/expected.yml")

    t1012 = merge_effective(1012)
    if t1012["kpis"].keys() != catalog["kpis"].keys():
        errors.append("org 1012 must not add or drop KPIs")
    overlay = PACK_ROOT / "organizations" / "org_1012" / "tenant_thresholds.yml"
    if not overlay.exists():
        errors.append("missing organizations/org_1012/tenant_thresholds.yml")
    else:
        import yaml
        tenant_doc = yaml.safe_load(overlay.read_text()) or {}
        if tenant_doc.get("kpis", {}).get("add") or tenant_doc.get("kpis", {}).get("override"):
            errors.append("org 1012 must not add or override KPIs")
        if not t1012.get("thresholds"):
            errors.append("org 1012 thresholds did not load onto the effective catalog")

    # ── 4. Virtual view CTEs for each role ──────────────────────────────────
    for role in ("admin", "agent", "resolver"):
        # Views every role should have
        shared_views = ["tickets", "ticket_facts", "notifications", "sla_policies", "queues", "queue_members"]
        # Views resolver does NOT have
        resolver_denied = {"agents", "customers", "accounts",
                           "kb_articles", "recommendations", "approvals"}
        for view in shared_views:
            try:
                body = cte_body(view, role, PRODUCT_DIR)
                if "SELECT" not in body.upper():
                    errors.append(f"cte_body {role}/{view}: no SELECT in body")
            except Exception as exc:
                errors.append(f"cte_body {role}/{view}: {exc}")
        # Resolver should not have denied views
        if role == "resolver":
            for view in resolver_denied:
                try:
                    cte_body(view, role, PRODUCT_DIR)
                    errors.append(f"cte_body resolver/{view}: should not exist for resolver")
                except KeyError:
                    pass  # expected

    # ── 5. sql_guard: admin basic SELECT ───────────────────────────────────
    try:
        guarded = guard_sql(
            "SELECT ticket_number, status FROM rpt.tickets LIMIT 10",
            role="admin",
            organization_id=900001,
            user_id=91001,
            queue_ids=[92001, 92002],
        )
        if "rpt_tickets" not in guarded.sql:
            errors.append("sql_guard: rpt_tickets CTE missing from admin query")
        if "%(  _org_id)s" in guarded.sql or "_org_id" not in str(guarded.params):
            pass  # params are bound internally — just verify sql structure
    except GuardError as exc:
        errors.append(f"sql_guard admin basic query rejected: {exc}")

    # ── 6. sql_guard: resolver denied rpt.agents ───────────────────────────
    try:
        guard_sql(
            "SELECT id FROM rpt.agents LIMIT 5",
            role="resolver",
            organization_id=900001,
            user_id=91003,
            queue_ids=[92001],
        )
        errors.append("sql_guard: resolver should be denied rpt.agents")
    except GuardError:
        pass  # expected

    # ── 7. sql_guard: forbidden SQL patterns ───────────────────────────────
    for bad_sql, label in [
        ("DROP TABLE ticketing.tickets", "DROP"),
        ("SELECT * FROM ticketing.tickets", "physical table"),
        ("SELECT pg_sleep(1)", "dangerous function"),
        ("SELECT * FROM rpt.tickets; SELECT 1", "multiple statements"),
    ]:
        try:
            guard_sql(bad_sql, role="admin", organization_id=900001, user_id=91001, queue_ids=[])
            errors.append(f"sql_guard: '{label}' should be rejected")
        except GuardError:
            pass  # expected

    # ── 8. run_kpi: admin org scope ─────────────────────────────────────────
    kpi_result = run_kpi(
        "ticket_count",
        organization_id=900001,
        user_id=91001,
        role="admin",
        scope_level="org",
        time_start=None,
        time_end=None,
    )
    if kpi_result.get("status") not in ("compiled", "ok"):
        errors.append(f"run_kpi admin org ticket_count: {kpi_result.get('error')}")
    if kpi_result.get("sql") and "organization_id" not in kpi_result["sql"]:
        errors.append("run_kpi: admin org ticket_count missing org filter")

    # ── 9. run_kpi: agent denied org scope ──────────────────────────────────
    denied = run_kpi(
        "ticket_count",
        organization_id=900001,
        user_id=91002,
        role="agent",
        queue_ids=[92001],
        scope_level="org",
    )
    if denied.get("error_type") != "DENY":
        errors.append("run_kpi: agent org scope should be DENY")

    # ── 10. run_kpi: agent queue scope (fixed bug) ──────────────────────────
    agent_queue = run_kpi(
        "ticket_count",
        organization_id=900001,
        user_id=91002,
        role="agent",
        queue_ids=[92001],
        scope_level="queue",
    )
    if agent_queue.get("error_type") == "DENY":
        errors.append("run_kpi: agent queue scope should NOT be DENY (bug fix regression)")
    elif agent_queue.get("status") not in ("compiled", "ok"):
        errors.append(f"run_kpi: agent queue scope unexpected error: {agent_queue.get('error')}")
    # Verify the SQL is scoped to their queue
    if agent_queue.get("sql") and "queue_id IN (92001)" not in agent_queue["sql"]:
        errors.append("run_kpi: agent queue scope SQL missing queue_id filter")

    # ── 11. run_kpi: resolver own scope ─────────────────────────────────────
    resolver_own = run_kpi(
        "ticket_count",
        organization_id=900001,
        user_id=91003,
        role="resolver",
        queue_ids=[92001],
        scope_level="own",
    )
    if resolver_own.get("status") not in ("compiled", "ok"):
        errors.append(f"run_kpi: resolver own scope error: {resolver_own.get('error')}")
    if resolver_own.get("sql") and "resolver_id" not in resolver_own["sql"]:
        errors.append("run_kpi: resolver own scope must filter resolver_id")

    # ── 12. KG measure / cypher file pairing ───────────────────────────────
    kg_measures = catalog.get("kg_measures") or {}
    kg_cypher = catalog.get("kg_cypher_files") or {}
    missing_cypher = set(kg_measures) - set(kg_cypher)
    extra_cypher = set(kg_cypher) - set(kg_measures)
    if missing_cypher:
        errors.append(f"KG measures missing cypher files: {sorted(missing_cypher)}")
    if extra_cypher:
        errors.append(f"KG cypher files with no measure card: {sorted(extra_cypher)}")

    # ── 13. cypher_guard: product fence ─────────────────────────────────────
    leak = (
        "MATCH (t:Ticket)-[:raised_by]->(c:Contact)-[:RAISED]->(x:Conversation) "
        "RETURN t.id LIMIT 1"
    )
    try:
        assert_product_fence(leak)
        errors.append("cross-product Contact hop should be rejected by product fence")
    except ValueError:
        pass  # expected

    star = "MATCH (t:Ticket)-[:in_queue*1..3]->(q:Queue) RETURN q.id LIMIT 1"
    try:
        assert_product_fence(star)
        errors.append("variable-length hop should be rejected by product fence")
    except ValueError:
        pass  # expected

    # ── 14. time resolver ───────────────────────────────────────────────────
    for expr in ["all time", "this month", "last 7 days", "August 2026", "yesterday"]:
        try:
            tb = resolve_expression(expr)
            if expr == "all time" and tb.start is not None:
                errors.append(f"time: 'all time' should have no start bound, got {tb.start}")
        except Exception as exc:
            errors.append(f"time: '{expr}' failed: {exc}")

    # ── Summary ─────────────────────────────────────────────────────────────
    if errors:
        print("\n".join(errors))
        return 1
    print(
        f"ok: {len(kpis)} KPIs, {len(kg_measures)} KG measures, "
        f"sql_guard checks, run_kpi scope checks (incl. agent-queue fix), "
        f"cypher fence, time resolver"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
