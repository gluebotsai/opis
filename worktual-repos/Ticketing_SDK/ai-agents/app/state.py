"""Shared LangGraph state for the multi-agent chat flow."""

from typing import Annotated, Literal, Optional, TypedDict



# Valid router destinations
AgentName = Literal[
    "tickets", "teams", "kb", "customers", "macros", "admin", "general"
]


class AgentState(TypedDict):
    """
    Graph state (frozen architecture):

      prepare → workflow_manager → commands(shim) → intent → policy → agents

    Workflow fields are the source of truth for multi-turn guided flows.
    Legacy *_draft keys remain adapters until the commands shim is fully drained.
    """

    messages: list
    route: Optional[AgentName]
    intent: Optional[str]
    tools_allowed: Optional[bool]
    policy_note: Optional[str]
    page: Optional[str]
    organization_id: Optional[str]
    summary: Optional[str]
    ticket_draft: Optional[dict]
    next_step: Optional[str]
    session_history: Optional[list]
    user_id: Optional[str]
    user_name: Optional[str]
    user_role: Optional[str]
    can_create_ticket: Optional[bool]
    surface: Optional[str]
    chat_module: Optional[str]
    """UI module for specialist tool allowlists (tickets|teams|kb|…). Internal routing only."""
    chat_surface: Optional[str]
    """UI surface: list | create | detail. Internal; Super Agent JSON is not sent to React."""
    portal_customer_id: Optional[str]
    portal_auth_mode: Optional[str]
    reply: Optional[str]
    # Chat command layer (escalate / create / filters) — hybrid shim
    command_handled: Optional[bool]
    workflow_handled: Optional[bool]
    specialist_handoff: Optional[bool]
    actions: Optional[list]
    # Frozen workflow contract
    current_workflow: Optional[str]
    current_step: Optional[str]
    workflow_data: Optional[dict]
    active_agent: Optional[str]
    last_super_agent_decision: Optional[dict]
    last_entity: Optional[dict]
    workflow_decision: Optional[dict]
    semantic_request: Optional[dict]
    semantic_intent: Optional[str]
    # Canonical conversation/workflow/query memory. Legacy draft keys below are
    # compatibility projections only while non-ticket modules migrate.
    conversation_context: Optional[dict]
    workflow_events: Optional[list]
    escalate_draft: Optional[dict]
    """Pending escalate dialog (ticket / assignee pick)."""
    reassign_draft: Optional[dict]
    """Pending reassign dialog (ticket / role / person / confirm)."""
    macro_draft: Optional[dict]
    """Pending create-macro dialog (title / body / confirm)."""
    team_draft: Optional[dict]
    """Pending create-team / add-members dialog."""
    kb_draft: Optional[dict]
    """Pending create-kb dialog (title / category / body / confirm)."""
    priority_draft: Optional[dict]
    """Pending create/delete priority catalog dialog."""
    status_draft: Optional[dict]
    """Pending create/delete status catalog dialog."""
    customer_draft: Optional[dict]
    """Pending add-customer dialog (name / email / phone)."""
    parked_drafts: Optional[list]
    """Suspended guided flows [{flow, draft}, …] so users can resume after a side quest."""
    data: Optional[dict]
    tool_memory: Optional[dict]
    """Compact last tool results (ids/names) for Super Agent + specialists."""
    session_memory: Optional[dict]
    """CRM UI sessionMemory (pendingIntent / pendingAsk / slots) for Super Agent NLU."""
