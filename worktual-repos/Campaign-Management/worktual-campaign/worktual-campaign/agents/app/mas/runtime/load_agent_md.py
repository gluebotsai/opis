"""Load agent.md into a structured dict for prompt assembly."""

from __future__ import annotations

from pathlib import Path
from typing import Any

_SECTION_HEADERS = (
    "role",
    "goal",
    "instructions",
    "context",
    "skills",
    "guardrails",
    "input/output contract",
    "allowed mcp servers",
    "handoff targets",
    "memory policy",
    "approval policy",
    "evaluation criteria",
    "allowed tools",
    "allowed executors",
)


def load_agent_md(path: Path | str) -> dict[str, str]:
    text = Path(path).read_text(encoding="utf-8")
    sections: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal current, buf
        if current is not None:
            sections[current] = "\n".join(buf).strip()
        buf = []

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            title = stripped[3:].strip().lower()
            flush()
            current = title
            continue
        if stripped.startswith("# ") and current is None:
            sections["title"] = stripped[2:].strip()
            continue
        if current is not None:
            buf.append(line)
    flush()
    return sections


def agent_md_to_system_prompt(sections: dict[str, str], *, runtime_context: str = "") -> str:
    """Compose a simple system prompt from agent.md sections."""
    parts: list[str] = []
    title = sections.get("title") or sections.get("role") or "Agent"
    parts.append(f"# {title}")
    for key in (
        "role",
        "goal",
        "instructions",
        "context",
        "guardrails",
        "allowed tools",
        "allowed executors",
        "handoff targets",
        "approval policy",
        "input/output contract",
    ):
        body = (sections.get(key) or "").strip()
        if body:
            parts.append(f"## {key.title()}\n{body}")
    if runtime_context.strip():
        parts.append(f"## Runtime Context\n{runtime_context.strip()}")
    # Skills deferred — mention only if present
    skills = (sections.get("skills") or "").strip()
    if skills and skills not in ("-", "n/a", "deferred", "(deferred)"):
        parts.append(f"## Skills\n{skills}")
    return "\n\n".join(parts)


def package_agent_md(package_dir: Path) -> dict[str, Any]:
    path = package_dir / "agent.md"
    if not path.is_file():
        return {"path": str(path), "sections": {}, "missing": True}
    sections = load_agent_md(path)
    return {
        "path": str(path),
        "sections": sections,
        "missing": False,
        "system_prompt": agent_md_to_system_prompt(sections),
    }
