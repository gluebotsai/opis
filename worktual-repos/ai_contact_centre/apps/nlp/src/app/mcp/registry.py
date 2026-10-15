"""MCP server catalog and explicit authorization policy."""

from __future__ import annotations

from typing import Any

from app.mcp.servers.analytics import AnalyticsMCPServer
from app.mcp.servers.contact import ContactMCPServer
from app.mcp.servers.conversation import ConversationMCPServer
from app.mcp.servers.metric import MetricMCPServer
from app.mcp.servers.monitoring import MonitoringMCPServer
from app.mcp.servers.navigation import NavigationMCPServer
from app.mcp.servers.organization import OrganizationMCPServer
from app.mcp.servers.preferences import PreferencesMCPServer
from app.mcp.servers.queue import QueueMCPServer
from app.mcp.servers.skill import SkillMCPServer
from app.mcp.servers.task import TaskMCPServer

AGENT_SERVERS: dict[str, set[str]] = {
    "support_bot": {"organization", "contact", "skill"},
    "custom_lola_worktual": {"contact"},
    "custom_booxoo_bot": {"contact"},
    "general": {"navigation", "organization"},
    "contact": {"contact", "skill", "preferences"},
    "inbox": {"conversation", "contact", "organization", "skill"},
    "task": {"task", "navigation", "preferences"},
    "queue": {"queue", "skill", "preferences"},
    "analytics": {"analytics", "skill", "metric"},
    "monitoring": {"monitoring", "contact", "navigation", "preferences"},
    "conversation_assist": {"conversation", "contact", "organization", "skill"},
    "coworker_task_assist": {
        "conversation",
        "contact",
        "task",
        "navigation",
        "organization",
        "skill",
        "preferences",
    },
    "contact_center_super": set(),
    "agent_assist_domain": set(),
    "interaction_operations_domain": set(),
    "workforce_management_domain": set(),
    "performance_intelligence_domain": set(),
}

# Home surfaces for each agent. Handoffs keep the caller's page surface, so
# authorization also allows tools from these home surfaces.
AGENT_HOME_SURFACES: dict[str, frozenset[str]] = {
    "support_bot": frozenset(
        {"webchat", "whatsapp", "instagram", "facebook", "social", "email"}
    ),
    "custom_lola_worktual": frozenset(
        {"webchat", "whatsapp", "instagram", "facebook", "social"}
    ),
    "custom_booxoo_bot": frozenset(
        {"webchat", "whatsapp", "instagram", "facebook", "social", "email"}
    ),
    "general": frozenset({"general", "dashboard", "other"}),
    "contact": frozenset({"contacts-list", "contacts-detail"}),
    "inbox": frozenset({"inbox"}),
    "task": frozenset({"tasks-list", "tasks-detail"}),
    "queue": frozenset(
        {"queues-list", "queue-create", "queue-detail", "queue-edit", "workforce"}
    ),
    "analytics": frozenset({"performance", "reports", "dashboard", "analytics"}),
    "monitoring": frozenset({"monitoring"}),
    "conversation_assist": frozenset({"inbox"}),
    "coworker_task_assist": frozenset(
        {"inbox", "contacts-list", "tasks-list", "general", "other"}
    ),
}

