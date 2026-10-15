"""LEGACY workflow-turn helpers (not used by native coworker).

Native chat: `ticketing_coworker` + tool loop — no Super-Agent JSON actions.
This module remains for legacy graph unit tests and frozensets imported by
lean specialists (`TICKET_OPERATIONS`, grounding helpers, etc.).

`WORKFLOW_NLU_SYSTEM` is a stub; FakeLLM heuristics drive test decisions.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from app.messages_compat import HumanMessage, SystemMessage

from app.config import get_settings
from app.llm import get_llm
from app.llm_log import log_llm
from app.prompts import WORKFLOW_NLU_SYSTEM
from app.state import AgentState
from app.workflow_schemas import (
    ground_fields_in_utterance,
    normalize_fields,
    schema_for_workflow,
)
from app.workflow_state import (
    agent_for_workflow,
    conversation_context_from_state,
    last_entity_from_state,
)

WORKFLOW_ACTIONS = frozenset(
    {
        "START_ADD_TEAM_MEMBERS",
        "START_CREATE_TEAM",
        "START_ESCALATE",
        "START_REASSIGN",
        "START_CREATE_TICKET",
        "START_CREATE_MACRO",
        "START_CREATE_KB",
        "START_CREATE_PRIORITY",
        "START_CREATE_STATUS",
        "START_CREATE_CUSTOMER",
        "CONTINUE_WORKFLOW",
        "PROVIDE_TEAM",
        "PROVIDE_MEMBERS",
        "PROVIDE_TICKET",
        "PROVIDE_ASSIGNEE",
        "CONFIRM_WORKFLOW",
        "CANCEL_WORKFLOW",
        "RESUME_WORKFLOW",
        "SIDE_QUEST",
        "NEW_TASK",
        "NORMAL_ROUTE",
        "AMBIGUOUS",
    }
)
INTENTS = frozenset(
    {
        "GREETING",
        "CHAT",
        "TICKET",
        "CUSTOMER",
        "KB",
        "TEAMS",
        "MACRO",
        "ADMIN",
        "CREATE",
        "UPDATE",
        "SEARCH",
        "NAVIGATE",
    }
)
TICKET_OPERATIONS = frozenset(
    {
        "NONE",
        "CREATE_TICKET",
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "GET_METRICS",
        "COMPARE",
        "RECOMMEND",
        "GET_TICKET",
        "GET_HISTORY",
        "UPDATE_TICKET",
    }
)
TEAM_OPERATIONS = frozenset(
    {
        "LIST_TEAMS",
        "SEARCH_TEAMS",
        "GET_TEAM",
        "UPDATE_TEAM",
        "ADD_MEMBERS",
        "REMOVE_MEMBERS",
        "DELETE_TEAM",
        "CREATE_TEAM",
    }
)
KB_OPERATIONS = frozenset(
    {
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "UPDATE_KB",
        "PUBLISH_KB",
        "CREATE_KB",
    }
)
CUSTOMER_OPERATIONS = frozenset(
    {
        "LIST_CUSTOMERS",
        "SEARCH_CUSTOMERS",
        "GET_CUSTOMER",
        "IMPORT_CUSTOMERS",
        "GET_CUSTOMER_TICKETS",
        "CREATE_CUSTOMER",
    }
)
MACRO_OPERATIONS = frozenset(
    {
        "LIST_MACROS",
        "SEARCH_MACROS",
        "GET_MACRO",
        "UPDATE_MACRO",
        "DELETE_MACRO",
        "CREATE_MACRO",
    }
)
ADMIN_OPERATIONS = frozenset(
    {
        "GET_ANALYTICS",
        "COMPARE",
        "EXPORT_ANALYTICS",
        "GET_CSAT",
        "LIST_AUDIT",
        "SEARCH_AUDIT",
        "LIST_PRIORITIES",
        "GET_PRIORITY",
        "UPDATE_PRIORITY",
        "TOGGLE_PRIORITY",
        "DELETE_PRIORITY",
        "CREATE_PRIORITY",
        "LIST_STATUSES",
        "GET_STATUS",
        "UPDATE_STATUS",
        "TOGGLE_STATUS",
        "DELETE_STATUS",
        "CREATE_STATUS",
        "LIST_DIRECTORY",
        "SEARCH_DIRECTORY",
        "FIND_SKILL",
        "GET_ORG_PREFERENCES",
        "UPDATE_ORG_PREFERENCES",
        "LIST_WIDGETS",
        "CREATE_WIDGET",
        "LIST_API_KEYS",
    }
)
ALL_OPERATIONS = (
    TICKET_OPERATIONS
    | TEAM_OPERATIONS
    | KB_OPERATIONS
    | CUSTOMER_OPERATIONS
    | MACRO_OPERATIONS
    | ADMIN_OPERATIONS
)
TICKET_TOOLS = {
    "CREATE_TICKET": "create_ticket",
    "LIST_TICKETS": "list_tickets",
    "SEARCH_TICKETS": "list_tickets",
    "GET_METRICS": "ask_semantic_layer",
    "COMPARE": "ask_semantic_layer",
    "RECOMMEND": "ask_semantic_layer",
    "GET_TICKET": "get_ticket",
    "GET_HISTORY": "get_ticket_progress",
    "UPDATE_TICKET": "update_ticket",
}
OPERATION_TOOLS = {
    **TICKET_TOOLS,
    "LIST_TEAMS": "list_queues",
    "SEARCH_TEAMS": "list_queues",
    "GET_TEAM": "list_queues",
    "CREATE_TEAM": "create_queue",
    "UPDATE_TEAM": "update_queue",
    "ADD_MEMBERS": "update_queue",
    "REMOVE_MEMBERS": "update_queue",
    "DELETE_TEAM": "delete_queue",
    "LIST_KB": "list_kb",
    "SEARCH_KB": "list_kb",
    "GET_ARTICLE": "get_kb",
    "CREATE_KB": "create_kb_article",
    "UPDATE_KB": "update_kb_article",
    "PUBLISH_KB": "publish_kb_article",
    "LIST_CUSTOMERS": "list_customers",
    "SEARCH_CUSTOMERS": "list_customers",
    "GET_CUSTOMER": "list_customers",
    "CREATE_CUSTOMER": "create_customer",
    "IMPORT_CUSTOMERS": "import_customers",
    "GET_CUSTOMER_TICKETS": "get_customer_360",
    "LIST_MACROS": "list_macros",
    "SEARCH_MACROS": "list_macros",
    "GET_MACRO": "list_macros",
    "CREATE_MACRO": "create_macro",
    "UPDATE_MACRO": "update_macro",
    "DELETE_MACRO": "delete_macro",
    "GET_ANALYTICS": "ask_semantic_layer",
    "EXPORT_ANALYTICS": "export_analytics",
    "GET_CSAT": "ask_semantic_layer",
    "LIST_AUDIT": "list_audit",
    "SEARCH_AUDIT": "list_audit",
    "LIST_PRIORITIES": "list_priorities",
    "GET_PRIORITY": "list_priorities",
    "CREATE_PRIORITY": "create_priority",
    "UPDATE_PRIORITY": "update_priority",
    "TOGGLE_PRIORITY": "update_priority",
    "DELETE_PRIORITY": "delete_priority",
    "LIST_STATUSES": "list_statuses",
    "GET_STATUS": "list_statuses",
    "CREATE_STATUS": "create_status",
    "UPDATE_STATUS": "update_status",
    "TOGGLE_STATUS": "update_status",
    "DELETE_STATUS": "delete_status",
    "LIST_DIRECTORY": "list_escalation_directory",
    "SEARCH_DIRECTORY": "list_escalation_directory",
    "FIND_SKILL": "list_escalation_directory",
    "GET_ORG_PREFERENCES": "get_org_preferences",
    "UPDATE_ORG_PREFERENCES": "update_org_preferences",
    "LIST_WIDGETS": "list_widgets",
    "CREATE_WIDGET": "create_widget",
    "LIST_API_KEYS": "list_integration_keys",
}
TICKET_ALT_TOOLS: dict[str, frozenset[str]] = {
    "LIST_TICKETS": frozenset({"list_tickets", "portal_list_tickets"}),
    "SEARCH_TICKETS": frozenset({"list_tickets", "portal_list_tickets"}),
    "GET_METRICS": frozenset({"ask_semantic_layer", "list_tickets"}),
    "COMPARE": frozenset({"ask_semantic_layer", "list_tickets"}),
    "RECOMMEND": frozenset({"ask_semantic_layer", "list_tickets", "get_triage_stats"}),
    "GET_TICKET": frozenset({"get_ticket", "list_tickets"}),
    "GET_HISTORY": frozenset({"get_ticket_progress", "get_ticket"}),
    "UPDATE_TICKET": frozenset(
        {"update_ticket", "add_ticket_note", "escalate_ticket", "auto_assign_ticket"}
    ),
    "LIST_TEAMS": frozenset({"list_queues"}),
    "SEARCH_TEAMS": frozenset({"list_queues"}),
    "GET_TEAM": frozenset({"list_queues"}),
    "UPDATE_TEAM": frozenset({"update_queue"}),
    "ADD_MEMBERS": frozenset({"update_queue"}),
    "REMOVE_MEMBERS": frozenset({"update_queue"}),
    "DELETE_TEAM": frozenset({"delete_queue"}),
    "LIST_KB": frozenset({"list_kb"}),
    "SEARCH_KB": frozenset({"list_kb"}),
    "GET_ARTICLE": frozenset({"get_kb", "list_kb"}),
    "UPDATE_KB": frozenset({"update_kb_article"}),
    "PUBLISH_KB": frozenset({"publish_kb_article", "update_kb_article"}),
    "LIST_CUSTOMERS": frozenset({"list_customers"}),
    "SEARCH_CUSTOMERS": frozenset({"list_customers"}),
    "GET_CUSTOMER": frozenset({"list_customers", "get_customer_360"}),
    "GET_CUSTOMER_TICKETS": frozenset(
        {"get_customer_360", "list_tickets", "list_customers"}
    ),
    "IMPORT_CUSTOMERS": frozenset({"import_customers", "open_customer_import"}),
    "LIST_MACROS": frozenset({"list_macros"}),
    "SEARCH_MACROS": frozenset({"list_macros"}),
    "GET_MACRO": frozenset({"list_macros"}),
    "UPDATE_MACRO": frozenset({"update_macro"}),
    "DELETE_MACRO": frozenset({"delete_macro"}),
    "GET_ANALYTICS": frozenset({"ask_semantic_layer", "list_tickets"}),
    "EXPORT_ANALYTICS": frozenset({"export_analytics", "ask_semantic_layer"}),
    "GET_CSAT": frozenset({"ask_semantic_layer", "list_tickets"}),
    "LIST_AUDIT": frozenset({"list_audit"}),
    "SEARCH_AUDIT": frozenset({"list_audit"}),
    "LIST_PRIORITIES": frozenset({"list_priorities"}),
    "GET_PRIORITY": frozenset({"list_priorities"}),
    "UPDATE_PRIORITY": frozenset({"update_priority"}),
    "TOGGLE_PRIORITY": frozenset({"update_priority"}),
    "DELETE_PRIORITY": frozenset({"delete_priority"}),
    "LIST_STATUSES": frozenset({"list_statuses"}),
    "GET_STATUS": frozenset({"list_statuses"}),
    "UPDATE_STATUS": frozenset({"update_status"}),
    "TOGGLE_STATUS": frozenset({"update_status"}),
    "DELETE_STATUS": frozenset({"delete_status"}),
    "LIST_DIRECTORY": frozenset({"list_escalation_directory", "list_queues"}),
    "SEARCH_DIRECTORY": frozenset({"list_escalation_directory", "list_queues"}),
    "FIND_SKILL": frozenset({"list_escalation_directory", "list_queues"}),
    "GET_ORG_PREFERENCES": frozenset({"get_org_preferences"}),
    "UPDATE_ORG_PREFERENCES": frozenset({"update_org_preferences"}),
    "LIST_WIDGETS": frozenset({"list_widgets"}),
    "CREATE_WIDGET": frozenset({"create_widget"}),
    "LIST_API_KEYS": frozenset({"list_integration_keys"}),
}
QUERY_REFERENCES = frozenset({"LAST_QUERY", "LAST_ENTITY"})
SELF_FILTERS = frozenset({"SELF"})
ASSIGNED_TO_SPECIAL = frozenset({"SELF", "UNASSIGNED"})
SCOPE_FILTERS = frozenset({"unassigned", "team", "created", "org", "self", "assignee"})
TICKET_PRIORITIES = frozenset({"low", "medium", "high", "urgent", "critical"})
PRIORITY_CANONICAL = {"critical": "urgent"}
TICKET_CHANNELS = {
    "email": "Email",
    "chat": "Chat",
    "phone": "Phone",
    "web": "Web",
}
TICKET_STATUSES = {
    "open": "Open",
    "pending": "In Progress",
    "waiting": "In Progress",
    "in progress": "In Progress",
    "on hold": "In Progress",
    "resolved": "Resolved",
    "closed": "Resolved",
    "overdue": "Overdue",
}
DUE_FILTERS = frozenset({"today", "overdue"})
TIME_RANGES = frozenset(
    {
        "today",
        "yesterday",
        "this_week",
        "last_week",
        "this_month",
        "last_month",
        "last_24h",
        "last_7d",
        "last_30d",
        "last_90d",
    }
)
ANALYTICS_RANGES = frozenset({"24hours", "7days", "30days"})
CSAT_RANGES = frozenset({"7days", "30days", "90days"})
ADMIN_RANGES = ANALYTICS_RANGES | CSAT_RANGES
SORT_FILTERS = frozenset({"latest", "oldest", "priority", "due"})
TOPIC_FILTERS = frozenset(
    {
        "overview",
        "activity",
        "workload",
        "queues",
        "pressure",
        "reassigned",
        "created",
        "analytics",
        "csat",
        "audit",
        "priorities",
        "statuses",
        "directory",
        "org_prefs",
        "volume",
        "channel",
        "performance",
        "sla",
        "assignee",
        "team",
        "stars",
    }
)


def _json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                pass
    return {}


_PURE_GREETING_RE = re.compile(
    r"^(hi+|hello|hey+|yo|sup|howdy|thanks|thank you|thx|"
    r"good (morning|afternoon|evening))(\s+(there|team|all|again))?$",
    re.I,
)


def is_pure_greeting(user_text: str | None) -> bool:
    """True only for hi/thanks chitchat — not 'show CSAT' mislabeled as GREETING."""
    lower = re.sub(r"[!?.,]+$", "", (user_text or "").strip().lower())
    if not lower:
        return True
    return bool(_PURE_GREETING_RE.fullmatch(lower))


def _admin_topic_from_page(page: str | None) -> str | None:
    page_l = str(page or "").lower()
    if "csat" in page_l:
        return "csat"
    if "analytics" in page_l or page_l.strip() in {"reports"}:
        return "analytics"
    if "audit" in page_l:
        return "audit"
    if "escalation-directory" in page_l or "escalation directory" in page_l:
        return "directory"
    if any(t in page_l for t in ("org-pref", "org pref", "org preferences", "settings")):
        return "org_prefs"
    if "priorit" in page_l:
        return "priorities"
    if "statuses" in page_l or (page_l.strip() in {"status", "statuses"}):
        return "statuses"
    return None


def _apply_page_default_scope(
    page: str | None, filters: dict[str, Any], operation: str
) -> dict[str, Any]:
    """Idle ticket lists inherit the current ticket page scope when unstated."""
    if operation not in {
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "GET_METRICS",
        "UPDATE_TICKET",
        "RECOMMEND",
    }:
        return filters
    if filters.get("scope") or filters.get("assigned_to"):
        return filters
    page_l = str(page or "").lower()
    if any(token in page_l for token in ("home", "dashboard", "overview")):
        return filters
    out = dict(filters)
    if any(token in page_l for token in ("team inbox", "team-inbox")):
        out["scope"] = "team"
    elif "unassigned" in page_l:
        out["scope"] = "unassigned"
    elif any(token in page_l for token in ("team-queue", "all tickets", "tickets-list")):
        out["scope"] = "org"
    return out


def normalize_workflow_decision(
    raw: dict[str, Any] | None,
    *,
    workflow_id: str | None = None,
    user_text: str | None = None,
    page: str | None = None,
    roster_members: list[str] | None = None,
) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    action = str(data.get("action") or "NORMAL_ROUTE").strip().upper()
    if action == "NEW_WORKFLOW":
        action = "NEW_TASK"
    if action in {"CONFIRM", "CORRECT", "CORRECT_WORKFLOW"}:
        action = (
            "CONTINUE_WORKFLOW"
            if action in {"CORRECT", "CORRECT_WORKFLOW"}
            else "CONFIRM_WORKFLOW"
        )
    if action == "CLARIFY":
        action = "AMBIGUOUS"
    if action not in WORKFLOW_ACTIONS:
        action = "AMBIGUOUS"
    intent = str(data.get("intent") or "CHAT").strip().upper()
    if intent not in INTENTS:
        intent = "CHAT"
    entity_type = str(data.get("entity_type") or "").strip().lower() or None
    entity_name = str(data.get("entity_name") or "").strip() or None
    values = data.get("values")
    clean_values = (
        [str(value).strip() for value in values if str(value).strip()]
        if isinstance(values, list)
        else []
    )
    fields_raw = data.get("fields")
    clean_fields = (
        normalize_fields(
            workflow_id,
            ground_fields_in_utterance(
                fields_raw,
                user_text,
                roster_members=roster_members,
            )
            if user_text is not None
            else fields_raw,
        )
        if isinstance(fields_raw, dict)
        else {}
    )
    try:
        confidence = min(1.0, max(0.0, float(data.get("confidence", 0.0))))
    except (TypeError, ValueError):
        confidence = 0.0
    operation = str(data.get("operation") or "NONE").strip().upper()
    if operation not in ALL_OPERATIONS:
        operation = "NONE"
    reference = str(data.get("reference") or "").strip().upper() or None
    if reference not in QUERY_REFERENCES:
        reference = None
    filters_raw = data.get("filters")
    filters: dict[str, Any] = {}
    if isinstance(filters_raw, dict):
        status = str(filters_raw.get("status") or "").strip()
        if status:
            filters["status"] = TICKET_STATUSES.get(status.lower(), status)
        priority = str(filters_raw.get("priority") or "").strip().lower()
        if priority in TICKET_PRIORITIES:
            filters["priority"] = PRIORITY_CANONICAL.get(priority, priority)
        channel = str(filters_raw.get("channel") or "").strip().lower()
        if channel in TICKET_CHANNELS:
            filters["channel"] = TICKET_CHANNELS[channel]
        query = str(filters_raw.get("query") or "").strip()
        if query:
            filters["query"] = query[:200]
        for key in ("created_by",):
            value = str(filters_raw.get(key) or "").strip().upper()
            if value in SELF_FILTERS:
                filters[key] = value
        assigned_raw = str(filters_raw.get("assigned_to") or "").strip()
        assigned_upper = assigned_raw.upper()
        if assigned_upper in ASSIGNED_TO_SPECIAL:
            filters["assigned_to"] = assigned_upper
        elif assigned_raw and assigned_upper not in {"NULL", "NONE"}:
            filters["assigned_to"] = assigned_raw
        scope = str(filters_raw.get("scope") or "").strip().lower()
        if scope in SCOPE_FILTERS:
            filters["scope"] = scope
        queue = str(filters_raw.get("queue") or filters_raw.get("team") or "").strip()
        if queue:
            filters["queue"] = queue[:128]
        team = str(filters_raw.get("team") or "").strip()
        if team:
            filters["team"] = team[:128]
            filters.setdefault("queue", team[:128])
        customer = str(filters_raw.get("customer") or "").strip()
        if customer:
            filters["customer"] = customer[:128]
        due = str(filters_raw.get("due") or "").strip().lower()
        if due in DUE_FILTERS:
            filters["due"] = due
        for range_key in ("created_range", "updated_range"):
            raw_range = str(filters_raw.get(range_key) or "").strip().lower().replace(" ", "_")
            if raw_range in {"last7d", "past_week", "pastweek"}:
                raw_range = "last_7d"
            if raw_range in {"last30d", "past_month", "pastmonth"}:
                raw_range = "last_30d"
            if raw_range in {"last24h", "last_24_hours", "past_day"}:
                raw_range = "last_24h"
            if raw_range in {"last90d", "past_90d", "last_90_days"}:
                raw_range = "last_90d"
            if raw_range in TIME_RANGES:
                filters[range_key] = raw_range
        sort = str(filters_raw.get("sort") or "").strip().lower()
        if sort in SORT_FILTERS:
            filters["sort"] = sort
        try:
            limit_raw = filters_raw.get("limit")
            if limit_raw not in (None, ""):
                limit_val = int(limit_raw)
                if 1 <= limit_val <= 100:
                    filters["limit"] = limit_val
        except (TypeError, ValueError):
            pass
        topic = str(filters_raw.get("topic") or "").strip().lower()
        if topic in TOPIC_FILTERS:
            filters["topic"] = topic
        category = str(filters_raw.get("category") or "").strip()
        if category:
            filters["category"] = category[:128]
        admin_range = str(filters_raw.get("range") or "").strip().lower().replace(" ", "")
        if admin_range in {"last7d", "last_7d", "7d", "week"}:
            admin_range = "7days"
        if admin_range in {"last30d", "last_30d", "30d", "month"}:
            admin_range = "30days"
        if admin_range in {"last24h", "last_24h", "24h", "day"}:
            admin_range = "24hours"
        if admin_range in {"last90d", "last_90d", "90d"}:
            admin_range = "90days"
        if admin_range in ADMIN_RANGES:
            filters["range"] = admin_range
        actor = str(filters_raw.get("actor") or "").strip()
        if actor:
            filters["actor"] = actor[:128]
        action_f = str(filters_raw.get("action") or "").strip()
        if action_f:
            filters["action"] = action_f[:128]
        skill = str(filters_raw.get("skill") or "").strip()
        if skill:
            filters["skill"] = skill[:128]
    infer_clarification: list[str] = []
    nlu_operation = operation
    if not str(workflow_id or "").strip():
        # Idle ops/filters come from Gemma only — no utterance keyword/regex infer.
        filters = _apply_page_default_scope(page, filters, operation)
        if not filters.get("topic"):
            page_topic = _admin_topic_from_page(page)
            if page_topic and (
                operation in ADMIN_OPERATIONS
                or operation == "NONE"
                or intent == "ADMIN"
            ):
                filters["topic"] = page_topic
        if entity_type is None and operation in TICKET_OPERATIONS and operation != "NONE":
            entity_type = "ticket"
        elif entity_type is None and operation in TEAM_OPERATIONS:
            entity_type = "team"
        elif entity_type is None and operation in KB_OPERATIONS:
            entity_type = "article"
        elif entity_type is None and operation in CUSTOMER_OPERATIONS:
            entity_type = "customer"
        elif entity_type is None and operation in MACRO_OPERATIONS:
            entity_type = "macro"
        elif entity_type is None and operation in {
            "LIST_PRIORITIES",
            "GET_PRIORITY",
            "UPDATE_PRIORITY",
            "TOGGLE_PRIORITY",
            "DELETE_PRIORITY",
            "CREATE_PRIORITY",
        }:
            entity_type = "priority"
        elif entity_type is None and operation in {
            "LIST_STATUSES",
            "GET_STATUS",
            "UPDATE_STATUS",
            "TOGGLE_STATUS",
            "DELETE_STATUS",
            "CREATE_STATUS",
        }:
            entity_type = "status"
    if (
        str(workflow_id or "").strip().lower() in {"create_kb", "kb"}
        and action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}
        and operation == "PUBLISH_KB"
    ):
        operation = "CREATE_KB"
    raw_proposed_tool = str(data.get("proposed_tool") or "").strip().lower() or None
    if operation != nlu_operation:
        raw_proposed_tool = None
    expected_tool = OPERATION_TOOLS.get(operation)
    alt_tools = TICKET_ALT_TOOLS.get(operation, frozenset())
    proposal_valid = (
        not raw_proposed_tool
        or raw_proposed_tool == expected_tool
        or raw_proposed_tool in alt_tools
    )
    mutation_tools = {
        "create_ticket",
        "create_queue",
        "create_customer",
        "create_kb",
        "create_macro",
        "create_priority",
        "create_status",
        "delete_ticket",
        "delete_queue",
        "update_ticket",
    }
    if (
        not proposal_valid
        and raw_proposed_tool in mutation_tools
        and str(operation).startswith(("LIST_", "GET_", "SEARCH_"))
    ):
        proposed_tool = raw_proposed_tool
    else:
        proposed_tool = (
            raw_proposed_tool
            if proposal_valid and raw_proposed_tool
            else (expected_tool if operation != "NONE" else None)
        )
        if proposed_tool:
            proposal_valid = True
    clarification = str(data.get("clarification") or "").strip() or None
    if infer_clarification:
        clarification = infer_clarification[0]
    elif (
        filters.get("scope") == "org"
        and str(filters.get("due") or "").lower() == "overdue"
        and action == "NORMAL_ROUTE"
    ):
        clarification = None
    specialists = {
        "tickets",
        "teams",
        "customers",
        "kb",
        "macros",
        "admin",
        "general",
    }
    agent = str(data.get("agent") or "").strip().lower()
    if agent in {"analytics", "reports", "metrics"}:
        agent = "tickets"
    if agent not in specialists:
        agent = None
    workflow = str(data.get("workflow") or "").strip().lower() or None
    from app.workflow_schemas import utterance_plausibly_starts_reassign
    from app.tasks.chat_commands import (
        _asks_reassign_roster_list,
        utterance_is_reassign_role_column,
    )

    # Correct empty UPDATE_TICKET when the user clearly started reassignment,
    # asked agent/resolver column, or asked to show the staff roster.
    # SIDE_QUEST/GREETING-style ops are overridden — "show resolvers" must not
    # park into metrics/greeting.
    role_column = utterance_is_reassign_role_column(user_text)
    roster_list_ask = _asks_reassign_roster_list(user_text)
    force_reassign = bool(
        utterance_plausibly_starts_reassign(user_text) or role_column or roster_list_ask
    )
    if force_reassign and action not in {
        "START_REASSIGN",
        "START_ESCALATE",
        "CANCEL_WORKFLOW",
        "NEW_TASK",
    }:
        patch_keys = {
            "status",
            "priority",
            "queue",
            "note",
            "subject",
            "body",
        }
        has_concrete = any(str(clean_fields.get(k) or "").strip() for k in patch_keys)
        assignee_val = str(clean_fields.get("assignee") or "").strip()
        if assignee_val and assignee_val.lower() not in {
            "assignee",
            "agent",
            "resolver",
            "owner",
            "person",
            "assigneee",
        }:
            has_concrete = True
        op_ok = operation in {
            "UPDATE_TICKET",
            "NONE",
            "GET_TICKET",
            "GET_HISTORY",
            "GET_METRICS",
            "LIST_TICKETS",
            "",
        } or action in {"SIDE_QUEST", "NORMAL_ROUTE", "AMBIGUOUS"}
        if op_ok and (not has_concrete or role_column or roster_list_ask):
            action = "START_REASSIGN"
            intent = "UPDATE"
            operation = "NONE"
            proposed_tool = None
            proposal_valid = True
            workflow = "reassign_ticket"
            agent = "tickets"
            if not entity_type:
                entity_type = "ticket"
            if role_column:
                clean_fields = {**clean_fields, "target_role": role_column}
            elif roster_list_ask:
                inferred = (
                    "resolver"
                    if re.search(r"\bresolvers?\b", (user_text or "").lower())
                    else (
                        "agent"
                        if re.search(r"\bagents?\b", (user_text or "").lower())
                        else None
                    )
                )
                if inferred:
                    clean_fields = {**clean_fields, "target_role": inferred}
    return {
        "action": action,
        "intent": intent,
        "entity_type": entity_type,
        "entity_name": entity_name,
        "values": clean_values,
        "fields": clean_fields,
        "operation": operation,
        "filters": filters,
        "reference": reference,
        "proposed_tool": proposed_tool,
        "tool_proposal_valid": proposal_valid,
        "clarification": clarification,
        "confidence": confidence,
        "agent": agent,
        "workflow": workflow,
    }


def _recent_history(state: AgentState, *, limit: int = 20) -> list[dict[str, str]]:
    history = state.get("session_history")
    if not isinstance(history, list):
        return []
    out: list[dict[str, str]] = []
    for item in history[-limit:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = str(item.get("text") or "").strip()
        if role in ("user", "assistant") and text:
            out.append({"role": role, "text": text})
    return out


def _tool_memory_from_state(state: AgentState) -> dict:
    tm = state.get("tool_memory") if isinstance(state.get("tool_memory"), dict) else None
    if isinstance(tm, dict) and tm:
        return tm
    ctx = (
        state.get("conversation_context")
        if isinstance(state.get("conversation_context"), dict)
        else {}
    )
    ctm = ctx.get("tool_memory") if isinstance(ctx.get("tool_memory"), dict) else None
    if isinstance(ctm, dict) and ctm:
        return ctm
    td = state.get("team_draft") if isinstance(state.get("team_draft"), dict) else {}
    wd = state.get("workflow_data") if isinstance(state.get("workflow_data"), dict) else {}
    nested = td.get("tool_memory") if isinstance(td.get("tool_memory"), dict) else None
    if not nested:
        nested = wd.get("tool_memory") if isinstance(wd.get("tool_memory"), dict) else {}
    return nested if isinstance(nested, dict) else {}


_COLLECT_STEPS = frozenset(
    {
        "name",
        "description",
        "create_members",
        "members",
        "title",
        "body",
        "category",
        "issue",
        "contact",
        "confirm",
        "assignee",
        "ticket",
        "customer",
        "manage_mode",
        "category_name",
    }
)
_START_TO_WORKFLOW = {
    "START_CREATE_TICKET": "create_ticket",
    "START_CREATE_TEAM": "create_team",
    "START_ADD_TEAM_MEMBERS": "add_team_members",
    "START_CREATE_MACRO": "create_macro",
    "START_CREATE_KB": "create_kb",
    "START_CREATE_CUSTOMER": "create_customer",
    "START_CREATE_PRIORITY": "create_priority",
    "START_CREATE_STATUS": "create_status",
    "START_ESCALATE": "escalate",
    "START_REASSIGN": "reassign_ticket",
}
_CREATE_OP_TO_START = {
    "CREATE_TICKET": "START_CREATE_TICKET",
    "CREATE_TEAM": "START_CREATE_TEAM",
    "CREATE_MACRO": "START_CREATE_MACRO",
    "CREATE_KB": "START_CREATE_KB",
    "CREATE_CUSTOMER": "START_CREATE_CUSTOMER",
    "CREATE_PRIORITY": "START_CREATE_PRIORITY",
    "CREATE_STATUS": "START_CREATE_STATUS",
}


def _own_start_for_workflow(workflow: str | None) -> str | None:
    wf = str(workflow or "").strip().lower()
    if not wf:
        return None
    for start, wname in _START_TO_WORKFLOW.items():
        aliases = {wname, wname.replace("create_", "")}
        if wname == "reassign_ticket":
            aliases.add("reassign")
        if wf in aliases:
            return start
    return None


def guided_start_for_decision(
    decision: dict[str, Any] | None,
    active_workflow: str | None,
) -> str | None:
    """START_* for a different guided create named by Super Agent (not the active one)."""
    if not isinstance(decision, dict):
        return None
    own = _own_start_for_workflow(active_workflow)
    op = str(decision.get("operation") or "").strip().upper()
    start = _CREATE_OP_TO_START.get(op)
    if start and start != own:
        return start
    action = str(decision.get("action") or "").strip().upper()
    if action in _START_TO_WORKFLOW and action != own:
        return action
    wf_key = str(decision.get("workflow") or "").strip().lower()
    named = _own_start_for_workflow(wf_key)
    if named and named != own:
        return named
    return None


_COLLECT_PRESERVE_ACTIONS = frozenset(
    {
        "CONTINUE_WORKFLOW",
        "SIDE_QUEST",
        "NEW_TASK",
        "CANCEL_WORKFLOW",
        "CONFIRM_WORKFLOW",
        "RESUME_WORKFLOW",
        "AMBIGUOUS",
        "PROVIDE_TEAM",
        "PROVIDE_MEMBERS",
        "PROVIDE_TICKET",
        "PROVIDE_ASSIGNEE",
    }
)
_MISROUTED_QUERY_OPS = frozenset(
    {
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "GET_METRICS",
        "COMPARE",
        "RECOMMEND",
        "GET_TICKET",
        "GET_HISTORY",
        "LIST_TEAMS",
        "SEARCH_TEAMS",
        "GET_TEAM",
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "LIST_CUSTOMERS",
        "SEARCH_CUSTOMERS",
        "GET_CUSTOMER",
        "LIST_MACROS",
        "SEARCH_MACROS",
        "GET_MACRO",
    }
)
_TICKET_COLLECT_STEPS = frozenset({"name", "contact", "issue", "priority"})
_TICKET_FIELD_FOR_STEP = {
    "name": "customerName",
    "contact": "contact",
    "issue": "issue",
    "priority": "priority",
}
_KB_COLLECT_STEPS = frozenset({"title", "category", "body"})
_KB_MANAGE_COLLECT_STEPS = frozenset({"manage_mode", "category_name"})
_KB_FIELD_FOR_STEP = {
    "title": "title",
    "category": "category",
    "body": "body",
}


def _awaiting_step_from_state(state: AgentState) -> str:
    """Prefer draft.awaiting over stale current_step (includes KB/macro drafts)."""
    for key in (
        "ticket_draft",
        "kb_draft",
        "macro_draft",
        "team_draft",
        "customer_draft",
        "escalate_draft",
        "reassign_draft",
        "priority_draft",
    ):
        draft = state.get(key)
        if isinstance(draft, dict):
            awaiting = str(draft.get("awaiting") or "").strip()
            if awaiting:
                return awaiting
    return str(state.get("current_step") or "").strip()


def needs_consistency_retry(
    *,
    active_workflow: str | None,
    current_step: str | None,
    decision: dict[str, Any],
) -> bool:
    """Retry Gemma when collect/confirm is misrouted to a query op or foreign START_*."""
    wf = str(active_workflow or "").strip().lower()
    step = str(current_step or "").strip().lower()
    if step == "members":
        step = "create_members"
    if not wf or step not in _COLLECT_STEPS:
        return False
    action = str(decision.get("action") or "").strip().upper()
    operation = str(decision.get("operation") or "").strip().upper()
    if step == "confirm" and action in {"NEW_TASK", "SIDE_QUEST"}:
        return True
    if action == "NORMAL_ROUTE" or operation in _MISROUTED_QUERY_OPS:
        return True
    if action in _COLLECT_PRESERVE_ACTIONS:
        return False
    if guided_start_for_decision(decision, wf):
        return False
    own = _own_start_for_workflow(wf)
    if not own or action == own:
        return False
    return action.startswith("START_")


def ground_active_collect_decision(
    decision: dict[str, Any],
    *,
    workflow: str | None,
    step: str | None,
    user_text: str,
    roster_members: list[str] | None,
    draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Structural integrity only — never classifies intent from utterance keywords.

    When Gemma still misroutes a collect/confirm turn to a query op after retry,
    keep the turn on the active workflow. At confirm, CONTINUE_WORKFLOW (or the
    LLM's CONFIRM_WORKFLOW) is enough for specialist handoff — this layer never
    invents confirm/cancel from phrase lists.
    """
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        bind_awaiting_value,
        bind_primary_missing,
    )

    action = str(decision.get("action") or "").strip().upper()
    wf = str(workflow or "").strip().lower()
    awaiting = str(step or "").strip().lower()
    text = (user_text or "").strip()
    active_draft = draft if isinstance(draft, dict) else {}
    if awaiting == "members":
        awaiting = "create_members"

    def _merge_typed_collect_fields(
        fields: dict[str, Any],
        *,
        workflow_id: str,
        step_map: dict[str, str],
    ) -> dict[str, Any]:
        """Fill fields from utterance via missing SoT; never blind-stuff into stale awaiting.

        Prefer Super Agent `fields` when already set (corrected spelling). Only
        bind raw user text into empty keys so misspellings do not overwrite NLU.
        """
        out = dict(fields)
        if not text:
            return out
        bound = bind_primary_missing(workflow_id, active_draft, text)
        if not bound:
            hint = awaiting
            if active_draft:
                mh = awaiting_hint_from_missing(workflow_id, active_draft)
                if mh and mh != "confirm":
                    hint = mh
            if hint in step_map:
                bound = bind_awaiting_value(workflow_id, hint, text)
        if not bound:
            return out
        for key, val in bound.items():
            if val in (None, "", [], {}) or str(out.get(key) or "").strip():
                continue
            out[key] = val
        return out

    if wf and awaiting in {"confirm", "delete_confirm"}:
        if action == "CANCEL_WORKFLOW":
            from app.workflow_schemas import utterance_plausibly_cancels

            if utterance_plausibly_cancels(text):
                return decision
            action = "CONTINUE_WORKFLOW"
            decision = {**decision, "action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        # Only park/start another flow at confirm when NLU names a foreign guided start.
        if action in {"NEW_TASK", "SIDE_QUEST"}:
            foreign = guided_start_for_decision(decision, wf)
            if foreign:
                return {**decision, "action": foreign}
        foreign = guided_start_for_decision(decision, wf)
        if foreign and action not in {"CANCEL_WORKFLOW"}:
            return {**decision, "action": foreign}
        own_start = _own_start_for_workflow(wf)
        if action.startswith("START_") and own_start and action != own_start:
            return decision
        from app.workflow_state import agent_for_workflow

        owner = agent_for_workflow(wf) or str(decision.get("agent") or "").strip().lower()
        keep_action = action if action == "CONFIRM_WORKFLOW" else "CONTINUE_WORKFLOW"
        # Confirm is not a collect slot. Dumping the whole utterance into
        # fields/values (e.g. "yehh" as a name) looks like a field edit and
        # stops the specialist write. Super Agent only parks/routes here.
        return {
            **decision,
            "action": keep_action,
            "intent": decision.get("intent") or "CREATE",
            "operation": "NONE",
            "agent": owner or decision.get("agent"),
            "workflow": wf,
            "proposed_tool": None,
            "reference": None,
            "fields": {},
            "values": [],
            "entity_name": None,
        }

    if wf in {"create_ticket", "ticket"} and awaiting in _TICKET_COLLECT_STEPS:
        if action == "CANCEL_WORKFLOW":
            from app.workflow_schemas import utterance_plausibly_cancels

            if utterance_plausibly_cancels(text):
                return decision
            # Keep collecting — issue/contact answers are not cancel.
            action = "CONTINUE_WORKFLOW"
            decision = {**decision, "action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        if action in {"NEW_TASK", "SIDE_QUEST"}:
            return decision
        foreign = guided_start_for_decision(decision, wf)
        if foreign:
            return {**decision, "action": foreign}
        if action.startswith("START_") and action != "START_CREATE_TICKET":
            return decision
        if action == "CONTINUE_WORKFLOW":
            fields = (
                dict(decision.get("fields") or {})
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            fields = _merge_typed_collect_fields(
                fields, workflow_id="create_ticket", step_map=_TICKET_FIELD_FOR_STEP
            )
            return {**decision, "fields": fields, "proposed_tool": None, "reference": None}
        fields = (
            dict(decision.get("fields") or {})
            if isinstance(decision.get("fields"), dict)
            else {}
        )
        fields = _merge_typed_collect_fields(
            fields, workflow_id="create_ticket", step_map=_TICKET_FIELD_FOR_STEP
        )
        return {
            **decision,
            "action": "CONTINUE_WORKFLOW",
            "intent": "CREATE",
            "operation": "NONE",
            "agent": "tickets",
            "workflow": "create_ticket",
            "fields": fields,
            "proposed_tool": None,
            "reference": None,
        }

    if wf in {"reassign_ticket", "reassign"} and awaiting in {
        "ticket",
        "target_role",
        "person",
        "confirm",
    }:
        if action == "CANCEL_WORKFLOW":
            from app.workflow_schemas import utterance_plausibly_cancels

            if utterance_plausibly_cancels(text):
                return decision
            action = "CONTINUE_WORKFLOW"
            decision = {**decision, "action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        if action == "SIDE_QUEST":
            # "show me the resolvers/agents" is roster help on this flow — not a park.
            from app.tasks.chat_commands import _asks_reassign_roster_list

            if _asks_reassign_roster_list(text):
                action = "CONTINUE_WORKFLOW"
                decision = {
                    **decision,
                    "action": "CONTINUE_WORKFLOW",
                    "operation": "NONE",
                    "agent": "tickets",
                    "workflow": wf,
                    "proposed_tool": None,
                }
            else:
                return decision
        elif action == "NEW_TASK":
            return decision
        # Never NORMAL_ROUTE / generic UPDATE while reassign is active.
        if action == "NORMAL_ROUTE":
            action = "CONTINUE_WORKFLOW"
            decision = {**decision, "action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        foreign = guided_start_for_decision(decision, wf)
        if foreign:
            return {**decision, "action": foreign}
        own_start = _own_start_for_workflow(wf)
        if action.startswith("START_") and own_start and action != own_start:
            return decision
        if action == "START_REASSIGN":
            action = "CONTINUE_WORKFLOW"

        # ROLE vs PERSON contract (AI-native): awaiting target_role means the
        # utterance selects agent|resolver — never a person name.
        if awaiting == "target_role":
            from app.tasks.chat_commands import (
                _is_reassign_role_token,
                _normalize_target_role,
            )

            fields = (
                dict(decision.get("fields") or {})
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            role = (
                _normalize_target_role(str(fields.get("target_role") or ""))
                or _normalize_target_role(str(decision.get("entity_name") or ""))
                or _normalize_target_role(
                    str((decision.get("values") or [""])[0] if decision.get("values") else "")
                )
            )
            # Semantic ROLE picks often put "agent"/"resolver" in fields.person —
            # strip those; person stays null until the person step.
            person_raw = str(fields.get("person") or fields.get("assignee") or "").strip()
            if person_raw and _is_reassign_role_token(person_raw):
                fields.pop("person", None)
                fields.pop("assignee", None)
                person_raw = ""
            if not role:
                # Last-resort column tokens only (not full intent grammar).
                from app.tasks.chat_commands import (
                    _infer_target_role,
                    utterance_is_reassign_role_column,
                )

                role = utterance_is_reassign_role_column(text) or _infer_target_role(
                    text
                )
            if role:
                fields["target_role"] = role
            # Never keep role words / whole role-pick utterance as person.
            if not person_raw or _is_reassign_role_token(person_raw):
                fields.pop("person", None)
                fields.pop("assignee", None)
            return {
                **decision,
                "action": action
                if action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW", "CANCEL_WORKFLOW"}
                else "CONTINUE_WORKFLOW",
                "intent": "UPDATE",
                "operation": "NONE",
                "agent": "tickets",
                "workflow": wf,
                "entity_name": role or None,
                "values": [role] if role else [],
                "fields": fields,
                "proposed_tool": None,
                "reference": None,
            }

        # CONFIRMATION PRECEDENCE: proposed/canonical person already on draft.
        if awaiting == "confirm":
            fields = (
                dict(decision.get("fields") or {})
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            bound = str(
                active_draft.get("person")
                or active_draft.get("proposed_person")
                or ""
            ).strip()
            roster = [
                str(n).strip()
                for n in (roster_members or active_draft.get("candidates") or [])
                if str(n).strip()
            ]
            from app.workflow_schemas import person_from_user_text, resolve_roster_name

            other = None
            if roster:
                other = (
                    person_from_user_text(
                        str(fields.get("person") or ""),
                        roster,
                        allow_fuzzy=False,
                        allow_substring=False,
                    )
                    or person_from_user_text(
                        text,
                        roster,
                        allow_fuzzy=False,
                        allow_substring=False,
                    )
                    or resolve_roster_name(
                        text.strip(),
                        roster,
                        allow_fuzzy=False,
                        allow_substring=False,
                    )
                )
            if other and bound and other != bound:
                # Replacement person — not an acknowledgement.
                fields["person"] = other
                return {
                    **decision,
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "UPDATE",
                    "operation": "NONE",
                    "agent": "tickets",
                    "workflow": wf,
                    "entity_name": other,
                    "values": [other],
                    "fields": fields,
                    "proposed_tool": None,
                    "reference": None,
                }
            # Agreement / continue write — never put ack text in fields.person.
            if bound:
                fields["person"] = bound
            out_action = (
                action
                if action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW", "CANCEL_WORKFLOW"}
                else "CONTINUE_WORKFLOW"
            )
            return {
                **decision,
                "action": out_action,
                "intent": "UPDATE",
                "operation": "NONE",
                "agent": "tickets",
                "workflow": wf,
                "entity_name": bound or None,
                "values": [bound] if bound else [],
                "fields": fields,
                "proposed_tool": None,
                "reference": None,
            }

        if awaiting == "person":
            from app.workflow_schemas import person_from_user_text, resolve_roster_name

            roster = [
                str(n).strip()
                for n in (roster_members or [])
                if str(n).strip()
            ]
            fields = (
                dict(decision.get("fields") or {})
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            llm_person = str(fields.get("person") or "").strip()
            proposed = str(active_draft.get("proposed_person") or "").strip()
            canon = None
            if roster:
                canon = (
                    person_from_user_text(
                        llm_person,
                        roster,
                        allow_fuzzy=False,
                        allow_substring=False,
                    )
                    or person_from_user_text(
                        text,
                        roster,
                        allow_fuzzy=False,
                        allow_substring=False,
                    )
                    or resolve_roster_name(
                        text.strip(),
                        roster,
                        allow_fuzzy=False,
                        allow_substring=False,
                    )
                )
            # Legacy: proposed_person while still on person step.
            if (
                proposed
                and action
                in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW", "START_REASSIGN"}
                and (not canon or canon == proposed)
            ):
                canon = proposed
                action = "CONFIRM_WORKFLOW"
            # Typo turn: do not stash raw ack/typo as canonical fields.person.
            # Keep fields.person null unless clear roster hit or proposed bind.
            name = canon or (text.strip() if text.strip() and not proposed else "")
            if canon:
                fields["person"] = canon
            elif proposed:
                fields.pop("person", None)
            else:
                # Short/typo fragment — leave person unset; code proposes via roster.
                fields.pop("person", None)
            values = (
                [canon]
                if canon
                else ([text.strip()] if text.strip() and not proposed else [])
            )
            entity_out = canon or name or None
        else:
            fields = (
                dict(decision.get("fields") or {})
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            name = str(decision.get("entity_name") or "").strip() or text
            values = [
                str(v).strip()
                for v in (decision.get("values") or [])
                if str(v).strip()
            ]
            if not values and name:
                values = [name]
            entity_out = name or None
        return {
            **decision,
            "action": action
            if action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW", "CANCEL_WORKFLOW"}
            else "CONTINUE_WORKFLOW",
            "intent": "UPDATE",
            "operation": "NONE",
            "agent": "tickets",
            "workflow": wf,
            "entity_name": entity_out,
            "values": values,
            "fields": fields,
            "proposed_tool": None,
            "reference": None,
        }

    if wf in {"escalate", "escalate_ticket"} and awaiting in {
        "ticket",
        "assignee",
        "note",
    }:
        if action == "CANCEL_WORKFLOW":
            from app.workflow_schemas import utterance_plausibly_cancels

            if utterance_plausibly_cancels(text):
                return decision
            action = "CONTINUE_WORKFLOW"
            decision = {**decision, "action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        if action in {"NEW_TASK", "SIDE_QUEST"}:
            return decision
        foreign = guided_start_for_decision(decision, wf)
        if foreign:
            return {**decision, "action": foreign}
        own_start = _own_start_for_workflow(wf)
        if action.startswith("START_") and own_start and action != own_start:
            return decision
        if action == "START_ESCALATE":
            action = "CONTINUE_WORKFLOW"
        fields = (
            dict(decision.get("fields") or {})
            if isinstance(decision.get("fields"), dict)
            else {}
        )
        name = str(decision.get("entity_name") or "").strip()
        values = [
            str(v).strip()
            for v in (decision.get("values") or [])
            if str(v).strip()
        ]
        if awaiting == "assignee":
            from app.tasks.chat_commands import (
                _escalate_role_only_turn,
                _extract_assignee_hint,
                _is_reassign_role_token,
                _nlu_reassign_person_slot,
            )
            from app.workflow_schemas import person_from_user_text, resolve_roster_name

            roster = [
                str(n).strip()
                for n in (roster_members or [])
                if str(n).strip()
            ]
            if not roster and isinstance(active_draft.get("candidates"), list):
                roster = [
                    str(n).strip()
                    for n in active_draft.get("candidates") or []
                    if str(n).strip()
                ]
            person_raw = str(
                fields.get("assignee") or fields.get("person") or ""
            ).strip()
            if person_raw and _is_reassign_role_token(person_raw):
                fields.pop("person", None)
                fields.pop("assignee", None)
                person_raw = ""
            llm_person = _nlu_reassign_person_slot(
                decision, roster_names=roster or None
            ) or ""
            role_only = _escalate_role_only_turn(
                decision=decision,
                user_text=text,
                assignee_hint=llm_person or None,
                awaiting=awaiting,
                roster_names=roster or None,
            )
            if role_only:
                fields.pop("person", None)
                fields.pop("assignee", None)
                name = ""
                values = []
            else:
                canon = None
                if roster:
                    # Clear matches only — fuzzy typos stay raw for Did-you-mean.
                    canon = (
                        person_from_user_text(
                            llm_person,
                            roster,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                        or person_from_user_text(
                            text,
                            roster,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                        or resolve_roster_name(
                            text.strip(),
                            roster,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                    )
                name = canon or llm_person or _extract_assignee_hint(text) or ""
                if not name and roster:
                    name = (
                        person_from_user_text(
                            text,
                            roster,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                        or resolve_roster_name(
                            text.strip(),
                            roster,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                        or ""
                    )
                if not name and text.strip() and not re.search(
                    r"\b(escalat|ticket|cancel|never\s*mind|resolver|agent)\b",
                    text,
                    re.I,
                ):
                    name = text.strip()
                if canon:
                    fields["assignee"] = canon
                    fields["person"] = canon
                values = [name] if name else []
        elif awaiting == "ticket":
            name = name or text.strip().lstrip("#")
            if name and not values:
                values = [name]
        return {
            **decision,
            "action": "CONTINUE_WORKFLOW",
            "intent": decision.get("intent") or "UPDATE",
            "operation": "NONE",
            "agent": "tickets",
            "workflow": "escalate",
            "entity_name": name or None,
            "values": values,
            "fields": fields,
            "proposed_tool": None,
            "reference": None,
        }

    if (
        wf in {"manage_kb_category", "manage_category"}
        or (
            wf in {"create_kb", "kb"}
            and (
                str(active_draft.get("flow") or "").strip().lower() == "manage_category"
                or awaiting in _KB_MANAGE_COLLECT_STEPS
            )
        )
    ) and (awaiting in _KB_MANAGE_COLLECT_STEPS or awaiting == ""):
        # Locked manage-category collect: bare add/edit/delete or a category name.
        if action == "CANCEL_WORKFLOW":
            from app.workflow_schemas import utterance_plausibly_cancels

            if utterance_plausibly_cancels(text):
                return decision
            action = "CONTINUE_WORKFLOW"
            decision = {**decision, "action": action, "operation": "NONE"}
        if action in {"NEW_TASK", "SIDE_QUEST"}:
            # Misroutes to create-article / Priorities stay on manage.
            foreign = guided_start_for_decision(decision, "manage_kb_category")
            op_u = str(decision.get("operation") or "").strip().upper()
            if foreign or op_u in {
                "CREATE_KB",
                "CREATE_PRIORITY",
                "CREATE_STATUS",
                "LIST_PRIORITIES",
            } or action in {
                "START_CREATE_KB",
                "START_CREATE_PRIORITY",
                "START_CREATE_STATUS",
            }:
                return {
                    **decision,
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "KB",
                    "operation": "NONE",
                    "agent": "kb",
                    "workflow": "manage_kb_category",
                    "fields": {},
                    "proposed_tool": None,
                    "reference": None,
                    "entity_type": "article",
                }
            return decision
        foreign = guided_start_for_decision(decision, "manage_kb_category")
        if foreign or (
            action.startswith("START_") and action != "CONTINUE_WORKFLOW"
        ):
            return {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "intent": "KB",
                "operation": "NONE",
                "agent": "kb",
                "workflow": "manage_kb_category",
                "fields": {},
                "proposed_tool": None,
                "reference": None,
                "entity_type": "article",
            }
        return {
            **decision,
            "action": "CONTINUE_WORKFLOW",
            "intent": decision.get("intent") or "KB",
            "operation": "NONE",
            "agent": "kb",
            "workflow": "manage_kb_category",
            "fields": {},
            "proposed_tool": None,
            "reference": None,
            "entity_type": "article",
        }

    if wf in {"create_kb", "kb"} and awaiting in _KB_COLLECT_STEPS:
        # Mid create-article category step: "add new category" is still the draft
        # (ask for the label) — never park for Priorities / other START_* creates.
        category_meta = False
        if awaiting == "category" and text:
            try:
                from app.tasks.catalog_commands import (
                    _KB_CATEGORY_ASK_CUSTOM_RE,
                    _KB_CATEGORY_LIST_RE,
                )

                lower = text.lower().rstrip("!?.")
                category_meta = bool(
                    _KB_CATEGORY_ASK_CUSTOM_RE.match(lower)
                    or _KB_CATEGORY_LIST_RE.match(lower)
                )
            except Exception:  # noqa: BLE001
                category_meta = False
        if category_meta:
            return {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "operation": "NONE",
                "agent": "kb",
                "workflow": "create_kb",
                "fields": {},
                "proposed_tool": None,
                "reference": None,
                "entity_type": "article",
            }
        if action in {"CANCEL_WORKFLOW", "NEW_TASK"}:
            # "Add category" misread as NEW_TASK / CREATE_PRIORITY → keep create_kb.
            if action == "NEW_TASK" and awaiting == "category":
                foreign = guided_start_for_decision(decision, wf)
                op_u = str(decision.get("operation") or "").strip().upper()
                if foreign in {
                    "START_CREATE_PRIORITY",
                    "START_CREATE_STATUS",
                    "START_CREATE_MACRO",
                    "START_CREATE_CUSTOMER",
                    "START_CREATE_TEAM",
                    "START_CREATE_TICKET",
                } or op_u in {
                    "CREATE_PRIORITY",
                    "CREATE_STATUS",
                    "LIST_PRIORITIES",
                    "UPDATE_PRIORITY",
                }:
                    return {
                        **decision,
                        "action": "CONTINUE_WORKFLOW",
                        "intent": "CREATE",
                        "operation": "NONE",
                        "agent": "kb",
                        "workflow": "create_kb",
                        "fields": {},
                        "proposed_tool": None,
                        "reference": None,
                        "entity_type": "article",
                    }
            return decision
        op = str(decision.get("operation") or "").strip().upper()
        # Listing categories while choosing one is still the collect turn —
        # do not park the create_kb draft on LIST_KB SIDE_QUEST.
        if action == "SIDE_QUEST" and awaiting == "category" and op == "LIST_KB":
            decision = {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "operation": "NONE",
                "proposed_tool": None,
                "reference": None,
            }
            action = "CONTINUE_WORKFLOW"
        elif action == "SIDE_QUEST":
            return decision
        foreign = guided_start_for_decision(decision, wf)
        if foreign:
            # Priority/status create is a common misroute for "category".
            if awaiting == "category" and foreign in {
                "START_CREATE_PRIORITY",
                "START_CREATE_STATUS",
            }:
                return {
                    **decision,
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "operation": "NONE",
                    "agent": "kb",
                    "workflow": "create_kb",
                    "fields": {},
                    "proposed_tool": None,
                    "reference": None,
                    "entity_type": "article",
                }
            return {**decision, "action": foreign}
        if action.startswith("START_") and action != "START_CREATE_KB":
            if awaiting == "category" and action in {
                "START_CREATE_PRIORITY",
                "START_CREATE_STATUS",
            }:
                return {
                    **decision,
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "operation": "NONE",
                    "agent": "kb",
                    "workflow": "create_kb",
                    "fields": {},
                    "proposed_tool": None,
                    "reference": None,
                    "entity_type": "article",
                }
            return decision
        fields = (
            dict(decision.get("fields") or {})
            if isinstance(decision.get("fields"), dict)
            else {}
        )
        skip_bind = False
        if awaiting == "category" and text:
            try:
                from app.tasks.catalog_commands import (
                    _KB_CATEGORY_ASK_CUSTOM_RE,
                    _KB_CATEGORY_LIST_RE,
                )

                lower = text.lower().rstrip("!?.")
                skip_bind = bool(
                    _KB_CATEGORY_ASK_CUSTOM_RE.match(lower)
                    or _KB_CATEGORY_LIST_RE.match(lower)
                )
            except Exception:  # noqa: BLE001
                skip_bind = False
        if not skip_bind:
            fields = _merge_typed_collect_fields(
                fields, workflow_id="create_kb", step_map=_KB_FIELD_FOR_STEP
            )
        return {
            **decision,
            "action": "CONTINUE_WORKFLOW",
            "intent": decision.get("intent") or "CREATE",
            "operation": "NONE",
            "agent": "kb",
            "workflow": "create_kb",
            "fields": fields,
            "proposed_tool": None,
            "reference": None,
        }

    def _create_team_foreign_add_members() -> dict[str, Any]:
        """Lookup vs mutate: unnamed add-members during create is a membership list."""
        existing = str(decision.get("entity_name") or "").strip()
        if existing:
            return {
                **decision,
                "action": "SIDE_QUEST",
                "operation": "ADD_MEMBERS",
                "intent": "TEAMS",
                "agent": "teams",
                "proposed_tool": "update_queue",
            }
        return {
            **decision,
            "action": "SIDE_QUEST",
            "operation": "LIST_TEAMS",
            "intent": "TEAMS",
            "agent": "teams",
            "proposed_tool": "list_queues",
            "workflow": "create_team",
        }

    op = str(decision.get("operation") or "").strip().upper()
    if wf in {"create_team", "team"} and awaiting in {"name", "description"}:
        if action in {
            "SIDE_QUEST",
            "NEW_TASK",
            "CANCEL_WORKFLOW",
            "RESUME_WORKFLOW",
        }:
            return decision
        if action == "START_ADD_TEAM_MEMBERS" or op == "ADD_MEMBERS":
            return _create_team_foreign_add_members()
        return decision

    if wf in {"create_team", "team"} and awaiting == "create_members":
        # Bind offered staff before honoring SIDE_QUEST / LIST_TEAMS. Gemma often
        # treats a first name as a team search; that must not park create-team.
        from app.workflow_schemas import (
            members_from_user_text,
            resolve_roster_name,
        )

        roster = [str(n).strip() for n in (roster_members or []) if str(n).strip()]
        fields = dict(decision.get("fields") or {}) if isinstance(decision.get("fields"), dict) else {}
        if isinstance(fields.get("members"), list) and [
            m for m in fields["members"] if str(m).strip()
        ]:
            return {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "agent": "teams",
                "workflow": "create_team",
                "fields": fields,
                "proposed_tool": None,
                "reference": None,
            }
        named = members_from_user_text(user_text, roster)
        if not named:
            value_hits: list[str] = []
            seen_v: set[str] = set()
            for raw_v in decision.get("values") or []:
                hit = resolve_roster_name(str(raw_v).strip(), roster)
                if hit and hit.lower() not in seen_v:
                    seen_v.add(hit.lower())
                    value_hits.append(hit)
            if value_hits:
                named = value_hits
        if not named:
            entity = str(decision.get("entity_name") or "").strip()
            if entity:
                hit = resolve_roster_name(entity, roster)
                if hit:
                    named = [hit]
        if named:
            fields["members"] = named
            fields.pop("members_skipped", None)
            fields.pop("customerName", None)
            fields.pop("customer_name", None)
            return {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "agent": "teams",
                "workflow": "create_team",
                "fields": fields,
                "proposed_tool": None,
                "reference": None,
            }
        canon = resolve_roster_name(user_text, roster_members)
        if canon:
            fields["members"] = [canon]
            fields.pop("customerName", None)
            fields.pop("customer_name", None)
            return {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "agent": "teams",
                "workflow": "create_team",
                "fields": fields,
                "proposed_tool": None,
                "reference": None,
            }
        if action == "START_ADD_TEAM_MEMBERS" or op == "ADD_MEMBERS":
            return _create_team_foreign_add_members()
        return decision

    if action in {
        "SIDE_QUEST",
        "NEW_TASK",
        "CANCEL_WORKFLOW",
        "RESUME_WORKFLOW",
    }:
        return decision
    return decision


_FLOW_ENTITY_TYPE = {
    "ticket": "ticket",
    "customer": "customer",
    "team": "team",
    "kb": "article",
    "macro": "macro",
    "priority": "priority",
    "escalate": "ticket",
    "reassign": "ticket",
}


_OP_TO_PARKED_FLOW = {
    "CREATE_TICKET": "create_ticket",
    "CREATE_CUSTOMER": "customer",
    "CREATE_TEAM": "create_team",
    "CREATE_MACRO": "create_macro",
    "CREATE_KB": "create_kb",
    "CREATE_PRIORITY": "create_priority",
    "CREATE_STATUS": "create_status",
    "ADD_MEMBERS": "add_team_members",
    "ESCALATE_TICKET": "escalate",
    "UPDATE_TICKET": "reassign_ticket",
}

_START_ACTION_TO_FLOW = {
    "START_CREATE_TICKET": "create_ticket",
    "START_CREATE_CUSTOMER": "customer",
    "START_CREATE_TEAM": "create_team",
    "START_CREATE_MACRO": "create_macro",
    "START_CREATE_KB": "create_kb",
    "START_CREATE_PRIORITY": "create_priority",
    "START_CREATE_STATUS": "create_status",
    "START_ADD_TEAM_MEMBERS": "add_team_members",
    "START_ESCALATE": "escalate",
    "START_REASSIGN": "reassign_ticket",
}


def _parked_flow_matches(candidate: str, parked_flow: str, draft: dict | None) -> bool:
    from app.memory_contract import workflow_id_for_parked_flow

    c = str(candidate or "").strip().lower()
    p = str(parked_flow or "").strip().lower()
    if not c or not p:
        return False
    if c == p:
        return True
    wid_c = workflow_id_for_parked_flow(c, draft)
    wid_p = workflow_id_for_parked_flow(p, draft)
    return bool(wid_c and wid_p and wid_c == wid_p) or c in {p, wid_p} or p in {c, wid_c}


def ground_resume_offer_decision(
    decision: dict[str, Any],
    state: AgentState,
) -> dict[str, Any]:
    """When a completion offered resume, map affirmations to RESUME_WORKFLOW.

    Uses pending_resume / parked stack + NLU action/operation — not utterance
    keyword lists. Recovers when pending_resume was dropped but parked drafts
    still exist and the user continues the same create op.
    """
    from app.memory_contract import normalize_parked

    # Any active guided collect blocks remapping affirmations onto a parked flow.
    # (current_workflow alone is not enough — kb/customer drafts can be active
    # while current_workflow is empty after a client remount.)
    if str(state.get("current_workflow") or "").strip():
        return decision
    for draft_key in (
        "ticket_draft",
        "kb_draft",
        "macro_draft",
        "team_draft",
        "customer_draft",
        "priority_draft",
        "escalate_draft",
        "reassign_draft",
    ):
        blob = state.get(draft_key)
        if isinstance(blob, dict) and str(blob.get("awaiting") or "").strip():
            return decision
    parked = normalize_parked(state.get("parked_drafts"))
    if not parked:
        return decision
    ctx = (
        state.get("conversation_context")
        if isinstance(state.get("conversation_context"), dict)
        else {}
    )
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    pending = (
        last_q.get("pending_resume")
        if isinstance(last_q.get("pending_resume"), dict)
        else None
    )
    awaiting = str(last_q.get("awaiting") or "").strip().lower()
    offer_open = awaiting == "resume_offer" or bool(pending)

    action = str(decision.get("action") or "").strip().upper()
    operation = str(decision.get("operation") or "").strip().upper()
    workflow_hint = str(decision.get("workflow") or "").strip().lower()

    if action in {"NEW_TASK", "SIDE_QUEST", "CANCEL_WORKFLOW"}:
        return decision

    flow = str((pending or {}).get("flow") or "").strip().lower()
    if not flow:
        flow = _OP_TO_PARKED_FLOW.get(operation) or ""
    if not flow and workflow_hint:
        flow = workflow_hint
    if not flow and action in _START_ACTION_TO_FLOW and offer_open:
        flow = _START_ACTION_TO_FLOW[action]
    if not flow and len(parked) == 1:
        flow = str(parked[0].get("flow") or "").strip().lower()
    if not flow:
        return decision

    matched = next(
        (
            p
            for p in parked
            if _parked_flow_matches(
                flow,
                str(p.get("flow") or ""),
                p.get("draft") if isinstance(p.get("draft"), dict) else None,
            )
        ),
        None,
    )
    if not matched:
        return decision
    flow = str(matched.get("flow") or flow).strip().lower()

    affirm = action in {
        "CONFIRM_WORKFLOW",
        "CONTINUE_WORKFLOW",
        "RESUME_WORKFLOW",
    }
    # Same-flow START after an offer is a mislabel of "yes, finish that" — resume.
    start_same = (
        offer_open
        and action in _START_ACTION_TO_FLOW
        and _parked_flow_matches(
            _START_ACTION_TO_FLOW[action],
            flow,
            matched.get("draft") if isinstance(matched.get("draft"), dict) else None,
        )
    )
    # Idle CONTINUE/CONFIRM with CREATE_* matching parked — even if pending_resume dropped.
    op_flow = _OP_TO_PARKED_FLOW.get(operation) or ""
    op_same = affirm and bool(op_flow) and _parked_flow_matches(
        op_flow,
        flow,
        matched.get("draft") if isinstance(matched.get("draft"), dict) else None,
    )
    if offer_open and (affirm or start_same):
        pass
    elif op_same:
        pass
    else:
        return decision

    out = dict(decision)
    out["action"] = "RESUME_WORKFLOW"
    entity = _FLOW_ENTITY_TYPE.get(flow)
    if not entity:
        if "ticket" in flow:
            entity = "ticket"
        elif "customer" in flow:
            entity = "customer"
        elif "team" in flow or "member" in flow:
            entity = "team"
        elif "macro" in flow:
            entity = "macro"
        elif "kb" in flow:
            entity = "article"
        elif "priority" in flow or "status" in flow:
            entity = "priority"
    out["entity_type"] = entity or decision.get("entity_type")
    out["fields"] = {}
    out["values"] = [flow]
    return out


def _compact_session_memory(raw: Any) -> dict[str, Any] | None:
    """CRM sessionMemory for Super Agent: pendingIntent / pendingAsk / slots."""
    if not isinstance(raw, dict) or not raw:
        return None
    out: dict[str, Any] = {}
    for key in ("pendingIntent", "pendingAsk"):
        val = raw.get(key)
        if val not in (None, ""):
            out[key] = str(val).strip()
    slots = raw.get("slots")
    if isinstance(slots, dict) and slots:
        compact_slots: dict[str, Any] = {}
        for k, v in list(slots.items())[:24]:
            if v in (None, "", [], {}):
                continue
            key = str(k).strip()
            if not key:
                continue
            if isinstance(v, (str, int, float, bool)):
                compact_slots[key] = v if not isinstance(v, str) else v.strip()[:200]
            elif isinstance(v, list):
                compact_slots[key] = [
                    str(x).strip()[:80] for x in v[:12] if str(x).strip()
                ]
            else:
                compact_slots[key] = str(v).strip()[:200]
        if compact_slots:
            out["slots"] = compact_slots
    parked = raw.get("parkedDrafts") or raw.get("parked_drafts")
    if isinstance(parked, list) and parked:
        out["parkedDrafts"] = [
            {
                "flow": str(item.get("flow") or "").strip(),
                "awaiting": str(
                    (item.get("draft") or {}).get("awaiting")
                    if isinstance(item.get("draft"), dict)
                    else item.get("awaiting")
                    or ""
                ).strip(),
            }
            for item in parked[:6]
            if isinstance(item, dict)
        ]
    return out or None


def _roster_from_state(state: AgentState) -> list[str]:
    td = state.get("team_draft") if isinstance(state.get("team_draft"), dict) else {}
    wd = state.get("workflow_data") if isinstance(state.get("workflow_data"), dict) else {}
    rd = state.get("reassign_draft") if isinstance(state.get("reassign_draft"), dict) else {}
    ed = state.get("escalate_draft") if isinstance(state.get("escalate_draft"), dict) else {}
    tm = _tool_memory_from_state(state)
    agents = tm.get("list_agents") if isinstance(tm.get("list_agents"), dict) else {}
    ents = agents.get("entities") if isinstance(agents, dict) else None
    entity_names = [
        str(e.get("name") or "").strip()
        for e in (ents or [])
        if isinstance(e, dict) and str(e.get("name") or "").strip()
    ]
    # Prefer the role-filtered list already shown on reassign/escalate person steps
    # so Super Agent can put exact DB spelling in fields.person.
    for raw in (
        rd.get("candidates") if str(rd.get("awaiting") or "").strip().lower() == "person" else None,
        ed.get("candidates")
        if str(ed.get("awaiting") or "").strip().lower() == "assignee"
        else None,
        td.get("available_members"),
        wd.get("available_members"),
        agents.get("names") if isinstance(agents, dict) else None,
        entity_names,
        rd.get("candidates"),
        ed.get("candidates"),
    ):
        if isinstance(raw, list) and raw:
            return [str(n).strip() for n in raw if str(n).strip()]
    return []


def build_super_agent_context(
    state: AgentState,
    user_text: str,
    *,
    consistency_note: str | None = None,
) -> dict[str, Any]:
    """Super Agent context — delegated to the central Context Factory."""
    from app.context_factory import build_super_agent_context as _factory_ctx

    return _factory_ctx(state, user_text, consistency_note=consistency_note)


def _invoke_workflow_nlu(context: dict[str, Any]) -> dict[str, Any]:
    """Legacy LLM call — stub system prompt; tests use FakeLLM heuristics."""
    settings = get_settings()
    llm = get_llm()
    messages = [
        SystemMessage(content=WORKFLOW_NLU_SYSTEM),
        HumanMessage(content=json.dumps(context, ensure_ascii=False, default=str)),
    ]
    last_error: Exception | None = None
    max_attempts = max(1, settings.workflow_decision_max_attempts)
    parsed: dict[str, Any] = {}
    for _attempt in range(max_attempts):
        try:
            result = llm.invoke(messages)
            content = (
                result.content
                if isinstance(result.content, str)
                else str(result.content or "")
            )
            parsed = _json_object(content)
            action = str(parsed.get("action") or "").strip().upper()
            intent = str(parsed.get("intent") or "").strip().upper()
            if action in WORKFLOW_ACTIONS and intent in INTENTS:
                return parsed
            last_error = ValueError("model returned an invalid workflow decision")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError("Workflow interpretation service failed") from last_error


def _active_collect_draft(state: AgentState, workflow: str | None) -> dict[str, Any]:
    """Active draft blob for typed collect grounding (missing_fields SoT)."""
    wid = str(workflow or "").strip().lower()
    key_by_wf = {
        "create_ticket": "ticket_draft",
        "ticket": "ticket_draft",
        "create_kb": "kb_draft",
        "kb": "kb_draft",
        "manage_kb_category": "kb_draft",
        "manage_category": "kb_draft",
        "create_customer": "customer_draft",
        "customer": "customer_draft",
        "create_macro": "macro_draft",
        "macro": "macro_draft",
        "create_team": "team_draft",
        "team": "team_draft",
        "create_priority": "priority_draft",
        "priority": "priority_draft",
        "create_status": "priority_draft",
        "status": "priority_draft",
        "escalate": "escalate_draft",
        "reassign_ticket": "reassign_draft",
        "reassign": "reassign_draft",
        "add_team_members": "team_draft",
        "add_members": "team_draft",
    }
    key = key_by_wf.get(wid)
    if not key:
        return {}
    blob = state.get(key)
    return dict(blob) if isinstance(blob, dict) else {}


def decide_workflow_turn(state: AgentState, user_text: str) -> dict[str, Any]:
    """LEGACY: workflow JSON decision for graph tests. Native path does not call this."""
    active = str(state.get("current_workflow") or "").strip().lower()
    step = _awaiting_step_from_state(state)
    context = build_super_agent_context(state, user_text)
    settings = get_settings()
    started = time.perf_counter()
    parsed = _invoke_workflow_nlu(context)
    roster = [
        str(n).strip()
        for n in (context.get("available_members") or [])
        if str(n).strip()
    ]
    decision = normalize_workflow_decision(
        parsed,
        workflow_id=active or None,
        user_text=user_text,
        page=state.get("page"),
        roster_members=roster,
    )
    if needs_consistency_retry(
        active_workflow=active,
        current_step=step,
        decision=decision,
    ):
        step_l = step.lower()
        if step_l == "confirm":
            consistency_note = (
                "Active workflow awaits confirm. Agreement → CONTINUE_WORKFLOW so "
                "the specialist can call the write tool. Cancel → CANCEL_WORKFLOW. "
                "A different guided create (add customer, create team, create macro) "
                "→ NEW_TASK or the matching START_*. An independent lookup "
                "(show/list tickets) → SIDE_QUEST with the query op. Never emit "
                "LIST_TICKETS/SEARCH_TICKETS for a short confirmation, and never "
                "re-ask a field already in the draft."
            )
        else:
            consistency_note = (
                "Active collect step is in progress. A field answer or short name "
                "is CONTINUE_WORKFLOW for the active workflow (put the value in "
                "fields), not LIST_*/SEARCH_*/NORMAL_ROUTE or a new START_* of the "
                "same flow. Use NEW_TASK or the matching START_* if they clearly "
                "switched to another guided create (add customer, create team). "
                "If create_kb awaits category, 'add new category' / 'new category' "
                "is CONTINUE_WORKFLOW (custom article category) — never "
                "START_CREATE_PRIORITY. If manage_kb_category awaits manage_mode "
                "or category_name, bare 'add' / a category name is "
                "CONTINUE_WORKFLOW — never START_CREATE_KB or "
                "START_CREATE_PRIORITY."
            )
        retry_ctx = build_super_agent_context(
            state,
            user_text,
            consistency_note=consistency_note,
        )
        parsed = _invoke_workflow_nlu(retry_ctx)
        decision = normalize_workflow_decision(
            parsed,
            workflow_id=active or None,
            user_text=user_text,
            page=state.get("page"),
            roster_members=roster,
        )
    decision = ground_active_collect_decision(
        decision,
        workflow=active,
        step=step,
        user_text=user_text,
        roster_members=roster,
        draft=_active_collect_draft(state, active),
    )
    decision = ground_resume_offer_decision(decision, state)
    elapsed_ms = (time.perf_counter() - started) * 1000
    log_llm(
        kind="workflow_nlu",
        user_text=user_text,
        response=json.dumps(decision, ensure_ascii=False),
        agent="workflow_manager",
        page=state.get("page"),
        organization_id=state.get("organization_id"),
        user_id=state.get("user_id"),
        model=settings.model_name,
        ms=elapsed_ms,
    )
    return decision
