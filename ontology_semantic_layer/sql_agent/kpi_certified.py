"""SQL-agent KPI certification (templates only — no other query stack)."""

from __future__ import annotations

from sql_agent.kpi_template_registry import get_template, list_templates


def is_certified(metric_id: str, *, product: str | None = None) -> bool:
    if product:
        return get_template(product, metric_id) is not None
    for prod in ("ticketing", "ccaas", "crm", "campaign", "webtracking"):
        if get_template(prod, metric_id):
            return True
    return False


def resolve_metric_alias(metric_id: str) -> str:
    aliases = {
        "high_priority_open_tickets_metric": "high_priority_ticket_volume",
        "tickets_created_by_me": "tickets_created_by_me",
        "open_tickets": "open_tickets_metric",
    }
    return aliases.get(metric_id, metric_id)
