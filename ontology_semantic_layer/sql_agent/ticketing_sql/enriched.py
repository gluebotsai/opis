"""Operational SQL enrichment for Ticketing KPI templates (no marts)."""

from __future__ import annotations

import re

ENRICHED_TICKETS_BODY = """
SELECT
    t.id::text AS ticket_id,
    t.organization_id::text AS organization_id,
    t.ticket_number,
    t.subject,
    t.status,
    ts.display_name AS status_display_name,
    COALESCE(ts.is_terminal, false) AS is_closed_by_status,
    t.priority,
    t.channel,
    t.customer_id::text AS customer_id,
    t.customer_name,
    t.customer_email,
    cp.account_id::text AS account_id,
    ta.name AS account_name,
    t.assignee_id::text AS assignee_id,
    t.assignee_name,
    ag.role AS assignee_role,
    t.resolver_id::text AS resolver_id,
    t.resolver_name,
    t.queue_id::text AS queue_id,
    t.queue_name,
    aq.type AS queue_type,
    aq.sla_status AS queue_sla_status,
    true AS team_supports_ticketing,
    t.category,
    t.skill,
    t.due_at,
    t.first_response_at,
    t.resolved_at,
    t.csat_score,
    t.csat_rated_at,
    t.created_by_id::text AS created_by_id,
    t.created_by_name,
    (LOWER(t.status) = 'resolved') AS is_resolved,
    (LOWER(t.status) = 'open') AS is_open,
    (LOWER(t.status) = 'closed') AS is_closed,
    (LOWER(t.status) NOT IN ('closed', 'resolved')) AS is_pending,
    (LOWER(t.status) = 'overdue') AS is_breached_proxy,
    CASE WHEN t.resolved_at IS NOT NULL AND t.created_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 END AS resolution_hours,
    CASE WHEN t.first_response_at IS NOT NULL AND t.created_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0 END AS first_response_hours,
    CASE WHEN t.first_response_at IS NOT NULL AND t.created_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60.0 END AS first_response_minutes,
    (t.first_response_at IS NOT NULL) AS has_first_response,
    (t.csat_score IS NOT NULL) AS has_csat_score,
    (t.csat_score IS NOT NULL) AS has_csat_rating,
    (t.assignee_id IS NOT NULL AND t.assignee_name IS NOT NULL AND t.assignee_name <> 'Unassigned') AS has_assignee,
    (t.resolver_id IS NOT NULL OR (t.resolver_name IS NOT NULL AND t.resolver_name <> '')) AS has_resolver,
    ((LOWER(t.status) NOT IN ('closed', 'resolved'))
        AND t.due_at IS NOT NULL AND t.due_at < NOW()) AS is_overdue,
    (LOWER(t.status) = 'reopened') AS is_reopened,
    ((LOWER(t.status) = 'open') AND LOWER(t.priority) = 'high') AS is_high_priority_open,
    ((LOWER(t.status) NOT IN ('closed', 'resolved'))
        AND t.due_at IS NOT NULL AND DATE(t.due_at) = CURRENT_DATE) AS is_due_today,
    ((LOWER(t.status) NOT IN ('closed', 'resolved'))
        AND t.due_at IS NOT NULL AND DATE(t.due_at) = CURRENT_DATE) AS is_sla_at_risk,
    CASE WHEN t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at > t.due_at
         THEN EXTRACT(EPOCH FROM (t.resolved_at - t.due_at)) / 3600.0 END AS overdue_hours,
    CASE
        WHEN t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at THEN true
        WHEN (LOWER(t.status) = 'resolved')
             AND sp.resolution_hours IS NOT NULL
             AND t.resolved_at IS NOT NULL AND t.created_at IS NOT NULL
             AND EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 <= sp.resolution_hours THEN true
        ELSE false
    END AS is_resolution_sla_met,
    (t.resolved_at IS NOT NULL AND (t.due_at IS NOT NULL OR sp.resolution_hours IS NOT NULL)) AS has_resolution_sla_target,
    sp.resolution_hours AS sla_resolution_hours,
    sp.first_response_hours AS sla_first_response_hours,
    CASE WHEN (LOWER(t.status) = 'resolved')
              AND sp.resolution_hours IS NOT NULL
              AND t.resolved_at IS NOT NULL AND t.created_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 - sp.resolution_hours END AS resolution_hours_variance,
    CASE WHEN t.first_response_at IS NOT NULL AND sp.first_response_hours IS NOT NULL
              AND EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0 <= sp.first_response_hours
         THEN true ELSE false END AS is_first_response_sla_met,
    (t.first_response_at IS NOT NULL AND sp.first_response_hours IS NOT NULL) AS has_first_response_sla_target,
    t.created_at,
    t.updated_at
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
    ON t.status = ts.status AND t.organization_id = ts.organization_id
LEFT JOIN ticketing.sla_policies sp
    ON t.priority = sp.priority AND t.organization_id = sp.organization_id AND sp.active = true
LEFT JOIN ticketing.contact_profile cp
    ON t.customer_id = cp.id AND t.organization_id = cp.organization_id
LEFT JOIN ticketing.ticketing_accounts ta
    ON cp.account_id = ta.id AND t.organization_id = ta.organization_id
LEFT JOIN ticketing.agent_queues aq
    ON t.queue_id = aq.id AND t.organization_id = aq.organization_id
LEFT JOIN ticketing.agents ag
    ON t.assignee_id = ag.id AND t.organization_id = ag.organization_id
"""

