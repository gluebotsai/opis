"""Assemble agent.md plus every skill folder listed under ## skills.

Does not onboard/offboard by question or plan. Callers that later select a subset
can pass skill_ids explicitly.
"""

from __future__ import annotations

import re
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = PACK_ROOT / "skills"

_SKILLS_HEADER = re.compile(r"^##\s+skills\s*$", re.MULTILINE | re.IGNORECASE)
_NEXT_HEADER = re.compile(r"^##\s+", re.MULTILINE)


def listed_skill_ids(agent_md: str) -> list[str]:
    match = _SKILLS_HEADER.search(agent_md)
    if not match:
        return []
    rest = agent_md[match.end() :]
    nxt = _NEXT_HEADER.search(rest)
    block = rest[: nxt.start()] if nxt else rest
    ids: list[str] = []
    for line in block.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            ids.append(stripped[2:].strip().strip("`"))
    return ids


def skill_body(skill_id: str, *, skills_dir: Path = SKILLS_DIR) -> str:
    path = skills_dir / skill_id / "SKILL.md"
    if not path.exists():
        raise FileNotFoundError(f"Skill '{skill_id}' not found at {path}")
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4 :]
    return text.strip()


def load_agent_prompt(
    agent_md_path: Path,
    *,
    skill_ids: list[str] | None = None,
    skills_dir: Path = SKILLS_DIR,
) -> str:
    """agent.md plus listed (or given) skill bodies. Same tokens as a dump until subsetting exists."""
    agent_md_path = Path(agent_md_path)
    core = agent_md_path.read_text(encoding="utf-8").strip()
    ids = skill_ids if skill_ids is not None else listed_skill_ids(core)
    parts = [core]
    for sid in ids:
        parts.append(f"# Skill: {sid}\n\n{skill_body(sid, skills_dir=skills_dir)}")
    return "\n\n".join(parts).strip()
