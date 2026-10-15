"""MiniMax: map corpus page text into an outline of sections (titles + ranges).

Deep content patterns are filled by proposal-corpus-section-deep (one section
per call). This agent owns outline fidelity only.
"""

from __future__ import annotations

import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import (
    LLM_JOB_TIMEOUT_MS,
    generate_proposal_ai_text as generate_ai_text,
    is_ai_configured,
    proposal_llm_source_tag as llm_source_tag,
)

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role=(
        "You outline historical B2B sales proposal or requirement documents "
        "for Worktual CRM pattern learning."
    ),
    goal=(
        "Learn the COMPLETE section outline of this document — every real "
        "heading in order — so later deep-reads and generate follow the same "
        "document family. Missing a comparison or commercials section makes "
        "generation look like a generic letter."
    ),
    instructions=(
        "- Walk the pages in order. Emit a section for every distinct heading / "
        "page role (cover, executive summary, requested vs recommended, comparison, "
        "scope, commercials, assumptions, next steps, etc.).\n"
        "- For requirement/BRD documents, outline the customer's headings "
        "(background, scope, features, integrations, constraints, commercials). "
        "A short BRD with 1–8 real sections is valid.\n"
        "- Prefer keys close to the document: keep the PDF's own section titles "
        "instead of renaming them to a generic outline "
        "(introduction / features / conclusion).\n"
        "- Do not invent sections with no supporting text.\n"
        "- Do not merge two visually distinct chapters into one section.\n"
        "- Do not use titles like 'Page 1' or keys like section_2 unless unavoidable.\n"
        "- Mark pricingShape when commercials/tables appear "
        "(none|phase_table|line_items|fixed_fee|subscription).\n"
        "- Do not redesign the document. Outline content structure only.\n"
        "- Redact customer names in any summary text."
    ),
    context="Document kind and page text excerpts are in the user message.",
    output=(
        'Return ONLY JSON: {"sections":[{"key":"...","title":"...","pageRange":[1,2],'
        '"summary":"...","intent":"...","tone":"...","hasTable":false}],'
        '"pricingShape":"none|phase_table|line_items|fixed_fee|subscription",'
        '"overallTone":"...",'
        '"sectionOrder":["cover","scope",...]}'
    ),
    guardrails=(
        "Never invent pricing numbers. Never include personal emails/phones. "
        "Never copy long verbatim paragraphs — summarize. Keep JSON compact."
    ),
)


def _min_sections(kind: str) -> int:
    return 1 if kind == "requirement" else 2


def _page_text_blob(
    pages: list[Any],
    full_text: str,
    *,
    max_pages: int = 10,
    text_limit: int = 1600,
) -> str:
    chunks: list[str] = []
    for page in pages[:max_pages]:
        if not isinstance(page, dict):
            continue
        text = str(page.get("text") or "").strip()
        if not text:
            continue
        chunks.append(f"--- Page {page.get('n')} ---\n{text[:text_limit]}")
    blob = "\n\n".join(chunks)
    if blob.strip():
        return blob
    return full_text[:8_000]


def _normalize_sections(raw: Any) -> list[dict[str, Any]]:
    sections = raw if isinstance(raw, list) else []
    normalized: list[dict[str, Any]] = []
    for item in sections:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip() or "section"
        title = str(item.get("title") or key)[:120]
        if title.lower().startswith("page ") and key.startswith("section_"):
            continue
        normalized.append(
            {
                "key": key,
                "title": title,
                "pageRange": item.get("pageRange")
                if isinstance(item.get("pageRange"), list)
                else [],
                "summary": str(item.get("summary") or "")[:600],
                "intent": str(item.get("intent") or "")[:200],
                "tone": str(item.get("tone") or "formal")[:80],
                "hasTable": bool(item.get("hasTable")),
            }
        )
    return normalized


def _heuristic_structure(pages: list[dict[str, Any]]) -> dict[str, Any]:
    """Offline-only page map. Never a successful outline."""
    sections: list[dict[str, Any]] = []
    for p in pages[:12]:
        n = int(p.get("n") or 0) or len(sections) + 1
        text = str(p.get("text") or "")[:400]
        key = "cover" if n == 1 else f"section_{n}"
        sections.append(
            {
                "key": key,
                "title": f"Page {n}",
                "pageRange": [n, n],
                "summary": text[:200] or "Content present",
                "intent": "document_body",
                "tone": "formal",
                "hasTable": "|" in text or "amount" in text.lower(),
            }
        )
    return {
        "sections": sections,
        "pricingShape": "none",
        "overallTone": "formal",
        "sectionOrder": [s["key"] for s in sections],
        "source": "heuristic",
    }


async def _outline_once(user: str, *, max_tokens: int = 3500) -> dict[str, Any]:
    text = await generate_ai_text(
        system=SYSTEM,
        user=user,
        max_tokens=max_tokens,
        timeout_ms=LLM_JOB_TIMEOUT_MS,
    )
    return extract_json(text or "") or {}


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    kind = str(body.get("kind") or "proposal").strip().lower()
    pages = body.get("pages") if isinstance(body.get("pages"), list) else []
    full_text = str(body.get("fullText") or "")[:12_000]

    if not pages and not full_text:
        return {
            "ok": False,
            "status": "failed",
            "reason": "empty_extract",
            "itemId": item_id,
        }

    needed = _min_sections(kind)
    page_blob = _page_text_blob(pages, full_text)
    kind_line = (
        "This is a customer REQUIREMENT / BRD. Outline its real headings. "
        "One or more sections is enough if that is all the document contains.\n"
        if kind == "requirement"
        else "This is a historical PROPOSAL. Include cover, body, comparison, and commercials when present.\n"
    )
    user = (
        f"Document kind: {kind}\n"
        f"Item id: {item_id}\n"
        f"{kind_line}\n"
        f"Page text:\n{page_blob}"
    )

    if not is_ai_configured():
        return {
            "ok": False,
            "status": "failed",
            "reason": "llm_not_configured",
            "itemId": item_id,
        }

    payload: dict[str, Any] = {}
    last_reason = "bad_json_or_empty_outline"
    for attempt in (1, 2):
        attempt_user = user
        if attempt == 2:
            attempt_user = (
                f"Document kind: {kind}\nItem id: {item_id}\n"
                f"{kind_line}\n"
                "Previous outline was empty or too thin. Return compact JSON with "
                f"at least {needed} section(s).\n\n"
                f"{_page_text_blob(pages, full_text, max_pages=6, text_limit=1200)}"
            )
        try:
            payload = await _outline_once(
                attempt_user,
                max_tokens=2500 if attempt == 2 else 3500,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-corpus-structure LLM failed")
            last_reason = f"llm_error:{exc}"
            payload = {}
            continue

        normalized = _normalize_sections(payload.get("sections"))
        if len(normalized) < needed:
            last_reason = (
                "bad_json_or_empty_outline"
                if not normalized
                else "outline_too_thin"
            )
            continue

        order = payload.get("sectionOrder")
        if not isinstance(order, list):
            order = [s["key"] for s in normalized]
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "sections": normalized,
            "pricingShape": str(payload.get("pricingShape") or "none"),
            "overallTone": str(payload.get("overallTone") or "formal"),
            "sectionOrder": [str(x) for x in order],
            "source": llm_source_tag(),
        }

    return {
        "ok": False,
        "status": "failed",
        "reason": last_reason,
        "itemId": item_id,
    }
