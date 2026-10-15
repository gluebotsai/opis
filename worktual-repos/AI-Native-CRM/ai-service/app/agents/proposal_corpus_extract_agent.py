"""Gemini extract: BRD JSON, proposal instance, layout merge (parser wins)."""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from app.agents.llm_result import label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_layout import (
    apply_layout_to_tokens,
    merge_layout,
    normalize_cover,
)
from app.agents.proposal_pdf_parse import parse_pdf_bytes, tables_as_text
from app.agents.proposal_schemas import BrdExtraction, LayoutExtraction, ProposalInstance
from app.services.proposal_gemini import generate_json, proposal_gemini_configured

logger = logging.getLogger(__name__)

_MAX_PAGE_IMAGES = 8


def _page_images(screenshots: Any) -> list[dict[str, Any]]:
    """Up to 8 PNG page rasters for multimodal generate. Not gold prose."""
    import base64

    out: list[dict[str, Any]] = []
    if not isinstance(screenshots, list):
        return out
    for item in screenshots:
        if len(out) >= _MAX_PAGE_IMAGES:
            break
        blob: bytes | None = None
        mime = "image/png"
        if isinstance(item, (tuple, list)) and item:
            raw = item[0]
            if isinstance(raw, bytes):
                blob = raw
            elif isinstance(raw, str) and raw:
                try:
                    blob = base64.b64decode(raw)
                except Exception:  # noqa: BLE001
                    blob = None
            if len(item) > 1 and isinstance(item[1], str):
                mime = item[1] or mime
        elif isinstance(item, dict):
            b64 = str(item.get("dataBase64") or "")
            if b64:
                out.append(
                    {
                        "page": int(item.get("page") or len(out) + 1),
                        "mime": str(item.get("mime") or mime),
                        "dataBase64": b64,
                    }
                )
            continue
        if not blob:
            continue
        out.append(
            {
                "page": len(out) + 1,
                "mime": mime,
                "dataBase64": base64.b64encode(blob).decode("ascii"),
            }
        )
    return out

BRD_PROMPT = sectioned_system_prompt(
    role="You extract a structured BRD / requirement from a sales document.",
    goal="Return a complete BrdExtraction JSON for the current document only.",
    instructions=(
        "- Do not invent quantities, prices, products, or client facts.\n"
        "- Capture client name, industry, website, objectives, pain points, "
        "requested solutions, channels, languages, integrations, and numeric "
        "quantities when present.\n"
        "- Keep wording close to the source. Leave fields empty rather than guessing."
    ),
    context="PDF bytes when present, otherwise extracted Word/text plus parser tables.",
    output="Return JSON matching the BrdExtraction schema.",
    guardrails="Never copy a historical proposal. Never invent prices.",
)

PROPOSAL_PROMPT = sectioned_system_prompt(
    role="You extract the content of a winning sales proposal.",
    goal="Return ProposalInstance JSON: cover, sections/blocks, tables, assumptions.",
    instructions=(
        "Cover (do not leave these empty when they appear on page 1):\n"
        "- brand: the vendor wordmark only. Never put \"Commercial Proposal\" here.\n"
        "- title: the document type line, usually \"Commercial Proposal\". "
        "If you see that phrase, title MUST be that string. title is NOT the brand.\n"
        "- prepared_for: client name (with or without the words Prepared for).\n"
        "- date: as printed.\n"
        "- subtitle: only a second line that is not the title (otherwise empty).\n"
        "- product_tags: each solution name as its own list item. Do not merge them.\n"
        "- tag_layout: centered_wrap if tags sit in a centered wrapped band; "
        "vertical if each tag is its own left stacked row; horizontal if one left inline row.\n"
        "- brand_align / cover_align: as printed on page 1.\n"
        "- meta_rows: if page 1 has a two-column facts block (Client / Document / "
        "Validity / Prepared By / Prepared For), extract EVERY row as {label, value}.\n"
        "- PARSER MEASURED LAYOUT alignments and meta_rows must be copied onto cover.\n"
        "- Do NOT put BRD fields (Client Name, Industry, Website, Lead Source) in meta_rows. "
        "Those belong in BrdExtraction. Cover meta is only Client / Document / Validity "
        "(or Prepared By / Prepared For) when that table is printed on page 1.\n"
        "Body: copy headings, bullets, and table cells as written. Do not invent prices.\n"
        "Section headings like Overview are body-sized bold, not the cover wordmark size."
    ),
    context="Gold proposal PDF when present, otherwise Word/text plus parser layout and tables.",
    output="Return JSON matching the ProposalInstance schema.",
    guardrails="Do not emit CSS. Never invent missing pages.",
)

