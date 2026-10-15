"""LLM: review assembled proposal sections against the learned content playbook."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_section_keys import (
    canonicalize_section_key,
    canonicalize_section_specs,
)
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role="You QA a drafted proposal against the org's learned writing playbook.",
    goal=(
        "Flag sections that miss the learned length band, tone, or specificity. "
        "Do not rewrite here — only list failures."
    ),
    instructions=(
        "- Compare each drafted section to sectionSpecs (purpose, tone, targetWordRange, specificity).\n"
        "- Fail a section only when it is clearly too generic, far outside the word band, "
        "or the wrong tone relative to the spec.\n"
        "- Ignore minor length misses of under ~20%."
    ),
    context="Draft sections and sectionSpecs are in the user message.",
    output=(
        "Return ONLY JSON: {\"failedSectionKeys\":[\"...\"],"
        "\"mismatches\":[{\"sectionKey\":\"...\",\"reason\":\"...\"}]}"
    ),
    guardrails="Do not invent new sections. Do not include customer PII.",
)


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    if not is_ai_configured():
        return label_fallback(
            {
                "ok": True,
                "status": "ok",
                "failedSectionKeys": [],
                "mismatches": [],
            },
            "llm_not_configured",
        )

    specs = canonicalize_section_specs(body.get("sectionSpecs"))
    sections: list[dict[str, Any]] = []
    for row in body.get("sections") or []:
        if not isinstance(row, dict):
            continue
        key = canonicalize_section_key(str(row.get("key") or row.get("sectionKey") or ""))
        sections.append({**row, "key": key or row.get("key")})
    user = json.dumps(
        {
            "sectionSpecs": specs,
            "sections": sections,
        },
        ensure_ascii=False,
        default=str,
    )[:18_000]
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=2000,
            timeout_ms=60_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-content-qa LLM failed")
        return label_fallback(
            {
                "ok": True,
                "status": "ok",
                "failedSectionKeys": [],
                "mismatches": [],
            },
            f"llm_error:{exc}",
        )

    keys = payload.get("failedSectionKeys")
    mismatches = payload.get("mismatches")
    failed = (
        [canonicalize_section_key(str(k)) or str(k) for k in keys]
        if isinstance(keys, list)
        else []
    )
    normalized_mismatches: list[Any] = []
    if isinstance(mismatches, list):
        for row in mismatches:
            if not isinstance(row, dict):
                normalized_mismatches.append(row)
                continue
            section_key = canonicalize_section_key(
                str(row.get("sectionKey") or row.get("key") or "")
            )
            normalized_mismatches.append(
                {**row, "sectionKey": section_key or row.get("sectionKey")}
            )
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "failedSectionKeys": failed,
            "mismatches": normalized_mismatches,
        }
    )
