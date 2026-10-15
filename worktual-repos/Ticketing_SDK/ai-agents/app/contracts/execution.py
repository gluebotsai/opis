"""Native agent run request / result schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


ExecutionMode = Literal["legacy", "dry_run", "native"]
AgentLayer = Literal["super", "domain", "executor"]
AgentExecutionMode = Literal["llm", "deterministic"]
ApprovalMode = Literal[
    "none",
    "interactive_semantic",
    "interactive_high_risk",
    "trusted_structured",
    "proactive_asga",
    "channel_dependent",
]
TaskStatus = Literal[
    "pending",
    "collecting",
    "awaiting_confirmation",
    "executing",
    "completed",
    "cancelled",
    "refused",
    "failed",
    "parked",
]
ExecutorOutcome = Literal[
    "ask_for_field",
    "call_tool",
    "respond",
    "handoff_required",
    "await_confirmation",
    "cancelled",
    "refuse",
]
RefusalReason = Literal[
    "unsupported_product",
    "unsupported_operation",
    "forbidden",
    "missing_context",
    "approval_required",
    "temporarily_unavailable",
]


class SkillDependency(BaseModel):
    name: str
    version: str = "1.0.0"
    input_mapping: dict[str, str] = Field(default_factory=dict)


class AgentDefinition(BaseModel):
    """Validated runtime contract loaded from one canonical agent.md."""

    id: str
    version: str = "1.0.0"
    layer: AgentLayer
    execution_mode: AgentExecutionMode = "llm"
    description: str = ""
    prompt_path: str
    skills: list[str] = Field(default_factory=list)
    mcp_servers: list[str] = Field(default_factory=list)
    handoff_targets: list[str] = Field(default_factory=list)
    task_ids: list[str] = Field(default_factory=list)
    local_controls: list[str] = Field(default_factory=list)
    output_contract: str = "executor-result-v1"
    approval_policy: ApprovalMode = "none"
    memory_policy: dict[str, Any] = Field(default_factory=dict)
    prompt: str = ""

    @model_validator(mode="after")
    def validate_layer_boundary(self) -> "AgentDefinition":
        if self.layer in {"super", "domain"} and self.mcp_servers:
            raise ValueError(f"{self.layer} agents may not declare business MCP servers")
        if self.layer == "super" and self.skills:
            raise ValueError("super agents may not declare business Skills")
        if self.execution_mode == "deterministic" and self.layer != "executor":
            raise ValueError("only executor agents may be deterministic")
        return self


class SkillDefinition(BaseModel):
    """Metadata discovered from a standards-compliant <name>/SKILL.md."""

    name: str
    version: str = "1.0.0"
    description: str
    path: str
    content_digest: str
    domain: str
    eligible_executors: list[str] = Field(default_factory=list)
    task_ids: list[str] = Field(default_factory=list)
    schema_ref: str | None = None
    approval_policy: ApprovalMode = "none"
    dependencies: list[SkillDependency] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    local_controls: list[str] = Field(default_factory=list)
    output_contract: str = "executor-result-v1"
    active: bool = True
    inactive_reason: str | None = None
    body: str | None = None


class TaskDefinition(BaseModel):
    """Canonical task binding across Domain, Executor, Skill and schemas."""

    id: str
    version: str = "1.0.0"
    domain: str
    executor: str
    skill_name: str
    schema_ref: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict)
    tool_names: list[str] = Field(default_factory=list)
    required: list[str] = Field(default_factory=list)
    optional: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    approval_mode: ApprovalMode = "none"
    idempotency_required: bool = False
    active: bool = True


class ConfirmationEvidence(BaseModel):
    confirmation_id: str
    task_version: str
    skill_version: str
    argument_hash: str
    requested_request_id: str | None = None
    approved: bool = False


class TaskState(BaseModel):
    """Typed working state persisted for active and parked Harness tasks."""

    task_id: str
    task_version: str = "1.0.0"
    domain: str
    executor: str
    skill_name: str
    skill_version: str = "1.0.0"
    skill_digest: str = ""
    channel: str | None = None
    status: TaskStatus = "pending"
    collected: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, str] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)
    validation_errors: dict[str, str] = Field(default_factory=dict)
    dependency_results: dict[str, Any] = Field(default_factory=dict)
    confirmation: ConfirmationEvidence | None = None
    last_tool_outcome: dict[str, Any] | None = None
    idempotency_key: str | None = None
    mutation_attempted: bool = False
    executed_confirmation_ids: list[str] = Field(default_factory=list)
    parked_siblings: list[dict[str, Any]] = Field(default_factory=list)


class DomainInstruction(BaseModel):
    executor_id: str
    task_id: str
    skill_name: str
    version: str = "1.0.0"
    objective: str
    supplied_fields: dict[str, Any] = Field(default_factory=dict)


class CapabilityRefusal(BaseModel):
    reason: RefusalReason
    capability: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    alternatives: list[str] = Field(default_factory=list)


class ExecutorResult(BaseModel):
    outcome: ExecutorOutcome
    assistant_text: str | None = None
    task_state: TaskState | None = None
    tool_name: str | None = None
    tool_arguments: dict[str, Any] = Field(default_factory=dict)
    refusal: CapabilityRefusal | None = None
    handoff_reason: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class DomainResult(BaseModel):
    instruction: DomainInstruction | None = None
    executor_result: ExecutorResult | None = None
    refusal: CapabilityRefusal | None = None
    completed_steps: list[str] = Field(default_factory=list)


class ActorContext(BaseModel):
    """Run actor — org_id/role/name aliases map onto existing field names."""

    user_id: str | None = None
    organization_id: str | None = None  # org_id
    user_role: str | None = None  # role
    user_name: str | None = None  # name
    user_email: str | None = None
    user_phone: str | None = None
    can_create_ticket: bool | None = None
    portal_customer_id: str | None = None
    portal_authenticated: bool | None = None
    portal_auth_mode: str | None = None
    locale: str | None = None

    @property
    def org_id(self) -> str | None:
        return self.organization_id

    @property
    def role(self) -> str | None:
        return self.user_role

    @property
    def name(self) -> str | None:
        return self.user_name


class RunBudgets(BaseModel):
    max_rounds: int = 10
    max_tool_calls: int = 16
    max_handoffs: int = 3
    deadline_ms: int = 120_000
    max_parallel_reads: int = 4
    max_result_bytes: int = 200_000


class RunRequest(BaseModel):
    message: str
    run_id: str | None = None
    request_id: str | None = None
    session_id: str | None = None
    actor: ActorContext = Field(default_factory=ActorContext)
    module: str | None = None
    surface: str | None = None
    page: str | None = None
    page_surface: str | None = None
    # Hub remainder channel: chat (coworker) | email (inbox ingress)
    channel: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)
    focused_entity: dict[str, Any] | None = None
    drafts: dict[str, Any] = Field(default_factory=dict)
    session_memory: dict[str, Any] = Field(default_factory=dict)
    durable_memory: dict[str, Any] | None = None
    durable_memory_version: int = 0
    confirm_tool: dict[str, Any] | None = None
    execution_mode: ExecutionMode = "native"
    budgets: RunBudgets = Field(default_factory=RunBudgets)
    mcp_token: str | None = None
    debug: bool = False


class RunError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    retryable: bool = False


class RunResult(BaseModel):
    assistant_text: str | None = None
    agent: str | None = None
    source: Literal["ai"] = "ai"
    tool_proposals: list[dict[str, Any]] = Field(default_factory=list)
    patch: dict[str, Any] | None = None
    session_memory_patch: dict[str, Any] | None = None
    ui_refresh: dict[str, Any] | None = None
    ui_actions: list[dict[str, Any]] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    durable_memory: dict[str, Any] | None = None
    durable_memory_version: int | None = None
    run_id: str | None = None
    request_id: str | None = None
    error: RunError | None = None

    def _public_trace(self) -> dict[str, Any] | None:
        raw = self.data.get("trace") if isinstance(self.data, dict) else None
        if not isinstance(raw, dict):
            return None
        agents = [str(item).strip() for item in (raw.get("agents") or []) if str(item).strip()]
        routes: list[dict[str, str]] = []
        for item in raw.get("routes") or []:
            if not isinstance(item, dict):
                continue
            dst = str(item.get("to") or "").strip()
            if not dst:
                continue
            routes.append({"from": str(item.get("from") or "").strip(), "to": dst})
        if not agents and not routes:
            return None
        return {"agents": agents, "routes": routes}

    def _with_trace(self, envelope: dict[str, Any]) -> dict[str, Any]:
        trace = self._public_trace()
        if not trace:
            return envelope
        data = dict(envelope.get("data") or {})
        data["trace"] = trace
        envelope["data"] = data
        envelope["trace"] = trace
        return envelope

    def to_agent_turn_envelope(self) -> dict[str, Any]:
        if self.error:
            return self._with_trace({
                "assistantText": None,
                "reply": None,
                "source": "error",
                "serviceError": self.error.model_dump(),
                "agent": self.agent,
                "toolProposals": [],
                "patch": None,
                "sessionMemoryPatch": None,
                "uiRefresh": None,
                "ui_actions": [],
                "data": self.data,
                "runId": self.run_id,
                "requestId": self.request_id,
            })
        # Map drafts + ui_actions into CRM proposals/patch (progress panel contract).
        from app.agent_turn import chat_result_to_agent_turn

        data = dict(self.data or {})
        if self.durable_memory:
            for key, value in self.durable_memory.items():
                data.setdefault(key, value)
        mapped = chat_result_to_agent_turn(
            {
                "reply": (self.assistant_text or "").strip(),
                "agent": self.agent,
                "actions": list(self.ui_actions or []),
                "data": data,
                "session_id": None,
                "request_id": self.request_id,
            },
            session_memory=self.session_memory_patch,
        )
        text = (mapped.get("assistantText") or self.assistant_text or "").strip()
        return self._with_trace({
            "assistantText": text,
            "reply": text,
            "source": "ai",
            "agent": mapped.get("agent") or self.agent,
            "toolProposals": mapped.get("toolProposals")
            or self.tool_proposals
            or [],
            "patch": mapped.get("patch") if mapped.get("patch") is not None else self.patch,
            "sessionMemoryPatch": mapped.get("sessionMemoryPatch")
            or self.session_memory_patch,
            "uiRefresh": mapped.get("uiRefresh") or self.ui_refresh,
            "ui_actions": mapped.get("ui_actions") or self.ui_actions or [],
            "data": mapped.get("data") or data,
            "runId": self.run_id,
            "requestId": self.request_id,
        })
