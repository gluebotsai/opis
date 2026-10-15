"""Frozen capability inventory for the native multi-agent migration (Phase 0).

Data structures only — keep concise; extend entries as parity work proceeds.
"""

from __future__ import annotations

from typing import Any

# Workflows / tools that must work identically from form UI and chat (same Express path).
FORM_CHAT_PARITY: list[dict[str, Any]] = [
    {"workflow": "create_ticket", "tool": "create_ticket", "module": "tickets"},
    {"workflow": "portal_create_ticket", "tool": "portal_create_ticket", "module": "tickets", "surface": "portal"},
    {"workflow": "escalate", "tool": "escalate_ticket", "module": "tickets"},
    {"workflow": "reassign_ticket", "tool": "update_ticket", "module": "tickets"},
    {"workflow": "create_team", "tool": "create_queue", "module": "teams"},
    {"workflow": "add_team_members", "tool": "update_queue", "module": "teams"},
    {"workflow": "create_customer", "tool": "create_customer", "module": "customers"},
    {"workflow": "create_kb", "tool": "create_kb_article", "module": "kb"},
    {"workflow": "manage_kb_category", "tool": "manage_kb_category", "module": "kb"},
    {"workflow": "create_macro", "tool": "create_macro", "module": "macros"},
    {"workflow": "create_priority", "tool": "create_priority", "module": "admin"},
    {"workflow": "create_status", "tool": "create_status", "module": "admin"},
]

# Authoritative create-ticket (+ related) permissions by role.
# Final rule: customer may create for themself (server-enforced identity); not for others.
ROLE_MATRIX: dict[str, dict[str, Any]] = {
    "admin": {
        "can_create_ticket": True,
        "modules": [
            "dashboard",
            "search",
            "assigned",
            "team-queue",
            "team-inbox",
            "unassigned",
            "create-ticket",
            "agent-queues",
            "kb",
            "customers",
            "analytics",
            "audit",
            "csat-reports",
            "macros",
            "priorities",
            "escalation-directory",
            "org-preferences",
            "approvals",
            "settings",
        ],
        "ticket_data_scope": "org",
    },
    "agent": {
        "can_create_ticket": True,
        "modules": [
            "dashboard",
            "search",
            "assigned",
            "team-inbox",
            "unassigned",
            "create-ticket",
            "kb",
            "customers",
            "macros",
            "settings",
        ],
        "ticket_data_scope": "assignee",
    },
    "resolver": {
        "can_create_ticket": False,
        "modules": [
            "dashboard",
            "search",
            "assigned",
            "work-board",
            "kb",
            "settings",
        ],
        "ticket_data_scope": "assignee",
    },
    "customer": {
        "can_create_ticket": True,  # self only — Express derives requester identity
        "modules": ["create-ticket", "assigned", "settings"],
        "ticket_data_scope": "requester",
    },
    "viewer": {
        "can_create_ticket": False,
        "modules": [
            "dashboard",
            "search",
            "assigned",
            "team-queue",
            "kb",
            "customers",
            "analytics",
            "settings",
        ],
        "ticket_data_scope": "org",
    },
}

# Interactive specialist agent names (supervisor routes to these).
SPECIALISTS: tuple[str, ...] = (
    "tickets",
    "customers",
    "teams",
    "kb",
    "macros",
    "admin",
    "general",
)

# Key regression scenario ids (from fixtures + owner suites).
REGRESSION_SCENARIOS: tuple[str, ...] = (
    "interrupt_kb_then_resume",
    "cancel_team_create",
    "last_entity_add_members_not_create",
    "members_draft_continues",
    "which_team_bare_name",
    "escalate_side_quest_keeps_draft",
    "escalate_cancel_clears_draft",
    "cancel_macro_clears_draft",
    "cancel_kb_clears_draft",
    "macro_title_continues",
    "create_ticket_list_side_quest_resume",
    "ticket_crud_escalate_reassign",
    "rbac_create_ticket_by_role",
    "portal_customer_create_self",
    "portal_guest_denied_create",
    "cross_specialist_follow_up",
    "proactive_approval_idempotent",
)

# Convenience map used by native run_chat defaults.
ROLE_CAN_CREATE_TICKET: dict[str, bool] = {
    role: bool(meta.get("can_create_ticket"))
    for role, meta in ROLE_MATRIX.items()
}
ROLE_CAN_CREATE_TICKET.update(
    {
        "portal_customer": True,
        "portal_guest": False,
    }
)

PROACTIVE_AGENTS: tuple[str, ...] = (
    "tcaa",
    "icpa",
    "itra",
    "dssa",
    "tsaa",
    "sema",
    "rkaa",
    "crda",
    "ara",
    "wloa",
    "tiaa",
    "stda",
    "pna",
    "rcaa",
)
