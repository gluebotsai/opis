"""Versioned Pydantic contracts shared by native orchestrator components."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

CONTRACT_VERSION = "1.0"


class ExecutionMode(str, Enum):
    LEGACY = "legacy"
    NATIVE = "native"
    DRY_RUN = "dry_run"


class AgentKind(str, Enum):
    COWORKER = "coworker"
    PROACTIVE = "proactive"
    MEETING = "meeting"
    ANALYTICS = "analytics"
    SUBAGENT = "subagent"


class ToolBudget(BaseModel):
    model_config = ConfigDict(populate_by_name=True, frozen=True)

    max_rounds: int = Field(default=6, alias="maxRounds", ge=1, le=6)
    max_calls: int = Field(default=10, alias="maxCalls", ge=1, le=10)
    max_repeated_call: int = Field(default=2, alias="maxRepeatedCall", ge=1, le=3)
    parallel_reads: bool = Field(default=True, alias="parallelReads")


class ExecutionEnvelope(BaseModel):
    """Identity, correlation and resource bounds for exactly one run."""

    model_config = ConfigDict(populate_by_name=True, frozen=True, extra="forbid")

    contract_version: Literal["1.0"] = Field(default=CONTRACT_VERSION, alias="contractVersion")
    run_id: str = Field(alias="runId", min_length=1, max_length=160)
    trace_id: str = Field(alias="traceId", min_length=1, max_length=160)
    organization_id: str = Field(alias="organizationId", min_length=1, max_length=160)
    actor_id: str = Field(alias="actorId", min_length=1, max_length=160)
    role: str = Field(min_length=1, max_length=80)
    business_type: str = Field(alias="businessType", min_length=1, max_length=40)
    mode: ExecutionMode = ExecutionMode.NATIVE
    deadline: datetime
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=240)
    conversation_id: Optional[str] = Field(default=None, alias="conversationId", max_length=160)
    tool_budget: ToolBudget = Field(default_factory=ToolBudget, alias="toolBudget")

    @field_validator("deadline")
    @classmethod
    def normalize_deadline(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("deadline must include a timezone")
        return value.astimezone(timezone.utc)

    def remaining_seconds(self, now: Optional[datetime] = None) -> float:
        current = now or datetime.now(timezone.utc)
        return max(0.0, (self.deadline - current).total_seconds())


class AgentSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True, frozen=True, extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=40)
    kind: AgentKind
    execution: Literal["turn", "pipeline"]
    description: str = ""
    prompt_builder: Optional[str] = Field(default=None, alias="promptBuilder")
    allowed_tools: List[str] = Field(default_factory=list, alias="allowedTools")
    allowed_skills: List[str] = Field(default_factory=list, alias="allowedSkills")
    max_handoffs: int = Field(default=3, alias="maxHandoffs", ge=0, le=3)
    mutation_capable: bool = Field(default=False, alias="mutationCapable")


class AgentContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    envelope: ExecutionEnvelope
    input: Dict[str, Any] = Field(default_factory=dict)
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    memory: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Handoff(BaseModel):
    model_config = ConfigDict(populate_by_name=True, frozen=True, extra="forbid")

    from_agent: str = Field(alias="fromAgent", min_length=1)
    to_agent: str = Field(alias="toAgent", min_length=1)
    reason: str = Field(min_length=1, max_length=500)
    context_patch: Dict[str, Any] = Field(default_factory=dict, alias="contextPatch")


class RunError(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    message: str
    retryable: bool = False
    detail: Dict[str, Any] = Field(default_factory=dict)


class RunMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    agent_version: str = Field(default="1.0", alias="agentVersion")
    prompt_version: str = Field(default="crm-tools-v1", alias="promptVersion")
    skill_versions: List[str] = Field(default_factory=list, alias="skillVersions")
    tool_policy_version: str = Field(default="crm-modules-v1", alias="toolPolicyVersion")
    latency_ms: int = Field(default=0, alias="latencyMs", ge=0)
    input_tokens: Optional[int] = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: Optional[int] = Field(default=None, alias="outputTokens", ge=0)
    handoffs: int = Field(default=0, ge=0)
    retries: int = Field(default=0, ge=0)
    memory_source: str = Field(default="compatibility", alias="memorySource")
    tool_outcomes: List[Dict[str, Any]] = Field(default_factory=list, alias="toolOutcomes")


class RunResult(BaseModel):
    """Native result with the legacy coworker fields preserved verbatim."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    contract_version: Literal["1.0"] = Field(default=CONTRACT_VERSION, alias="contractVersion")
    ok: bool = True
    run_id: str = Field(alias="runId")
    trace_id: str = Field(alias="traceId")
    assistant_text: str = Field(default="", alias="assistantText")
    patch: Optional[Dict[str, Any]] = None
    tool_proposals: Optional[List[Dict[str, Any]]] = Field(default=None, alias="toolProposals")
    session_memory: Optional[Dict[str, Any]] = Field(default=None, alias="sessionMemory")
    session_memory_patch: Optional[Dict[str, Any]] = Field(
        default=None, alias="sessionMemoryPatch"
    )
    ui_refresh: Optional[Dict[str, Any]] = Field(default=None, alias="uiRefresh")
    source: Literal["ai", "heuristic"] = "ai"
    agent: Optional[str] = None
    run_metadata: Optional[RunMetadata] = Field(default=None, alias="runMetadata")
    error: Optional[RunError] = None

    def compatibility_dict(self) -> Dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)
