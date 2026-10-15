"""Agent allowlist and routing policy for SQL Super."""

from __future__ import annotations

import re
from typing import Any

from ontology.slice import normalize_product_id
from sql_agent.agent_grants import visible_metrics_for_agent
from sql_agent.kpi_certified import is_certified
from sql_agent.kpi_policy import get_metric_policy

_KPI_PATTERNS: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"\b(total conversations?|conversation volume)\b", re.I), ["total_conversations"]),
    (re.compile(r"\bopen conversations?\b", re.I), ["open_conversations"]),
    (re.compile(r"\b(aht|average handle time|handle time)\b", re.I), ["average_handle_time"]),
    (re.compile(r"\b(containment|ai containment)\b", re.I), ["ai_containment_rate"]),
    (re.compile(r"\b(sla breach|breach rate)\b", re.I), ["sla_breach_rate"]),
    (re.compile(r"\b(missed contact)\b", re.I), ["missed_contact_rate"]),
    (re.compile(r"\bopen tickets?\b", re.I), ["open_tickets_metric"]),
    (re.compile(r"\b(high[- ]?priority|urgent)\b.*\btickets?\b", re.I), ["high_priority_ticket_volume"]),
    (re.compile(r"\btickets?\b.*\b(high[- ]?priority|urgent)\b", re.I), ["high_priority_ticket_volume"]),
    (re.compile(r"\b(resolution time|avg resolution)\b", re.I), ["average_resolution_time_hours"]),
    (re.compile(r"\bcsat\b", re.I), ["average_csat_score"]),
    (re.compile(r"\b(won rate|win rate|deals won)\b", re.I), ["won_deal_rate"]),
    (re.compile(r"\b(pipeline value|deal value)\b", re.I), ["pipeline_value"]),
    (re.compile(r"\b(open deals?|active deals?)\b", re.I), ["open_deals_metric"]),
    (re.compile(r"\b(campaign sends?|sent touches?)\b", re.I), ["sent_touch_count"]),
    (re.compile(r"\b(open rate|email open)\b", re.I), ["email_open_rate"]),
    (re.compile(r"\b(click rate|ctr)\b", re.I), ["email_click_rate"]),
    (re.compile(r"\b(bounce rate|unsubscribe rate)\b", re.I), ["bounce_rate"]),
    (re.compile(r"\b(session duration|avg session)\b", re.I), ["average_session_duration_seconds"]),
    (re.compile(r"\b(bounce rate|page bounce)\b", re.I), ["bounce_rate_web"]),
    (re.compile(r"\b(conversion rate|goal conversion)\b", re.I), ["conversion_rate"]),
]

_COUNT_INTENT = re.compile(
    r"\b(count|how many|number of|total|volume)\b",
    re.I,
)

_COUNT_PATTERNS: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"\b(high[- ]?priority|urgent)\b.*\btickets?\b", re.I), ["high_priority_ticket_volume"]),
    (re.compile(r"\btickets?\b.*\b(high[- ]?priority|urgent)\b", re.I), ["high_priority_ticket_volume"]),
    (re.compile(r"\btickets?\b", re.I), ["ticket_volume"]),
    (re.compile(r"\bconversations?\b", re.I), ["total_conversations"]),
    (re.compile(r"\bdeals?\b", re.I), ["deal_volume"]),
    (re.compile(r"\bcontacts?\b", re.I), ["contact_volume"]),
    (re.compile(r"\bcampaigns?\b", re.I), ["campaign_volume"]),
    (re.compile(r"\b(sessions?|visitors?)\b", re.I), ["web_session_volume"]),
]

_DEFAULT_VOLUME_METRIC: dict[str, str] = {
    "ticketing": "ticket_volume",
    "ccaas": "total_conversations",
    "crm": "deal_volume",
    "campaign": "campaign_volume",
    "webtracking": "web_session_volume",
    "cdp": "contact_volume",
}

PLAIN_COUNT = "__plain_count__"

_HIGH_PRIORITY_TICKET = re.compile(
    r"\b(high[- ]?priority|urgent)\b.*\btickets?\b|\btickets?\b.*\b(high[- ]?priority|urgent)\b",
    re.I,
)


