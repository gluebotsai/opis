"""
Shared `agent.md` loader — makes agent.md the prompt source of truth
(.cursor/skills/build-nlp-agents/SKILL.md, non-negotiable #1) for background
job agents, not just conversational ones.

Job agents (cron-triggered, stateless per run — see invoice_escalation_agent.py)
only need the subset of the build-nlp-agents `agent.md` template that maps onto
`sectioned_system_prompt` (crm_tools.build_system_prompt order): Role, Goal,
Instructions, Context, Output, Guardrails. MCP servers / handoff targets /
memory policy sections are conversational-agent concerns and are intentionally
not parsed here (see docs/... plan: items 2/4/5 of the skill don't apply to
job agents).

Usage:
    from app.agents.agent_md import load_agent_md, agent_md_path

    SECTIONS = load_agent_md(agent_md_path(__file__, "company-collection-risk"))

    def build_prompt(context: str) -> str:
        return sectioned_system_prompt(
            role=SECTIONS["role"],
            goal=SECTIONS["goal"],
            instructions=SECTIONS["instructions"],
            context=context,
            output=SECTIONS["output"],
            guardrails=SECTIONS["guardrails"],
        )
"""

from __future__ import annotations

import os
import re
from functools import lru_cache

# Sections a job agent's agent.md is expected to define. Static prose from
# `## context` (if present) is domain background; per-run context built by
# the caller (e.g. one company's invoice history) is passed separately into
# sectioned_system_prompt(context=...) and the two are concatenated by the
# caller, not here.
REQUIRED_SECTIONS = ("role", "goal", "instructions", "output", "guardrails")
OPTIONAL_SECTIONS = ("context",)

_HEADING_RE = re.compile(r"^#{1,3}\s+(.+?)\s*$", re.MULTILINE)


def agent_md_path(caller_file: str, agent_name: str) -> str:
    """Resolve `ai-service/app/agents/<agent_name>/agent.md` relative to a
    caller module's `__file__` (so it works regardless of cwd)."""
    base = os.path.dirname(os.path.abspath(caller_file))
    return os.path.join(base, agent_name, "agent.md")


def _normalize_heading(raw: str) -> str:
    return raw.strip().lower().lstrip("#").strip()


def parse_agent_md(text: str) -> dict[str, str]:
    """Split an agent.md body into {section_name: body_text} by its `##`
    (or `#`) headings. The top-level `# <agent_name>` title heading itself
    is not treated as a section."""
    sections: dict[str, str] = {}
    matches = list(_HEADING_RE.finditer(text))
    for idx, match in enumerate(matches):
        heading = _normalize_heading(match.group(1))
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if heading and body:
            sections[heading] = body
    return sections


@lru_cache(maxsize=32)
def _load_cached(path: str, _mtime: float) -> dict[str, str]:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    sections = parse_agent_md(text)
    missing = [s for s in REQUIRED_SECTIONS if s not in sections]
    if missing:
        raise ValueError(
            f"agent.md at {path} is missing required section(s): {', '.join(missing)}"
        )
    return sections


def load_agent_md(path: str) -> dict[str, str]:
    """Load + parse an agent.md file, cached by (path, mtime) so edits during
    dev are picked up without a process restart."""
    mtime = os.path.getmtime(path)
    return _load_cached(path, mtime)
