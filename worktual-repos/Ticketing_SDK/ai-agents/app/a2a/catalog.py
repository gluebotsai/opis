"""Hub-facing skill catalog — granular tk.* skills for Agent Card + dispatch."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from app.proactive.registry_agents import AGENTS

SkillKind = Literal["coworker", "proactive", "super"]

# Sentinel: tk.proactive.run — Hub passes eventType / agentId in instruction.
PROACTIVE_HUB_EVENT_AGENT = "__hub_event__"

# Legacy coworker specialist ids (dispatch only — not on agent card).
COWORKER_SKILLS: dict[str, str] = {
    "tickets": "Create, update, escalate, and list support tickets",
    "customers": "Customer directory CRUD and 360 views",
    "teams": "Agent queues and team membership",
    "kb": "Knowledge base articles and categories",
    "macros": "Canned reply macros",
    "admin": "Priorities, statuses, analytics, and org preferences",
    "general": "Cross-module ticketing assistant and navigation",
}

PROACTIVE_DESCRIPTIONS: dict[str, str] = {
    "tcaa": "Ticket creation and capture from inbound messages",
    "icpa": "Classify and prioritize new tickets",
    "itra": "Intelligent ticket routing and assignment",
    "dssa": "Deflect support requests with KB self-service",
    "tsaa": "Ticket summarization and AI summary updates",
    "sema": "Sentiment monitoring on ticket activity",
    "rkaa": "Related knowledge article recommendations",
    "crda": "Customer risk and churn detection alerts",
    "ara": "Agent response assistance on open tickets",
    "wloa": "Workload optimization and queue balancing",
    "tiaa": "Ticket insights and analytics assistance",
    "stda": "SLA threat detection and breach prevention",
    "pna": "Proactive staff notifications",
    "rcaa": "Routing weight learning from outcomes",
}

SUPER_AGENT_SKILL = {
    "id": "super-agent",
    "description": "Full multi-agent supervisor — routes to any ticketing specialist or proactive agent",
}

# Minimal Hub discovery set (Option 1) — one skill per domain + proactive + super.
TK_CAPABILITY_SKILLS: dict[str, str] = {
    "tk.ticket.manage": "Tickets — create, list, update, escalate, triage, and metrics",
    "tk.customer.manage": "Customers — directory search, 360, add, and import",
    "tk.team.manage": "Teams and queues — create, update, roster, and list",
    "tk.kb.manage": "Knowledge base — articles, categories, and search",
    "tk.macro.manage": "Macros — canned replies create, update, and list",
    "tk.admin.manage": "Admin — priorities, statuses, analytics, CSAT, and audit",
    "tk.proactive.run": "Run proactive agents — pass eventType and payload in instruction",
    "tk.super-agent.route": "Route instruction to the best ticketing specialist",
}

# Primary tk.* domain skills → internal coworker specialist.
_TK_COWORKER: dict[str, str] = {
    "tk.ticket.manage": "tickets",
    "tk.customer.manage": "customers",
    "tk.team.manage": "teams",
    "tk.kb.manage": "kb",
    "tk.macro.manage": "macros",
    "tk.admin.manage": "admin",
    # Backward-compatible granular ids (dispatch only — not advertised on agent card).
    "tk.ticket.create": "tickets",
    "tk.ticket.read": "tickets",
    "tk.ticket.list": "tickets",
    "tk.ticket.update": "tickets",
    "tk.ticket.escalate": "tickets",
    "tk.ticket.note.add": "tickets",
    "tk.ticket.enrich": "tickets",
    "tk.ticket.customer.verify": "tickets",
    "tk.ticket.assign.auto": "tickets",
    "tk.ticket.assign.resolve": "tickets",
    "tk.ticket.metrics.read": "tickets",
    "tk.ticket.progress.read": "tickets",
    "tk.customer.create": "customers",
    "tk.customer.read": "customers",
    "tk.customer.list": "customers",
    "tk.customer.import": "customers",
    "tk.team.create": "teams",
    "tk.team.update": "teams",
    "tk.team.list": "teams",
    "tk.staff.list": "teams",
    "tk.team.members.add": "teams",
    "tk.kb.article.create": "kb",
    "tk.kb.article.update": "kb",
    "tk.kb.search": "kb",
    "tk.kb.category.manage": "kb",
    "tk.macro.create": "macros",
    "tk.macro.update": "macros",
    "tk.macro.list": "macros",
    "tk.catalog.priority.create": "admin",
    "tk.catalog.priority.update": "admin",
    "tk.catalog.status.create": "admin",
    "tk.catalog.status.update": "admin",
    "tk.analytics.query": "admin",
    "tk.analytics.root-cause.analyze": "admin",
    "tk.csat.report.read": "admin",
    "tk.audit.list": "admin",
    "tk.escalation.directory.read": "admin",
    "tk.navigate": "general",
}

# Backward-compatible granular proactive ids (dispatch only).
_TK_PROACTIVE: dict[str, tuple[str, str]] = {
    "tk.proactive.inbound.deflect": ("dssa", "inbound.message"),
    "tk.proactive.inbound.capture": ("tcaa", "inbound.message"),
    "tk.proactive.ticket.classify": ("icpa", "ticket.created"),
    "tk.proactive.ticket.route": ("itra", "ticket.created"),
    "tk.proactive.ticket.summarize": ("tsaa", "on_demand.summary"),
    "tk.proactive.ticket.similar-detect": ("stda", "ticket.created"),
    "tk.proactive.kb.recommend": ("rkaa", "on_demand.knowledge"),
    "tk.proactive.reply.draft": ("crda", "on_demand.draft"),
    "tk.proactive.ticket.close-assist": ("ara", "on_demand.ara"),
    "tk.proactive.sla.monitor": ("sema", "ticket.sla_at_risk"),
    "tk.proactive.notify.staff": ("pna", "ticket.updated"),
    "tk.proactive.workload.optimize": ("wloa", "schedule.wloa"),
    "tk.proactive.insights.analyze": ("tiaa", "on_demand.insights"),
    "tk.proactive.routing.learn": ("rcaa", "schedule.rcaa"),
}
_TK_TASK_BINDINGS: dict[str, str] = {
    "tk.ticket.create": "ticket.create",
    "tk.ticket.read": "ticket.read.search",
    "tk.ticket.list": "ticket.read.search",
    "tk.ticket.update": "ticket.update",
    "tk.ticket.escalate": "ticket.escalate",
    "tk.ticket.note.add": "ticket.note.add",
    "tk.ticket.enrich": "ticket.enrich",
    "tk.ticket.customer.verify": "customer.verify",
    "tk.ticket.assign.auto": "ticket.assign.best",
    "tk.ticket.assign.resolve": "ticket.reassign",
    "tk.ticket.metrics.read": "dashboard.metrics.read",
    "tk.ticket.progress.read": "ticket.read.search",
    "tk.customer.create": "customer.create",
    "tk.customer.read": "customer.read.360",
    "tk.customer.list": "customer.read.360",
    "tk.customer.import": "customer.import",
    "tk.team.create": "team.create",
    "tk.team.update": "team.update",
    "tk.team.list": "team.read",
    "tk.staff.list": "team.read",
    "tk.team.members.add": "team.members.update",
    "tk.kb.article.create": "knowledge.article.create",
    "tk.kb.article.update": "knowledge.article.update",
    "tk.kb.search": "knowledge.read",
    "tk.kb.category.manage": "knowledge.category.manage",
    "tk.macro.create": "macro.create",
    "tk.macro.update": "macro.update",
    "tk.macro.list": "macro.read",
    "tk.catalog.priority.create": "priority.create",
    "tk.catalog.priority.update": "priority.update",
    "tk.catalog.status.create": "status.create",
    "tk.catalog.status.update": "status.update",
    "tk.analytics.query": "analytics.query",
    "tk.analytics.root-cause.analyze": "analytics.root.cause",
    "tk.csat.report.read": "csat.report",
    "tk.audit.list": "audit.query",
    "tk.escalation.directory.read": "escalation.directory.read",
}


@dataclass(frozen=True)
class HubSkillTarget:
    kind: SkillKind
    agent_id: str
    module: str | None = None
    default_event_type: str | None = None
    advertised_id: str = ""
    task_id: str | None = None
    task_version: str | None = None
    domain: str | None = None
    executor: str | None = None
    skill_name: str | None = None
    skill_version: str | None = None


def _norm(skill_id: str) -> str:
    return (skill_id or "").strip().lower()


def _binding_versions(binding: dict[str, str]) -> tuple[str | None, str | None]:
    from app.skills.catalog import load_skill_definition
    from app.workflow_schemas import task_definition_for

    task = task_definition_for(binding.get("task_id", ""))
    skill_name = binding.get("skill_name", "")
    skill = load_skill_definition(skill_name) if skill_name else None
    return (
        task.version if task and task.active else None,
        skill.version if skill and skill.active else None,
    )


def resolve_hub_skill(skill_id: str) -> HubSkillTarget | None:
    """Map Hub skillId (tk.* or legacy agent id) → coworker / proactive / super target."""
    sid = _norm(skill_id)
    if not sid:
        return None
    if sid in ("super-agent", "tk.super-agent.route"):
        return HubSkillTarget(
            kind="super",
            agent_id="ticketing_coworker",
            advertised_id=sid,
        )
    if sid == "tk.proactive.run":
        return HubSkillTarget(
            kind="proactive",
            agent_id=PROACTIVE_HUB_EVENT_AGENT,
            advertised_id=sid,
        )
    if sid in _TK_TASK_BINDINGS:
        from app.workflow_schemas import task_definition_for

        task = task_definition_for(_TK_TASK_BINDINGS[sid])
        if not task or not task.active:
            return None
        return HubSkillTarget(
            kind="coworker",
            agent_id=task.executor,
            module=_TK_COWORKER.get(sid),
            advertised_id=sid,
            task_id=task.id,
            task_version=task.version,
            domain=task.domain,
            executor=task.executor,
            skill_name=task.skill_name,
            skill_version=task.version,
        )
    if sid in _TK_COWORKER:
        agent = _TK_COWORKER[sid]
        if sid.endswith(".manage"):
            return HubSkillTarget(
                kind="super",
                agent_id="ticketing_coworker",
                module=agent,
                advertised_id=sid,
            )
        return HubSkillTarget(
            kind="coworker",
            agent_id=agent,
            module=agent,
            advertised_id=sid,
        )
    if sid in _TK_PROACTIVE:
        agent, event = _TK_PROACTIVE[sid]
        from app.proactive.registry_agents import harness_binding_for

        binding = harness_binding_for(agent) or {}
        task_version, skill_version_value = _binding_versions(binding)
        return HubSkillTarget(
            kind="proactive",
            agent_id=agent,
            default_event_type=event,
            advertised_id=sid,
            task_id=binding.get("task_id"),
            task_version=task_version,
            domain=binding.get("domain"),
            executor=binding.get("executor"),
            skill_name=binding.get("skill_name"),
            skill_version=skill_version_value,
        )
    if sid in COWORKER_SKILLS:
        return HubSkillTarget(
            kind="coworker",
            agent_id=sid,
            module=sid,
            advertised_id=sid,
        )
    if sid in AGENTS:
        from app.proactive.registry_agents import harness_binding_for

        binding = harness_binding_for(sid) or {}
        task_version, skill_version_value = _binding_versions(binding)
        return HubSkillTarget(
            kind="proactive",
            agent_id=sid,
            default_event_type=f"hub.{sid}",
            advertised_id=sid,
            task_id=binding.get("task_id"),
            task_version=task_version,
            domain=binding.get("domain"),
            executor=binding.get("executor"),
            skill_name=binding.get("skill_name"),
            skill_version=skill_version_value,
        )
    return None


@dataclass(frozen=True)
class SkillSpec:
    """Published Agent Card skill (Hub discovery + typed contracts)."""

    id: str
    name: str
    description: str
    tags: tuple[str, ...]
    examples: tuple[str, ...]
    risk: Literal["read", "reversible_write", "high_impact"]
    scope: str
    required_argument_keys: tuple[str, ...] = ()
    specialist: str = ""
    surface: str = "staff"
    mcp_server: str | None = "ticketing"
    mcp_tool: str | None = None
    orchestration: tuple[str, ...] = ()


# UI / local-only — never on Agent Card skills[].
EXCLUDED_CAPABILITIES: tuple[str, ...] = (
    "navigate",
    "patch_ticket_draft",
    "patch_team_draft",
    "patch_kb_draft",
    "patch_macro_draft",
    "patch_customer_draft",
    "patch_priority_draft",
    "patch_status_draft",
    "confirm chips",
    "tk.navigate",
)

_RISK_WRITE = "reversible_write"
_RISK_READ = "read"
_RISK_HIGH = "high_impact"


def _spec(
    skill_id: str,
    *,
    name: str,
    description: str,
    tags: tuple[str, ...],
    examples: tuple[str, ...],
    risk: Literal["read", "reversible_write", "high_impact"],
    required: tuple[str, ...] = (),
    specialist: str = "",
    mcp_tool: str | None = None,
    surface: str = "staff",
) -> SkillSpec:
    return SkillSpec(
        id=skill_id,
        name=name,
        description=description,
        tags=tags,
        examples=examples,
        risk=risk,
        scope=skill_id,
        required_argument_keys=required,
        specialist=specialist or (_TK_COWORKER.get(skill_id) or "ticketing_coworker"),
        surface=surface,
        mcp_server="ticketing",
        mcp_tool=mcp_tool,
    )


# Granular skills advertised on the Agent Card (dispatch already supported).
_PUBLISHED_SPECS: tuple[SkillSpec, ...] = (
    _spec(
        "tk.ticket.create",
        name="Create ticket",
        description="Create a support ticket after Hub policy approval for the write.",
        tags=("ticket", "write", "create"),
        examples=("Create a ticket for John about VPN login failures.",),
        risk=_RISK_WRITE,
        required=("issue",),
        specialist="ticket_creation_executor",
        mcp_tool="create_ticket",
    ),
    _spec(
        "tk.ticket.read",
        name="Read ticket",
        description="Fetch a single ticket by number or id.",
        tags=("ticket", "read"),
        examples=("Show ticket #42.",),
        risk=_RISK_READ,
        specialist="ticket_lifecycle_executor",
        mcp_tool="get_ticket",
    ),
    _spec(
        "tk.ticket.list",
        name="List tickets",
        description="Search or list tickets with optional filters.",
        tags=("ticket", "read", "list"),
        examples=("List open tickets for my team.",),
        risk=_RISK_READ,
        specialist="ticket_lifecycle_executor",
        mcp_tool="list_tickets",
    ),
    _spec(
        "tk.ticket.update",
        name="Update ticket",
        description="Update ticket fields (status, priority, assignee).",
        tags=("ticket", "write", "update"),
        examples=("Set ticket #42 to In Progress.",),
        risk=_RISK_WRITE,
        required=("ticketNumber",),
        specialist="ticket_lifecycle_executor",
        mcp_tool="update_ticket",
    ),
    _spec(
        "tk.ticket.escalate",
        name="Escalate ticket",
        description="Escalate a ticket to a resolver or named person.",
        tags=("ticket", "write", "escalate"),
        examples=("Escalate ticket #42 to Yaswanth.",),
        risk=_RISK_HIGH,
        required=("ticketNumber",),
        specialist="sla_escalation_executor",
        mcp_tool="escalate_ticket",
    ),
    _spec(
        "tk.ticket.note.add",
        name="Add ticket note",
        description="Add an internal note to a ticket.",
        tags=("ticket", "write", "note"),
        examples=("Add a note on ticket #42.",),
        risk=_RISK_WRITE,
        required=("ticketNumber", "note"),
        specialist="ticket_lifecycle_executor",
        mcp_tool="add_ticket_note",
    ),
    _spec(
        "tk.ticket.enrich",
        name="Enrich ticket draft",
        description="Suggest subject, priority, and queue from an issue description.",
        tags=("ticket", "read", "enrich"),
        examples=("Enrich this issue: VPN keeps dropping.",),
        risk=_RISK_READ,
        specialist="ticket_creation_executor",
        mcp_tool="enrich_ticket",
    ),
    _spec(
        "tk.ticket.customer.verify",
        name="Verify customer",
        description="Check directory/CDP for a customer by email or phone.",
        tags=("ticket", "customer", "read"),
        examples=("Verify customer jane@acme.com before create ticket.",),
        risk=_RISK_READ,
        specialist="ticket_creation_executor",
        mcp_tool="verify_customer",
    ),
    _spec(
        "tk.ticket.assign.auto",
        name="Auto-assign ticket",
        description="Assign the best available agent for a ticket.",
        tags=("ticket", "write", "assign"),
        examples=("Auto-assign ticket #42.",),
        risk=_RISK_WRITE,
        specialist="intelligent_assignment_executor",
        mcp_tool="auto_assign_ticket",
    ),
    _spec(
        "tk.ticket.assign.resolve",
        name="Reassign ticket",
        description="Reassign a ticket to a named agent or resolver.",
        tags=("ticket", "write", "reassign"),
        examples=("Reassign ticket #42 to Ashika.",),
        risk=_RISK_WRITE,
        required=("ticketNumber",),
        specialist="ticket_lifecycle_executor",
        mcp_tool="update_ticket",
    ),
    _spec(
        "tk.ticket.metrics.read",
        name="Read ticket metrics",
        description="Read dashboard / ticket metrics for the org.",
        tags=("ticket", "analytics", "read"),
        examples=("How many open tickets today?",),
        risk=_RISK_READ,
        specialist="analytics_audit_query_executor",
        mcp_tool="get_metrics",
    ),
    _spec(
        "tk.ticket.progress.read",
        name="Read ticket progress",
        description="Read progress / timeline context for a ticket.",
        tags=("ticket", "read"),
        examples=("What is the progress on ticket #42?",),
        risk=_RISK_READ,
        specialist="ticket_lifecycle_executor",
        mcp_tool="get_ticket_progress",
    ),
    _spec(
        "tk.customer.create",
        name="Create customer",
        description="Add a customer to the directory.",
        tags=("customer", "write", "create"),
        examples=("Add customer Jane Doe jane@acme.com.",),
        risk=_RISK_WRITE,
        required=("name",),
        specialist="customer_directory_crud_executor",
        mcp_tool="create_customer",
    ),
    _spec(
        "tk.customer.read",
        name="Read customer 360",
        description="Customer 360 / history by email or id.",
        tags=("customer", "read"),
        examples=("Show 360 for jane@acme.com.",),
        risk=_RISK_READ,
        specialist="customer_directory_crud_executor",
        mcp_tool="get_customer_360",
    ),
    _spec(
        "tk.customer.list",
        name="List customers",
        description="Search the customer directory.",
        tags=("customer", "read", "list"),
        examples=("Find customers named Jane.",),
        risk=_RISK_READ,
        specialist="customer_directory_crud_executor",
        mcp_tool="list_customers",
    ),
    _spec(
        "tk.customer.import",
        name="Import customers",
        description="Import customers from a CSV/Excel upload context.",
        tags=("customer", "write", "import"),
        examples=("Import the uploaded customer CSV.",),
        risk=_RISK_HIGH,
        specialist="customer_directory_crud_executor",
        mcp_tool="import_customers",
    ),
    _spec(
        "tk.team.create",
        name="Create team",
        description="Create a team/queue with name, description, and members.",
        tags=("team", "write", "create"),
        examples=("Create team MCP with members Ashika and Uday.",),
        risk=_RISK_WRITE,
        required=("name",),
        specialist="team_queue_crud_executor",
        mcp_tool="create_queue",
    ),
    _spec(
        "tk.team.update",
        name="Update team",
        description="Update team name, description, or members.",
        tags=("team", "write", "update"),
        examples=("Rename team Frontend to UI Engineering.",),
        risk=_RISK_WRITE,
        specialist="team_queue_crud_executor",
        mcp_tool="update_queue",
    ),
    _spec(
        "tk.team.list",
        name="List teams",
        description="List or search teams/queues.",
        tags=("team", "read", "list"),
        examples=("List all teams.",),
        risk=_RISK_READ,
        specialist="team_queue_crud_executor",
        mcp_tool="list_queues",
    ),
    _spec(
        "tk.staff.list",
        name="List staff",
        description=(
            "List organization staff. Use a returned id as user_id on "
            "tk.proactive.notify.staff. Never invent ids."
        ),
        tags=("staff", "read", "list"),
        examples=("List staff so I can notify someone.",),
        risk=_RISK_READ,
        specialist="team_queue_crud_executor",
        mcp_tool="list_agents",
    ),
    _spec(
        "tk.team.members.add",
        name="Add team members",
        description="Add staff to an existing team without replacing the roster.",
        tags=("team", "write", "members"),
        examples=("Add Uday to the MCP team.",),
        risk=_RISK_WRITE,
        specialist="team_queue_crud_executor",
        mcp_tool="update_queue",
    ),
    _spec(
        "tk.kb.article.create",
        name="Create KB article",
        description="Create a knowledge base article.",
        tags=("kb", "write", "create"),
        examples=("Create a KB article about password reset.",),
        risk=_RISK_WRITE,
        required=("title",),
        specialist="kb_quality_crud_executor",
        mcp_tool="create_kb_article",
    ),
    _spec(
        "tk.kb.article.update",
        name="Update KB article",
        description="Update an existing knowledge base article.",
        tags=("kb", "write", "update"),
        examples=("Update the password-reset KB article body.",),
        risk=_RISK_WRITE,
        required=("articleId",),
        specialist="kb_quality_crud_executor",
        mcp_tool="update_kb_article",
    ),
    _spec(
        "tk.kb.search",
        name="Search knowledge base",
        description="Search live org knowledge base articles.",
        tags=("kb", "read", "search"),
        examples=("Search KB for VPN issues.",),
        risk=_RISK_READ,
        specialist="resolution_knowledge_executor",
        mcp_tool="list_kb",
    ),
    _spec(
        "tk.kb.category.manage",
        name="Manage KB category",
        description="Create or manage knowledge base categories.",
        tags=("kb", "write", "category"),
        examples=("Add KB category Networking.",),
        risk=_RISK_WRITE,
        specialist="kb_quality_crud_executor",
        mcp_tool="manage_kb_category",
    ),
    _spec(
        "tk.macro.create",
        name="Create macro",
        description="Create a canned reply macro.",
        tags=("macro", "write", "create"),
        examples=("Create a macro for greeting replies.",),
        risk=_RISK_WRITE,
        required=("title", "body"),
        specialist="macro_crud_executor",
        mcp_tool="create_macro",
    ),
    _spec(
        "tk.macro.update",
        name="Update macro",
        description="Update an existing macro.",
        tags=("macro", "write", "update"),
        examples=("Update the greeting macro body.",),
        risk=_RISK_WRITE,
        required=("macroId",),
        specialist="macro_crud_executor",
        mcp_tool="update_macro",
    ),
    _spec(
        "tk.macro.list",
        name="List macros",
        description="List or search macros.",
        tags=("macro", "read", "list"),
        examples=("List macros.",),
        risk=_RISK_READ,
        specialist="macro_crud_executor",
        mcp_tool="list_macros",
    ),
    _spec(
        "tk.catalog.priority.create",
        name="Create priority",
        description="Create a priority catalog entry.",
        tags=("admin", "priority", "write"),
        examples=("Create priority Critical with 1 hour SLA.",),
        risk=_RISK_WRITE,
        specialist="priority_status_crud_executor",
        mcp_tool="create_priority",
    ),
    _spec(
        "tk.catalog.priority.update",
        name="Update priority",
        description="Update a priority catalog entry.",
        tags=("admin", "priority", "write"),
        examples=("Update Critical priority hours to 2.",),
        risk=_RISK_WRITE,
        specialist="priority_status_crud_executor",
        mcp_tool="update_priority",
    ),
    _spec(
        "tk.catalog.status.create",
        name="Create status",
        description="Create a ticket status catalog entry.",
        tags=("admin", "status", "write"),
        examples=("Create status Waiting on Customer.",),
        risk=_RISK_WRITE,
        specialist="priority_status_crud_executor",
        mcp_tool="create_status",
    ),
    _spec(
        "tk.catalog.status.update",
        name="Update status",
        description="Update a ticket status catalog entry.",
        tags=("admin", "status", "write"),
        examples=("Rename status Waiting on Customer.",),
        risk=_RISK_WRITE,
        specialist="priority_status_crud_executor",
        mcp_tool="update_status",
    ),
    _spec(
        "tk.analytics.query",
        name="Analytics query",
        description="Answer analytics / metrics questions from live data.",
        tags=("analytics", "read"),
        examples=("Which team has the most open tickets?",),
        risk=_RISK_READ,
        specialist="analytics_audit_query_executor",
        mcp_tool="ask_semantic_layer",
    ),
    _spec(
        "tk.analytics.root-cause.analyze",
        name="Root-cause analysis",
        description="Analyze root causes using semantic layer / ontology tools.",
        tags=("analytics", "read", "root-cause"),
        examples=("Why did ticket volume spike today?",),
        risk=_RISK_READ,
        specialist="analytics_audit_query_executor",
        mcp_tool="ask_knowledge_graph",
    ),
    _spec(
        "tk.csat.report.read",
        name="CSAT report",
        description="Read CSAT reports for a date range.",
        tags=("analytics", "csat", "read"),
        examples=("Show CSAT for last 30 days.",),
        risk=_RISK_READ,
        specialist="analytics_audit_query_executor",
        mcp_tool="get_csat_reports",
    ),
    _spec(
        "tk.audit.list",
        name="List audit events",
        description="Query the audit log.",
        tags=("admin", "audit", "read"),
        examples=("Show recent audit events for ticket deletes.",),
        risk=_RISK_READ,
        specialist="analytics_audit_query_executor",
        mcp_tool="list_audit",
    ),
    _spec(
        "tk.escalation.directory.read",
        name="Escalation directory",
        description="Read the escalation directory.",
        tags=("admin", "escalation", "read"),
        examples=("Show escalation directory.",),
        risk=_RISK_READ,
        specialist="analytics_audit_query_executor",
        mcp_tool="list_escalation_directory",
    ),
    _spec(
        "tk.proactive.run",
        name="Run proactive agent",
        description="Run a proactive agent by eventType / agentId with payload.",
        tags=("proactive", "write"),
        examples=("Run ICPA classify for a new ticket payload.",),
        risk=_RISK_WRITE,
        specialist="proactive",
        mcp_tool=None,
        surface="proactive",
    ),
    _spec(
        "tk.super-agent.route",
        name="Super Agent route",
        description="Route a natural-language instruction through the Ticketing Super Agent.",
        tags=("super", "route"),
        examples=("Help me create a team and add Ashika.",),
        risk=_RISK_READ,
        specialist="ticketing_super_agent",
        mcp_tool=None,
    ),
)


def _proactive_specs() -> tuple[SkillSpec, ...]:
    rows: list[SkillSpec] = []
    for skill_id, (agent, _event) in sorted(_TK_PROACTIVE.items()):
        desc = PROACTIVE_DESCRIPTIONS.get(agent, f"Proactive agent {agent}")
        rows.append(
            _spec(
                skill_id,
                name=skill_id.replace("tk.proactive.", "").replace(".", " ").title(),
                description=desc,
                tags=("proactive", agent, "automation"),
                examples=(f"Run {agent} for the given ticket event.",),
                risk=_RISK_WRITE,
                specialist=agent,
                mcp_tool=None,
                surface="proactive",
            )
        )
    return tuple(rows)


_ALL_PUBLISHED: tuple[SkillSpec, ...] = _PUBLISHED_SPECS + _proactive_specs()
_PUBLISHED_BY_ID: dict[str, SkillSpec] = {s.id: s for s in _ALL_PUBLISHED}

# Hub Agent Card advertise set (stable order for skills[] / skillVersion).
# Catalog specs for other tk.* ids remain for schemas + resolve_hub_skill;
# A2A message/send rejects unpublished skillIds.
HUB_CARD_SKILL_ORDER: tuple[str, ...] = (
    "tk.super-agent.route",
    "tk.ticket.create",
    "tk.ticket.read",
    "tk.ticket.list",
    "tk.ticket.update",
    "tk.ticket.customer.verify",
    "tk.customer.read",
    "tk.kb.search",
    "tk.proactive.inbound.capture",
    "tk.proactive.inbound.deflect",
    "tk.proactive.notify.staff",
    "tk.staff.list",
)
HUB_CARD_SKILL_IDS: frozenset[str] = frozenset(HUB_CARD_SKILL_ORDER)


def _enabled_skill_allowlist() -> set[str] | None:
    from app.config import get_settings

    raw = str(getattr(get_settings(), "a2a_enabled_skills", "") or "").strip()
    if not raw:
        return None
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def is_hub_card_skill(skill_id: str) -> bool:
    """True when Hub may discover and invoke this skillId over A2A."""
    sid = _norm(skill_id)
    if sid not in HUB_CARD_SKILL_IDS:
        return False
    allow = _enabled_skill_allowlist()
    if allow is not None:
        return sid in allow
    return True


def list_skill_specs() -> list[SkillSpec]:
    """Skills published on the Agent Card.

    Default is the Hub advertise set. A2A_ENABLED_SKILLS may further subset that list
    (never expand beyond HUB_CARD_SKILL_IDS).
    """
    allow = _enabled_skill_allowlist()
    specs: list[SkillSpec] = []
    for skill_id in HUB_CARD_SKILL_ORDER:
        spec = _PUBLISHED_BY_ID.get(skill_id)
        if spec is None:
            continue
        if allow is not None and spec.id.lower() not in allow:
            continue
        specs.append(spec)
    return specs


def get_skill_spec(skill_id: str) -> SkillSpec | None:
    return _PUBLISHED_BY_ID.get(_norm(skill_id))


def hub_skills() -> list[dict[str, str]]:
    """Backward-compatible minimal list (id + description) for JWT skillVersion."""
    return [
        {"id": spec.id, "description": spec.description}
        for spec in list_skill_specs()
    ]


def skill_version(skills: list[dict[str, str]] | None = None) -> str:
    """Stable hash over skill ids + descriptions; invalidates access JWTs on change."""
    items = skills if skills is not None else hub_skills()
    canonical = json.dumps(
        sorted((s["id"], s.get("description", "")) for s in items),
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def is_coworker_skill(skill_id: str) -> bool:
    target = resolve_hub_skill(skill_id)
    return target is not None and target.kind == "coworker"


def is_proactive_skill(skill_id: str) -> bool:
    target = resolve_hub_skill(skill_id)
    return target is not None and target.kind == "proactive"


def is_super_agent(skill_id: str) -> bool:
    target = resolve_hub_skill(skill_id)
    return target is not None and target.kind == "super"


def coworker_agent_for_hub(skill_id: str) -> str | None:
    target = resolve_hub_skill(skill_id)
    if target and target.kind == "coworker":
        return target.agent_id
    return None


def proactive_agent_for_hub(skill_id: str) -> tuple[str, str | None] | None:
    target = resolve_hub_skill(skill_id)
    if target and target.kind == "proactive":
        if target.agent_id == PROACTIVE_HUB_EVENT_AGENT:
            return target.agent_id, target.default_event_type
        return target.agent_id, target.default_event_type
    return None