def _high_priority_ticket_intent(instruction: str) -> bool:
    return bool(_HIGH_PRIORITY_TICKET.search(instruction or ""))


_LIST_ONLY_AGENTS = frozenset(
    {
        "cc.ai_support",
        "cc.coworker",
    }
)


class AgentPolicyError(ValueError):
    pass


def resolve_agent_policy(
    *,
    organization_id: int,
    user_id: int,
    origin_product: str,
    origin_agent: str,
) -> dict[str, Any]:
    product = normalize_product_id(origin_product)
    visible = visible_metrics_for_agent(origin_agent, product)
    return {
        "product": product,
        "agent": origin_agent,
        "allowed_metrics": visible,
        "list_only": origin_agent in _LIST_ONLY_AGENTS,
        "role": "agent",
    }


def assert_metrics_allowed(
    policy: dict[str, Any],
    metric_ids: list[str],
) -> None:
    for mid in metric_ids:
        if not is_certified(mid, product=policy.get("product")):
            raise AgentPolicyError(f"Metric '{mid}' is not certified.")
        allowed = policy.get("allowed_metrics") or set()
        if mid not in allowed:
            raise AgentPolicyError(
                f"Metric '{mid}' is not allowlisted for agent '{policy.get('agent')}'."
            )


_LIST_VERBS = re.compile(r"\b(list|show|get|fetch|display|drill|rows?|details?|search)\b", re.I)


def detect_kpi_metrics(instruction: str, policy: dict[str, Any]) -> list[str]:
    if _LIST_VERBS.search(instruction) and not _COUNT_INTENT.search(instruction):
        return []
    allowed = policy.get("allowed_metrics") or set()
    product = policy.get("product")
    if _high_priority_ticket_intent(instruction):
        mid = "high_priority_ticket_volume"
        if mid in allowed and is_certified(mid, product=product):
            return [mid]
    found: list[str] = []
    for pattern, metrics in _KPI_PATTERNS:
        if pattern.search(instruction):
            for mid in metrics:
                if mid in allowed and mid not in found and is_certified(mid, product=product):
                    found.append(mid)
    return found


def _instruction_names_kpi(instruction: str) -> bool:
    if _high_priority_ticket_intent(instruction):
        return True
    return any(pattern.search(instruction) for pattern, _ in _KPI_PATTERNS)


def detect_count_metrics(
    instruction: str,
    policy: dict[str, Any],
    product: str,
) -> list[str]:
    if policy.get("list_only"):
        return []
    if not _COUNT_INTENT.search(instruction):
        return []
    if product == "ticketing" and _high_priority_ticket_intent(instruction):
        list_only = bool(policy.get("list_only"))
        allowed = policy.get("allowed_metrics") or set()
        if list_only or "high_priority_ticket_volume" in allowed:
            if is_certified("high_priority_ticket_volume", product=product):
                return ["high_priority_ticket_volume"]
    if _instruction_names_kpi(instruction) or detect_kpi_metrics(instruction, policy):
        return []
    allowed = policy.get("allowed_metrics") or set()
    list_only = bool(policy.get("list_only"))
    for pattern, metrics in _COUNT_PATTERNS:
        if pattern.search(instruction):
            for mid in metrics:
                if list_only or mid in allowed:
                    if is_certified(mid, product=product):
                        return [mid]
    default_mid = _DEFAULT_VOLUME_METRIC.get(product.strip().lower())
    if default_mid and (list_only or default_mid in allowed) and is_certified(default_mid, product=product):
        return [default_mid]
    if list_only or _COUNT_INTENT.search(instruction):
        return [PLAIN_COUNT]
    return []


def suggest_metric_request(
    instruction: str,
    policy: dict[str, Any],
    *,
    organization_id: int,
    user_id: int,
    product: str,
) -> dict[str, Any] | None:
    metrics = detect_kpi_metrics(instruction, policy)
    if not metrics:
        return None
    return {
        "organizationId": organization_id,
        "userId": user_id,
        "product": product,
        "agent": policy.get("agent"),
        "metrics": metrics[:1],
    }


def metric_scope_mode(metric_id: str, product: str) -> str:
    pol = get_metric_policy(metric_id, product=product)
    if (pol.get("scope") or "org").lower() == "org":
        return "org"
    return "assignee"
