"""Vision fill for quote / invoice templates (parallel to proposal-fill-template)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import TemplateFillResult
from app.services.proposal_gemini import (
    GEMINI_UNAVAILABLE_MESSAGE,
    GEMINI_UNAVAILABLE_REASON,
    format_gemini_error,
    generate_json,
    is_gemini_unavailable,
    proposal_gemini_configured,
)

logger = logging.getLogger(__name__)

_MAX_IMAGES = 8
_CONTEXT_CAP = 48_000
_TOKEN_RE = re.compile(r"--c-(?:primary|accent|th|text|border)\s*:\s*[^;]+", re.I)


def _vision_runtime_available() -> bool:
    if not proposal_gemini_configured():
        return False
    try:
        import google.genai  # noqa: F401
    except ImportError:
        return False
    return True


def _decode_page_images(raw: Any) -> list[tuple[bytes, str]]:
    if not isinstance(raw, list):
        return []
    out: list[tuple[bytes, str]] = []
    for row in raw:
        if len(out) >= _MAX_IMAGES or not isinstance(row, dict):
            continue
        mime = str(row.get("mime") or "image/png")
        b64 = str(row.get("dataBase64") or "").strip()
        data_url = str(row.get("dataUrl") or "").strip()
        if not b64 and "," in data_url:
            b64 = data_url.split(",", 1)[1]
        if len(b64) < 32:
            continue
        try:
            import base64

            blob = base64.b64decode(b64, validate=False)
        except Exception:  # noqa: BLE001
            continue
        if blob:
            out.append((blob, mime))
    return out


def _css_tokens(css: str) -> str:
    hits = _TOKEN_RE.findall(css or "")
    return "\n".join(hits[:12])


def _skeleton_summary(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        spec = row.get("tableSpec") if isinstance(row.get("tableSpec"), dict) else {}
        cols = spec.get("columns") if isinstance(spec, dict) else None
        out.append(
            {
                "key": str(row.get("key") or ""),
                "title": str(row.get("title") or row.get("heading") or ""),
                "purpose": str(row.get("purpose") or ""),
                "columns": [str(c) for c in cols] if isinstance(cols, list) else [],
            }
        )
        if len(out) >= 24:
            break
    return out


def _system(kind: str) -> str:
    doc = "quotation" if kind == "quote" else "invoice"
    return sectioned_system_prompt(
        role=f"You fill a {doc} that must match a learned page layout.",
        goal=(
            "Write section bodies for THIS customer/deal so the document follows "
            "the uploaded page images (letterhead, tables, footer). Use ONLY the "
            "structured context for names, dates, line items, tax, and totals."
        ),
        instructions=(
            "- Return one section per skeleton key, in that order.\n"
            "- Page images are layout reference only — do not copy sample customer names.\n"
            "- line_items: use PRODUCTS rows; amounts must match context merge fields.\n"
            "- For invoices: include GST/tax wording, amount in words, bank block, and "
            "payment terms when those sections exist in the skeleton.\n"
            "- Prose sections (introduction, terms): professional commercial tone.\n"
            "- Do not invent line items or prices not in PRODUCTS / merge."
        ),
        context="Page images, skeleton, CSS tokens, and JSON context are attached.",
        output="Return JSON matching TemplateFillResult.",
        guardrails="Never invent totals. Never add products not in context.",
    )


async def run_for_kind(body: dict[str, Any], kind: str) -> dict[str, Any]:
    body = body or {}
    images = _decode_page_images(body.get("pageImages"))
    skeleton = _skeleton_summary(body.get("skeleton") or body.get("sections"))
    if not skeleton:
        return label_fallback(
            {"ok": False, "status": "failed", "sections": [], "reason": "missing_skeleton"},
            "missing_skeleton",
        )
    if not images:
        return label_fallback(
            {"ok": False, "status": "failed", "sections": [], "reason": "missing_page_images"},
            "missing_page_images",
        )
    if not _vision_runtime_available():
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "sections": [],
                "reason": "vision_unavailable",
                "error": "Page-image fill needs the Gemini vision client.",
            },
            "vision_unavailable",
        )

    ctx = body.get("context") if isinstance(body.get("context"), dict) else {}
    extra = json.dumps(
        {
            "kind": kind,
            "skeleton": skeleton,
            "cssTokens": _css_tokens(str(body.get("css") or "")),
            "context": ctx,
        },
        ensure_ascii=False,
        default=str,
    )[:_CONTEXT_CAP]

    try:
        model = await generate_json(
            _system(kind),
            TemplateFillResult,
            image_bytes=images,
            extra_text=extra,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("%s-fill-template failed: %s", kind, exc)
        if is_gemini_unavailable(exc):
            return label_fallback(
                {
                    "ok": False,
                    "status": "failed",
                    "sections": [],
                    "error": GEMINI_UNAVAILABLE_MESSAGE,
                },
                GEMINI_UNAVAILABLE_REASON,
            )
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "sections": [],
                "error": format_gemini_error(exc),
            },
            f"llm_error:{type(exc).__name__}",
        )

    payload = model.model_dump()
    sections = []
    for row in payload.get("sections") or []:
        if not isinstance(row, dict):
            continue
        sections.append(
            {
                "key": str(row.get("key") or ""),
                "title": str(row.get("title") or row.get("heading") or ""),
                "body": str(row.get("body") or ""),
                "tableRows": row.get("tableRows") or [],
            }
        )
    if not sections:
        return label_fallback(
            {"ok": False, "status": "failed", "sections": [], "reason": "empty_sections"},
            "empty_sections",
        )
    return label_ai({"ok": True, "status": "ok", "sections": sections})