LAYOUT_PROMPT = sectioned_system_prompt(
    role="You read visual layout from a proposal PDF.",
    goal="Return LayoutExtraction with alignments and point sizes that match the PDF.",
    instructions=(
        "- Prefer PARSER MEASURED LAYOUT whenever a number is non-zero. Copy those floats.\n"
        "- Do not set heading_font_pt to the brand/wordmark size.\n"
        "- Spacing is the empty gap between boxes in points (bottom of one line to top of the next).\n"
        "- brand_align: wordmark — center if it sits in the middle of the page.\n"
        "- title_align / prepared_align / date_align: measure each line. Do not assume left.\n"
        "- tags_layout: centered_wrap if bullets wrap in a centered band; vertical if stacked left.\n"
        "- has_cover_meta_table: true if a Client / Document / Validity (or similar) block exists.\n"
        "- heading_align: section titles like Overview — usually left.\n"
        "- Font sizes: brand_font_pt = wordmark; title_font_pt = Commercial Proposal only; "
        "heading_font_pt = Overview (often body-sized)."
    ),
    context="Page-1 screenshot plus parser layout JSON.",
    output="Return JSON matching the LayoutExtraction schema.",
    guardrails="Do not invent sizes when the parser already measured them. Do not emit CSS.",
)


def _decode_pdf(body: dict[str, Any]) -> bytes:
    raw = body.get("contentBase64")
    if isinstance(raw, str) and raw.strip():
        try:
            return base64.b64decode(raw.strip())
        except Exception:  # noqa: BLE001
            return b""
    return b""


def _is_pdf(filename: str) -> bool:
    return str(filename or "").lower().endswith(".pdf")


def _document_text(filename: str, raw: bytes, body_full_text: str) -> str:
    """Plain text for Gemini. Never send Word/text bytes as application/pdf."""
    existing = str(body_full_text or "").strip()
    if existing:
        return existing[:40_000]
    if _is_pdf(filename) or not raw:
        return ""
    from app.agents.document_template_agent import extract_sample_text_from_file

    text, _warnings = extract_sample_text_from_file(
        filename, base64.b64encode(raw).decode("ascii")
    )
    return str(text or "").strip()[:40_000]


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _is_transport_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}:{exc}".lower()
    needles = (
        "timeout",
        "timed out",
        "handshake",
        "_ssl.c",
        "connecttimeout",
        "connection reset",
        "temporarily unavailable",
        "deadline exceeded",
        "deadline_exceeded",
        "unavailable",
        "504",
    )
    return any(needle in text for needle in needles)


# Extract fills a schema from already-parsed text. High thinking often 504s.
EXTRACT_THINKING_LEVEL = "low"


