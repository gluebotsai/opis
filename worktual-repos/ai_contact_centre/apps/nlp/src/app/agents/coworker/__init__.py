"""Co-worker agent package and router factory."""

from collections.abc import Callable
from typing import Any

from app.agents.coworker.analytics import AnalyticsAgent
from app.agents.coworker.contact import ContactAgent
from app.agents.coworker.conversation_assist import ConversationAssistAgent
from app.agents.coworker.general import GeneralAgent
from app.agents.coworker.inbox import InboxAgent
from app.agents.coworker.monitoring import MonitoringAgent
from app.agents.coworker.queue import QueueAgent
from app.agents.coworker.task import TaskAgent
from app.agents.definitions import (
    AGENT_ASSIST_DOMAIN_DEFINITION,
    CONTACT_CENTER_SUPER_DEFINITION,
    COWORKER_TASK_ASSIST_DEFINITION,
    INTERACTION_OPERATIONS_DOMAIN_DEFINITION,
    PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION,
    WORKFORCE_MANAGEMENT_DOMAIN_DEFINITION,
)
from app.llm.assist_client import get_assist_llm_client
from app.runtime.agent import Agent
from app.runtime.memory import SessionMemory
from app.runtime.router import AgentRouter


def create_coworker_agent(
    surface: str = "general",
    user_role: str = "admin",
    organization_id: str | None = None,
    *,
    tool_context: Any = None,
    get_tool_context: Callable[[], Any] | None = None,
    memory: SessionMemory | None = None,
    llm: Any = None,
    assist_llm: Any = None,
) -> AgentRouter:
    """Build the explicit co-worker router.

    Context arguments remain accepted so existing callers can migrate without an
    import or signature change; trusted context is supplied to ``route_and_run``.
    """
    del surface, user_role, organization_id, tool_context, get_tool_context
    kwargs = {"llm": llm} if llm is not None else {}
    draft_llm = assist_llm if assist_llm is not None else llm
    if draft_llm is None:
        draft_llm = get_assist_llm_client()
    agents = {
        "general": GeneralAgent(**kwargs),
        "contact": ContactAgent(**kwargs),
        "inbox": InboxAgent(**kwargs),
        "task": TaskAgent(**kwargs),
        "queue": QueueAgent(**kwargs),
        "analytics": AnalyticsAgent(**kwargs),
        "monitoring": MonitoringAgent(**kwargs),
        "conversation_assist": ConversationAssistAgent(llm=draft_llm),
        "coworker_task_assist": Agent(COWORKER_TASK_ASSIST_DEFINITION, **kwargs),
        "contact_center_super": Agent(CONTACT_CENTER_SUPER_DEFINITION, **kwargs),
        "agent_assist_domain": Agent(AGENT_ASSIST_DOMAIN_DEFINITION, **kwargs),
        "interaction_operations_domain": Agent(
            INTERACTION_OPERATIONS_DOMAIN_DEFINITION,
            **kwargs,
        ),
        "workforce_management_domain": Agent(
            WORKFORCE_MANAGEMENT_DOMAIN_DEFINITION,
            **kwargs,
        ),
        "performance_intelligence_domain": Agent(
            PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION,
            **kwargs,
        ),
    }
    return AgentRouter(agents, memory=memory)


__all__ = [
    "AnalyticsAgent",
    "ContactAgent",
    "ConversationAssistAgent",
    "GeneralAgent",
    "InboxAgent",
    "MonitoringAgent",
    "QueueAgent",
    "TaskAgent",
    "create_coworker_agent",
]
