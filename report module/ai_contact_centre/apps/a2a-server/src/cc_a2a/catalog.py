"""Hub Agent Card catalogue — source of truth for discovery and MAS assignment.

Hub invokes Contact Centre only through typed skillIds on this card. Runtime
always enters L1 `contact_center_super`, which assigns the given skill to the
skill's L2 domain; L2 assigns to the L3 executor; L3 runs the mapped tool.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

RiskLevel = Literal["read", "reversible_write", "high_impact"]
Domain = Literal[
    "omnichannel_engagement_domain",
    "agent_assist_domain",
    "interaction_operations_domain",
    "workforce_management_domain",
    "performance_intelligence_domain",
]
# L3 executor (NLP coworker agent name, or webchat delivery).
Executor = Literal[
    "contact",
    "inbox",
    "queue",
    "analytics",
    "monitoring",
    "webchat",
    "voice",
    "super",
]


@dataclass(frozen=True)
class SkillSpec:
    skill_id: str
    name: str
    description: str
    domain: Domain
    specialist: Executor
    surface: str
    mcp_server: str | None
    mcp_tool: str | None
    scope: str
    risk: RiskLevel
    tags: tuple[str, ...]
    examples: tuple[str, ...]
    required_argument_keys: tuple[str, ...] = ()
    argument_aliases: dict[str, str] = field(default_factory=dict)
    argument_defaults: dict[str, Any] = field(default_factory=dict)
    orchestration: tuple[str, ...] = ()
    published: bool = True
    excluded: bool = False


L1_AGENT = "contact_center_super"

# Explicitly excluded UI / coworker / supervisor capabilities (documented, never published).
EXCLUDED_CAPABILITIES: tuple[str, ...] = (
    "navigate",
    "open_task_workspace",
    "stage_contact_draft",
    "stage_queue_draft",
    "skill/metric administration",
    "conversation send/transfer/close",
    "conversation reply suggest",
    "general task creation",
    "coworker task inbox",
    "organization/knowledge coworker reads",
    "queue create/status/delete",
    "full queue editing",
    "supervisor force logout and presence",
    "generate_plot as a remote business skill",
    "analytics report generate",
)


SKILLS: tuple[SkillSpec, ...] = (
    # --- Contacts (CDP match / sync) ---
    SkillSpec(
        skill_id="cc.contact.list",
        name="List contacts",
        description="Search or list active contacts in the tenant CDP.",
        domain="interaction_operations_domain",
        specialist="contact",
        surface="contacts-list",
        mcp_server="contact",
        mcp_tool="list_contacts",
        scope="cc.contact.read",
        risk="read",
        tags=("contact", "read"),
        examples=("List contacts matching jane@example.com.",),
    ),
    SkillSpec(
        skill_id="cc.contact.read",
        name="Read contact",
        description="Get one contact by id, email, or full name.",
        domain="interaction_operations_domain",
        specialist="contact",
        surface="contacts-detail",
        mcp_server="contact",
        mcp_tool="get_contact",
        scope="cc.contact.read",
        risk="read",
        tags=("contact", "read"),
        examples=("Get contact by id.",),
    ),
    SkillSpec(
        skill_id="cc.contact.create",
        name="Create contact",
        description="Create a contact after Hub policy approval for the write.",
        domain="interaction_operations_domain",
        specialist="contact",
        surface="contacts-list",
        mcp_server="contact",
        mcp_tool="create_contact",
        scope="cc.contact.write",
        risk="reversible_write",
        tags=("contact", "write", "reversible"),
        examples=("Create contact Jane Doe with primaryEmail.",),
        required_argument_keys=("firstName",),
    ),
    SkillSpec(
        skill_id="cc.contact.update",
        name="Update contact",
        description="Update contact profile fields after Hub policy approval.",
        domain="interaction_operations_domain",
        specialist="contact",
        surface="contacts-detail",
        mcp_server="contact",
        mcp_tool="update_contact",
        scope="cc.contact.write",
        risk="reversible_write",
        tags=("contact", "write", "reversible"),
        examples=("Update contact phone number.",),
        required_argument_keys=("contactId",),
    ),
    SkillSpec(
        skill_id="cc.contact.status.update",
        name="Update contact status",
        description="Activate or deactivate a contact via isActive.",
        domain="interaction_operations_domain",
        specialist="contact",
        surface="contacts-detail",
        mcp_server="contact",
        mcp_tool="update_contact",
        scope="cc.contact.write",
        risk="reversible_write",
        tags=("contact", "write", "reversible", "status"),
        examples=("Deactivate contact 123.",),
        required_argument_keys=("contactId", "isActive"),
    ),
    SkillSpec(
        skill_id="cc.contact.enrich",
        name="Enrich contact",
        description="Enrich the contact linked to a conversation from stated profile fields.",
        domain="interaction_operations_domain",
        specialist="contact",
        surface="inbox",
        mcp_server="contact",
        mcp_tool="contact_enrich",
        scope="cc.contact.write",
        risk="reversible_write",
        tags=("contact", "write", "enrich"),
        examples=("Enrich conversation contact with email from customer message.",),
    ),
    # --- Live conversation (journey) ---
    SkillSpec(
        skill_id="cc.conversation.context.read",
        name="Read conversation context",
        description="Read bounded context for a selected conversation.",
        domain="agent_assist_domain",
        specialist="inbox",
        surface="inbox",
        mcp_server="conversation",
        mcp_tool="get_conversation_context",
        scope="cc.conversation.read",
        risk="read",
        tags=("inbox", "read", "conversation"),
        examples=("Read context for conversationId.",),
        required_argument_keys=("conversationId",),
    ),
    # --- Workforce / queues ---
    SkillSpec(
        skill_id="cc.queue.list",
        name="List queues",
        description="List queues with team, status, and assigned-agent count.",
        domain="workforce_management_domain",
        specialist="queue",
        surface="queues-list",
        mcp_server="queue",
        mcp_tool="list_queues",
        scope="cc.queue.read",
        risk="read",
        tags=("queue", "read"),
        examples=("List all queues.",),
    ),
    SkillSpec(
        skill_id="cc.queue.agent-eligibility.read",
        name="Read queue agent eligibility",
        description="List unassigned agents eligible for a queue, including people on another queue who can be moved.",
        domain="workforce_management_domain",
        specialist="queue",
        surface="workforce",
        mcp_server="queue",
        mcp_tool="list_eligible_agents",
        scope="cc.queue.read",
        risk="read",
        tags=("queue", "read", "agent"),
        examples=("List agents eligible for Sales queue.",),
    ),
    SkillSpec(
        skill_id="cc.agent.presence.read",
        name="Read agent presence",
        description="List current workforce presence.",
        domain="workforce_management_domain",
        specialist="queue",
        surface="workforce",
        mcp_server="queue",
        mcp_tool="list_presence",
        scope="cc.queue.read",
        risk="read",
        tags=("queue", "read", "presence"),
        examples=("Show current agent presence.",),
    ),
    SkillSpec(
        skill_id="cc.queue.agent.add",
        name="Add queue agent",
        description=(
            "Assign one or more people to an existing queue after Hub policy approval. "
            "Call cc.queue.agent-eligibility.read first for people who are not already assigned. "
            "Does not create queues or change queue settings."
        ),
        domain="workforce_management_domain",
        specialist="queue",
        surface="queue-detail",
        mcp_server="queue",
        mcp_tool="update_queue",
        scope="cc.queue.write",
        risk="reversible_write",
        tags=("queue", "write", "reversible", "staffing"),
        examples=("Add Jane Doe to the Support queue.",),
        required_argument_keys=("queueName", "addAgents"),
    ),
    SkillSpec(
        skill_id="cc.queue.agent.remove",
        name="Remove queue agent",
        description=(
            "Unassign one or more people from an existing queue after Hub policy approval. "
            "Does not delete the queue."
        ),
        domain="workforce_management_domain",
        specialist="queue",
        surface="queue-detail",
        mcp_server="queue",
        mcp_tool="update_queue",
        scope="cc.queue.write",
        risk="reversible_write",
        tags=("queue", "write", "reversible", "staffing"),
        examples=("Remove Jane Doe from the Support queue.",),
        required_argument_keys=("queueName",),
    ),
    # --- Callbacks (campaign / journey follow-up) ---
    SkillSpec(
        skill_id="cc.monitoring.callback-channels.read",
        name="Read callback channels",
        description="List callback channels available for a contact.",
        domain="workforce_management_domain",
        specialist="monitoring",
        surface="monitoring",
        mcp_server="monitoring",
        mcp_tool="get_contact_callback_channels",
        scope="cc.monitoring.read",
        risk="read",
        tags=("monitoring", "read", "callback"),
        examples=("List callback channels for contact.",),
        required_argument_keys=("contactId",),
    ),
    SkillSpec(
        skill_id="cc.callback.create",
        name="Create callback task",
        description="Assign a callback task to an agent for a contact or conversation.",
        domain="workforce_management_domain",
        specialist="monitoring",
        surface="monitoring",
        mcp_server="monitoring",
        mcp_tool="create_callback_task",
        scope="cc.callback.write",
        risk="reversible_write",
        tags=("monitoring", "write", "callback", "reversible"),
        examples=("Create callback for contact on voice channel.",),
        required_argument_keys=("assignedUserId",),
    ),
    # --- Performance ---
    SkillSpec(
        skill_id="cc.analytics.query",
        name="Query analytics",
        description="Ask the semantic metrics layer a business analytics question.",
        domain="performance_intelligence_domain",
        specialist="analytics",
        surface="performance",
        mcp_server="analytics",
        mcp_tool="ask_semantic_layer",
        scope="cc.analytics.read",
        risk="read",
        tags=("analytics", "read"),
        examples=("What is today's contact volume?",),
        required_argument_keys=("question",),
        argument_aliases={"question": "query"},
    ),
    SkillSpec(
        skill_id="cc.analytics.root-cause.analyze",
        name="Analyze analytics root cause",
        description="Internal step of cc.anomaly.investigate. Not published on the Agent Card.",
        domain="performance_intelligence_domain",
        specialist="analytics",
        surface="dashboard",
        mcp_server="analytics",
        mcp_tool="ask_ontology_layer",
        scope="cc.analytics.read",
        risk="read",
        tags=("analytics", "read", "ontology", "internal"),
        examples=("Why did missed contacts rise yesterday?",),
        required_argument_keys=("question",),
        argument_aliases={"question": "query"},
        published=False,
    ),
    SkillSpec(
        skill_id="cc.monitoring.snapshot.read",
        name="Read monitoring snapshot",
        description="Internal step of cc.anomaly.investigate. Not published on the Agent Card.",
        domain="workforce_management_domain",
        specialist="monitoring",
        surface="monitoring",
        mcp_server="monitoring",
        mcp_tool="get_monitoring_snapshot",
        scope="cc.monitoring.read",
        risk="read",
        tags=("monitoring", "read", "internal"),
        examples=("Get live monitoring snapshot.",),
        published=False,
    ),
    # --- Webchat delivery ---
    SkillSpec(
        skill_id="cc.webchat.proactive-engagement.trigger",
        name="Trigger proactive webchat engagement",
        description=(
            "Deliver a proactive popup/welcome to an online webchat visitor via the "
            "existing Chat Service WebSocket trigger. Does not invoke the Support Bot LLM. "
            "When webchatId is omitted, uses the organization's first active webchat widget."
        ),
        domain="omnichannel_engagement_domain",
        specialist="webchat",
        surface="webchat",
        mcp_server=None,
        mcp_tool=None,
        scope="cc.webchat.engagement.write",
        risk="reversible_write",
        tags=("webchat", "write", "engagement"),
        examples=("Popup welcome for visitor on pricing page.",),
        required_argument_keys=("visitorId",),
    ),
    SkillSpec(
        skill_id="cc.voice.auto-bot-call.trigger",
        name="Trigger voice bot call",
        description=(
            "Start an outbound voice-bot call for a customer number. Contact Centre "
            "publishes the call on the campaign channel. Hub does not choose the CLI, "
            "SIP domain, or Redis channel."
        ),
        domain="omnichannel_engagement_domain",
        specialist="voice",
        surface="voice",
        mcp_server=None,
        mcp_tool=None,
        scope="cc.voice.auto-bot.write",
        risk="reversible_write",
        tags=("voice", "write", "engagement"),
        examples=("Call the customer and confirm the recent order.",),
        required_argument_keys=("number",),
    ),
    # --- L1 composite (published); inner tools stay unpublished ---
    SkillSpec(
        skill_id="cc.anomaly.investigate",
        name="Investigate anomaly",
        description=(
            "Bounded composite read across analytics then monitoring. Returns evidence "
            "only; never performs implicit mutations."
        ),
        domain="performance_intelligence_domain",
        specialist="super",
        surface="dashboard",
        mcp_server=None,
        mcp_tool=None,
        scope="cc.analytics.read",
        risk="read",
        tags=("super", "read", "composite", "analytics", "monitoring"),
        examples=("Investigate spike in missed contacts.",),
        required_argument_keys=("question",),
        argument_aliases={"question": "query"},
        orchestration=(
            "cc.analytics.root-cause.analyze",
            "cc.monitoring.snapshot.read",
        ),
    ),
)


_BY_ID: dict[str, SkillSpec] = {skill.skill_id: skill for skill in SKILLS}


def get_skill(skill_id: str) -> SkillSpec | None:
    return _BY_ID.get(skill_id)


def list_skills() -> tuple[SkillSpec, ...]:
    """Skills published on the Agent Card (Hub-invokable)."""
    return tuple(skill for skill in SKILLS if skill.published)


def list_all_skills() -> tuple[SkillSpec, ...]:
    return SKILLS


def skill_ids() -> frozenset[str]:
    return frozenset(skill.skill_id for skill in list_skills())


def scopes_for_skills() -> frozenset[str]:
    return frozenset(skill.scope for skill in list_skills())