ENRICHED_AUDIT_BODY = """
SELECT
    ae.id::text AS audit_event_id,
    ae.organization_id::text AS organization_id,
    ae.ticket_id::text AS ticket_id,
    t.ticket_number,
    t.priority AS ticket_priority,
    t.status AS ticket_status,
    t.channel AS ticket_channel,
    t.queue_id::text AS queue_id,
    t.queue_name,
    t.assignee_id::text AS assignee_id,
    t.assignee_name,
    ae.action,
    ae.actor_id::text AS actor_id,
    ae.actor_name,
    (LOWER(ae.action) IN ('escalate', 'escalated', 'ticket.escalated')) AS is_escalation_event,
    (LOWER(ae.action) IN ('reassign', 'reassigned', 'assign', 'assigned', 'ticket.assigned', 'ticket.reassigned')) AS is_assignment_event,
    ae.created_at
FROM ticketing.audit_events ae
LEFT JOIN ticketing.tickets t
    ON ae.ticket_id = t.id AND ae.organization_id = t.organization_id
"""

OPERATIONAL_FROM: dict[str, str] = {
    'ticketing_marts.mart_agent_queue_members': """
(
SELECT
    id::text AS queue_membership_id,
    organization_id::text AS organization_id,
    queue_id::text AS queue_id,
    user_id::text AS user_id,
    created_at
 FROM ticketing.agent_queue_members
) AS op_agent_queue_members
""",
    'ticketing_marts.mart_agent_queues': """
(
SELECT
    id::text AS queue_id,
    organization_id::text AS organization_id,
    queue_name,
    type AS queue_type,
    sla_status,
    open_tickets,
    assigned,
    (LOWER(sla_status) = 'at_risk') AS is_at_risk,
    created_at
 FROM ticketing.agent_queues
) AS op_agent_queues
""",
    'ticketing_marts.mart_customers': """
(
SELECT
    id::text AS customer_id,
    organization_id::text AS organization_id,
    account_id::text AS account_id,
    status,
    (LOWER(status) = 'active') AS is_active,
    total_tickets,
    created_at,
    updated_at
 FROM ticketing.contact_profile
) AS op_customers
""",
    'ticketing_marts.mart_kb_articles': """
(
SELECT
    id::text AS kb_article_id,
    organization_id::text AS organization_id,
    title,
    status,
    category,
    (LOWER(status) = 'published') AS is_published,
    COALESCE(views, 0)::bigint AS view_count,
    created_at
 FROM ticketing.kb_articles
) AS op_kb_articles
""",
    'ticketing_marts.mart_macros': """
(
SELECT
    id::text AS macro_id,
    organization_id::text AS organization_id,
    created_by_name,
    created_at
 FROM ticketing.macros
) AS op_macros
""",
    'ticketing_marts.mart_notifications': """
(
SELECT
    id::text AS notification_id,
    organization_id::text AS organization_id,
    user_id::text AS user_id,
    kind,
    COALESCE(is_read, false) AS is_read,
    created_at
 FROM ticketing.notifications
) AS op_notifications
""",
    'ticketing_marts.mart_outbound_emails': """
(
SELECT
    id::text AS outbound_email_id,
    organization_id::text AS organization_id,
    ticket_id::text AS ticket_id,
    kind,
    status,
    created_at
 FROM ticketing.outbound_email_log
) AS op_outbound_emails
""",
    'ticketing_marts.mart_proactive_approvals': """
(
SELECT
    id::text AS approval_id,
    organization_id::text AS organization_id,
    ticket_id::text AS ticket_id,
    agent_id::text AS agent_id,
    status,
    (LOWER(status) = 'approved') AS is_approved,
    (LOWER(status) = 'rejected') AS is_rejected,
    (LOWER(status) = 'pending') AS is_pending,
    (LOWER(status) IN ('approved', 'rejected')) AS is_decided,
    0.0::float AS decision_hours,
    created_at
 FROM ticketing.proactive_approvals
) AS op_proactive_approvals
""",
    'ticketing_marts.mart_proactive_audit': """
(
SELECT
    id::text AS proactive_audit_id,
    organization_id::text AS organization_id,
    ticket_id::text AS ticket_id,
    agent_id::text AS agent_id,
    created_at
 FROM ticketing.proactive_audit
) AS op_proactive_audit
""",
    'ticketing_marts.mart_proactive_recommendations': """
(
SELECT
    id::text AS recommendation_id,
    organization_id::text AS organization_id,
    ticket_id::text AS ticket_id,
    agent_id::text AS agent_id,
    status,
    (LOWER(status) = 'accepted') AS is_accepted,
    (LOWER(status) = 'dismissed') AS is_dismissed,
    (LOWER(status) = 'open') AS is_open,
    created_at
 FROM ticketing.proactive_recommendations
) AS op_proactive_recommendations
""",
    'ticketing_marts.mart_ticket_notes': """
(
SELECT
    id::text AS ticket_note_id,
    organization_id::text AS organization_id,
    ticket_id::text AS ticket_id,
    author_id::text AS author_id,
    author_name,
    visibility,
    (LOWER(visibility) = 'internal') AS is_internal_note,
    created_at
 FROM ticketing.ticket_notes
) AS op_ticket_notes
""",
    'ticketing_marts.mart_users': """
(
SELECT
    id::text AS user_id,
    organization_id::text AS organization_id,
    support_email AS email,
    role,
    status,
    (LOWER(status) = 'active') AS is_active,
    created_at,
    updated_at
 FROM ticketing.agents
) AS op_users
""",
}


