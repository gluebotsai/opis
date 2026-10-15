"""LLM: study how one BRD became one winning proposal."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_section_keys import canonicalize_section_key
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

# Keep in lockstep with backend WORDS_PER_PROPOSAL_PAGE / density band.
_WORDS_PER_PROPOSAL_PAGE = 350
_MIN_WORDS_PER_PAGE_DENSITY = 120
_MAX_WORDS_PER_PAGE_DENSITY = 500

SYSTEM = sectioned_system_prompt(
    role="You are a proposal historian. You study one requirement and the proposal written from it.",
    goal=(
        "Explain how this specific BRD became this specific proposal: which "
        "requirement points drove which sections, how long each ran, tone, and "
        "whether copy was paraphrased from the BRD, drawn from product knowledge, "
        "or invented generically."
    ),
    instructions=(
        "- Use the uploaded section headings and requirement references.\n"
        "- wordCount is an integer estimate of that proposal section.\n"
        "- provenance must be one of paraphrased_from_brd, product_knowledge, invented_generic.\n"
        "- elaborationSignal: expanded | brief | mirrored.\n"
        "- Do not copy customer names, prices, or emails into the analysis.\n"
        "- lengthAnalysis.requirementComplexityScore is 0–1.\n"
        "- Do not invent requirementWordCount, proposalWordCount, or proposalPageCount; "
        "those are measured from the extracted text."
    ),
    context="Requirement text and winning-proposal extract are in the user message.",
    output=(
        "Return ONLY JSON: {\"sectionAnalysis\":[{\"sectionKey\":\"...\",\"sourceRequirementRefs\":"
        "[\"...\"],\"wordCount\":0,\"toneRegister\":\"...\",\"specificityLevel\":\"high|medium|low\","
        "\"provenance\":\"paraphrased_from_brd|product_knowledge|invented_generic\","
        "\"elaborationSignal\":\"expanded|brief|mirrored\"}],"
        "\"lengthAnalysis\":{\"requirementWordCount\":0,\"requirementComplexityScore\":0.5,"
        "\"proposalPageCount\":0,\"proposalWordCount\":0}}"
    ),
    guardrails="Never invent item ids. Never include real customer or contact names.",
)


def _word_count(text: str) -> int:
    return len((text or "").split())


def _table_text(tables: list[Any], table_id: str) -> str:
    """Flatten a ProposalTable (title/headers/rows) by id for word-count purposes."""
    if not table_id:
        return ""
    for t in tables:
        if isinstance(t, dict) and str(t.get("id") or "") == table_id:
            headers = t.get("headers") if isinstance(t.get("headers"), list) else []
            rows = t.get("rows") if isinstance(t.get("rows"), list) else []
            parts = [str(t.get("title") or ""), " ".join(str(h) for h in headers)]
            for r in rows:
                if isinstance(r, list):
                    parts.append(" ".join(str(c) for c in r))
            return "\n".join(p for p in parts if p)
    return ""


def _section_text(section: dict[str, Any], tables: list[Any]) -> str:
    """ProposalSection.blocks[] (prose/bullets/table/note) → flat text.

    Falls back to legacy body/content keys for older callers/tests that don't
    use the blocks schema.
    """
    blocks = section.get("blocks") if isinstance(section.get("blocks"), list) else []
    parts: list[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        text = str(block.get("text") or "").strip()
        if text:
            parts.append(text)
        items = block.get("items") if isinstance(block.get("items"), list) else []
        parts.extend(str(i) for i in items if str(i).strip())
        table_id = str(block.get("table_id") or block.get("tableId") or "")
        table_text = _table_text(tables, table_id)
        if table_text:
            parts.append(table_text)
    if not parts:
        legacy = section.get("body") or section.get("content")
        if legacy:
            parts.append(str(legacy))
    return "\n".join(parts)


def _section_bodies(proposal: dict[str, Any]) -> list[str]:
    sections = proposal.get("sections") if isinstance(proposal.get("sections"), list) else []
    tables = proposal.get("tables") if isinstance(proposal.get("tables"), list) else []
    out: list[str] = []
    for row in sections:
        if isinstance(row, dict):
            out.append(_section_text(row, tables))
    return out


def _extract_section_entries(proposal: dict[str, Any]) -> list[dict[str, Any]]:
    """(sectionKey, text) for every section in the extract, in document order,
    deduped by canonical key. Includes table sections (kind == "table") and
    closing/note sections — nothing here is filtered by "does it look like it
    matters"; that's the whole point of the completeness check below."""
    sections_in = proposal.get("sections") if isinstance(proposal.get("sections"), list) else []
    tables = proposal.get("tables") if isinstance(proposal.get("tables"), list) else []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in sections_in:
        if not isinstance(row, dict):
            continue
        key = canonicalize_section_key(
            str(row.get("heading") or row.get("id") or row.get("key") or row.get("title") or "")
        )
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"sectionKey": key, "text": _section_text(row, tables)})
    return out


def _backfill_row(entry: dict[str, Any]) -> dict[str, Any]:
    """A code-level stand-in analysis row for a section the LLM's JSON never
    mentioned. Word count is measured (not guessed); everything qualitative
    is a labeled heuristic placeholder — never presented as an LLM finding."""
    return {
        "sectionKey": entry["sectionKey"],
        "sourceRequirementRefs": [],
        "wordCount": max(40, _word_count(entry["text"])),
        "toneRegister": "formal",
        "specificityLevel": "medium",
        "provenance": "invented_generic",
        "elaborationSignal": "mirrored",
        "source": "heuristic_backfill",
    }


