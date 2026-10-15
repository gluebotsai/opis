"""MAS skill spec types."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path


@dataclass(frozen=True)
class SkillSpec:
    module: str
    skill_id: str
    executor_id: str
    tool_names: frozenset[str]
    description: str = ""
    prompt_path: Path | None = None
    completion_tool_names: frozenset[str] = field(default_factory=frozenset)
    extra: dict = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str]:
        return (str(self.module).strip().lower(), str(self.skill_id).strip().lower())
