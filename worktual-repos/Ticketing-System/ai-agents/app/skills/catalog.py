"""Standards-compliant runtime Agent Skill discovery and lazy activation."""

from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.contracts.execution import SkillDefinition, SkillDependency
from app.tools.registry import tools_for_agent


_SKILLS_ROOT = Path(__file__).resolve().parent
_SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _scalar(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _frontmatter(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md must begin with YAML frontmatter")
    try:
        close = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as exc:
        raise ValueError("SKILL.md frontmatter is not closed") from exc
    data: dict[str, Any] = {}
    current_map: dict[str, str] | None = None
    for line in lines[1:close]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith((" ", "\t")):
            if current_map is None:
                raise ValueError(f"unexpected nested frontmatter line: {line.strip()}")
            key, sep, value = line.strip().partition(":")
            if not sep:
                raise ValueError(f"invalid metadata line: {line.strip()}")
            current_map[key.strip()] = _scalar(value)
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise ValueError(f"invalid frontmatter line: {line.strip()}")
        key = key.strip()
        value = value.strip()
        if not value:
            nested: dict[str, str] = {}
            data[key] = nested
            current_map = nested
        else:
            data[key] = _scalar(value)
            current_map = None
    return data, "\n".join(lines[close + 1 :]).strip()


def _csv(raw: Any) -> list[str]:
    return [item.strip() for item in str(raw or "").split(",") if item.strip()]


def _dependencies(raw: Any) -> list[SkillDependency]:
    out: list[SkillDependency] = []
    for item in _csv(raw):
        name, sep, version = item.partition("@")
        out.append(SkillDependency(name=name, version=version if sep else "1.0.0"))
    return out


def _skill_path(name: str) -> Path:
    clean = str(name or "").strip()
    if not _SKILL_NAME_RE.fullmatch(clean):
        raise ValueError(f"invalid Skill name: {name!r}")
    path = (_SKILLS_ROOT / clean / "SKILL.md").resolve()
    root = _SKILLS_ROOT.resolve()
    if root not in path.parents or not path.is_file():
        raise ValueError(f"unknown Skill: {clean}")
    return path


def _parse_skill(path: Path, *, include_body: bool) -> SkillDefinition:
    resolved = path.resolve()
    root = _SKILLS_ROOT.resolve()
    if root not in resolved.parents or resolved.name != "SKILL.md":
        raise ValueError(f"Skill path escapes packaged root: {path}")
    if resolved.parent.name != path.parent.name:
        raise ValueError(f"Skill directory may not resolve through a symlink: {path}")
    text = resolved.read_text(encoding="utf-8")
    header, body = _frontmatter(text)
    name = str(header.get("name") or "").strip()
    description = str(header.get("description") or "").strip()
    if not _SKILL_NAME_RE.fullmatch(name) or name != resolved.parent.name:
        raise ValueError(f"Skill name must match parent directory: {resolved}")
    if not description or len(description) > 1024:
        raise ValueError(f"Skill description is required and limited to 1024 chars: {name}")
    if len(text.splitlines()) > 500:
        raise ValueError(f"SKILL.md exceeds 500 lines: {name}")
    metadata = header.get("metadata") or {}
    if not isinstance(metadata, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in metadata.items()
    ):
        raise ValueError(f"Skill metadata must be string key/value pairs: {name}")
    active = str(metadata.get("status") or "active").strip().lower() == "active"
    allowed_tools = str(header.get("allowed-tools") or "").split()
    return SkillDefinition(
        name=name,
        version=str(metadata.get("version") or "1.0.0"),
        description=description,
        path=str(resolved),
        content_digest=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        domain=str(metadata.get("domain") or ""),
        eligible_executors=_csv(metadata.get("executors")),
        task_ids=_csv(metadata.get("task-ids")),
        schema_ref=str(metadata.get("schema-ref") or "") or None,
        approval_policy=str(metadata.get("approval-policy") or "none"),
        dependencies=_dependencies(metadata.get("dependencies")),
        allowed_tools=allowed_tools,
        local_controls=_csv(metadata.get("local-controls")),
        output_contract=str(metadata.get("output-contract") or "executor-result-v1"),
        active=active,
        inactive_reason=str(metadata.get("inactive-reason") or "") or None,
        body=body if include_body else None,
    )


@lru_cache
def discover_skills() -> dict[str, SkillDefinition]:
    """Load metadata for every packaged Skill and validate the dependency graph."""
    skills: dict[str, SkillDefinition] = {}
    for path in sorted(_SKILLS_ROOT.glob("*/SKILL.md")):
        definition = _parse_skill(path, include_body=False)
        if definition.name in skills:
            raise ValueError(f"duplicate Skill name: {definition.name}")
        skills[definition.name] = definition
    _validate_skills(skills)
    return skills


def _validate_skills(skills: dict[str, SkillDefinition]) -> None:
    from app.prompts.builder import load_agent_definitions
    from app.tools.registry import TOOL_META

    agents = load_agent_definitions()
    known_tools = set(TOOL_META)
    for skill in skills.values():
        if skill.domain not in agents or agents[skill.domain].layer != "domain":
            raise ValueError(f"{skill.name} has unknown Domain: {skill.domain}")
        for executor in skill.eligible_executors:
            definition = agents.get(executor)
            if not definition or definition.layer != "executor":
                raise ValueError(f"{skill.name} has unknown Executor: {executor}")
            if skill.name not in definition.skills:
                raise ValueError(f"{executor} does not declare Skill {skill.name}")
            undeclared_controls = set(skill.local_controls) - set(
                definition.local_controls
            )
            if undeclared_controls:
                raise ValueError(
                    f"{skill.name} uses controls absent from {executor}: "
                    f"{sorted(undeclared_controls)}"
                )
            if skill.active:
                unauthorized = set(skill.allowed_tools) - set(tools_for_agent(executor))
                if unauthorized:
                    raise ValueError(
                        f"{skill.name} exceeds {executor} tools: {sorted(unauthorized)}"
                    )
        if skill.active:
            unknown_tools = (
                set(skill.allowed_tools) | set(skill.local_controls)
            ) - known_tools
            if unknown_tools:
                raise ValueError(
                    f"{skill.name} declares unknown tools: {sorted(unknown_tools)}"
                )
        unknown_dependencies = {
            dependency.name
            for dependency in skill.dependencies
            if dependency.name not in skills
        }
        if unknown_dependencies:
            raise ValueError(
                f"{skill.name} has unknown dependencies: {sorted(unknown_dependencies)}"
            )

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(name: str) -> None:
        if name in visiting:
            raise ValueError(f"Skill dependency cycle at {name}")
        if name in visited:
            return
        visiting.add(name)
        for dependency in skills[name].dependencies:
            visit(dependency.name)
        visiting.remove(name)
        visited.add(name)

    for name in skills:
        visit(name)


@lru_cache
def load_skill_definition(name: str) -> SkillDefinition:
    """Activate one selected Skill body after metadata-only discovery."""
    metadata = discover_skills().get(str(name or "").strip())
    if not metadata:
        raise ValueError(f"unknown Skill: {name}")
    loaded = _parse_skill(_skill_path(metadata.name), include_body=True)
    if loaded.content_digest != metadata.content_digest:
        discover_skills.cache_clear()
        raise ValueError(f"Skill changed after discovery: {metadata.name}")
    return loaded


def skills_for_executor(executor_id: str, *, active_only: bool = True) -> tuple[SkillDefinition, ...]:
    values = [
        skill
        for skill in discover_skills().values()
        if executor_id in skill.eligible_executors
        and (skill.active or not active_only)
    ]
    return tuple(sorted(values, key=lambda item: item.name))


def skill_summaries_for_executor(executor_id: str) -> list[dict[str, str]]:
    return [
        {"name": skill.name, "description": skill.description, "version": skill.version}
        for skill in skills_for_executor(executor_id)
    ]


def tools_for_skill(skill_id: str, agent: str) -> frozenset[str]:
    """Return a fail-closed intersection; a Skill can never expand permissions."""
    skill = discover_skills().get(str(skill_id or "").strip())
    if not skill or not skill.active or agent not in skill.eligible_executors:
        return frozenset()
    allowed = set(tools_for_agent(agent))
    return frozenset(set(skill.allowed_tools) & allowed)


def clear_skill_caches() -> None:
    discover_skills.cache_clear()
    load_skill_definition.cache_clear()


def _public_catalog() -> dict[str, dict[str, Any]]:
    return {
        name: {
            "description": skill.description,
            "version": skill.version,
            "domain": skill.domain,
            "agents": list(skill.eligible_executors),
            "tools": list(skill.allowed_tools),
            "active": skill.active,
        }
        for name, skill in discover_skills().items()
    }


# Compatibility export used by callers that inspect Skill metadata.
SKILLS: dict[str, dict[str, Any]] = _public_catalog()