def _ensure_full_coverage(
    rows: list[dict[str, Any]],
    proposal: dict[str, Any],
) -> list[dict[str, Any]]:
    """Guarantee one sectionAnalysis row per extracted section — tables and
    closing notes included. The LLM's prompt asks it to cover every section
    but does not reliably comply (observed: comparison tables and
    customer-signed closing notes are the sections most often dropped).
    Backfilling in code, rather than relying solely on prompt wording, keeps
    downstream length-planning/table-shape logic from silently treating a
    skipped section as zero learned signal."""
    covered = {row.get("sectionKey") for row in rows if isinstance(row, dict)}
    out = list(rows)
    for entry in _extract_section_entries(proposal):
        if entry["sectionKey"] in covered:
            continue
        out.append(_backfill_row(entry))
        covered.add(entry["sectionKey"])
    return out


def measure_proposal_length(
    requirement: dict[str, Any],
    proposal: dict[str, Any],
) -> dict[str, int]:
    """Word/page counts from extracted text — never PDF sheet count alone."""
    req_words = _word_count(str(requirement.get("fullText") or ""))
    prop_text = str(proposal.get("fullText") or "")
    prop_words = _word_count(prop_text)
    if prop_words == 0:
        prop_words = sum(_word_count(body) for body in _section_bodies(proposal))
    pdf_pages = 0
    try:
        pdf_pages = max(0, int(proposal.get("pageCount") or 0))
    except (TypeError, ValueError):
        pdf_pages = 0
    derived = max(1, round(prop_words / _WORDS_PER_PROPOSAL_PAGE)) if prop_words else 0
    page_count = derived
    if pdf_pages > 0 and prop_words > 0:
        density = prop_words / pdf_pages
        if _MIN_WORDS_PER_PAGE_DENSITY <= density <= _MAX_WORDS_PER_PAGE_DENSITY:
            page_count = pdf_pages
    return {
        "requirementWordCount": req_words,
        "proposalWordCount": prop_words,
        "proposalPageCount": page_count,
    }


def _clamp_complexity(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.5
    if n != n:  # NaN
        return 0.5
    return min(1.0, max(0.0, n))


def _heuristic(body: dict[str, Any]) -> dict[str, Any]:
    proposal = body.get("proposal") if isinstance(body.get("proposal"), dict) else {}
    requirement = body.get("requirement") if isinstance(body.get("requirement"), dict) else {}
    analysis = [_backfill_row(entry) for entry in _extract_section_entries(proposal)[:20]]
    return {
        "sectionAnalysis": analysis,
        "lengthAnalysis": {
            **measure_proposal_length(requirement, proposal),
            "requirementComplexityScore": 0.5,
        },
    }


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    fallback = _heuristic(body)
    if not is_ai_configured():
        return label_fallback(
            {"ok": True, "status": "ok", **fallback},
            "llm_not_configured",
        )

    user = (
        "Study this requirement → proposal pair. Redact customer names.\n"
        f"{json.dumps(body, ensure_ascii=False, default=str)[:24_000]}"
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=4000,
            timeout_ms=90_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-case-study LLM failed")
        return label_fallback(
            {"ok": True, "status": "ok", **fallback},
            f"llm_error:{exc}",
        )

    sections = payload.get("sectionAnalysis")
    length = payload.get("lengthAnalysis")
    if not isinstance(sections, list) or not sections:
        return label_fallback(
            {"ok": True, "status": "ok", **fallback},
            "unusable_json",
        )
    cleaned: list[dict[str, Any]] = []
    for row in sections:
        if not isinstance(row, dict):
            continue
        key = canonicalize_section_key(str(row.get("sectionKey") or ""))
        if not key:
            continue
        refs = row.get("sourceRequirementRefs")
        cleaned.append(
            {
                "sectionKey": key[:120],
                "sourceRequirementRefs": [str(r)[:200] for r in refs][:8]
                if isinstance(refs, list)
                else [],
                "wordCount": int(row.get("wordCount") or 0),
                "toneRegister": str(row.get("toneRegister") or "formal")[:80],
                "specificityLevel": str(row.get("specificityLevel") or "medium")[:20],
                "provenance": str(row.get("provenance") or "paraphrased_from_brd")[:40],
                "elaborationSignal": str(row.get("elaborationSignal") or "mirrored")[:20],
                "source": "llm",
            }
        )
    length_rec = length if isinstance(length, dict) else {}
    measured = measure_proposal_length(
        body.get("requirement") if isinstance(body.get("requirement"), dict) else {},
        body.get("proposal") if isinstance(body.get("proposal"), dict) else {},
    )
    proposal_for_coverage = body.get("proposal") if isinstance(body.get("proposal"), dict) else {}
    complete_analysis = _ensure_full_coverage(
        cleaned or fallback["sectionAnalysis"], proposal_for_coverage
    )
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "sectionAnalysis": complete_analysis,
            "lengthAnalysis": {
                **measured,
                "requirementComplexityScore": _clamp_complexity(
                    length_rec.get("requirementComplexityScore")
                ),
            },
        }
    )