SURFACE_TOOLS: dict[str, set[str]] = {
    "webchat": {
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
        "contact_enrich",
        "get_skill",
        "update_skill_in_system",
    },
    "whatsapp": {
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
        "contact_enrich",
        "get_skill",
        "update_skill_in_system",
    },
    "instagram": {
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
        "contact_enrich",
        "get_skill",
        "update_skill_in_system",
    },
    "facebook": {
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
        "contact_enrich",
        "get_skill",
        "update_skill_in_system",
    },
    "social": {
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
        "contact_enrich",
        "get_skill",
        "update_skill_in_system",
    },
    "email": {
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
        "contact_enrich",
        "get_skill",
        "update_skill_in_system",
    },
    "contacts-list": {
        "list_contacts",
        "count_contacts_created",
        "get_contact",
        "stage_contact_draft",
        "create_contact",
        "update_contact",
        "navigate",
        "get_skill",
        "update_skill_in_system",
    },
    "contacts-detail": {
        "list_contacts",
        "count_contacts_created",
        "get_contact",
        "stage_contact_draft",
        "update_contact",
        "navigate",
        "get_skill",
        "update_skill_in_system",
    },
    "inbox": {
        "contact_enrich",
        "get_contact",
        "get_conversation_context",
        "get_organization_knowledge",
        "suggest_reply",
        "summarize_conversation",
        "get_skill",
        "update_skill_in_system",
    },
    "tasks-list": {
        "list_tasks",
        "get_task",
        "update_task",
        "open_task_workspace",
        "navigate",
    },
    "tasks-detail": {
        "list_tasks",
        "get_task",
        "update_task",
        "open_task_workspace",
        "navigate",
    },
    "queues-list": {
        "list_queues",
        "list_teams",
        "list_business_hours",
        "stage_queue_draft",
        "create_queue",
        "update_queue",
        "update_queue_status",
        "delete_queue",
        "list_agents",
        "list_eligible_agents",
        "list_presence",
        "navigate",
    },
    "queue-create": {
        "list_queues",
        "list_teams",
        "list_business_hours",
        "stage_queue_draft",
        "create_queue",
        "list_eligible_agents",
        "navigate",
    },
    "queue-edit": {
        "list_queues",
        "update_queue",
        "update_queue_status",
        "delete_queue",
        "navigate",
    },
    "queue-detail": {
        "list_queues",
        "update_queue",
        "update_queue_status",
        "delete_queue",
        "list_agents",
        "list_presence",
        "navigate",
    },
    "workforce": {
        "list_queues",
        "list_teams",
        "list_agents",
        "list_eligible_agents",
        "list_presence",
    },
    "performance": {
        "ask_semantic_layer",
        "sql_analytics",
        "generate_plot",
        "generate_performance_report",
        "list_skills",
        "get_skill",
        "update_skill_in_system",
        "remove_skill_from_system",
        "list_active_skills",
        "list_metric_domains",
        "get_metrics",
        "get_metric",
        "get_metric_schema",
        "list_active_metrics",
        "remove_metrics",
    },
    "dashboard": {
        "list_queues",
        "list_agents",
        "list_presence",
        "navigate",
        "ask_ontology_layer",
        "ask_semantic_layer",
        "generate_performance_report",
        "sql_analytics",
        "generate_plot",
        "get_metrics",
        "get_metric",
        "get_metric_schema",
        "list_skills",
        "get_skill",
        "get_organization_details",
        "get_organization_knowledge",
        "get_dashboard_analytics_snapshot",
        "get_analytics_hourly_volume",
    },
    "reports": {
        "ask_semantic_layer",
        "sql_analytics",
        "generate_plot",
        "generate_performance_report",
        "get_dashboard_analytics_snapshot",
        "get_analytics_hourly_volume",
        "list_skills",
        "get_skill",
        "get_metrics",
        "get_metric",
        "get_metric_schema",
    },
    "analytics": {
        "get_dashboard_analytics_snapshot",
        "get_analytics_hourly_volume",
        "generate_performance_report",
        "ask_semantic_layer",
        "sql_analytics",
        "generate_plot",
        "navigate",
        "get_metrics",
        "get_metric",
        "get_metric_schema",
        "list_skills",
        "get_skill",
    },
    "monitoring": {
        "get_monitoring_snapshot",
        "get_agent_attendance",
        "get_not_ready_escalation_insight",
        "get_contact_callback_channels",
        "create_callback_task",
        "force_agent_logout",
        "set_agent_presence",
        "acknowledge_not_ready_escalation",
        "acknowledge_proactive_callback",
        "list_contacts",
        "get_contact",
        "navigate",
    },
    "other": {
        "get_organization_details",
        "get_organization_knowledge",
        "navigate",
    },
}

PREFERENCE_TOOLS = {
    "get_user_preferences",
    "update_user_preference",
    "verify_hard_preferences",
}
for _surface in (
    "general",
    "other",
    "contacts-list",
    "contacts-detail",
    "inbox",
    "tasks-list",
    "tasks-detail",
    "queues-list",
    "queue-create",
    "queue-detail",
    "queue-edit",
    "workforce",
    "monitoring",
):
    SURFACE_TOOLS.setdefault(_surface, set()).update(PREFERENCE_TOOLS)

