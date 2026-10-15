"""Deterministic loader for per-agent ``agent.md`` definitions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

AGENT_DOCUMENT_ROOT = Path(__file__).resolve().parents[3] / "agents"
_EMPTY_VALUES = {"", "none", "n/a", "no business mcp servers", "no handoffs"}


@dataclass(frozen=True)
class AgentDocument:
    name: str
    prompt: str
    mcp_servers: tuple[str, ...]
    handoff_targets: tuple[str, ...]
    allowed_skills: tuple[str, ...]
    required_skills: tuple[str, ...]
    version: str
    path: Path | None = None


def _sections(markdown: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current = ""
    subsection = ""
    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if line.startswith("## "):
            current = line[3:].strip().casefold()
            subsection = ""
            sections.setdefault(current, [])
            continue
        if line.startswith("### "):
            subsection = line[4:].strip().casefold()
            sections.setdefault(f"{current}.{subsection}", [])
            continue
        key = f"{current}.{subsection}" if subsection else current
        if key:
            sections.setdefault(key, []).append(line)
    return sections


def _bullet_ids(lines: list[str]) -> tuple[str, ...]:
    values: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("-"):
            continue
        value = stripped[1:].strip()
        value = re.sub(r"^[`*_]+|[`*_]+$", "", value).strip()
        value = re.split(r"\s+(?:—|-)\s+|:\s+", value, maxsplit=1)[0].strip("` ")
        if value.casefold() in _EMPTY_VALUES or not value:
            continue
        if re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value):
            values.append(value)
    return tuple(dict.fromkeys(values))


def load_agent_document(
    name: str,
    *,
    fallback_prompt: str,
    fallback_mcp_servers: tuple[str, ...] = (),
    fallback_handoff_targets: tuple[str, ...] = (),
    fallback_allowed_skills: tuple[str, ...] = (),
    fallback_required_skills: tuple[str, ...] = (),
) -> AgentDocument:
    path = AGENT_DOCUMENT_ROOT / name / "agent.md"
    if not path.is_file():
        return AgentDocument(
            name=name,
            prompt=fallback_prompt,
            mcp_servers=fallback_mcp_servers,
            handoff_targets=fallback_handoff_targets,
            allowed_skills=fallback_allowed_skills,
            required_skills=fallback_required_skills,
            version="legacy",
        )

    markdown = path.read_text(encoding="utf-8").strip()
    parsed = _sections(markdown)
    mcp_servers = _bullet_ids(parsed.get("allowed mcp servers", []))
    handoff_targets = _bullet_ids(parsed.get("handoff targets", []))
    allowed_skills = _bullet_ids(
        parsed.get("skills.allowed", parsed.get("skills", []))
    )
    required_skills = _bullet_ids(parsed.get("skills.required", []))
    return AgentDocument(
        name=name,
        prompt=markdown,
        mcp_servers=mcp_servers or fallback_mcp_servers,
        handoff_targets=handoff_targets or fallback_handoff_targets,
        allowed_skills=allowed_skills or fallback_allowed_skills,
        required_skills=required_skills or fallback_required_skills,
        version=sha256(markdown.encode("utf-8")).hexdigest()[:12],
        path=path,
    )

