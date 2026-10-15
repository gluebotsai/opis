"""python -m reports_analytics_agent_ticketing.core.validate"""

from __future__ import annotations

import sys

from .access import AccessDenied
from .loader import merge_effective, PACK_ROOT
from .query_frame import FilterMention, Identity, QueryFrame, ScopeSpec, TimeSpec
from .run_analytics import UnmatchedName, compile_certified, compile_frame, execute_frame


def _admin() -> Identity:
    return Identity(organization_id=900001, user_id=91001, role="admin", my_queue_ids=[92001, 92002])


def main() -> int:
    catalog = merge_effective(None)
    kpis = catalog["kpis"]
    errors: list[str] = []
    if "matrix" not in catalog["access"]:
        errors.append("access.yml missing matrix")
    expected = PACK_ROOT / "tests" / "golden" / "expected.yml"
    if not expected.exists():
        errors.append("missing tests/golden/expected.yml")

    ident = _admin()
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
        if t1012.get("thresholds") != (tenant_doc.get("thresholds") or {}):
            errors.append("org 1012 thresholds did not match tenant_thresholds.yml")

    for kpi_id in sorted(kpis):
        scope = "org" if "org" in (kpis[kpi_id].get("allowed_scope_levels") or ["org"]) else (
            kpis[kpi_id]["allowed_scope_levels"][0]
        )
        extras = {}
        if kpi_id == "csat_distribution_rate":
            extras["filters"] = [FilterMention(field="bucket", mention="promoter")]
        frame = QueryFrame(
            shape="kpi",
            measure=kpi_id,
            path="certified",
            scope=ScopeSpec(level=scope),
            time=TimeSpec(),
            **extras,
        )
        try:
            sql, _echo = compile_certified(frame, ident)
        except Exception as exc:
            errors.append(f"compile {kpi_id}: {exc}")
            continue
        if "organization_id" not in sql and "{{" in sql:
            errors.append(f"{kpi_id} still has slots")
        if kpi_id != "total_customers" and str(ident.organization_id) not in sql:
            errors.append(f"{kpi_id} missing org id")

    open_frame = QueryFrame(
        shape="kpi",
        measure="ticket_count",
        path="certified",
        scope=ScopeSpec(level="org"),
        filters=[FilterMention(field="status", mention="open", reading="open")],
    )
    sql, _ = compile_certified(open_frame, ident)
    if "status = 'Open'" not in sql:
        errors.append("ticket_count open segment missing")
    pending = QueryFrame(
        shape="kpi",
        measure="ticket_count",
        path="certified",
        scope=ScopeSpec(level="org"),
        filters=[FilterMention(field="status", mention="pending", reading="generic_pending")],
    )
    sql, _ = compile_certified(pending, ident)
    if "NOT IN ('Closed', 'Resolved')" not in sql:
        errors.append("generic pending SQL missing")

    grouped = QueryFrame(
        shape="breakdown",
        measure="ticket_count",
        path="certified",
        scope=ScopeSpec(level="org"),
        group_by=["queue"],
    )
    sql, _ = compile_certified(grouped, ident)
    if "GROUP BY queue_id" not in sql:
        errors.append("group by queue missing")

    agent = Identity(organization_id=900001, user_id=91002, role="agent", my_queue_ids=[92001])
    try:
        compile_certified(
            QueryFrame(shape="kpi", measure="ticket_count", path="certified", scope=ScopeSpec(level="org")),
            agent,
        )
        errors.append("agent org ticket_count should be denied")
    except AccessDenied:
        pass


    resolver = Identity(organization_id=900001, user_id=91003, role="resolver", my_queue_ids=[92001])
    sla = QueryFrame(
        shape="kpi",
        measure="sla_breach_rate",
        path="certified",
        scope=ScopeSpec(level="queue"),
    )
    try:
        compile_certified(sla, resolver)
        errors.append("resolver queue sla_breach_rate should be denied")
    except AccessDenied:
        pass

    own = QueryFrame(
        shape="kpi",
        measure="ticket_count",
        path="certified",
        scope=ScopeSpec(level="own"),
    )
    sql, _ = compile_certified(own, resolver)
    if "resolver_id" not in sql:
        errors.append("resolver own tickets must filter resolver_id")

    listing = QueryFrame(
        shape="list",
        measure="tickets",
        path="catalog",
        scope=ScopeSpec(level="org"),
        limit=20,
    )
    sql, _ = compile_frame(listing, ident)
    if "ticketing.tickets" not in sql:
        errors.append("catalog list missing tickets")

    from .cypher_compiler import compile_graph_frame

    kg_measures = catalog["kg_measures"]
    for measure_id, card in kg_measures.items():
        extras: dict = {}
        if card.get("requires_group_by"):
            extras["group_by"] = ["queue"]
        scope = "org" if "org" in (card.get("allowed_scope_levels") or ["org"]) else card["allowed_scope_levels"][0]
        kg_frame = QueryFrame(
            shape="breakdown" if card.get("requires_group_by") else "list",
            measure=measure_id,
            path="certified",
            scope=ScopeSpec(level=scope),
            **extras,
        )
        try:
            cypher, params, echo = compile_graph_frame(kg_frame, ident)
        except Exception as exc:
            errors.append(f"compile kg {measure_id}: {exc}")
            continue
        if "organization_id" in cypher:
            errors.append(f"{measure_id} must not filter organization_id")
        if "OpenTicket" in cypher:
            errors.append(f"{measure_id} must not use OpenTicket labels")
        if "{{" in cypher:
            errors.append(f"{measure_id} still has slots")
        if "MATCH" not in cypher.upper():
            errors.append(f"{measure_id} missing MATCH")

    open_kg = QueryFrame(
        shape="list",
        measure="ticket_neighborhood",
        path="certified",
        scope=ScopeSpec(level="org"),
        filters=[FilterMention(field="status", mention="open", reading="open")],
    )
    cypher, _, _ = compile_graph_frame(open_kg, ident)
    if "t.status = 'Open'" not in cypher:
        errors.append("kg open segment missing")
    pending_kg = QueryFrame(
        shape="list",
        measure="ticket_neighborhood",
        path="certified",
        scope=ScopeSpec(level="org"),
        filters=[FilterMention(field="status", mention="pending", reading="generic_pending")],
    )
    cypher, _, _ = compile_graph_frame(pending_kg, ident)
    if "Closed" not in cypher or "Resolved" not in cypher:
        errors.append("kg generic pending missing")

    try:
        compile_graph_frame(
            QueryFrame(
                shape="list",
                measure="ticket_neighborhood",
                path="certified",
                scope=ScopeSpec(level="org"),
            ),
            agent,
        )
        errors.append("agent org kg neighborhood should be denied")
    except AccessDenied:
        pass

    week_open = QueryFrame(
        shape="list",
        measure="ticket_neighborhood",
        path="certified",
        scope=ScopeSpec(level="org"),
        time=TimeSpec(expression="this week"),
        filters=[FilterMention(field="status", mention="open", reading="open")],
    )
    cypher, params, echo = compile_graph_frame(week_open, ident)
    if "datetime($period_start)" not in cypher or "t.status = 'Open'" not in cypher:
        errors.append("golden open neighborhood this week missing time or Open")
    if "this week" not in echo:
        errors.append("golden open neighborhood echo missing week")

    why_own = QueryFrame(
        shape="breakdown",
        measure="why_breakdown",
        path="certified",
        scope=ScopeSpec(level="own"),
        group_by=["queue"],
    )
    cypher, _, echo = compile_graph_frame(why_own, ident)
    if "assignee_id" not in cypher:
        errors.append("golden why own missing assignee_id")
    if "in_queue" not in cypher:
        errors.append("golden why own missing in_queue hop")

    staff = QueryFrame(
        shape="list",
        measure="staffing_path",
        path="certified",
        scope=ScopeSpec(level="org"),
    )
    cypher, _, _ = compile_graph_frame(staff, ident)
    if "staffed_by" not in cypher:
        errors.append("golden staffing missing staffed_by")

    from .cypher_validate import assert_product_fence

    leak = (
        "MATCH (t:Ticket)-[:raised_by]->(c:Contact)-[:RAISED]->(x:Conversation) "
        "RETURN t.id LIMIT 1"
    )
    try:
        assert_product_fence(leak)
        errors.append("cross-product Contact hop should be rejected")
    except ValueError:
        pass

    star = "MATCH (t:Ticket)-[:in_queue*1..3]->(q:Queue) RETURN q.id LIMIT 1"
    try:
        assert_product_fence(star)
        errors.append("variable-length hop should be rejected")
    except ValueError:
        pass

    from .run_graph import execute_graph

    queued = QueryFrame(
        shape="kpi",
        measure="ticket_count",
        path="certified",
        scope=ScopeSpec(level="org"),
        filters=[FilterMention(field="queue", mention="92001")],
    )
    job = execute_frame(queued, ident)
    if "queue_id IN (92001)" not in job["sql"]:
        errors.append("numeric queue filter missing")
    try:
        execute_frame(
            QueryFrame(
                shape="kpi",
                measure="ticket_count",
                path="certified",
                scope=ScopeSpec(level="org"),
                filters=[FilterMention(field="queue", mention="Unknown Queue")],
            ),
            ident,
        )
        errors.append("unresolved queue name should not compile")
    except UnmatchedName:
        pass
    try:
        compile_certified(
            QueryFrame(
                shape="kpi",
                measure="ticket_count",
                path="certified",
                scope=ScopeSpec(level="org"),
                time=TimeSpec(date_column="paid_at"),
            ),
            ident,
        )
        errors.append("disallowed date column should fail")
    except ValueError:
        pass
    th = execute_frame(
        QueryFrame(
            shape="kpi",
            measure="sla_breach_rate",
            path="certified",
            scope=ScopeSpec(level="org"),
            check_thresholds=True,
        ),
        Identity(organization_id=1012, user_id=1, role="admin", my_queue_ids=[]),
        value=0.25,
    )
    if th.get("threshold_level") != "critical":
        errors.append(f"org 1012 sla_breach_rate 0.25 should be critical, got {th.get('threshold_level')}")
    kg_job = execute_graph(
        QueryFrame(
            shape="list",
            measure="ticket_neighborhood",
            path="certified",
            scope=ScopeSpec(level="org"),
            filters=[FilterMention(field="queue", mention="92001")],
        ),
        ident,
    )
    if "t.queue_id IN" not in kg_job["cypher"] or "92001" not in kg_job["cypher"]:
        errors.append("kg numeric queue filter missing")

    if errors:
        print("\n".join(errors))
        return 1
    print(f"ok: {len(kpis)} KPIs compile, {len(kg_measures)} graph measures, access checks, catalog list")
    return 0


if __name__ == "__main__":
    sys.exit(main())
