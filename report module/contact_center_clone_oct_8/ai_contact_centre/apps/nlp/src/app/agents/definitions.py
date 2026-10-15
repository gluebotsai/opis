"""Declarative agent definitions specifying MCP servers, skills, and metric domains."""

from app.agents.prompt_loader import load_agent_document
from app.config import get_settings
from app.prompts import (
    ANALYTICS_AGENT_PROMPT,
    CONTACT_AGENT_PROMPT,
    CONTACT_ENTITY_PROMPT,
    CONTACT_IDENTITY_PROMPT,
    INBOX_AGENT_PROMPT,
    MONITORING_AGENT_PROMPT,
    QUEUE_AGENT_PROMPT,
    SUPPORT_BOT_SYSTEM_PROMPT,
    TASK_AGENT_PROMPT,
)
from app.prompts.coworker import COWORKER_SYSTEM_PROMPT, build_routing_instruction
from app.prompts.proactive import PROACTIVE_CALLBACK_PROMPT
from app.runtime.agent import AgentDefinition

HANDOFFS = {
    "general": "Navigation, organization questions, and requests outside a specialist domain.",
    "contact": (
        "Contact-directory search, created-period counts, identity, creation, and updates. "
        "Not conversation volume or channel mix."
    ),
    "inbox": "Conversation context, summaries, and suggested replies.",
    "task": "Task search and task updates.",
    "queue": "Queue setup, workforce eligibility, and presence.",
    "analytics": (
        "Conversation and performance KPIs, reports, plots, channel mix, SLA, "
        "Analytics incidents, missed-contact rate, forecasts, and peak hour. "
        "Not contact-directory created counts."
    ),
    "monitoring": "Live queue, agent, waiting, missed, callback, and SLA monitoring.",
}
ROUTING_PROMPT = build_routing_instruction(HANDOFFS)


def _agent_definition(
    name: str,
    fallback_prompt: str,
    *,
    layer: str = "executor",
    handoff_instruction: str | None = None,
    handoff_targets: tuple[str, ...] = (),
    mcp_servers: tuple[str, ...] = (),
    allowed_skills: tuple[str, ...] = (),
    required_skills: tuple[str, ...] = (),
    metric_domains: tuple[str, ...] = (),
    allowed_surfaces: tuple[str, ...] = (),
    max_tool_rounds: int = 6,
) -> AgentDefinition:
    document = load_agent_document(
        name,
        fallback_prompt=fallback_prompt,
        fallback_mcp_servers=mcp_servers,
        fallback_handoff_targets=handoff_targets,
        fallback_allowed_skills=allowed_skills,
        fallback_required_skills=required_skills,
    )
    use_markdown_prompt = (
        get_settings().agent_markdown_prompts_enabled
        or layer in {"super", "domain"}
        or name in {"conversation_assist", "coworker_task_assist", "queue", "contact", "analytics"}
    )
    return AgentDefinition(
        name=name,
        system_prompt=document.prompt if use_markdown_prompt else fallback_prompt,
        prompt_version=document.version if use_markdown_prompt else "legacy",
        handoff_instruction=handoff_instruction,
        layer=layer,
        handoff_targets=document.handoff_targets,
        mcp_servers=document.mcp_servers,
        allowed_skills=document.allowed_skills,
        required_skills=document.required_skills,
        metric_domains=metric_domains,
        allowed_surfaces=allowed_surfaces,
        max_tool_rounds=max_tool_rounds,
    )

SUPPORT_BOT_DEFINITION = _agent_definition(
    "support_bot",
    (
        SUPPORT_BOT_SYSTEM_PROMPT
        + "\n"
        + CONTACT_ENTITY_PROMPT
        + "\n"
        + CONTACT_IDENTITY_PROMPT
    ),
    mcp_servers=("organization", "contact", "skill"),
    allowed_skills=("contact-entity-extraction", "contact-identity-resolution"),
    required_skills=("contact-entity-extraction", "contact-identity-resolution"),
    allowed_surfaces=("webchat", "whatsapp", "instagram", "facebook", "social", "email"),
)