async def _generate_json_pdf_then_text(
    prompt: str,
    schema: Any,
    *,
    extra: str,
    pdf_parts: list[bytes],
    image_bytes: list[tuple[bytes, str]] | None = None,
) -> tuple[Any, bool]:
    """LLM extract. Prefer PDF parts; on Gemini transport failure, retry text-only."""
    json_kwargs: dict[str, Any] = {"thinking_level": EXTRACT_THINKING_LEVEL}
    if pdf_parts:
        try:
            result = await generate_json(
                prompt,
                schema,
                pdf_bytes=pdf_parts,
                image_bytes=image_bytes,
                extra_text=extra,
                **json_kwargs,
            )
            return result, False
        except Exception as exc:  # noqa: BLE001
            if extra.strip() and _is_transport_error(exc):
                logger.warning(
                    "Gemini PDF extract failed (%s); retrying with ingested text only",
                    exc,
                )
                result = await generate_json(
                    prompt,
                    schema,
                    pdf_bytes=None,
                    image_bytes=None,
                    extra_text=extra,
                    **json_kwargs,
                )
                return result, True
            raise
    result = await generate_json(
        prompt,
        schema,
        pdf_bytes=None,
        image_bytes=image_bytes,
        extra_text=extra,
        **json_kwargs,
    )
    return result, False


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    kind = str(body.get("kind") or "requirement").strip().lower()
    filename = str(body.get("filename") or "document.pdf")
    pdf = _decode_pdf(body)
    extra_from_body = str(body.get("fullText") or "").strip()
    if not pdf and not extra_from_body:
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "reason": "missing_content",
                "itemId": item_id,
            },
            "missing_content",
        )

    parsed: dict[str, Any] = {}
    is_pdf = _is_pdf(filename)
    if is_pdf and pdf:
        try:
            parsed = parse_pdf_bytes(pdf, max_screenshots=8)
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-corpus-extract parse failed: %s", exc)
            parsed = {}

    extra = _document_text(
        filename,
        pdf,
        str(parsed.get("full_text") or body.get("fullText") or extra_from_body),
    )
    if parsed.get("tables"):
        extra = f"{extra}\n\n{tables_as_text(parsed['tables'])}" if extra else tables_as_text(parsed["tables"])
    pdf_parts = [pdf] if is_pdf and pdf else []
    if not extra and not pdf_parts:
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "reason": "no_extractable_text",
                "itemId": item_id,
                "kind": kind,
            },
            "no_extractable_text",
        )

    if not proposal_gemini_configured():
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "itemId": item_id,
                "kind": kind,
                "reason": "proposal_gemini_not_configured",
            },
            "proposal_gemini_not_configured",
        )

    try:
        if kind != "proposal":
            # Requirements are content-only; ingested text avoids Gemini PDF handshake timeouts.
            brd_pdf = [] if extra.strip() else pdf_parts
            brd, _used_text = await _generate_json_pdf_then_text(
                BRD_PROMPT,
                BrdExtraction,
                extra=extra[:20_000],
                pdf_parts=brd_pdf,
            )
            return label_ai(
                {
                    "ok": True,
                    "status": "ok",
                    "itemId": item_id,
                    "kind": kind,
                    "brd": brd.model_dump(),
                    "tables": parsed.get("tables") or [],
                    "themeTokens": parsed.get("theme_tokens") or {},
                    "layoutMeasured": parsed.get("layout_measured") or {},
                }
            )

        layout_parser = parsed.get("layout_measured") or {}
        images = parsed.get("screenshots") or []
        prop_extra = (
            "PARSER MEASURED LAYOUT (copy alignments, font sizes, spacing, "
            "and meta_rows when present):\n"
            + _dumps(layout_parser)
            + "\n\nDOCUMENT TEXT:\n"
            + extra[:28_000]
        )
        if parsed.get("tables"):
            prop_extra += "\n\nPARSER TABLES:\n" + tables_as_text(parsed["tables"])
        proposal, used_text_fallback = await _generate_json_pdf_then_text(
            PROPOSAL_PROMPT,
            ProposalInstance,
            extra=prop_extra[:30_000],
            pdf_parts=pdf_parts,
            image_bytes=images[:2],
        )
        layout = dict(layout_parser)
        if (pdf_parts or images) and not used_text_fallback:
            try:
                layout_llm, _layout_text = await _generate_json_pdf_then_text(
                    LAYOUT_PROMPT,
                    LayoutExtraction,
                    extra=(
                        "PARSER MEASURED LAYOUT (copy non-zero numbers; do not invent "
                        "conflicting sizes):\n"
                        + _dumps(layout_parser)
                    ),
                    pdf_parts=pdf_parts,
                    image_bytes=images[:2],
                )
                layout = merge_layout(layout_parser, layout_llm.model_dump())
            except Exception as exc:  # noqa: BLE001
                logger.warning("layout extract failed; parser measurements used: %s", exc)
                layout = merge_layout(layout_parser, layout)
        else:
            layout = merge_layout(layout_parser, layout)

        tokens = apply_layout_to_tokens(parsed.get("theme_tokens") or {}, layout)
        proposal_dump = proposal.model_dump()
        proposal_dump["cover"] = normalize_cover(proposal_dump.get("cover") or {}, layout)
        logo_b64 = str(parsed.get("logo_b64") or "")
        return label_ai(
            {
                "ok": True,
                "status": "ok",
                "itemId": item_id,
                "kind": kind,
                "instance": proposal_dump,
                "layout": layout,
                "themeTokens": tokens,
                "tables": parsed.get("tables") or [],
                "logoB64": logo_b64,
                "headerText": parsed.get("header_text") or "",
                "footerText": parsed.get("footer_text") or "",
                "pageImages": _page_images(parsed.get("screenshots")),
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-extract failed")
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "itemId": item_id,
                "kind": kind,
                "reason": f"llm_error:{exc}",
            },
            f"llm_error:{exc}",
        )
