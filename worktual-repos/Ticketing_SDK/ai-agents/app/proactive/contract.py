"""Frozen per-agent contract shared by every proactive module."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

OutputType = Literal["RECOMMENDATION", "ACTION_PROPOSAL"]
RiskLevel = Literal["low", "high"]

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def catalog_slug(full_name: str) -> str:
    """Stable catalog id from a human title (never a short code)."""
    text = (full_name or "").strip().lower().replace("&", " and ")
    return _SLUG_RE.sub("_", text).strip("_")


HIGH_RISK_TOOLS = frozenset(
    {
        "escalate_ticket",
        "auto_assign_ticket",
    }
)

HIGH_RISK_STATUS = frozenset({"closed", "resolved", "solved"})


@dataclass(frozen=True)
class AgentSpec:
    agent_id: str
    trigger: tuple[str, ...]
    inputs_required: tuple[str, ...]
    tools_used: frozenset[str]
    output_type: OutputType
    risk_level: RiskLevel
    confidence_threshold: float
    audit_event: str
    full_name: str

    def __post_init__(self) -> None:
        if not str(self.full_name or "").strip():
            raise ValueError("AgentSpec.full_name is required")

    @property
    def catalog_id(self) -> str:
        return catalog_slug(self.full_name)


@dataclass
class Proposal:
    agent_id: str
    organization_id: str
    ticket_id: str | None = None
    ticket_number: str | None = None
    event_id: str | None = None
    event_type: str | None = None
    output_type: OutputType = "RECOMMENDATION"
    risk_level: RiskLevel = "low"
    confidence: float = 0.0
    tool_name: str | None = None
    tool_args: dict[str, Any] = field(default_factory=dict)
    summary: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class GateResult:
    decision: Literal["execute", "approve", "recommend", "reject"]
    reason: str
    proposal: Proposal