_MART_TICKETS = "ticketing_marts.mart_tickets"
_TABLE_MAP = {
    "mart_tickets": "tickets",
    "mart_users": "agents",
    "mart_customers": "contact_profile",
    "mart_audit_events": "audit_events",
    "mart_proactive_recommendations": "proactive_recommendations",
    "mart_proactive_approvals": "proactive_approvals",
    "mart_proactive_audit": "proactive_audit",
    "mart_ticket_notes": "ticket_notes",
    "mart_kb_articles": "kb_articles",
    "mart_macros": "macros",
    "mart_notifications": "notifications",
    "mart_outbound_emails": "outbound_email_log",
    "mart_agent_queues": "agent_queues",
    "mart_agent_queue_members": "agent_queue_members",
}


def operational_table(table: str | None) -> str | None:
    if not table:
        return table
    if table.startswith("mart_"):
        return _TABLE_MAP.get(table, table.removeprefix("mart_"))
    return table


def _replace_mart_refs(sql: str) -> str:
    out = sql
    for mart_ref, subq in OPERATIONAL_FROM.items():
        out = out.replace(mart_ref, subq)
    out = out.replace(_MART_TICKETS, "enriched")
    out = out.replace("ticketing_marts.mart_audit_events", "enriched_audit")
    return out


def _strip_leading_with_cte(sql: str, cte_name: str) -> tuple[str | None, str]:
    """If sql starts with WITH <cte_name> AS (...), return (body, remainder)."""
    marker = f"WITH {cte_name} AS ("
    body = sql.strip()
    if not body.upper().startswith(marker.upper()):
        return None, body
    start = len(marker)
    depth = 1
    i = start
    while i < len(body) and depth:
        if body[i] == "(":
            depth += 1
        elif body[i] == ")":
            depth -= 1
        i += 1
    cte_body = body[start : i - 1]
    rest = body[i:].lstrip()
    return cte_body, rest


def wrap_metric_sql(sql: str, *, enriched_base: str | None = None) -> str:
    """Rewrite mart-based semantic templates to operational ticketing.* SQL."""
    out = _replace_mart_refs(sql.strip())
    needs_tickets = (
        "FROM enriched" in out
        or "from enriched" in out
        or "mart_tickets" in sql
        or _MART_TICKETS in sql
    )
    needs_audit = (
        "enriched_audit" in out.lower()
        or "mart_audit_events" in sql
    )

    tickets_cte = None
    audit_cte = None
    rest = out

    existing_tickets, rest = _strip_leading_with_cte(rest, "enriched")
    if existing_tickets is not None:
        tickets_cte = existing_tickets
        needs_tickets = True
    existing_audit, rest2 = _strip_leading_with_cte(rest, "enriched_audit")
    if existing_audit is not None:
        audit_cte = existing_audit
        rest = rest2
        needs_audit = True

    if needs_tickets and tickets_cte is None:
        tickets_cte = ENRICHED_TICKETS_BODY
    if needs_audit and audit_cte is None:
        audit_cte = ENRICHED_AUDIT_BODY

    ctes: list[str] = []
    if tickets_cte is not None:
        ctes.append(f"enriched AS ({tickets_cte})")
    if audit_cte is not None:
        ctes.append(f"enriched_audit AS ({audit_cte})")
    if not ctes:
        return rest
    return f"WITH {', '.join(ctes)} {rest}"

