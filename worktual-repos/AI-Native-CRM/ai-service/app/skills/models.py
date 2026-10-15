"""Typed declarative contracts for progressively disclosed CRM skills."""

from __future__ import annotations

from typing import Any, Dict, FrozenSet, Literal, Tuple

from pydantic import BaseModel, ConfigDict, Field


class ContextPolicy(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    allowed_fields: FrozenSet[str] = frozenset()
    redact_fields: FrozenSet[str] = frozenset(
        {"password", "token", "secret", "apiKey", "accessToken", "refreshToken"}
    )
    max_context_chars: int = Field(default=6000, ge=500, le=20_000)


class CompletionTest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    assertion: str


class SkillSpec(BaseModel):
    """Full package; only ``summary`` is exposed before selection."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    version: str = "1.0"
    description: str = Field(min_length=1, max_length=300)
    role: str
    goal: str
    instructions: str
    context: str
    output: str
    guardrails: str
    context_policy: ContextPolicy = Field(default_factory=ContextPolicy)
    allowed_mcp_groups: FrozenSet[str] = frozenset()
    eligible_roles: FrozenSet[str] = frozenset(
        {"admin", "sales_manager", "sales_rep", "marketing", "finance", "viewer"}
    )
    eligible_business_types: FrozenSet[Literal["b2b", "b2c", "b2b2c"]] = frozenset(
        {"b2b", "b2c", "b2b2c"}
    )
    input_schema: Dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "additionalProperties": True}
    )
    output_schema: Dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "additionalProperties": True}
    )
    completion_tests: Tuple[CompletionTest, ...] = ()

    def summary(self) -> Dict[str, str]:
        return {"name": self.name, "description": self.description}


class SkillPackage(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    spec: SkillSpec
    canonical_prompt_fragment: str = Field(alias="canonicalPromptFragment")
    allowed_tools: Tuple[str, ...] = Field(default_factory=tuple, alias="allowedTools")

