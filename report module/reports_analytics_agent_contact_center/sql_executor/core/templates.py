"""Slot-filling helper for Contact Center certified KPI SQL."""

from __future__ import annotations

import re
from typing import Any, Optional

SAFE_DIMENSIONS: dict[str, str] = {
    "queue": "queue_name",
    "queue_name": "queue_name",
    "agent": "agent_name",
    "agent_name": "agent_name",
    "channel": "channel",
    "priority": "priority",
    "status": "status",
    "disposition_category": "disposition_category",
    "disposition_code": "disposition_code",
    "direction": "direction",
    "sender_type": "sender_type",
    "from_queue": "from_queue_name",
    "from_queue_name": "from_queue_name",
    "to_queue": "to_queue_name",
    "to_queue_name": "to_queue_name",
    "state": "state",
    "outcome_reason": "outcome_reason",
    "reason": "reason",
    "reason_code": "reason_code",
    "handoff_reason": "handoff_reason",
    "intent": "intent",
    "skill_key": "skill_key",
    "turn_type": "turn_type",
    "agent_ext": "agent_ext",
    "is_inbound": "is_inbound",
    "team": "team_name",
    "team_name": "team_name",
}

DIMENSION_ALIASES: dict[str, str] = {
    "agents": "agent",
    "queues": "queue",
    "channels": "channel",
    "owner": "agent",
    "rep": "agent",
}

CALENDAR_DIMS = {"hour_of_day", "day_of_week", "day", "week", "month"}


def normalize_dimension(dimension: Optional[str], allowed: Optional[list] = None) -> Optional[str]:
    if dimension is None:
        return None
    raw = str(dimension).strip()
    if not raw or raw.lower() in {"null", "none", "false"}:
        return None
    mapped = DIMENSION_ALIASES.get(raw.lower(), raw.lower())
    if mapped not in SAFE_DIMENSIONS and mapped not in CALENDAR_DIMS:
        return None
    if allowed:
        allowed_ids = {str(a).strip().lower() for a in allowed if a}
        if mapped not in allowed_ids:
            return None
    return mapped


def _dim_expression(dimension: str, date_column: str) -> str:
    if dimension == "hour_of_day":
        return f"EXTRACT(HOUR FROM {date_column})::int"
    if dimension == "day_of_week":
        return f"TO_CHAR({date_column}, 'Dy')"
    if dimension == "day":
        return f"({date_column})::date"
    if dimension == "week":
        return f"TO_CHAR({date_column}, 'IYYY-IW')"
    if dimension == "month":
        return f"TO_CHAR({date_column}, 'YYYY-MM')"
    return SAFE_DIMENSIONS[dimension]


# Event-grain templates do not expose conversation aliases (queue_name / agent_name).
_Q = "COALESCE(q.name, 'Unassigned Queue')"
_A = "COALESCE(a.display_name, 'Unassigned')"
_FQ = "COALESCE(fq.name, 'Unassigned Queue')"
_TQ = "COALESCE(tq.name, 'Unassigned Queue')"
_EXT = "COALESCE(NULLIF(BTRIM(c.agent_ext), ''), 'Unassigned')"

KPI_DIM_SQL: dict[str, dict[str, str]] = {
    "avg_handle_time_voice": {"queue": _Q, "agent": _EXT},
    "avg_hold_time": {"queue": _Q, "agent": _EXT},
    "avg_messages_per_conversation": {"queue": _Q, "agent": _A, "channel": "c.channel"},
    "message_count": {"channel": "c.channel", "direction": "m.direction", "sender_type": "m.sender_type"},
    "bot_turn_count": {"intent": "t.intent", "skill_key": "t.skill_key", "channel": "c.channel"},
    "bot_intent_distribution": {"channel": "c.channel"},
    "bot_intent_confidence_avg": {"queue": _Q, "channel": "c.channel", "intent": "t.intent"},
    "bot_grounded_rate": {"queue": _Q, "skill_key": "t.skill_key"},
    "bot_response_latency_avg": {"queue": _Q, "intent": "t.intent", "skill_key": "t.skill_key"},
    "callback_completion_rate": {"agent": _A, "channel": "t.channel"},
    "concurrency_utilization": {"agent": _A, "channel": "ac.channel"},
    "copilot_acceptance_rate": {"agent": _A, "skill_key": "ct.skill_key", "turn_type": "ct.turn_type"},
    "copilot_usage_count": {"agent": _A, "skill_key": "ct.skill_key", "turn_type": "ct.turn_type"},
    "copilot_tool_success_rate": {"skill_key": "e.skill_key", "agent": "COALESCE(e.agent_name, 'Unassigned')"},
    "copilot_latency_avg": {"agent": _A, "skill_key": "ct.skill_key"},
    "escalation_count": {"queue": _Q, "agent": _A, "status": "t.status"},
    "missed_contact_count": {"queue": _Q, "agent": _A, "reason": "m.reason", "channel": "m.channel"},
    "negative_sentiment_rate": {"queue": _Q, "agent": _A, "channel": "c.channel"},
    "new_vs_returning_rate": {"queue": "queue_name", "channel": "channel"},
    "overflow_rate": {"queue": _Q},
    "routing_attempt_success_rate": {"queue": _Q},
    "sentiment_trend": {"queue": _Q, "agent": _A, "channel": "c.channel"},
    "transfer_count": {
        "from_queue": _FQ,
        "to_queue": _TQ,
        "state": "ct.state",
        "outcome_reason": "ct.outcome_reason",
    },
}


def dimension_slots(dimension: Optional[str], date_column: str, *, kpi_id: Optional[str] = None) -> dict[str, str]:
    empty = {
        "dimension_select": "",
        "group_by_sql": "",
        "group_by_extra": "",
        "order_by_sql": "",
        "grain_extra": "",
    }
    if not dimension:
        return empty
    override = (KPI_DIM_SQL.get(kpi_id) or {}).get(dimension) if kpi_id else None
    expr = override if override else _dim_expression(dimension, date_column)
    alias = dimension
    select = f"COALESCE({expr}::text, 'Unassigned') AS {alias},\n    "
    group = f"\nGROUP BY COALESCE({expr}::text, 'Unassigned')"
    extra = f", COALESCE({expr}::text, 'Unassigned')"
    grain = "" if dimension in CALENDAR_DIMS else f", {expr}"
    order = "\nORDER BY 2 DESC NULLS LAST"
    return {
        "dimension_select": select,
        "group_by_sql": group,
        "group_by_extra": extra,
        "order_by_sql": order,
        "grain_extra": grain,
    }


def fill_slots(template: str, slots: dict[str, Any]) -> str:
    result = template
    for key, value in slots.items():
        pattern = r"\{\{\s*" + re.escape(str(key)) + r"\s*\}\}"
        result = re.sub(pattern, str(value), result)
    return result