PROCEDURAL_SKILL_TOOLS = {
    "list_skills",
    "get_skill",
    "update_skill_in_system",
    "remove_skill_from_system",
    "list_active_skills",
}
for _surface in (
    "contacts-list",
    "contacts-detail",
    "inbox",
    "performance",
    "reports",
    "dashboard",
    "analytics",
    "queues-list",
    "queue-create",
    "queue-detail",
    "queue-edit",
    "workforce",
):
    SURFACE_TOOLS.setdefault(_surface, set()).update(PROCEDURAL_SKILL_TOOLS)

ROLE_DENIED_TOOLS: dict[str, set[str]] = {
    "admin": set(),
    "agent": {
        "ask_ontology_layer",
        "create_queue",
        "update_queue",
        "update_queue_status",
        "delete_queue",
        "get_monitoring_snapshot",
        "get_agent_attendance",
        "get_not_ready_escalation_insight",
        "get_contact_callback_channels",
        "create_callback_task",
        "force_agent_logout",
        "set_agent_presence",
        "acknowledge_not_ready_escalation",
        "acknowledge_proactive_callback",
        "get_dashboard_analytics_snapshot",
        "get_analytics_hourly_volume",
    },
}


class MCPRegistry:
    def __init__(self) -> None:
        self.servers: dict[str, Any] = {
            "contact": ContactMCPServer(),
            "conversation": ConversationMCPServer(),
            "task": TaskMCPServer(),
            "queue": QueueMCPServer(),
            "analytics": AnalyticsMCPServer(),
            "organization": OrganizationMCPServer(),
            "navigation": NavigationMCPServer(),
            "skill": SkillMCPServer(),
            "metric": MetricMCPServer(),
            "monitoring": MonitoringMCPServer(),
            "preferences": PreferencesMCPServer(),
        }

        self.tool_servers: dict[str, str] = {}
        for server_name, server in self.servers.items():
            for tool_name in server.tool_names:
                if tool_name in self.tool_servers:
                    raise ValueError(f"Duplicate MCP tool name: {tool_name}")
                self.tool_servers[tool_name] = server_name

    def get_server(self, name: str) -> Any:
        return self.servers.get(name)

    def server_for_tool(self, tool_name: str) -> str | None:
        return self.tool_servers.get(tool_name)

    def allowed_tools_for(self, agent_name: str, surface: str) -> set[str]:
        """Tools allowed on the current page plus the agent's home surfaces."""
        tools = set(SURFACE_TOOLS.get(surface) or ())
        for home_surface in AGENT_HOME_SURFACES.get(agent_name, ()):
            tools |= SURFACE_TOOLS.get(home_surface) or set()
        return tools

    def is_agent_home_surface(self, agent_name: str, surface: str) -> bool:
        """True when the user is already on this agent's primary page."""
        return surface in AGENT_HOME_SURFACES.get(agent_name, frozenset())

    def is_authorized(
        self,
        *,
        server_name: str,
        tool_name: str,
        agent_name: str,
        surface: str,
        role: str,
    ) -> bool:
        allowed_servers = AGENT_SERVERS.get(agent_name)
        surface_tools = self.allowed_tools_for(agent_name, surface)
        denied_tools = ROLE_DENIED_TOOLS.get(role)
        return bool(
            allowed_servers is not None
            and server_name in allowed_servers
            and tool_name in surface_tools
            and denied_tools is not None
            and tool_name not in denied_tools
        )

    def authorize(
        self,
        *,
        server_name: str,
        tool_name: str,
        agent_name: str,
        surface: str,
        role: str,
    ) -> None:
        if not self.is_authorized(
            server_name=server_name,
            tool_name=tool_name,
            agent_name=agent_name,
            surface=surface,
            role=role,
        ):
            raise PermissionError(
                f"Tool '{tool_name}' is not allowed for agent '{agent_name}' "
                f"on surface '{surface}' with role '{role}'"
            )


_registry: MCPRegistry | None = None


def get_mcp_registry() -> MCPRegistry:
    global _registry
    if _registry is None:
        _registry = MCPRegistry()
    return _registry
