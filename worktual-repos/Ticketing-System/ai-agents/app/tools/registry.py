"""Tool Registry — code-owned allowlists (not LLM-configurable)."""

from __future__ import annotations

from typing import Any, Callable

# agent → allowed tool names
TOOL_ALLOWLIST: dict[str, frozenset[str]] = {
    "tickets": frozenset(
        {
            "get_ticket",
            "get_ticket_progress",
            "list_tickets",
            "portal_list_tickets",
            "portal_create_ticket",
            "escalate_ticket",
            "create_ticket",
            "enrich_ticket",
            "verify_ticket_customer",
            "update_ticket",
            "add_ticket_note",
            "auto_assign_ticket",
            "ask_semantic_layer",
            "ask_ontology",
            "ask_hub",
            "get_metrics",
            "get_triage_stats",
            "get_dashboard_chart",
            "list_activities",
            "list_queues",
            "get_analytics",
            "list_customers",
            "create_customer",
            "patch_customer_draft",
            "list_ticket_recommendations",
            "resolve_ticket_person",
            "patch_ticket_draft",
            "patch_escalate_draft",
            "patch_reassign_draft",
            "navigate",
        }
    ),
    "teams": frozenset(
        {
            "list_queues",
            "list_agents",
            "create_queue",
            "update_queue",
            "delete_queue",
            "patch_team_draft",
            "ask_hub",
            "navigate",
        }
    ),
    "customers": frozenset(
        {
            "list_customers",
            "create_customer",
            "import_customers",
            "get_customer_360",
            "list_tickets",
            "patch_customer_draft",
            "ask_hub",
            "navigate",
            "open_customer_import",
        }
    ),
    "kb": frozenset(
        {
            "list_kb",
            "get_kb",
            "create_kb_article",
            "update_kb_article",
            "publish_kb_article",
            "list_kb_categories",
            "manage_kb_category",
            "export_kb",
            "import_kb_articles",
            "portal_list_tickets",
            "portal_create_ticket",
            "patch_kb_draft",
            "ask_hub",
            "navigate",
        }
    ),
    "macros": frozenset(
        {
            "list_macros",
            "create_macro",
            "update_macro",
            "delete_macro",
            "patch_macro_draft",
            "ask_hub",
            "navigate",
        }
    ),
    "admin": frozenset(
        {
            "list_priorities",
            "create_priority",
            "update_priority",
            "delete_priority",
            "list_statuses",
            "create_status",
            "update_status",
            "delete_status",
            "ask_semantic_layer",
            "ask_ontology",
            "ask_hub",
            "get_metrics",
            "get_analytics",
            "export_analytics",
            "get_csat_reports",
            "list_audit",
            "list_escalation_directory",
            "list_tickets",
            "get_org_preferences",
            "update_org_preferences",
            "get_user_preferences",
            "update_user_preference",
            "verify_hard_preferences",
            "store_long_term_memory",
            "search_long_term_memory",
            "list_widgets",
            "create_widget",
            "update_widget",
            "list_integration_keys",
            "create_integration_key",
            "revoke_integration_key",
            "list_notifications",
            "mark_all_notifications_read",
            "mark_notification_read",
            "clear_notifications",
            "list_automation_rules",
            "create_automation_rule",
            "update_automation_rule",
            "delete_automation_rule",
            "patch_priority_draft",
            "patch_status_draft",
            "navigate",
        }
    ),
    "tcaa": frozenset({"create_ticket", "list_customers", "list_kb"}),
    "icpa": frozenset({"get_ticket", "update_ticket", "list_queues", "list_tickets"}),
    "itra": frozenset(
        {
            "get_ticket",
            "update_ticket",
            "auto_assign_ticket",
            "list_agents",
            "list_queues",
            "list_tickets",
        }
    ),
    "dssa": frozenset({"list_kb", "get_kb", "list_tickets"}),
    "tsaa": frozenset(
        {
            "get_ticket",
            "update_ticket",
            "get_ticket_progress",
            "list_ticket_notes",
            "list_tickets",
        }
    ),
    "sema": frozenset(
        {
            "get_ticket",
            "list_tickets",
            "escalate_ticket",
            "update_ticket",
            "send_staff_notification",
            "list_agents",
        }
    ),
    "rkaa": frozenset({"list_kb", "list_tickets", "get_ticket", "list_ticket_recommendations"}),
    "crda": frozenset({"get_ticket", "add_ticket_note", "get_ticket_progress"}),
    "ara": frozenset({"get_ticket", "update_ticket"}),
    "wloa": frozenset({"list_tickets", "list_agents", "list_queues", "get_metrics"}),
    "tiaa": frozenset(
        {
            "ask_semantic_layer",
            "ask_ontology",
            "get_analytics",
            "get_metrics",
            "list_tickets",
            "get_csat_reports",
        }
    ),
    "stda": frozenset(
        {"list_tickets", "get_ticket", "list_ticket_notes", "list_kb", "list_macros"}
    ),
    "pna": frozenset({"send_staff_notification", "list_notifications", "get_ticket"}),
    "rcaa": frozenset(
        {
            "ask_semantic_layer",
            "ask_ontology",
            "get_analytics",
            "list_tickets",
            "get_csat_reports",
            "list_audit",
        }
    ),
    "rqa": frozenset(
        {
            "get_ticket",
            "list_ticket_notes",
            "get_ticket_progress",
            "add_ticket_note",
        }
    ),
    "general": frozenset(
        {
            "create_macro",
            "delete_macro",
            "list_macros",
            "list_queues",
            "create_queue",
            "update_queue",
            "delete_queue",
            "list_kb",
            "get_kb",
            "create_kb_article",
            "list_customers",
            "create_customer",
            "list_agents",
            "ask_semantic_layer",
            "ask_ontology",
            "ask_hub",
            "get_metrics",
            "get_analytics",
            "export_analytics",
            "get_csat_reports",
            "list_audit",
            "list_escalation_directory",
            "update_macro",
            "get_org_preferences",
            "update_org_preferences",
            "get_user_preferences",
            "update_user_preference",
            "verify_hard_preferences",
            "store_long_term_memory",
            "search_long_term_memory",
            "list_widgets",
            "create_widget",
            "list_integration_keys",
            "list_notifications",
            "mark_all_notifications_read",
            "mark_notification_read",
        }
    ),
}

