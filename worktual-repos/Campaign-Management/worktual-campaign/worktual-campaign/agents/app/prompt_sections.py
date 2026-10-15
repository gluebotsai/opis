"""Shared 6-section system prompt builder for all campaign agents.

Order is fixed: Role → Goal → Instructions → Context → Output → Guardrails.
Context must be rebuilt every turn from live session / org state.

Every agent automatically receives shared clarify + guardrails + tool rules
from app.shared_prompts (unless include_shared=False).
"""

from __future__ import annotations

from typing import Any

from app.shared_prompts import (
    SHARED_BASE_GUARDRAILS,
    SHARED_CLARIFY_INSTRUCTIONS,
    SHARED_TOOL_RULES,
)

SECTION_ORDER = (
    "Role",
    "Goal",
    "Instructions",
    "Context",
    "Output",
    "Guardrails",
)


def sectioned_system_prompt(
    *,
    role: str,
    goal: str,
    instructions: str,
    context: str,
    output: str,
    guardrails: str,
    extra_instructions: str = "",
    extra_guardrails: str = "",
    include_shared: bool = True,
) -> str:
    """Compose a model-facing system prompt with mandatory section headers."""
    instr = (instructions or "").strip()
    if include_shared:
        instr = f"{instr}\n\n{SHARED_CLARIFY_INSTRUCTIONS}\n\n{SHARED_TOOL_RULES}".strip()
    if extra_instructions.strip():
        instr = f"{instr}\n\n{extra_instructions.strip()}"
    guards = (guardrails or "").strip()
    if include_shared:
        guards = f"{guards}\n\n{SHARED_BASE_GUARDRAILS}".strip()
    if extra_guardrails.strip():
        guards = f"{guards}\n\n{extra_guardrails.strip()}"

    blocks = [
        ("Role", (role or "").strip()),
        ("Goal", (goal or "").strip()),
        ("Instructions", instr),
        ("Context", (context or "").strip() or "(no live context)"),
        ("Output", (output or "").strip()),
        ("Guardrails", guards),
    ]
    parts: list[str] = []
    for title, body in blocks:
        parts.append(f"## {title}\n{body}")
    return "\n\n".join(parts)


def format_json_context(label: str, data: Any) -> str:
    """Pretty-print a JSON-ish Context subsection."""
    import json

    try:
        body = json.dumps(data, indent=2, default=str)
    except TypeError:
        body = str(data)
    return f"{label}:\n{body}"


def join_context_parts(*parts: str) -> str:
    return "\n\n".join(p.strip() for p in parts if p and str(p).strip())
