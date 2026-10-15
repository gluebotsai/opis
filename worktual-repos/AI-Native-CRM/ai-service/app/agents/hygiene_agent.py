"""Hygiene agent — LLM suggests duplicate merges / missing enrichments.

Never auto-merges. Confirm via MCP propose_merge_contacts (confirmed=true).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_fallback, sectioned_system_prompt
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)


async def run(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = payload.get("candidates") or payload.get("duplicates") or []
    contact = payload.get("contact") or {}
    if not isinstance(candidates, list):
        candidates = []

    system = sectioned_system_prompt(
        role="You are a CRM data hygiene agent for Worktual.",
        goal=(
            "Review duplicate contact candidates and recommend merges or "
            "enrichment steps. Never merge automatically."
        ),
        instructions=(
            "- Prefer identity_keys email/phone matches over fuzzy name-only.\n"
            "- Recommend merge only when confidence is high.\n"
            "- Suggest enrich (company/domain) when profile is thin.\n"
            "- Always require human confirm for merge."
        ),
        context=(
            f"Primary contact: {json.dumps(contact, default=str)[:1500]}\n"
            f"Candidates: {json.dumps(candidates, default=str)[:4000]}"
        ),
        output=(
            "Return JSON: {\n"
            '  "action": "suggest_merge"|"suggest_enrich"|"no_action",\n'
            '  "primaryContactId": string|null,\n'
            '  "secondaryContactId": string|null,\n'
            '  "confidence": 0-1,\n'
            '  "rationale": string,\n'
            '  "enrichHints": string[]\n'
            "}"
        ),
        guardrails=(
            "- Never invent contact ids.\n"
            "- Never claim a merge was completed.\n"
            "- If unsure, action=no_action."
        ),
    )

    if not is_ai_configured():
        return label_fallback(
            {
                "ok": True,
                "action": "no_action",
                "confidence": 0,
                "enrichHints": [],
            },
            "llm_unavailable",
        )

    try:
        text = await generate_ai_text(
            system=system,
            user="Recommend the next hygiene action as JSON.",
            max_tokens=800,
        )
        data = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("hygiene-agent LLM unavailable: %s", exc)
        return label_fallback(
            {
                "ok": True,
                "action": "no_action",
                "confidence": 0,
                "enrichHints": [],
            },
            "llm_error",
        )

    action = str(data.get("action") or "no_action").strip()
    if action not in {"suggest_merge", "suggest_enrich", "no_action"}:
        action = "no_action"

    return {
        "ok": True,
        "action": action,
        "primaryContactId": data.get("primaryContactId"),
        "secondaryContactId": data.get("secondaryContactId"),
        "confidence": float(data.get("confidence") or 0),
        "rationale": str(data.get("rationale") or "")[:500],
        "enrichHints": data.get("enrichHints")
        if isinstance(data.get("enrichHints"), list)
        else [],
        "source": "ai",
        "toolHint": (
            {
                "name": "propose_merge_contacts",
                "args": {
                    "primaryContactId": data.get("primaryContactId"),
                    "secondaryContactId": data.get("secondaryContactId"),
                    "confirmed": False,
                },
            }
            if action == "suggest_merge"
            else None
        ),
    }
