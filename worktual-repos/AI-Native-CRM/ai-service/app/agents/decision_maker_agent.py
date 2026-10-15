"""
Decision-maker agent.

Prompt: agents/decision-maker/agent.md.
The model suggests a buying role and relationship links. Code only keeps
ids that were in the request. Callers store a confidence under 0.7 as a
suggestion. This agent does not write to the CRM.
"""

from __future__ import annotations

from typing import Any

from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.llm import LLM_JOB_TIMEOUT_MS, is_ai_configured

ROLES = {
    "decision_maker",
    "economic_buyer",
    "champion",
    "influencer",
    "technical_evaluator",
    "user",
    "procurement_legal",
    "blocker",
}
KINDS = {"reports_to", "influences", "former_colleague", "introduced_by"}
INFLUENCE = {"high", "medium", "low"}
ATTITUDE = {"supporter", "neutral", "opponent"}
STRENGTH = {"strong", "medium", "weak"}

_SECTIONS = load_agent_md(agent_md_path(__file__, "decision-maker"))
SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)


def _choice(value: Any, allowed: set[str]) -> str | None:
    text = str(value or "").strip()
    return text if text in allowed else None


def clamp_decision_makers(raw: dict[str, Any], contact_ids: set[str]) -> dict[str, Any]:
    people = []
    seen: set[str] = set()
    for item in raw.get("people") or []:
        if not isinstance(item, dict):
            continue
        contact_id = str(item.get("contactId") or "").strip()
        role = _choice(item.get("role"), ROLES)
        if not contact_id or contact_id not in contact_ids or not role or contact_id in seen:
            continue
        try:
            confidence = float(item.get("confidence"))
        except (TypeError, ValueError):
            continue
        confidence = max(0.0, min(1.0, confidence))
        evidence = str(item.get("evidence") or "").strip()[:500]
        if not evidence:
            continue
        seen.add(contact_id)
        people.append(
            {
                "contactId": contact_id,
                "role": role,
                "confidence": round(confidence, 2),
                "influence": _choice(item.get("influence"), INFLUENCE),
                "attitude": _choice(item.get("attitude"), ATTITUDE),
                "evidence": evidence,
            }
        )
    links = []
    for item in raw.get("relationships") or []:
        if not isinstance(item, dict):
            continue
        left = str(item.get("fromContactId") or "").strip()
        right = str(item.get("toContactId") or "").strip()
        kind = _choice(item.get("kind"), KINDS)
        if not kind or left not in contact_ids or right not in contact_ids or left == right:
            continue
        evidence = str(item.get("evidence") or "").strip()[:500]
        if not evidence:
            continue
        links.append(
            {
                "fromContactId": left,
                "toContactId": right,
                "kind": kind,
                "strength": _choice(item.get("strength"), STRENGTH),
                "evidence": evidence,
            }
        )
    return {"people": people[:20], "relationships": links[:20]}


async def run(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    contacts = body.get("contacts") if isinstance(body.get("contacts"), list) else []
    ids = {str(row.get("id") or "").strip() for row in contacts if isinstance(row, dict)}
    ids.discard("")
    if not ids:
        return {"status": "failed", "reason": "no_contacts", "people": [], "relationships": []}
    if not is_ai_configured():
        return {"status": "failed", "reason": "llm_not_configured", "people": [], "relationships": []}

    lines = ["People:"]
    for row in contacts:
        if not isinstance(row, dict):
            continue
        contact_id = str(row.get("id") or "").strip()
        if contact_id not in ids:
            continue
        rejected = row.get("rejectedRoles") if isinstance(row.get("rejectedRoles"), list) else []
        lines.append(
            f"- id={contact_id} name={row.get('name') or ''} title={row.get('title') or ''} "
            f"rejected={','.join(str(item) for item in rejected)} "
            f"activities={row.get('activities') or 'none'}"
        )

    def validate(raw: dict[str, Any]) -> dict[str, Any]:
        clamped = clamp_decision_makers(raw, ids)
        if not clamped["people"] and not clamped["relationships"]:
            raise ValueError("no_suggestions")
        return clamped

    parsed, reason = await generate_json_with_retries(
        system=SYSTEM,
        user="\n".join(lines),
        max_tokens=1600,
        timeout_ms=LLM_JOB_TIMEOUT_MS,
        validate=validate,
    )
    if not parsed:
        return {
            "status": "failed",
            "reason": reason or "llm_empty",
            "people": [],
            "relationships": [],
        }
    return {"status": "ok", "source": "ai", **parsed}
