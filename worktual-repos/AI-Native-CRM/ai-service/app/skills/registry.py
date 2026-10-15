"""Immutable skill registry with progressive disclosure and policy checks."""

from __future__ import annotations

from types import MappingProxyType
from typing import Any, Iterable, Mapping, Sequence

from app.orchestrator.contracts import AgentSpec
from app.orchestrator.errors import ContractError, PolicyViolationError
from app.skills.catalog import SPECS, package_for
from app.skills.models import SkillPackage, SkillSpec


class SkillRegistry:
    def __init__(self, specs: Iterable[SkillSpec] = ()) -> None:
        entries: dict[str, SkillPackage] = {}
        for spec in specs:
            if spec.name in entries:
                raise ContractError(f"Duplicate skill: {spec.name}")
            entries[spec.name] = package_for(spec)
        self._entries: Mapping[str, SkillPackage] = MappingProxyType(entries)

    def list_summaries(self) -> tuple[dict[str, str], ...]:
        """Discovery intentionally reveals names/descriptions only."""
        return tuple(package.spec.summary() for package in self._entries.values())

    def load(
        self,
        name: str,
        *,
        agent: AgentSpec,
        role: str,
        business_type: str,
    ) -> SkillPackage:
        package = self._entries.get(name)
        if package is None:
            raise ContractError(f"Unknown skill: {name}")
        if name not in agent.allowed_skills:
            raise PolicyViolationError(f"Agent {agent.name} cannot select skill {name}")
        normalized_role = role.strip().lower()
        normalized_business = business_type.strip().lower()
        if normalized_role not in package.spec.eligible_roles:
            raise PolicyViolationError(f"Role {role} is not eligible for skill {name}")
        if normalized_business not in package.spec.eligible_business_types:
            raise PolicyViolationError(
                f"Business type {business_type} is not eligible for skill {name}"
            )
        return package

    def select(
        self,
        names: Sequence[str],
        *,
        agent: AgentSpec,
        role: str,
        business_type: str,
    ) -> tuple[SkillPackage, ...]:
        unique = tuple(dict.fromkeys(str(name).strip() for name in names if str(name).strip()))
        return tuple(
            self.load(name, agent=agent, role=role, business_type=business_type)
            for name in unique
        )


def effective_tool_names(
    agent: AgentSpec, packages: Sequence[SkillPackage]
) -> frozenset[str]:
    """Skills only narrow an agent's explicit tool capability."""
    agent_tools = frozenset(agent.allowed_tools)
    if not packages:
        return agent_tools
    skill_tools = frozenset(
        tool for package in packages for tool in package.allowed_tools
    )
    return agent_tools.intersection(skill_tools)


def redact_skill_context(
    context: Mapping[str, Any], package: SkillPackage
) -> dict[str, Any]:
    policy = package.spec.context_policy
    output: dict[str, Any] = {}
    for key, value in context.items():
        if key not in policy.allowed_fields:
            continue
        if key in policy.redact_fields:
            output[key] = "[REDACTED]"
        else:
            output[key] = value
    # Hard cap is applied after string conversion by prompt adapters; omit excess keys.
    while len(str(output)) > policy.max_context_chars and output:
        output.pop(next(reversed(output)))
    return output


DEFAULT_SKILL_REGISTRY = SkillRegistry(SPECS)