# Frozen Harness Executors receive a code-owned superset which selected Skills
# may only narrow. Legacy specialist/proactive allowlists remain compatibility
# sources during the staged cutover; Markdown never grants tool authority.
_CANONICAL_EXECUTOR_BASE_AGENTS: dict[str, tuple[str, ...]] = {
    "ai_resolution_executor": ("dssa",),
    "ticket_creation_executor": ("tickets", "tcaa"),
    "classification_priority_executor": ("icpa",),
    "intelligent_assignment_executor": ("itra",),
    "workload_optimization_executor": ("wloa",),
    "root_cause_learning_executor": ("rcaa",),
    "ticket_lifecycle_executor": ("tickets", "admin"),
    "sla_escalation_executor": ("sema",),
    "investigation_summary_executor": ("tsaa",),
    "customer_reply_drafting_executor": ("crda", "tickets", "macros"),
    "autonomous_resolution_executor": ("ara",),
    "resolution_quality_executor": ("rqa",),
    "personalized_notification_executor": ("pna",),
    "insights_analytics_executor": ("tiaa",),
    "resolution_knowledge_executor": ("rkaa", "kb"),
    "similar_ticket_detection_executor": ("stda",),
    "team_queue_crud_executor": ("teams",),
    "kb_quality_crud_executor": ("kb",),
    "macro_crud_executor": ("macros",),
    "customer_directory_crud_executor": ("customers",),
    "priority_status_crud_executor": ("admin",),
    "org_settings_integrations_executor": ("admin",),
    "notification_inbox_executor": ("admin", "pna"),
    "analytics_audit_query_executor": ("admin", "tiaa", "rcaa"),
    "automation_rule_crud_executor": ("admin",),
}
_CANONICAL_EXECUTOR_EXTRA_TOOLS: dict[str, frozenset[str]] = {
    "ticket_lifecycle_executor": frozenset({"list_ticket_notes", "list_agents"}),
    "customer_reply_drafting_executor": frozenset({"list_ticket_notes"}),
    "resolution_quality_executor": frozenset({"list_ticket_notes", "get_ticket_progress"}),
    "analytics_audit_query_executor": frozenset(
        {"get_triage_stats", "get_dashboard_chart", "list_activities"}
    ),
}

for _executor_id, _base_agents in _CANONICAL_EXECUTOR_BASE_AGENTS.items():
    TOOL_ALLOWLIST[_executor_id] = frozenset(
        tool
        for _base_agent in _base_agents
        for tool in TOOL_ALLOWLIST.get(_base_agent, frozenset())
    ) | _CANONICAL_EXECUTOR_EXTRA_TOOLS.get(_executor_id, frozenset())


def tools_for_agent(agent: str) -> frozenset[str]:
    return TOOL_ALLOWLIST.get((agent or "").strip().lower(), frozenset())


_MODULE_ALIASES = {
    "ticket": "tickets",
    "team": "teams",
    "queue": "teams",
    "queues": "teams",
    "article": "kb",
    "articles": "kb",
    "knowledge": "kb",
    "customer": "customers",
    "macro": "macros",
    "priority": "admin",
    "priorities": "admin",
    "status": "admin",
    "analytics": "admin",
    "csat": "admin",
    "audit": "admin",
    "directory": "admin",
    "prefs": "admin",
    "settings": "admin",
}

