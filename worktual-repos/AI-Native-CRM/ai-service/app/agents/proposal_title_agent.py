"""LLM: name the generated proposal from its own sections (not the gold cover)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import GeneratedDocumentTitle
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.proposal_gemini import (
    format_gemini_error,
    generate_json,
    is_gemini_unavailable,
    proposal_gemini_configured,
)

logger = logging.getLogger(__name__)

BODY_CAP = 900
EXTRA_CAP = 8_000
STATIC_TITLE_RE = re.compile(
    r"^(commercial\s+proposal(?:\s*&\s*quotation)?|quotation|quote)\s*$",
    re.I,
)

SYSTEM = sectioned_system_prompt(
    role="You name one commercial proposal after it has been written.",
    goal=(
        "Return a customer-facing document title for THIS generated proposal, "
        "from the section bodies — not a frozen template phrase and not a catalog SKU list."
    ),
    instructions=(
        "- title is the solution/project this draft actually proposes (8–90 characters).\n"
        "- Do not use \"Commercial Proposal\", \"Quotation\", or \"Commercial Proposal & Quotation\".\n"
        "- Do not join inventory SKUs with bullets or middots.\n"
        "- Do not copy another customer's gold cover title.\n"
        "- product_tags: 1–4 solution names as they appear in THIS draft "
        "(e.g. AI Chatbot, AI Voicebot, Proactive Contact Centre).\n"
        "- Omit products the draft does not actually propose."
    ),
    context="Customer name and generated section excerpts.",
    output="Return JSON matching GeneratedDocumentTitle.",
    guardrails="Never invent SKUs or prices. Never use a generic document-type H1.",
)


def _excerpt(text: str, cap: int = BODY_CAP) -> str:
    return " ".join(str(text or "").split())[:cap]


def _fallback_title(sections: list[dict[str, Any]], customer: str) -> str:
    for row in sections:
        key = f"{row.get('key') or ''} {row.get('title') or row.get('heading') or ''}".lower()
        if not re.search(r"executive|overview|summary|introduction", key):
            continue
        body = _excerpt(str(row.get("body") or ""), 180)
        sentence = re.split(r"[.!?\n]", body)[0].strip()
        if 12 <= len(sentence) <= 90 and not STATIC_TITLE_RE.match(sentence):
            return sentence
    if customer:
        return f"Proposal for {customer}"
    return ""


def _fallback_tags(allowed: list[str], draft: str) -> list[str]:
    hay = draft.lower()
    out: list[str] = []
    for name in allowed:
        token = str(name or "").strip()
        if len(token) < 4:
            continue
        if token.lower() in hay:
            out.append(token)
        if len(out) >= 4:
            break
    return out


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    customer = str(body.get("customerName") or body.get("companyName") or "").strip()
    raw_sections = body.get("sections")
    sections = [row for row in raw_sections if isinstance(row, dict)] if isinstance(raw_sections, list) else []
    allowed = [
        str(name).strip()
        for name in (body.get("allowedProducts") or [])
        if str(name).strip()
    ]
    draft = " ".join(
        _excerpt(str(row.get("body") or ""))
        for row in sections[:8]
    )
    fallback_title = _fallback_title(sections, customer)
    fallback_tags = _fallback_tags(allowed, draft)
    fallback = {
        "ok": True,
        "status": "ok",
        "title": fallback_title,
        "product_tags": fallback_tags,
    }
    extra = json.dumps(
        {
            "customerName": customer,
            "allowedProducts": allowed[:8],
            "sections": [
                {
                    "key": str(row.get("key") or ""),
                    "heading": str(row.get("title") or row.get("heading") or ""),
                    "body": _excerpt(str(row.get("body") or "")),
                }
                for row in sections[:8]
            ],
        },
        ensure_ascii=False,
        default=str,
    )[:EXTRA_CAP]
    logger.info(
        "[proposal-generate] title start customer=%s sections=%s gemini=%s",
        customer,
        len(sections),
        proposal_gemini_configured(),
    )
    payload: dict[str, Any] = {}
    if proposal_gemini_configured():
        try:
            model = await generate_json(
                SYSTEM + "\n\nName this generated proposal.",
                GeneratedDocumentTitle,
                extra_text=extra,
            )
            payload = model.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-title Gemini failed: %s", exc)
            if is_gemini_unavailable(exc):
                return label_fallback(fallback, "gemini_unavailable")
            return label_fallback(fallback, f"llm_error:{format_gemini_error(exc)}")
    elif is_ai_configured():
        try:
            text = await generate_ai_text(
                system=SYSTEM,
                user=f"Name this generated proposal.\n{extra}",
                max_tokens=400,
                timeout_ms=60_000,
            )
            payload = extract_json(text or "") or {}
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-title LLM failed")
            return label_fallback(fallback, f"llm_error:{exc}")
    else:
        return label_fallback(fallback, "llm_unconfigured")

    title = str(payload.get("title") or "").strip()
    if not title or STATIC_TITLE_RE.match(title):
        title = fallback_title
    tags_raw = payload.get("product_tags")
    tags = [
        str(tag).strip()
        for tag in (tags_raw if isinstance(tags_raw, list) else [])
        if str(tag).strip()
    ][:4]
    if not tags:
        tags = fallback_tags
    logger.info("[proposal-generate] title done title=%s tags=%s", title[:90], tags)
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "title": title[:90],
            "product_tags": tags,
        }
    )