GENERAL_AGENT_DEFINITION = _agent_definition(
    "general",
    COWORKER_SYSTEM_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["general"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("navigation", "organization"),
    allowed_surfaces=("general", "dashboard", "other"),
)

CONTACT_AGENT_DEFINITION = _agent_definition(
    "contact",
    COWORKER_SYSTEM_PROMPT + "\n" + CONTACT_AGENT_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["contact"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("contact", "skill", "preferences"),
    allowed_skills=(
        "contact-identity-resolution",
        "contact-search",
        "contact-create",
        "contact-update",
        "contact-deactivate",
    ),
    required_skills=(),
    allowed_surfaces=("contacts-list", "contacts-detail"),
)

INBOX_AGENT_DEFINITION = _agent_definition(
    "inbox",
    COWORKER_SYSTEM_PROMPT + "\n" + INBOX_AGENT_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["inbox"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("conversation", "contact", "organization", "skill"),
    allowed_skills=("contact-entity-extraction", "contact-identity-resolution"),
    required_skills=("contact-entity-extraction", "contact-identity-resolution"),
    allowed_surfaces=("inbox",),
)

TASK_AGENT_DEFINITION = _agent_definition(
    "task",
    COWORKER_SYSTEM_PROMPT + "\n" + TASK_AGENT_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["task"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("task", "navigation", "preferences"),
    allowed_surfaces=("tasks-list", "tasks-detail"),
)

QUEUE_AGENT_DEFINITION = _agent_definition(
    "queue",
    COWORKER_SYSTEM_PROMPT + "\n" + QUEUE_AGENT_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["queue"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("queue", "skill", "preferences"),
    allowed_skills=("queue-create", "queue-update", "queue-staff", "queue-delete"),
    required_skills=(),
    metric_domains=("workforce",),
    allowed_surfaces=("queues-list", "queue-create", "queue-detail", "queue-edit", "workforce"),
)

ANALYTICS_AGENT_DEFINITION = _agent_definition(
    "analytics",
    COWORKER_SYSTEM_PROMPT + "\n" + ANALYTICS_AGENT_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["analytics"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("analytics", "skill", "metric"),
    allowed_skills=("performance-analytics", "dashboard-analytics"),
    required_skills=(),
    metric_domains=("performance",),
    allowed_surfaces=("performance", "reports", "dashboard", "analytics"),
)

MONITORING_AGENT_DEFINITION = _agent_definition(
    "monitoring",
    COWORKER_SYSTEM_PROMPT + "\n" + MONITORING_AGENT_PROMPT + ROUTING_PROMPT,
    handoff_instruction=HANDOFFS["monitoring"],
    handoff_targets=("contact_center_super",),
    mcp_servers=("monitoring", "contact", "navigation", "preferences"),
    allowed_surfaces=("monitoring",),
)

PROACTIVE_AGENT_DEFINITION = _agent_definition(
    "proactive",
    PROACTIVE_CALLBACK_PROMPT,
    mcp_servers=(),
    allowed_surfaces=(),
)

CONTACT_CENTER_SUPER_DEFINITION = _agent_definition(
    "contact_center_super",
    """You are the L1 Contact Center Super Agent for human co-worker chat.
Choose exactly one domain by calling route_to_agent. Do not answer the user and do not call
business tools. Use the complete request and trusted surface only as context.
Domains: agent_assist_domain for conversation help and inbox assistance;
interaction_operations_domain for navigation, contacts, and tasks;
workforce_management_domain for queues, staffing, presence, and monitoring;
performance_intelligence_domain for metrics, reports, charts, and analysis.""",
    layer="super",
    handoff_instruction="Route human co-worker requests to one Contact Center domain.",
    handoff_targets=(
        "agent_assist_domain",
        "interaction_operations_domain",
        "workforce_management_domain",
        "performance_intelligence_domain",
    ),
    max_tool_rounds=1,
)

AGENT_ASSIST_DOMAIN_DEFINITION = _agent_definition(
    "agent_assist_domain",
    """You are the L2 Agent Assist Domain Agent.
Call route_to_agent exactly once. Use coworker_task_assist for action proposals based on the
active customer conversation, inbox for suggested replies/conversation context, contact for
contact search or profile operations, and general for organization/navigation help.
Do not answer the user and do not call business tools.""",
    layer="domain",
    handoff_instruction="Choose one Agent Assist executor.",
    handoff_targets=("coworker_task_assist", "general", "contact", "inbox"),
    max_tool_rounds=1,
)

INTERACTION_OPERATIONS_DOMAIN_DEFINITION = _agent_definition(
    "interaction_operations_domain",
    """You are the L2 Interaction Operations Domain Agent.
Route task and follow-up work to the task executor by calling route_to_agent exactly once.
Do not answer the user and do not call business tools.""",
    layer="domain",
    handoff_instruction="Choose an Interaction Operations executor.",
    handoff_targets=("task",),
    max_tool_rounds=1,
)

WORKFORCE_MANAGEMENT_DOMAIN_DEFINITION = _agent_definition(
    "workforce_management_domain",
    """You are the L2 Workforce Management Domain Agent.
Route queue, team, staffing, and queue configuration work to queue. Route live presence,
attendance, waiting contacts, callbacks, alerts, and SLA monitoring to monitoring.
Call route_to_agent exactly once. Do not answer the user and do not call business tools.""",
    layer="domain",
    handoff_instruction="Choose a Workforce Management executor.",
    handoff_targets=("queue", "monitoring"),
    max_tool_rounds=1,
)

PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION = _agent_definition(
    "performance_intelligence_domain",
    """You are the L2 Performance Intelligence Domain Agent.
Route KPI, metric, report, chart, trend, and causal performance questions to analytics by
calling route_to_agent exactly once. Do not answer the user and do not call business tools.""",
    layer="domain",
    handoff_instruction="Choose a Performance Intelligence executor.",
    handoff_targets=("analytics",),
    max_tool_rounds=1,
)

CONVERSATION_ASSIST_DEFINITION = _agent_definition(
    "conversation_assist",
    """You are the passive suggest-reply executor. Load conversation context first.
Call get_organization_knowledge only for product, policy, FAQ, or company questions.
Extract entities only when the customer stated a new identity field. Return JSON with
replyDraft, privateNotes, actionProposal (null), revision, and sourceMessageId.
Never send the reply or invent knowledge.""",
    layer="executor",
    mcp_servers=("conversation", "organization", "contact", "skill"),
    allowed_skills=("contact-entity-extraction",),
    required_skills=(),
    allowed_surfaces=("inbox",),
    max_tool_rounds=6,
)

COWORKER_TASK_ASSIST_DEFINITION = _agent_definition(
    "coworker_task_assist",
    COWORKER_SYSTEM_PROMPT
    + """
You are the L3 Coworker Task Assist executor for a human support agent.
Read the active conversation context and shared working notes. Explain available and missing
information, propose the next action, and execute only explicitly approved actions through
authorized MCP tools. Never infer success and never send a customer message.""",
    layer="executor",
    handoff_instruction="Return unrelated work to the Contact Center Super Agent.",
    handoff_targets=("contact_center_super",),
    mcp_servers=(
        "conversation",
        "contact",
        "task",
        "navigation",
        "organization",
        "skill",
        "preferences",
    ),
    allowed_skills=(
        "contact-entity-extraction",
        "contact-identity-resolution",
        "contact-search",
        "contact-create",
        "contact-update",
        "contact-deactivate",
    ),
    required_skills=("contact-entity-extraction", "contact-identity-resolution"),
    allowed_surfaces=("inbox", "general", "other"),
)

ALL_AGENT_DEFINITIONS = (
    SUPPORT_BOT_DEFINITION,
    GENERAL_AGENT_DEFINITION,
    CONTACT_AGENT_DEFINITION,
    INBOX_AGENT_DEFINITION,
    TASK_AGENT_DEFINITION,
    QUEUE_AGENT_DEFINITION,
    ANALYTICS_AGENT_DEFINITION,
    MONITORING_AGENT_DEFINITION,
    CONTACT_CENTER_SUPER_DEFINITION,
    AGENT_ASSIST_DOMAIN_DEFINITION,
    INTERACTION_OPERATIONS_DOMAIN_DEFINITION,
    WORKFORCE_MANAGEMENT_DOMAIN_DEFINITION,
    PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION,
    CONVERSATION_ASSIST_DEFINITION,
    COWORKER_TASK_ASSIST_DEFINITION,
)


def validate_agent_dependencies(
    *,
    available_skills: set[str] | None = None,
    available_metric_domains: set[str] | None = None,
    raise_on_error: bool = False,
) -> list[str]:
    """Validate every declared server, skill, and metric dependency."""
    errors = []
    for definition in ALL_AGENT_DEFINITIONS:
        errors.extend(
            definition.validate_dependencies(
                available_skills=available_skills,
                available_metric_domains=available_metric_domains,
            )
        )
    if errors and raise_on_error:
        raise RuntimeError("Invalid agent dependencies:\n" + "\n".join(errors))
    return errors
