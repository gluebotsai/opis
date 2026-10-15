"""Sales guide: suggestions from touchpoints, one next action, one CTA.

Prompt: agents/sales-guide/agent.md.
The model decides. Code only clamps the action to the operations this
contact can start. This agent does not write to the CRM.
"""

from __future__ import annotations

from typing import Any

from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.llm import LLM_JOB_TIMEOUT_MS, is_ai_configured

ACTIONS = {
    "email",
    "call",
    "meeting",
    "sms",
    "task",
    "note",
    "quote",
    "proposal",
    "deal",
    "view_deal",
    "order",
}
NEEDS_MESSAGE = {"email", "sms", "note"}
OBJECTION_KINDS = {"price", "timing", "competitor", "authority"}

_SECTIONS = load_agent_md(agent_md_path(__file__, "sales-guide"))
SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)


def _text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _days(value: Any, default: int, cap: int = 21) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(cap, days))


def clamp_guide(raw: dict[str, Any], allowed_actions: set[str]) -> dict[str, Any]:
    suggestions = []
    for item in raw.get("suggestions") or []:
        line = _text(item, 400)
        if len(line) < 8:
            continue
        suggestions.append(line)
        if len(suggestions) == 4:
            break

    action_raw = raw.get("nextBestAction") if isinstance(raw.get("nextBestAction"), dict) else {}
    title = _text(action_raw.get("title"), 160)
    detail = _text(action_raw.get("detail"), 800)
    next_action = (
        {"title": title, "detail": detail, "dueInDays": _days(action_raw.get("dueInDays"), 2, 14)}
        if title and detail
        else None
    )

    chosen = raw.get("action") if isinstance(raw.get("action"), dict) else {}
    kind = _text(chosen.get("kind"), 32)
    subject = _text(chosen.get("subject"), 160)
    message = _text(chosen.get("message"), 1200)
    if kind == "email" and not subject:
        kind = ""
    if kind in NEEDS_MESSAGE and not message:
        kind = ""
    cta = (
        {
            "kind": kind,
            "subject": subject,
            "message": message,
            "dueInDays": _days(chosen.get("dueInDays"), 2),
        }
        if kind in allowed_actions
        else None
    )
    return {
        "suggestions": suggestions,
        "nextBestAction": next_action,
        "action": cta,
    }


def clamp_objection(raw: dict[str, Any]) -> dict[str, Any] | None:
    kind = _text(raw.get("kind"), 32)
    reply = _text(raw.get("reply"), 800)
    if kind not in OBJECTION_KINDS or not reply:
        return None
    return {
        "kind": kind,
        "customerLine": _text(raw.get("customerLine"), 400),
        "reply": reply,
        "proofPoint": _text(raw.get("proofPoint"), 400) or None,
        "question": _text(raw.get("question"), 300) or None,
    }


def _facts(body: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Name: {body.get('displayName') or 'unknown'}",
            f"Title: {body.get('title') or 'unknown'}",
            f"Company: {body.get('companyName') or 'unknown'}",
            f"Industry: {body.get('industry') or 'unknown'}",
            f"Country: {body.get('country') or 'unknown'}",
            f"Lead status: {body.get('leadStatus') or 'unknown'}",
            f"Score: {body.get('score') if body.get('score') is not None else 'unknown'}",
            f"Open deals: {body.get('deals') or 'none'}",
            f"Available actions: {', '.join(body.get('availableActions') or []) or 'none'}",
            f"Recent interactions:\n{body.get('activities') or 'none'}",
            f"Omni-channel summary: {body.get('omniChannelSummary') or 'none'}",
            f"Tasks: {body.get('tasks') or 'none'}",
        ]
    )


async def run(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    mode = _text(body.get("mode"), 16) or "guide"
    if not is_ai_configured():
        return {"status": "failed", "reason": "llm_not_configured"}

    if mode == "objection":
        line = _text(body.get("objection"), 800)
        if not line:
            return {"status": "failed", "reason": "no_objection"}

        def validate_objection(raw: dict[str, Any]) -> dict[str, Any]:
            clamped = clamp_objection(raw)
            if not clamped:
                raise ValueError("no_objection")
            return clamped

        parsed, reason = await generate_json_with_retries(
            system=SYSTEM,
            user="\n".join(
                [
                    "mode objection",
                    _facts(body),
                    "",
                    "Customer objection:",
                    line,
                ]
            ),
            max_tokens=700,
            timeout_ms=min(LLM_JOB_TIMEOUT_MS, 60_000),
            validate=validate_objection,
        )
        if not parsed:
            return {"status": "failed", "reason": reason or "empty_or_invalid_llm"}
        return {"status": "ok", "objection": parsed}

    allowed = {
        _text(item, 32)
        for item in (body.get("availableActions") or [])
        if _text(item, 32) in ACTIONS
    }

    def validate_guide(raw: dict[str, Any]) -> dict[str, Any]:
        clamped = clamp_guide(raw, allowed)
        if not clamped["suggestions"] or not clamped["nextBestAction"] or not clamped["action"]:
            raise ValueError("incomplete_guide")
        return clamped

    parsed, reason = await generate_json_with_retries(
        system=SYSTEM,
        user="mode guide\n" + _facts(body),
        max_tokens=1400,
        timeout_ms=min(LLM_JOB_TIMEOUT_MS, 90_000),
        validate=validate_guide,
    )
    if not parsed:
        return {"status": "failed", "reason": reason or "empty_or_invalid_llm"}
    return {"status": "ok", **parsed}