# Small allowlists per CRM module + surface. Always a subset of the specialist
# agent tools. Idle page routing uses this; Super Agent JSON is not the UI protocol.
MODULE_SURFACE_TOOLS: dict[tuple[str, str], frozenset[str]] = {
    ("tickets", "list"): frozenset(
        {
            "list_tickets",
            "get_ticket",
            "get_ticket_progress",
            "get_metrics",
            "ask_semantic_layer",
            "ask_ontology",
            "ask_hub",
            "update_ticket",
            "add_ticket_note",
            "auto_assign_ticket",
            "escalate_ticket",
            "list_ticket_recommendations",
            "list_queues",
            "resolve_ticket_person",
            "enrich_ticket",
            "verify_ticket_customer",
            "list_customers",
            "patch_ticket_draft",
            "patch_escalate_draft",
            "patch_reassign_draft",
            "navigate",
        }
    ),
    ("tickets", "create"): frozenset(
        {
            "create_ticket",
            "enrich_ticket",
            "verify_ticket_customer",
            "list_customers",
            "list_queues",
            "patch_ticket_draft",
            # CDP miss during create-ticket: customer must be added in-flow
            "create_customer",
            "patch_customer_draft",
            "navigate",
        }
    ),
    ("tickets", "detail"): frozenset(
        {
            "get_ticket",
            "get_ticket_progress",
            "update_ticket",
            "add_ticket_note",
            "auto_assign_ticket",
            "escalate_ticket",
            "list_ticket_recommendations",
            "resolve_ticket_person",
            "patch_escalate_draft",
            "patch_reassign_draft",
            "navigate",
        }
    ),
    ("teams", "list"): frozenset(
        {
            "list_queues",
            "list_agents",
            "update_queue",
            "delete_queue",
            "create_queue",
            "patch_team_draft",
            "navigate",
        }
    ),
    ("teams", "create"): frozenset(
        {
            "create_queue",
            "update_queue",
            "list_agents",
            "list_queues",
            "patch_team_draft",
            "navigate",
        }
    ),
    ("teams", "detail"): frozenset(
        {
            "list_queues",
            "list_agents",
            "update_queue",
            "delete_queue",
            "patch_team_draft",
            "navigate",
        }
    ),
    ("customers", "list"): frozenset(
        {
            "list_customers",
            "get_customer_360",
            "list_tickets",
            "create_customer",
            "import_customers",
            "open_customer_import",
            "patch_customer_draft",
            "navigate",
        }
    ),
    ("customers", "create"): frozenset(
        {
            "create_customer",
            "list_customers",
            "import_customers",
            "open_customer_import",
            "patch_customer_draft",
            "navigate",
        }
    ),
    ("kb", "list"): frozenset(
        {
            "list_kb",
            "get_kb",
            "update_kb_article",
            "publish_kb_article",
            "list_kb_categories",
            "manage_kb_category",
            "export_kb",
            "import_kb_articles",
            "create_kb_article",
            "patch_kb_draft",
            "navigate",
        }
    ),
    ("kb", "create"): frozenset(
        {
            "create_kb_article",
            "list_kb",
            "list_kb_categories",
            "manage_kb_category",
            "patch_kb_draft",
            "navigate",
        }
    ),
    ("kb", "detail"): frozenset(
        {
            "list_kb",
            "get_kb",
            "update_kb_article",
            "publish_kb_article",
            "list_kb_categories",
            "export_kb",
            "patch_kb_draft",
            "navigate",
        }
    ),
    ("macros", "list"): frozenset(
        {
            "list_macros",
            "update_macro",
            "delete_macro",
            "create_macro",
            "patch_macro_draft",
            "navigate",
        }
    ),
    ("macros", "create"): frozenset(
        {"create_macro", "list_macros", "patch_macro_draft", "navigate"}
    ),
    ("admin", "list"): frozenset(
        {
            "ask_semantic_layer",
            "ask_ontology",
            "ask_hub",
            "get_metrics",
            "get_analytics",
            "list_priorities",
            "list_statuses",
            "list_audit",
            "get_csat_reports",
            "list_escalation_directory",
            "get_org_preferences",
            "create_priority",
            "create_status",
            "update_priority",
            "update_status",
            "delete_priority",
            "delete_status",
            "patch_priority_draft",
            "patch_status_draft",
            "navigate",
        }
    ),
    ("admin", "analytics"): frozenset(
        {
            "ask_semantic_layer",
            "ask_ontology",
            "get_analytics",
            "export_analytics",
            "list_tickets",
        }
    ),
    ("admin", "csat"): frozenset(
        {"ask_semantic_layer", "ask_ontology", "list_tickets"}
    ),
    ("admin", "audit"): frozenset({"list_audit"}),
    ("admin", "directory"): frozenset({"list_escalation_directory", "list_agents"}),
    ("admin", "priorities"): frozenset(
        {
            "list_priorities",
            "create_priority",
            "update_priority",
            "delete_priority",
            "list_statuses",
            "create_status",
            "update_status",
            "delete_status",
            "patch_priority_draft",
            "patch_status_draft",
            "navigate",
        }
    ),
    ("admin", "prefs"): frozenset(
        {
            "get_org_preferences",
            "update_org_preferences",
            "get_user_preferences",
            "update_user_preference",
            "verify_hard_preferences",
            "store_long_term_memory",
            "search_long_term_memory",
            "list_widgets",
            "create_widget",
            "list_integration_keys",
        }
    ),
    ("portal", "home"): frozenset(
        {"portal_list_tickets", "portal_create_ticket", "list_kb", "get_kb"}
    ),
}

_MODULE_TO_AGENT = {
    "tickets": "tickets",
    "teams": "teams",
    "customers": "customers",
    "kb": "kb",
    "macros": "macros",
    "admin": "admin",
    "portal": "kb",
    "general": "general",
}


def normalize_module(module: str | None) -> str:
    raw = (module or "").strip().lower()
    return _MODULE_ALIASES.get(raw, raw or "general")


