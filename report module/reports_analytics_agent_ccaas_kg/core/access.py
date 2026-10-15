"""Role-Based Access Control (RBAC) and Security Fencing for CCaaS Knowledge Graph."""

from __future__ import annotations

from typing import Any, Optional


class AccessDenied(Exception):
    """Raised when an operation, template, or graph entity is denied by RBAC policy."""
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# Role policies for CCaaS knowledge graph
ROLE_POLICIES: dict[str, dict[str, Any]] = {
    "admin": {
        "description": "Full administrative access to conversations, queues, staff workload, and outcomes.",
        "allowed_templates": ["*"],
        "can_access_sensitive_staff": True,
        "can_access_all_queues": True,
    },
    "supervisor": {
        "description": "Supervisor/Team Lead with visibility across all operational queues and agent workload.",
        "allowed_templates": [
            "conversation_volume_summary",
            "average_handle_time",
            "resolution_rate_and_outcomes",
            "unresolved_interaction_causes",
            "queue_wait_times_and_performance",
            "agent_workload_and_performance",
            "conversation_outcomes_and_reasons",
            "channel_distribution",
            "channel_comparison_root_cause",
            "service_level_overview",
            "abandonment_and_disconnect_analysis",
            "unresolved_conversations_root_cause",
            "transfer_loops_and_chained_sessions",
            "bot_escalation_and_missed_contacts",
            "bot_sessions_and_handoff_volume",
            "customer_contact_journey",
            "business_hours_and_shifts",
            "holiday_calendar_overview",
        ],
        "can_access_sensitive_staff": False,
        "can_access_all_queues": True,
    },
    "team_lead": {
        "description": "Supervisor/Team Lead with visibility across all operational queues and agent workload.",
        "allowed_templates": [
            "conversation_volume_summary",
            "average_handle_time",
            "resolution_rate_and_outcomes",
            "unresolved_interaction_causes",
            "queue_wait_times_and_performance",
            "agent_workload_and_performance",
            "conversation_outcomes_and_reasons",
            "channel_distribution",
            "channel_comparison_root_cause",
            "service_level_overview",
            "abandonment_and_disconnect_analysis",
            "unresolved_conversations_root_cause",
            "transfer_loops_and_chained_sessions",
            "bot_escalation_and_missed_contacts",
            "bot_sessions_and_handoff_volume",
            "customer_contact_journey",
            "business_hours_and_shifts",
            "holiday_calendar_overview",
        ],
        "can_access_sensitive_staff": False,
        "can_access_all_queues": True,
    },
    "agent": {
        "description": "Individual support agent scoped to personal conversation assignments and metrics.",
        "allowed_templates": [
            "conversation_volume_summary",
            "average_handle_time",
            "resolution_rate_and_outcomes",
            "unresolved_interaction_causes",
            "channel_distribution",
            "channel_comparison_root_cause",
            "customer_contact_journey",
            "business_hours_and_shifts",
            "holiday_calendar_overview",
        ],
        "can_access_sensitive_staff": False,
        "can_access_all_queues": False,
    },
}


def get_role_policy(role: str) -> dict[str, Any]:
    """Retrieve policy configuration for a given role."""
    return ROLE_POLICIES.get(role.lower(), ROLE_POLICIES["agent"])


def validate_role_kg_template_access(role: str, template_name: str) -> None:
    """Validate whether the role has permission to run the specified knowledge graph template."""
    policy = get_role_policy(role)
    allowed = policy.get("allowed_templates", [])
    if "*" not in allowed and template_name not in allowed:
        raise AccessDenied(
            f"Role '{role}' is not authorized to execute CCaaS template '{template_name}'."
        )


def can_access_sensitive_staff(role: str) -> bool:
    """Check if the role is authorized to query sensitive administrative staff properties or labels."""
    policy = get_role_policy(role)
    return bool(policy.get("can_access_sensitive_staff", False))


def can_access_sensitive_pii(role: str) -> bool:
    """Alias for can_access_sensitive_staff."""
    return can_access_sensitive_staff(role)
