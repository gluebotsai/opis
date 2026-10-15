"""Adapters that compose selected skills into the existing prompt/tool stack."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from app.skills.models import SkillPackage
from app.skills.registry import redact_skill_context


def compose_system_prompt(
    base_prompt: str,
    packages: Sequence[SkillPackage],
    *,
    context: Mapping[str, Any],
) -> str:
    """Retain the canonical CRM prompt and append canonical six-section fragments."""
    if not packages:
        return base_prompt
    fragments = []
    for package in packages:
        safe_context = redact_skill_context(context, package)
        fragments.append(
            f"Selected skill: {package.spec.name}\n"
            f"{package.canonical_prompt_fragment}\n"
            f"Authorized skill context: {safe_context}"
        )
    return f"{base_prompt}\n\nSelected skill packages:\n\n" + "\n\n".join(fragments)


def filter_mcp_tools(
    tools: Sequence[dict[str, Any]], allowed_names: frozenset[str]
) -> list[dict[str, Any]]:
    return [
        tool
        for tool in tools
        if isinstance(tool, dict) and str(tool.get("name") or "") in allowed_names
    ]