def tools_for_module(module: str, surface: str | None = None) -> frozenset[str]:
    """Allowlist for the current page. Completeness still lives in workflow_schemas."""
    mod = normalize_module(module)
    surf = (surface or "list").strip().lower() or "list"
    scoped = MODULE_SURFACE_TOOLS.get((mod, surf))
    if scoped:
        return scoped
    agent = _MODULE_TO_AGENT.get(mod, "general")
    return tools_for_agent(agent)


def module_matches_agent(module: str | None, agent: str | None) -> bool:
    mod = normalize_module(module)
    agent_key = (agent or "").strip().lower()
    if not mod or not agent_key:
        return False
    if mod == "portal":
        return agent_key in {"kb", "tickets", "general"}
    return _MODULE_TO_AGENT.get(mod, "") == agent_key


def assert_tool_allowed(agent: str, tool_name: str) -> None:
    allowed = tools_for_agent(agent)
    if tool_name not in allowed:
        raise PermissionError(f"Tool {tool_name} not allowed for agent {agent}")


# Code-owned tool metadata. LLM may request a tool; code enforces confirm/RBAC.
TOOL_META: dict[str, dict[str, Any]] = {
    "list_tickets": {"destructive": False, "confirm": False},
    "portal_list_tickets": {"destructive": False, "confirm": False},
    "get_ticket": {"destructive": False, "confirm": False},
    "get_ticket_progress": {"destructive": False, "confirm": False},
    "list_ticket_notes": {"destructive": False, "confirm": False},
    "get_metrics": {"destructive": False, "confirm": False},
    "get_triage_stats": {"destructive": False, "confirm": False},
    "get_dashboard_chart": {"destructive": False, "confirm": False},
    "list_activities": {"destructive": False, "confirm": False},
    "list_ticket_recommendations": {"destructive": False, "confirm": False},
    "list_queues": {"destructive": False, "confirm": False},
    "list_agents": {"destructive": False, "confirm": False},
    "resolve_ticket_person": {"destructive": False, "confirm": False},
    "list_kb": {"destructive": False, "confirm": False},
    "list_kb_categories": {"destructive": False, "confirm": False},
    "manage_kb_category": {"destructive": False, "confirm": False},
    "export_kb": {"destructive": False, "confirm": False},
    "import_kb_articles": {"destructive": False, "confirm": True},
    "get_kb": {"destructive": False, "confirm": False},
    "list_customers": {"destructive": False, "confirm": False},
    "get_customer_360": {"destructive": False, "confirm": False},
    "list_macros": {"destructive": False, "confirm": False},
    "list_priorities": {"destructive": False, "confirm": False},
    "list_statuses": {"destructive": False, "confirm": False},
    "get_analytics": {"destructive": False, "confirm": False},
    "ask_semantic_layer": {"destructive": False, "confirm": False},
    "ask_ontology": {"destructive": False, "confirm": False},
    "ask_hub": {"destructive": False, "confirm": False},
    "get_csat_reports": {"destructive": False, "confirm": False},
    "list_audit": {"destructive": False, "confirm": False},
    "list_escalation_directory": {"destructive": False, "confirm": False},
    "get_org_preferences": {"destructive": False, "confirm": False},
    "get_user_preferences": {"destructive": False, "confirm": False},
    "update_user_preference": {"destructive": False, "confirm": False},
    "verify_hard_preferences": {"destructive": False, "confirm": False},
    "store_long_term_memory": {"destructive": False, "confirm": False},
    "search_long_term_memory": {"destructive": False, "confirm": False},
    "list_widgets": {"destructive": False, "confirm": False},
    "list_integration_keys": {"destructive": False, "confirm": False},
    "list_notifications": {"destructive": False, "confirm": False},
    "export_analytics": {"destructive": False, "confirm": False},
    "mark_notification_read": {"destructive": False, "confirm": False},
    "mark_all_notifications_read": {"destructive": False, "confirm": False},
    "enrich_ticket": {"destructive": False, "confirm": False},
    "verify_ticket_customer": {
        "destructive": False,
        "confirm": False,
        "description": (
            "After customerName + email/phone on create-ticket: check CDP/directory "
            "before collecting the issue. Returns exists=true to continue, or "
            "exists=false with guidance to offer add-customer."
        ),
    },
    "create_ticket": {"destructive": False, "confirm": True},
    "portal_create_ticket": {"destructive": False, "confirm": False},
    "update_ticket": {"destructive": False, "confirm": False},
    "add_ticket_note": {"destructive": False, "confirm": False},
    "auto_assign_ticket": {"destructive": False, "confirm": False},
    "escalate_ticket": {"destructive": True, "confirm": True},
    "create_queue": {"destructive": False, "confirm": True},
    "update_queue": {"destructive": False, "confirm": True},
    "delete_queue": {"destructive": True, "confirm": True},
    "create_kb_article": {"destructive": False, "confirm": True},
    "update_kb_article": {"destructive": False, "confirm": True},
    "publish_kb_article": {"destructive": False, "confirm": True},
    "create_customer": {"destructive": False, "confirm": True},
    "import_customers": {"destructive": False, "confirm": True},
    "open_customer_import": {
        "destructive": False,
        "confirm": False,
        "description": "Open chat file picker for customer/contact import",
    },
    "create_macro": {"destructive": False, "confirm": True},
    "update_macro": {"destructive": False, "confirm": True},
    "delete_macro": {"destructive": True, "confirm": True},
    "create_priority": {"destructive": False, "confirm": True},
    "update_priority": {"destructive": False, "confirm": True},
    "delete_priority": {"destructive": True, "confirm": True},
    "create_status": {"destructive": False, "confirm": True},
    "update_status": {"destructive": False, "confirm": True},
    "delete_status": {"destructive": True, "confirm": True},
    "update_org_preferences": {"destructive": True, "confirm": True},
    "create_widget": {"destructive": False, "confirm": True},
    "update_widget": {"destructive": False, "confirm": True},
    "create_integration_key": {"destructive": False, "confirm": True},
    "revoke_integration_key": {"destructive": True, "confirm": True},
    "clear_notifications": {"destructive": True, "confirm": True},
    "list_automation_rules": {"destructive": False, "confirm": False},
    "create_automation_rule": {"destructive": False, "confirm": True},
    "update_automation_rule": {"destructive": False, "confirm": True},
    "delete_automation_rule": {"destructive": True, "confirm": True},
    "send_staff_notification": {"destructive": False, "confirm": False},
    "navigate": {"destructive": False, "confirm": False, "description": "Open a CRM view"},
    "patch_ticket_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-ticket draft / progress panel",
    },
    "patch_team_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-team draft / progress panel",
    },
    "patch_kb_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-KB draft / progress panel",
    },
    "patch_macro_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-macro draft / progress panel",
    },
    "patch_customer_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-customer draft / progress panel",
    },
    "patch_priority_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-priority draft / progress panel",
    },
    "patch_status_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the create-status draft / progress panel",
    },
    "patch_escalate_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the escalate draft / progress panel",
    },
    "patch_reassign_draft": {
        "destructive": False,
        "confirm": False,
        "description": "Update the reassign draft (ticket, role, person)",
    },
}

