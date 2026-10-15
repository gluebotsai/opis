"""Typed Worktual A2A request/result contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

CONTRACT_VERSION = "1.0"
TYPED_SKILLS_EXTENSION = "urn:worktual:a2a:typed-skills:v1"

Outcome = Literal[
    "succeeded",
    "failed",
    "rejected",
    "input_required",
    "auth_required",
    "canceled",
    "visitor_offline",
]


class ApprovalEvidence(BaseModel):
    """Signed Hub approval for high-impact writes."""

    approvalId: str
    approvedSkillId: str
    approvedAt: str
    approverSubject: str | None = None
    signature: str | None = None
    expiresAt: str | None = None


class WorktualEnvelope(BaseModel):
    commandId: str = Field(min_length=8, max_length=128)
    skillId: str = Field(min_length=3, max_length=128)
    contractVersion: str = Field(default=CONTRACT_VERSION)
    organizationId: str = Field(min_length=1, max_length=64)
    arguments: dict[str, Any] = Field(default_factory=dict)
    deadline: str | None = None
    traceparent: str | None = None
    approval: ApprovalEvidence | None = None
    # Optional staff bearer for domain MCP calls (Hub-delegated). Never logged.
    actorAuthorization: str | None = None
    hopCount: int = Field(default=0, ge=0, le=16)

    @field_validator("contractVersion")
    @classmethod
    def _contract_version(cls, value: str) -> str:
        if value != CONTRACT_VERSION:
            raise ValueError(f"Unsupported contractVersion: {value}")
        return value


class PolicyDecision(BaseModel):
    allowed: bool
    risk: str
    scope: str
    reason: str
    requiresApproval: bool = False
    confirmationId: str | None = None


class SkillResultArtifact(BaseModel):
    contractVersion: str = CONTRACT_VERSION
    commandId: str
    skillId: str
    outcome: Outcome
    affectedIds: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    policy: PolicyDecision | None = None
    retryable: bool = False
    trace: dict[str, Any] = Field(default_factory=dict)
    domainReferences: dict[str, Any] = Field(default_factory=dict)
    message: str | None = None


class MissingInputStatus(BaseModel):
    status: Literal["INPUT_REQUIRED"] = "INPUT_REQUIRED"
    skillId: str
    missingFields: list[str]
    message: str


class HubHelpRequest(BaseModel):
    """Protected internal request to delegate leftover work to Intelligent Hub."""

    organizationId: str = Field(min_length=1, max_length=64)
    query: str = Field(min_length=1, max_length=8_000)
    channel: str = Field(default="chat", min_length=1, max_length=64)
    cdpId: str | None = Field(default=None, max_length=128)
    commandId: str = Field(min_length=8, max_length=128)
    source: str | None = Field(default=None, max_length=32)
    hopCount: int = Field(default=0, ge=0, le=16)


class HubDelegationResult(BaseModel):
    commandId: str
    outcome: Literal["succeeded", "failed", "rejected", "timeout"]
    hubTaskId: str | None = None
    hubTaskState: str | None = None
    message: str | None = None
    retryable: bool = False
    evidence: dict[str, Any] = Field(default_factory=dict)
