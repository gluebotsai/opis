"""MiniMax: deep-read one proposal/requirement section into a rich content pattern."""

from __future__ import annotations

import json
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
        "You deep-read one section of a historical B2B proposal or requirement "
        "to capture how that section is written and structured."
    ),
    goal=(
        "Learn the COMPLETE writing pattern of this one section so a later "
        "generate step can reproduce the same rhetorical sequence, density, and "
        "tables for a NEW customer — without copying PII."
    ),
    instructions=(
        "- Use only the provided page excerpts for this section.\n"
        "- Read the full excerpt. Do not collapse a multi-block section into "
        "'a paragraph and some bullets'.\n"
        "- blocks must list EVERY block in visual order: "
        "heading|paragraph|bullets|numbered_list|table|callout|signature. "
        "Each block.notes must say what that block does (e.g. '3-col comparison "
        "header: capability | requested | recommended').\n"
        "- contentPattern must be >= 150 characters. Describe: opening move, "
        "paragraph vs list density, whether a table appears and its shape, "
        "emphasis phrases, closing move. A vague one-liner is a failed learn.\n"
        "- typicalLength: short|medium|long with wordBand like '180-350' that "
        "matches the actual excerpt length. A short BRD list is still valid — "
        "describe that sparse shape; do not refuse.\n"
        "- If a table exists, tableSpec.columns must be the exact header labels "
        "in order, and notes must describe row kinds (feature rows, MRC/OTC, "
        "totals). shape none only when there is no table.\n"
        "- If the excerpt is thin, still write a >= 150 character contentPattern "
        "that explains the sparse shape (heading then short list/table, no extra "
        "chapters). Never return a one-liner.\n"
        "- Redact customer company/person names (say 'the customer').\n"
        "- Never invent prices or SKUs."
    ),
    context="Section metadata and page excerpts are in the user message.",
    output=(
        'Return ONLY JSON: {"key":"...","title":"...","intent":"...","tone":"...",'
        '"typicalLength":"short|medium|long","wordBand":"180-350",'
        '"blocks":[{"type":"paragraph","notes":"..."}],'
        '"hasTable":false,'
        '"tableSpec":{"shape":"none|phase_table|line_items|fixed_fee|subscription",'
        '"columns":["..."],"notes":"..."},'
        '"contentPattern":"...","summary":"..."}'
    ),
    guardrails="No PII. No verbatim multi-paragraph copy. Pattern must be reusable.",
)


def _min_pattern_len(kind: str) -> int:
    if kind in {"requirement", "brd", "rfp", "rfi"}:
        return 40
    return 80