WRITE_TOOLS = frozenset(
    {
        "create_ticket",
        "portal_create_ticket",
        "update_ticket",
        "add_ticket_note",
        "auto_assign_ticket",
        "escalate_ticket",
        "create_queue",
        "update_queue",
        "delete_queue",
        "create_kb_article",
        "update_kb_article",
        "publish_kb_article",
        "manage_kb_category",
        "import_kb_articles",
        "create_customer",
        "import_customers",
        "create_macro",
        "update_macro",
        "delete_macro",
        "create_priority",
        "update_priority",
        "delete_priority",
        "create_status",
        "update_status",
        "delete_status",
        "update_org_preferences",
        "create_widget",
        "update_widget",
        "create_integration_key",
        "revoke_integration_key",
        "clear_notifications",
        "create_automation_rule",
        "update_automation_rule",
        "delete_automation_rule",
        "mark_notification_read",
        "mark_all_notifications_read",
        "send_staff_notification",
    }
)
for _write_tool in WRITE_TOOLS:
    if _write_tool in TOOL_META:
        TOOL_META[_write_tool]["write"] = True


def tool_meta(tool_name: str) -> dict[str, Any] | None:
    name = str(tool_name or "").strip().lower()
    meta = TOOL_META.get(name)
    return dict(meta) if meta else None


def confirmation_satisfied(
    *,
    action: str | None = None,
    last_query: dict[str, Any] | None = None,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
    args: dict[str, Any] | None = None,
) -> bool:
    """CRM-style write gate: confirmed/auto + complete draft (not awaiting=confirm).

    Legacy lean path still accepts awaiting=confirm via write_tool_armed when
    confirmed/auto is absent.
    """
    del action  # Super Agent CONFIRM_WORKFLOW is not the write gate.
    pending = last_query if isinstance(last_query, dict) else {}
    if pending.get("pending_bulk"):
        return False
    if pending.get("pending_update") or pending.get("pending_delete"):
        return True

    raw = args if isinstance(args, dict) else {}
    confirmed = _truthy_flag(raw.get("confirmed")) or _truthy_flag(raw.get("auto"))
    if confirmed:
        from app.workflow_schemas import (
            customer_write_ready,
            draft_complete,
            workflow_id_for_draft,
        )

        # Merge draft + tool args so nested CDP-miss create_customer works when
        # hydrate armed confirmed=true from name+(email|phone) but customer_draft
        # was never opened (only ticket_draft holds the contact).
        merged: dict[str, Any] = {}
        if isinstance(draft, dict):
            merged.update(draft)
        for key, value in raw.items():
            if key in {"confirmed", "auto", "_idempotency_key"}:
                continue
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            merged[key] = value

        wid = (
            str(workflow_id or "").strip()
            or workflow_id_for_draft(draft_key, merged if merged else draft)
            or ""
        )
        # Tool contract: name + (email|phone). Do not require phone-complete draft.
        if wid in {"create_customer", "customer"} or draft_key == "customer_draft":
            return customer_write_ready(merged)

        if not merged:
            return False
        return draft_complete(wid, merged)

    from app.workflow_schemas import write_tool_armed

    return write_tool_armed(
        draft=draft,
        workflow_id=workflow_id,
        last_query=last_query,
        draft_key=draft_key,
    )


