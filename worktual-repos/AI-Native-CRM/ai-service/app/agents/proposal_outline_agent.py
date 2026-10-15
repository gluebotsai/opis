"""LLM: expand a BRD into exclusive proposal chapter leaves."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import ProposalOutline
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.proposal_gemini import generate_json, proposal_gemini_configured

logger = logging.getLogger(__name__)

MAX_LEAVES = 16

SYSTEM = sectioned_system_prompt(
    role="You plan the table of contents for one commercial proposal.",
    goal=(
        "Keep the org playbook section keys. Do not add extra BRD chapters."
    ),
    instructions=(
        "- Return only playbook slots (same keys and titles).\n"
        "- Do not invent extra architecture/rollout/SLA chapters.\n"
        "- purpose must stay exclusive per leaf.\n"
        "- Do not invent products outside ALLOWED PRODUCTS.\n"
        "- kind is usually prose; use mixed/table only for comparison or pricing."
    ),
    context="Playbook section specs, requirement, allowed products, and catalog.",
    output="Return JSON matching ProposalOutline.",
    guardrails="Never copy gold-proposal prose. Never invent catalog prices.",
)


def _playbook_leaves(body: dict[str, Any]) -> list[dict[str, Any]]:
    specs = body.get("sectionSpecs")
    mapping = specs if isinstance(specs, dict) else {}
    nested = mapping.get("sectionSpecs") if isinstance(mapping.get("sectionSpecs"), dict) else None
    source = nested or mapping
    out: list[dict[str, Any]] = []
    for key, raw in source.items():
        if key == "sectionSpecs":
            continue
        rec = raw if isinstance(raw, dict) else {}
        slug = str(rec.get("key") or rec.get("sectionKey") or key).strip()
        if not slug:
            continue
        out.append(
            {
                "key": slug,
                "title": str(rec.get("title") or rec.get("heading") or slug),
                "purpose": str(rec.get("purpose") or ""),
                "kind": str(rec.get("kind") or "prose"),
            }
        )
    skeleton = body.get("skeleton")
    if isinstance(skeleton, list) and not out:
        for row in skeleton:
            if not isinstance(row, dict):
                continue
            slug = str(row.get("key") or row.get("id") or "").strip()
            if not slug:
                continue
            out.append(
                {
                    "key": slug,
                    "title": str(row.get("title") or slug),
                    "purpose": str(row.get("purpose") or ""),
                    "kind": "prose",
                }
            )
    return out[:MAX_LEAVES]


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    fallback_leaves = _playbook_leaves(body)
    fallback = {"ok": True, "status": "ok", "sections": fallback_leaves}

    if not proposal_gemini_configured() and not is_ai_configured():
        return label_fallback(fallback, "llm_not_configured")

    extra = json.dumps(
        {
            "sectionSpecs": body.get("sectionSpecs"),
            "skeleton": body.get("skeleton"),
            "requirementText": str(body.get("requirementText") or "")[:8_000],
            "profile": body.get("profile"),
            "allowedProducts": body.get("allowedProducts"),
            "products": body.get("products"),
        },
        ensure_ascii=False,
        default=str,
    )[:20_000]
    logger.info(
        "[proposal-generate] outline start org=%s products=%s gemini=%s extra_chars=%s",
        body.get("organizationId"),
        body.get("allowedProducts"),
        proposal_gemini_configured(),
        len(extra),
    )
    prompt = f"{SYSTEM}\n\nPlan exclusive chapters for this requirement."
    payload: dict[str, Any] = {}

    if proposal_gemini_configured():
        try:
            model = await generate_json(prompt, ProposalOutline, extra_text=extra)
            payload = model.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-outline schema JSON failed: %s", exc)

    if not payload.get("sections") and is_ai_configured():
        try:
            from app.agents.llm_result import extract_json

            text = await generate_ai_text(
                system=SYSTEM,
                user=extra,
                max_tokens=4_000,
                timeout_ms=90_000,
            )
            payload = extract_json(text or "") or {}
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-outline LLM failed")
            return label_fallback(fallback, f"llm_error:{exc}")

    rows = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    sections: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key") or "").strip()
        title = str(raw.get("title") or key).strip()
        if not key or key.lower() in seen:
            continue
        seen.add(key.lower())
        kind = str(raw.get("kind") or "prose")
        if kind not in {"prose", "bullets", "table", "mixed"}:
            kind = "prose"
        sections.append(
            {
                "key": key,
                "title": title,
                "purpose": str(raw.get("purpose") or "")[:400],
                "kind": kind,
            }
        )
        if len(sections) >= MAX_LEAVES:
            break
    if not sections:
        logger.warning("[proposal-generate] outline unusable, using playbook slots")
        return label_fallback(fallback, "unusable_json")
    logger.info(
        "[proposal-generate] outline done count=%s keys=%s",
        len(sections),
        [row["key"] for row in sections],
    )
    return label_ai({"ok": True, "status": "ok", "sections": sections})
