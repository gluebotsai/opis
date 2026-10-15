"""LLM: write one proposal section against the learned content spec."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import SectionDraft
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.knowledge_base import KB_UNAVAILABLE_MESSAGE, KB_UNAVAILABLE_REASON
from app.services.proposal_gemini import (
    GEMINI_UNAVAILABLE_MESSAGE,
    GEMINI_UNAVAILABLE_REASON,
    format_gemini_error,
    generate_json,
    is_gemini_unavailable,
    proposal_gemini_configured,
)
from app.services.proposal_knowledge import load_section_kb, product_id_candidates

logger = logging.getLogger(__name__)

EXTRA_CAP = 28_000
REQUIREMENT_CAP = 8_000
COMMERCIAL_REQUIREMENT_CAP = 48_000
_COMMERCIAL_KEY = re.compile(
    r"pricing|commercial|usage|compare|comparison|one_time|monthly|mrc|otc",
    re.I,
)
KB_EXTRA_CAP = 4_000
EXEMPLAR_CAP = 6_000
PROFILE_CAP = 2_000
SPEC_CAP = 3_000
PRODUCT_FIELD_KEYS = (
    "id",
    "sku",
    "skuId",
    "name",
    "price",
    "listPrice",
    "currency",
    "unit",
    "uom",
    "unitOfMeasure",
    "billingFrequency",
    "meterKey",
)


def _table_spec(body: dict[str, Any], skeleton: dict[str, Any]) -> dict[str, Any]:
    for raw in (body.get("tableSpec"), skeleton.get("tableSpec")):
        if not isinstance(raw, dict):
            continue
        cols = raw.get("columns")
        if isinstance(cols, list) and any(str(c).strip() for c in cols):
            return raw
    return {}


def _system(target_words: int, table_spec: dict[str, Any] | None = None) -> str:
    n = max(1, int(target_words or 220))
    table_lines = ""
    if table_spec:
        cols = [str(c).strip() for c in (table_spec.get("columns") or []) if str(c).strip()]
        if cols:
            table_lines = (
                "- This section has a learned table. Set kind to \"mixed\" (or \"table\").\n"
                f"- Emit tableRows as objects {{cells: [...]}} with exactly {len(cols)} cells "
                f"in this column order: {json.dumps(cols, ensure_ascii=False)}.\n"
                "- Row labels (first cell) come from THIS requirement and ALLOWED PRODUCTS, "
                "never from exemplars or another customer.\n"
                "- Fill price/amount/rate cells from PRODUCTS (list price, addons, tiers) "
                "when the BRD calls for commercial detail; do not invent figures outside PRODUCTS.\n"
            )
    return sectioned_system_prompt(
        role="You write one section of a commercial proposal in the org's learned voice.",
        goal=(
            "Fill this section for the CURRENT customer using the requirement, "
            "the exclusive section purpose, org knowledge-base excerpts, catalog "
            "products, anonymized style exemplars, and a recap of sections already written."
        ),
        instructions=(
            "- Write only this section's purpose. Do not repeat facts already in rollingRecap; "
            "add only new depth or point back in one clause.\n"
            "- Write each fact once. Do not repeat a paragraph, sentence, or bullet list "
            "inside this section.\n"
            f"- Write about {n} words for this section. Do not pad past that.\n"
            "- Product capabilities come only from KNOWLEDGE BASE excerpts. "
            "If the knowledge base has no fact, write less — do not restate the BRD. "
            "All rates and amounts come from PRODUCTS (full catalog JSON), shaped by the BRD.\n"
            "- Use facts from THIS requirement. Exemplars are style only — never copy their facts.\n"
            "- Return body as customer-ready prose (paragraphs and optional bullets).\n"
            f"{table_lines}"
        ),
        context=(
            "Section spec, purpose, exemplars, rolling recap, requirement excerpt, "
            "knowledge base, and products are in the user message."
        ),
        output="Return JSON matching the SectionDraft schema.",
        guardrails=(
            "Use only catalog prices from PRODUCTS — never invent amounts. "
            "Never reuse historical customer names. "
            "Never dump the full prior document into this section. "
            "Never invent product capabilities that are not in the knowledge base."
        ),
    )


def _fallback_section(key: str, heading: str) -> dict[str, Any]:
    return {
        "key": key,
        "heading": heading,
        "body": (
            f"{heading}. Address the customer's stated needs for this section "
            "using the requirement facts provided."
        ),
        "kind": "prose",
        "tableRows": [],
    }


def _section_requirement(body: dict[str, Any], heading: str, purpose: str) -> str:
    full = str(body.get("requirementText") or "")
    key = str(body.get("sectionKey") or "")
    if _COMMERCIAL_KEY.search(key) or _COMMERCIAL_KEY.search(heading):
        return full[:COMMERCIAL_REQUIREMENT_CAP]
    if len(full) <= REQUIREMENT_CAP:
        return full
    needles = [heading, purpose]
    lower = full.lower()
    snippets: list[str] = [full[:2_000]]
    for needle in needles:
        token = str(needle or "").strip().lower()
        if len(token) < 4:
            continue
        idx = lower.find(token)
        if idx >= 0:
            start = max(0, idx - 400)
            snippets.append(full[start : start + 2_400])
    snippets.append(full[-2_000:])
    seen: set[str] = set()
    ordered: list[str] = []
    for part in snippets:
        if part and part not in seen:
            seen.add(part)
            ordered.append(part)
    return "\n\n---\n\n".join(ordered)[:REQUIREMENT_CAP]


def _capped(raw: Any, cap: int) -> Any:
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw[:cap] or None
    dumped = json.dumps(raw, ensure_ascii=False, default=str)
    if len(dumped) <= cap:
        return raw
    if isinstance(raw, list):
        kept: list[Any] = []
        size = 2
        for item in raw:
            piece = json.dumps(item, ensure_ascii=False, default=str)
            if kept and size + len(piece) + 1 > cap:
                break
            kept.append(item)
            size += len(piece) + 1
        return kept or dumped[:cap]
    return dumped[:cap]


def _compact_products(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, list):
        return None
    slim: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        item: dict[str, Any] = {}
        for key, val in row.items():
            if val in (None, ""):
                continue
            if key in ("description", "tagline") and isinstance(val, str):
                item[key] = val[:1200]
            else:
                item[key] = val
        if item:
            slim.append(item)
        if len(slim) >= 100:
            break
    return slim or None


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    skeleton = body.get("section") if isinstance(body.get("section"), dict) else {}
    key = str(body.get("sectionKey") or skeleton.get("key") or "section")
    heading = str(
        body.get("heading") or skeleton.get("title") or skeleton.get("heading") or key
    )
    purpose = str(
        body.get("purpose")
        or (skeleton.get("purpose") if isinstance(skeleton, dict) else "")
        or ""
    )
    fallback = _fallback_section(key, heading)
    table_spec = _table_spec(body, skeleton)
    if table_spec:
        fallback["kind"] = "mixed"
    target_words = 220
    try:
        target_words = max(1, int(body.get("targetWords") or 220))
    except (TypeError, ValueError):
        target_words = 220

    if not proposal_gemini_configured() and not is_ai_configured():
        return label_fallback(
            {"ok": True, "status": "ok", "section": fallback},
            "llm_not_configured",
        )

    knowledge = str(body.get("knowledgeBase") or "").strip()
    org = str(body.get("organizationId") or body.get("organization_id") or "") or None
    products = body.get("products")
    product_rows = [row for row in products if isinstance(row, dict)] if isinstance(products, list) else []
    product_ids: list[str] = []
    for row in product_rows:
        for cand in product_id_candidates(row):
            if cand not in product_ids:
                product_ids.append(cand)
    requirement_excerpt = _section_requirement(body, heading, purpose)
    if not knowledge:
        leaf_query = " ".join(
            part for part in (purpose, requirement_excerpt[:800]) if part
        ).strip()
        if leaf_query:
            leaf_kb, leaf_fail = await load_section_kb(
                leaf_query,
                organization_id=org,
                product_ids=product_ids,
            )
            if leaf_fail == KB_UNAVAILABLE_REASON:
                return label_fallback(
                    {
                        "ok": False,
                        "status": "failed",
                        "section": fallback,
                        "error": KB_UNAVAILABLE_MESSAGE,
                        "reason": KB_UNAVAILABLE_REASON,
                    },
                    KB_UNAVAILABLE_REASON,
                )
            if leaf_kb:
                knowledge = leaf_kb

    recap = body.get("alreadyCovered") or body.get("rollingRecap")
    extra = json.dumps(
        {
            "sectionKey": key,
            "heading": heading,
            "purpose": purpose or None,
            "tableSpec": table_spec or None,
            "spec": _capped(body.get("spec"), SPEC_CAP),
            "targetWords": target_words,
            "exemplars": _capped(body.get("exemplars"), EXEMPLAR_CAP),
            "requirementText": requirement_excerpt,
            "alreadyCovered": recap,
            "profile": _capped(body.get("profile"), PROFILE_CAP),
            "allowedProducts": body.get("allowedProducts"),
            "products": _compact_products(body.get("products")),
            "knowledgeBase": (knowledge[:KB_EXTRA_CAP] or None),
            "validatorNotes": body.get("validatorNotes"),
        },
        ensure_ascii=False,
        default=str,
    )[:EXTRA_CAP]
    logger.info(
        "[proposal-generate] section llm start key=%s heading=%s target_words=%s extra_chars=%s kb_chars=%s gemini=%s",
        key,
        heading,
        target_words,
        len(extra),
        len(knowledge),
        proposal_gemini_configured(),
    )
    fill_note = ""
    if body.get("tableFillRetry"):
        fill_note = (
            " The previous draft left commercial table cells empty. "
            "Fill every table cell from PRODUCTS and the BRD. Do not leave rate cells blank "
            "when PRODUCTS has a price, addon, or tier."
        )
    prompt = (
        f"{_system(target_words, table_spec)}\n\nWrite about {target_words} words "
        "for this section. Do not pad past that. Do not restate rollingRecap."
        f"{fill_note}"
    )
    payload: dict[str, Any] = {}
    gemini = proposal_gemini_configured()

    if gemini:
        try:
            model = await generate_json(
                prompt,
                SectionDraft,
                extra_text=extra,
            )
            payload = model.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-generate-section Gemini failed: %s", exc)
            if is_gemini_unavailable(exc):
                return label_fallback(
                    {
                        "ok": False,
                        "status": "failed",
                        "section": fallback,
                        "error": GEMINI_UNAVAILABLE_MESSAGE,
                    },
                    GEMINI_UNAVAILABLE_REASON,
                )
            return label_fallback(
                {
                    "ok": False,
                    "status": "failed",
                    "section": fallback,
                    "error": format_gemini_error(exc),
                },
                f"llm_error:{type(exc).__name__}",
            )
    elif is_ai_configured():
        try:
            text = await generate_ai_text(
                system=_system(target_words, table_spec),
                user=f"Write approximately {target_words} words for this section.\n{extra}",
                max_tokens=max(2_000, target_words * 4),
                timeout_ms=90_000,
            )
            payload = extract_json(text or "") or payload
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-generate-section LLM failed")
            return label_fallback(
                {"ok": True, "status": "ok", "section": fallback},
                f"llm_error:{exc}",
            )

    body_text = str(payload.get("body") or "").strip()
    if not body_text:
        logger.warning("[proposal-generate] section unusable_json key=%s", key)
        return label_fallback(
            {"ok": True, "status": "ok", "section": fallback},
            "unusable_json",
        )
    words = len(body_text.split())
    logger.info(
        "[proposal-generate] section llm done key=%s words=%s target_words=%s via=%s",
        key,
        words,
        target_words,
        "gemini" if gemini else "fallback",
    )
    rows = payload.get("tableRows")
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "section": {
                "key": str(payload.get("key") or key),
                "heading": str(payload.get("heading") or heading),
                "body": body_text,
                "kind": str(
                    payload.get("kind")
                    or ("mixed" if table_spec else "prose")
                ),
                "tableRows": rows if isinstance(rows, list) else [],
            },
        }
    )