def _truthy_flag(value: Any) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def validate_specialist_tool(
    *,
    agent: str,
    tool_name: str,
    operation: str | None = None,
    role: str | None = None,
    workflow: str | None = None,
    action: str | None = None,
    last_query: dict[str, Any] | None = None,
    args: dict[str, Any] | None = None,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
) -> dict[str, Any]:
    """Fail closed before execution. Structured error for the specialist LLM."""
    name = str(tool_name or "").strip().lower()
    if not name:
        return {
            "success": False,
            "error_code": "TOOL_NOT_REGISTERED",
            "message": "No tool was selected.",
        }
    registered = name in TOOL_META or any(
        name in tools for tools in TOOL_ALLOWLIST.values()
    )
    if not registered:
        return {
            "success": False,
            "error_code": "TOOL_NOT_REGISTERED",
            "message": f"Tool {name} is not registered.",
        }
    allowed = tools_for_agent(agent)
    if name not in allowed:
        return {
            "success": False,
            "error_code": "TOOL_NOT_ALLOWED",
            "message": f"Tool {name} is not allowed for the {agent} specialist.",
        }
    meta = TOOL_META.get(name) or {}
    # create_customer: write gate is name+(email|phone). Never use the guided
    # schema's phone slot to block or to tell the LLM to re-collect phone when
    # email is already present (nested CDP miss under ticket.create).
    if name == "create_customer" and meta.get("confirm"):
        from app.workflow_schemas import customer_write_ready

        raw = args if isinstance(args, dict) else {}
        merged: dict[str, Any] = {}
        if isinstance(draft, dict):
            merged.update(draft)
        for key, value in raw.items():
            if key in {"confirmed", "auto", "_idempotency_key"}:
                continue
            if value is None or (isinstance(value, str) and not value.strip()):
                continue
            merged[key] = value
        if customer_write_ready(merged):
            if not (
                _truthy_flag(raw.get("confirmed")) or _truthy_flag(raw.get("auto"))
            ):
                return {
                    "success": False,
                    "error_code": "CONFIRMATION_REQUIRED",
                    "kind": "needs_confirm",
                    "message": (
                        "High-risk write needs chat confirmation. If the user already "
                        "affirmed in natural language, call this tool again with "
                        "confirmed=true and the draft fields (name + email or phone). "
                        "Do not re-ask name or contact already provided. Never tell "
                        "the user to type a specific word like yes or confirm."
                    ),
                }
            # confirmed + write-ready → allow (skip generic draft_complete phone check)
        else:
            miss: list[str] = []
            if not str(merged.get("name") or merged.get("customerName") or "").strip():
                miss.append("name")
            email = str(merged.get("email") or merged.get("customerEmail") or "").strip()
            phone = str(merged.get("phone") or merged.get("customerPhone") or "").strip()
            if not email and not phone:
                miss.append("email")
            return {
                "success": False,
                "error_code": "CONFIRMATION_REQUIRED",
                "kind": "needs_confirm",
                "message": (
                    "Draft is incomplete. Ask only for the missing fields "
                    f"({', '.join(miss) if miss else 'name or contact'}), then call "
                    "this tool again with confirmed=true. Never tell the user to type "
                    "a specific word like yes or confirm."
                ),
                "missing": miss,
            }
    elif meta.get("confirm") and not confirmation_satisfied(
        action=action,
        last_query=last_query,
        draft=draft,
        workflow_id=workflow_id or workflow,
        draft_key=draft_key,
        args=args if isinstance(args, dict) else None,
    ):
        from app.workflow_schemas import draft_complete, missing_fields, workflow_id_for_draft

        wid = workflow_id or workflow or workflow_id_for_draft(draft_key, draft)
        miss = missing_fields(wid, draft) if isinstance(draft, dict) else ["draft"]
        if isinstance(draft, dict) and wid and not draft_complete(wid, draft):
            return {
                "success": False,
                "error_code": "CONFIRMATION_REQUIRED",
                "kind": "needs_confirm",
                "message": (
                    "Draft is incomplete. Ask only for the missing fields "
                    f"({', '.join(miss) if miss else 'required fields'}), then call "
                    "this tool again with confirmed=true. Never tell the user to type "
                    "a specific word like yes or confirm."
                ),
                "missing": miss,
            }
        return {
            "success": False,
            "error_code": "CONFIRMATION_REQUIRED",
            "kind": "needs_confirm",
            "message": (
                "High-risk write needs chat confirmation. If the user already "
                "affirmed in natural language, call this tool again with "
                "confirmed=true and the draft fields. Never tell the user to type "
                "a specific word like yes or confirm."
            ),
        }
    op = str(operation or "").strip().upper()
    if op and op != "NONE":
        try:
            authorize_tool(
                agent=agent,
                tool_name=name,
                operation=op,
                role=role,
                workflow=workflow,
            )
        except PermissionError as exc:
            return {
                "success": False,
                "error_code": "FORBIDDEN",
                "message": str(exc),
            }
    else:
        try:
            assert_tool_allowed(agent, name)
        except PermissionError as exc:
            return {
                "success": False,
                "error_code": "TOOL_NOT_ALLOWED",
                "message": str(exc),
            }
    return {"success": True, "error_code": None, "message": None}


