"""Disposition agent: one short outcome label for a single touch.

Prompt: agents/disposition/agent.md.
The label is free text. Examples in the prompt are not an allow-list.
This agent does not change lead status, qualification, or nurture.
"""

from __future__ import annotations

import re
from typing import Any

from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.llm_result import generate_json_with_retries, label_ai, sectioned_system_prompt

_SECTIONS = load_agent_md(agent_md_path(__file__, "disposition"))

SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)

_TAG = re.compile(r"[A-Za-z0-9][A-Za-z0-9 '&/-]{0,39}")
_EMPTY = {"null", "none", "n/a", "unknown", "undefined"}


def clamp_tag(value: Any) -> str | None:
    """Keep a short label. A sentence or an empty value is not a tag."""
    if not isinstance(value, str):
        return None
    text = " ".join(value.replace("_", " ").split()).strip(" .,:;\"'")
    if not text or text.lower() in _EMPTY:
        return None
    if len(text.split()) > 3 or len(text) > 40:
        return None
    if not _TAG.fullmatch(text):
        return None
    return text


def _validate(raw: dict[str, Any]) -> dict[str, Any] | None:
    if "tag" not in raw:
        return None
    tag = raw.get("tag")
    if tag is None or (isinstance(tag, str) and not tag.strip()):
        return {"tag": None}
    clamped = clamp_tag(tag)
    if not clamped:
        return None
    return {"tag": clamped}


async def run(
    channel: str,
    text: str,
    subject: str | None = None,
    direction: str | None = None,
    organizationId: str | None = None,
) -> dict[str, Any]:
    del organizationId
    body = (text or "").strip()
    if len(body) < 12:
        return {"ok": True, "status": "skipped", "tag": None, "reason": "too_short"}
    user = "\n".join(
        [
            f"Channel: {(channel or 'message').strip()[:32]}",
            f"Direction: {(direction or '').strip()[:32] or 'unknown'}",
            f"Subject: {(subject or '').strip()[:200] or '(none)'}",
            "",
            body[:6000],
        ]
    )
    parsed, reason = await generate_json_with_retries(
        system=SYSTEM,
        user=user,
        max_tokens=80,
        timeout_ms=60_000,
        attempts=2,
        validate=_validate,
        enable_thinking=False,
    )
    if not parsed:
        return {"ok": False, "status": "failed", "tag": None, "reason": reason or "llm_empty"}
    return label_ai({"ok": True, "status": "ok", "tag": parsed.get("tag")})