def _excerpt_blob(excerpts: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for row in excerpts:
        if not isinstance(row, dict):
            continue
        text = " ".join(str(row.get("text") or "").split())
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def _pattern_from_evidence(
    *,
    section: dict[str, Any],
    excerpts: list[dict[str, Any]],
    kind: str,
    short_pattern: str,
) -> str:
    title = str(section.get("title") or section.get("key") or "section").strip()
    blob = _excerpt_blob(excerpts)
    has_table = "|" in blob or "table" in blob.lower()
    shape = (
        "present a table whose columns match the source"
        if has_table
        else "cover the requested items in short paragraphs or bullets"
    )
    return (
        f"For '{title}' in this {kind} document, keep the same heading then {shape}. "
        "Opening states the topic; body follows the source density and order; "
        "do not add extra chapters. Redact historical customer names. "
        f"{short_pattern} "
        f"Evidence: {blob[:280]}"
    ).strip()[:1200]


def _coerce_pattern(payload: dict[str, Any]) -> str:
    raw = payload.get("contentPattern")
    if isinstance(raw, str):
        pattern = raw.strip()
    elif isinstance(raw, list):
        pattern = " ".join(str(x).strip() for x in raw if str(x).strip())
    else:
        pattern = ""
    summary = str(payload.get("summary") or "").strip()
    if len(pattern) < 80 and summary:
        pattern = f"{pattern} {summary}".strip()
    return pattern


def _section_payload(
    *,
    section: dict[str, Any],
    payload: dict[str, Any],
    page_range: list[Any],
    pattern: str,
) -> dict[str, Any]:
    blocks = payload.get("blocks") if isinstance(payload.get("blocks"), list) else []
    key = str(payload.get("key") or section.get("key") or "section").strip()
    title = str(payload.get("title") or section.get("title") or key).strip()[:120]
    return {
        "key": key,
        "title": title,
        "pageRange": page_range,
        "intent": str(payload.get("intent") or section.get("intent") or "")[:300],
        "tone": str(payload.get("tone") or "formal")[:80],
        "typicalLength": str(payload.get("typicalLength") or "medium")[:20],
        "wordBand": str(payload.get("wordBand") or "")[:40],
        "blocks": blocks[:20],
        "hasTable": bool(payload.get("hasTable")),
        "tableSpec": payload.get("tableSpec")
        if isinstance(payload.get("tableSpec"), dict)
        else {"shape": "none"},
        "contentPattern": pattern[:1200],
        "summary": str(payload.get("summary") or section.get("summary") or "")[:600],
        "pricingHints": str(
            (payload.get("tableSpec") or {}).get("shape")
            if isinstance(payload.get("tableSpec"), dict)
            else ""
        )[:80],
    }


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    kind = str(body.get("kind") or "proposal").strip().lower()
    section = body.get("section") if isinstance(body.get("section"), dict) else {}
    pages = body.get("pages") if isinstance(body.get("pages"), list) else []
    page_range = (
        section.get("pageRange")
        if isinstance(section.get("pageRange"), list)
        else []
    )

    if not section:
        return {
            "ok": False,
            "status": "failed",
            "reason": "missing_section",
            "itemId": item_id,
        }

    if not is_ai_configured():
        return {
            "ok": False,
            "status": "failed",
            "reason": "llm_not_configured",
            "itemId": item_id,
        }

    selected_pages: list[dict[str, Any]] = []
    if page_range and len(page_range) >= 1:
        try:
            lo = int(page_range[0])
            hi = int(page_range[1] if len(page_range) > 1 else page_range[0])
        except (TypeError, ValueError):
            lo, hi = 1, 99
        for p in pages:
            if not isinstance(p, dict):
                continue
            try:
                n = int(p.get("n") or 0)
            except (TypeError, ValueError):
                continue
            if lo <= n <= hi:
                selected_pages.append(p)
    if not selected_pages:
        selected_pages = [p for p in pages[:4] if isinstance(p, dict)]

    excerpts = [
        {
            "n": p.get("n"),
            "text": str(p.get("text") or "")[:3500],
        }
        for p in selected_pages[:6]
    ]

    user = (
        f"Document kind: {kind}\nItem id: {item_id}\n"
        f"Section stub: {json.dumps(section, ensure_ascii=False)[:2000]}\n\n"
        f"Page excerpts:\n{json.dumps(excerpts, ensure_ascii=False)[:16000]}\n\n"
        "Learn the COMPLETE writing pattern of this section: every block in "
        "order, every table column, density, and rhetorical sequence. "
        "If the excerpt is sparse, still write a detailed pattern that describes "
        "that sparse shape. contentPattern must be at least 150 characters."
    )
    payload: dict[str, Any] = {}
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=4000,
            timeout_ms=LLM_JOB_TIMEOUT_MS,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-section-deep LLM failed")
        payload = {}
        text = None
        logger.warning("section-deep first pass failed: %s", exc)

    pattern = _coerce_pattern(payload)
    min_len = _min_pattern_len(kind)
    if len(pattern) < min_len:
        try:
            retry_text = await generate_ai_text(
                system=SYSTEM,
                user=(
                    user
                    + "\n\nPrevious contentPattern was too short. Write a full "
                    "reusable pattern (>= 150 characters) describing heading, "
                    "block sequence, table shape if any, and density. Return JSON."
                ),
                max_tokens=4000,
                timeout_ms=LLM_JOB_TIMEOUT_MS,
            )
            retry_payload = extract_json(retry_text or "") or {}
            retry_pattern = _coerce_pattern(retry_payload)
            if len(retry_pattern) >= len(pattern):
                payload = retry_payload or payload
                pattern = retry_pattern
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-corpus-section-deep retry failed: %s", exc)

    source = llm_source_tag()
    if len(pattern) < min_len:
        pattern = _pattern_from_evidence(
            section=section,
            excerpts=excerpts,
            kind=kind,
            short_pattern=pattern,
        )
        source = f"{source}_expanded"

    return {
        "ok": True,
        "status": "ok",
        "itemId": item_id,
        "section": _section_payload(
            section=section,
            payload=payload,
            page_range=page_range,
            pattern=pattern,
        ),
        "source": source,
    }