# Semantic operations → Express tools (not a second HTTP client).
OPERATION_TOOL: dict[str, str] = {
    "CREATE_TICKET": "create_ticket",
    "LIST_TICKETS": "list_tickets",
    "SEARCH_TICKETS": "list_tickets",
    "UPDATE_TICKET": "update_ticket",
    "ESCALATE_TICKET": "escalate_ticket",
    "ADD_TICKET_NOTE": "add_ticket_note",
    "CREATE_CUSTOMER": "create_customer",
    "LIST_CUSTOMERS": "list_customers",
    "SEARCH_CUSTOMERS": "list_customers",
    "GET_CUSTOMER": "list_customers",
    "IMPORT_CUSTOMERS": "import_customers",
    "GET_CUSTOMER_TICKETS": "get_customer_360",
    "CREATE_TEAM": "create_queue",
    "LIST_TEAMS": "list_queues",
    "SEARCH_TEAMS": "list_queues",
    "GET_TEAM": "list_queues",
    "UPDATE_TEAM": "update_queue",
    "ADD_MEMBERS": "update_queue",
    "REMOVE_MEMBERS": "update_queue",
    "DELETE_TEAM": "delete_queue",
    "CREATE_KB": "create_kb_article",
    "LIST_KB": "list_kb",
    "SEARCH_KB": "list_kb",
    "GET_ARTICLE": "get_kb",
    "UPDATE_KB": "update_kb_article",
    "PUBLISH_KB": "publish_kb_article",
    "AUTO_ASSIGN_TICKET": "auto_assign_ticket",
    "CREATE_MACRO": "create_macro",
    "LIST_MACROS": "list_macros",
    "SEARCH_MACROS": "list_macros",
    "GET_MACRO": "list_macros",
    "UPDATE_MACRO": "update_macro",
    "DELETE_MACRO": "delete_macro",
    "CREATE_PRIORITY": "create_priority",
    "LIST_PRIORITIES": "list_priorities",
    "GET_PRIORITY": "list_priorities",
    "UPDATE_PRIORITY": "update_priority",
    "TOGGLE_PRIORITY": "update_priority",
    "DELETE_PRIORITY": "delete_priority",
    "CREATE_STATUS": "create_status",
    "LIST_STATUSES": "list_statuses",
    "GET_STATUS": "list_statuses",
    "UPDATE_STATUS": "update_status",
    "TOGGLE_STATUS": "update_status",
    "DELETE_STATUS": "delete_status",
    "GET_METRICS": "ask_semantic_layer",
    "COMPARE": "ask_semantic_layer",
    "RECOMMEND": "ask_semantic_layer",
    "GET_TICKET": "get_ticket",
    "GET_HISTORY": "get_ticket_progress",
    "GET_ANALYTICS": "ask_semantic_layer",
    "EXPORT_ANALYTICS": "export_analytics",
    "GET_CSAT": "ask_semantic_layer",
    "LIST_AUDIT": "list_audit",
    "SEARCH_AUDIT": "list_audit",
    "LIST_DIRECTORY": "list_escalation_directory",
    "SEARCH_DIRECTORY": "list_escalation_directory",
    "FIND_SKILL": "list_escalation_directory",
    "GET_ORG_PREFERENCES": "get_org_preferences",
    "UPDATE_ORG_PREFERENCES": "update_org_preferences",
    "LIST_WIDGETS": "list_widgets",
    "CREATE_WIDGET": "create_widget",
    "LIST_API_KEYS": "list_integration_keys",
}

