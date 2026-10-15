"""Data contracts and models for CRM B2B Knowledge Graph Agent."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

DEFAULT_ORG_ID = int(os.getenv("DEFAULT_ORG_ID", "1003"))


@dataclass
class AgentContext:
    """Security context, tenant scope, and caller identity for CRM B2B analytics."""
    org_id: int = DEFAULT_ORG_ID
    role: str = "admin"
    user_id: int = 1000
    session_id: Optional[str] = None
    currency: str = "USD"
    filters: dict[str, Any] = field(default_factory=dict)


@dataclass
class PlanStep:
    """Individual graph execution step in an autonomous plan."""
    step_id: str
    tool: str  # 'cypher', 'unsupported'
    template_name: Optional[str] = None
    cypher: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    description: str = ""


@dataclass
class ExecutionPlan:
    """Multi-step execution plan produced by the KGPlanner."""
    plan_id: str
    goal: str
    steps: list[PlanStep] = field(default_factory=list)


@dataclass
class QueryResult:
    """Raw Cypher execution outcome from the Knowledge Graph."""
    status: str  # 'success', 'error'
    columns: list[str] = field(default_factory=list)
    rows: list[dict[str, Any]] = field(default_factory=list)
    row_count: int = 0
    error: Optional[str] = None
    error_type: Optional[str] = None  # 'DENY', 'UNSUPPORTED', 'REPLAN', 'DB_ERROR'
    raw_query: Optional[str] = None


@dataclass
class Fact:
    """Grounded metric or tabular fact extracted from the Knowledge Graph."""
    label: str
    value: Any = None
    unit: Optional[str] = None
    breakdown: Optional[list[dict[str, Any]]] = None


@dataclass
class SynthesisOutput:
    """Final executive answer rendered in clean business language."""
    markdown: str
    facts: list[Fact] = field(default_factory=list)
    status: str = "success"
    error: Optional[str] = None
    attempts_made: int = 1
    cypher_used: list[str] = field(default_factory=list)