# Alternate tools allowed for one operation (preview / portal).
_OPERATION_ALT_TOOLS: dict[str, frozenset[str]] = {
    "CREATE_TICKET": frozenset(
        {"create_ticket", "enrich_ticket", "verify_ticket_customer", "portal_create_ticket"}
    ),
    "LIST_TICKETS": frozenset({"list_tickets", "portal_list_tickets"}),
    "SEARCH_TICKETS": frozenset({"list_tickets", "portal_list_tickets"}),
    "RECOMMEND": frozenset(
        {"ask_semantic_layer", "ask_ontology", "list_tickets", "get_triage_stats"}
    ),
    "GET_TICKET": frozenset({"get_ticket", "list_tickets"}),
    "GET_HISTORY": frozenset({"get_ticket_progress", "get_ticket"}),
    "UPDATE_TICKET": frozenset(
        {"update_ticket", "add_ticket_note", "escalate_ticket", "auto_assign_ticket"}
    ),
    "AUTO_ASSIGN_TICKET": frozenset({"auto_assign_ticket", "update_ticket"}),
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
    "GET_METRICS": frozenset({"ask_semantic_layer", "list_tickets"}),
    "COMPARE": frozenset({"ask_semantic_layer", "list_tickets"}),
    "LIST_MACROS": frozenset({"list_macros"}),
    "SEARCH_MACROS": frozenset({"list_macros"}),
    "GET_MACRO": frozenset({"list_macros"}),
    "UPDATE_MACRO": frozenset({"update_macro"}),
    "DELETE_MACRO": frozenset({"delete_macro"}),
    "GET_ANALYTICS": frozenset({"ask_semantic_layer", "ask_ontology", "list_tickets"}),
    "EXPORT_ANALYTICS": frozenset({"export_analytics", "ask_semantic_layer"}),
    "GET_CSAT": frozenset({"ask_semantic_layer", "ask_ontology", "list_tickets"}),
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

_CREATE_OP_WORKFLOW: dict[str, str] = {
    "CREATE_TICKET": "create_ticket",
    "CREATE_CUSTOMER": "create_customer",
    "CREATE_TEAM": "create_team",
    "CREATE_KB": "create_kb",
    "CREATE_MACRO": "create_macro",
    "CREATE_PRIORITY": "create_priority",
    "CREATE_STATUS": "create_status",
    "ESCALATE_TICKET": "escalate",
    "DELETE_TEAM": "delete_team",
    "DELETE_MACRO": "create_macro",
    "DELETE_PRIORITY": "create_priority",
    "DELETE_STATUS": "create_status",
}

_ALL_OPS = frozenset(OPERATION_TOOL)
_PORTAL_CUSTOMER_OPS = frozenset(
    {
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "CREATE_TICKET",
    }
)
_PORTAL_GUEST_OPS = frozenset({"LIST_KB", "SEARCH_KB", "GET_ARTICLE"})
_TICKET_READ = frozenset(
    {
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "GET_METRICS",
        "GET_TICKET",
        "GET_HISTORY",
        "COMPARE",
        "RECOMMEND",
    }
)
_AGENT_OPS = frozenset(
    {
        "CREATE_TICKET",
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "UPDATE_TICKET",
        "ESCALATE_TICKET",
        "ADD_TICKET_NOTE",
        "AUTO_ASSIGN_TICKET",
        "LIST_CUSTOMERS",
        "SEARCH_CUSTOMERS",
        "GET_CUSTOMER",
        "GET_CUSTOMER_TICKETS",
        "LIST_TEAMS",
        "SEARCH_TEAMS",
        "GET_TEAM",
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "CREATE_KB",
        "UPDATE_KB",
        "PUBLISH_KB",
        "CREATE_MACRO",
        "LIST_MACROS",
        "SEARCH_MACROS",
        "GET_MACRO",
        "UPDATE_MACRO",
        "DELETE_MACRO",
        "LIST_PRIORITIES",
        "LIST_STATUSES",
        "GET_METRICS",
        "GET_TICKET",
        "GET_HISTORY",
        "COMPARE",
        "RECOMMEND",
    }
)
_RESOLVER_OPS = _TICKET_READ | frozenset(
    {
        "UPDATE_TICKET",
        "ESCALATE_TICKET",
        "ADD_TICKET_NOTE",
        "AUTO_ASSIGN_TICKET",
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "LIST_PRIORITIES",
        "LIST_STATUSES",
        "GET_METRICS",
    }
)
_VIEWER_OPS = _TICKET_READ | frozenset(
    {
        "LIST_CUSTOMERS",
        "SEARCH_CUSTOMERS",
        "GET_CUSTOMER",
        "GET_CUSTOMER_TICKETS",
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "GET_ANALYTICS",
        "EXPORT_ANALYTICS",
        "GET_METRICS",
        "LIST_PRIORITIES",
        "LIST_STATUSES",
        "LIST_TEAMS",
        "SEARCH_TEAMS",
        "GET_TEAM",
    }
)
OPERATIONS_BY_ROLE: dict[str, frozenset[str]] = {
    "admin": _ALL_OPS,
    "agent": _AGENT_OPS,
    "resolver": _RESOLVER_OPS,
    "viewer": _VIEWER_OPS,
    "customer": _TICKET_READ | frozenset({"CREATE_TICKET"}),
    "portal_customer": _PORTAL_CUSTOMER_OPS,
    "portal_guest": _PORTAL_GUEST_OPS,
}

# Backward-compatible alias used by older tests.
_OPERATION_TOOL = OPERATION_TOOL
_TICKET_OPERATIONS_BY_ROLE = OPERATIONS_BY_ROLE
_CREATE_WORKFLOW_TOOLS = _OPERATION_ALT_TOOLS["CREATE_TICKET"]


def tool_for_operation(operation: str) -> str | None:
    return OPERATION_TOOL.get(str(operation or "").strip().upper())


def authorize_tool(
    *,
    agent: str,
    tool_name: str,
    operation: str,
    role: str | None,
    workflow: str | None = None,
) -> None:
    """LangGraph authorization layer 1; Express remains final authority."""
    assert_tool_allowed(agent, tool_name)
    op = str(operation or "").strip().upper()
    expected = OPERATION_TOOL.get(op)
    allowed_tools = _OPERATION_ALT_TOOLS.get(op)
    valid_tool = (
        (tool_name in allowed_tools)
        if allowed_tools
        else (expected is not None and tool_name == expected)
    )
    if not valid_tool:
        raise PermissionError(f"Tool {tool_name} does not implement operation {op}")
    normalized_role = str(role or "agent").strip().lower()
    allowed = OPERATIONS_BY_ROLE.get(normalized_role, frozenset())
    if op not in allowed:
        raise PermissionError(f"Role {normalized_role} cannot attempt {op}")
    active = str(workflow or "").strip().lower()
    expected_wf = _CREATE_OP_WORKFLOW.get(op)
    if expected_wf and active and active != expected_wf:
        raise PermissionError(f"{op} is not valid in this active workflow")
    from app.memory import emit_workflow_event

    emit_workflow_event(
        "tool_authorized",
        workflow=active or None,
        operation=op,
        tool=tool_name,
    )


ToolFn = Callable[..., dict[str, Any]]
