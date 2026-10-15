"""LLM: fill a learned proposal template from page images, BRD, and catalog.

Layout comes from the approved playbook's page rasters. All customer copy and
commercial figures come from the model using the BRD and PRODUCTS only.
"""

from __future__ import annotations

import base64
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
_COMMERCIAL_BRD_CAP = 48_000
_CATALOG_CAP = 24_000
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
        if len(out) >= 32:
            break
    return out


def _system() -> str:
    return sectioned_system_prompt(
        role="You fill a commercial proposal that must match a learned page layout.",
        goal=(
            "Write every section for THIS customer so the document follows the "
            "uploaded page images (section order, table shapes, emphasis) while "
            "using only the BRD and PRODUCTS for facts and prices."
        ),
        instructions=(
            "- Return one section per skeleton key, in that order.\n"
            "- Page images are the layout reference. Do not copy another customer's names or sentences from them.\n"
            "- Prose and table cell text are yours. Fill tableRows when columns are listed.\n"
            "- Commercial, pricing, usage, and comparison sections must use the FULL BRD slice "
            "and catalog prices, addons, and tiers. Do not leave price cells blank when PRODUCTS has a rate.\n"
            "- Do not invent amounts that are not in PRODUCTS or the BRD.\n"
            "- Product capabilities come from the knowledge base. Write each fact once; "
            "do not repeat a paragraph or bullet list inside a section."
        ),
        context="Page images, skeleton, CSS color tokens, catalog, and BRD are attached.",
        output="Return JSON matching TemplateFillResult.",
        guardrails=(
            "Never reuse historical customer names from the page images. "
            "Never invent catalog prices."
        ),
    )


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
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
                "error": "Page-image generate needs the Gemini vision client.",
            },
            "vision_unavailable",
        )

    requirement = str(body.get("requirementText") or "")[:_COMMERCIAL_BRD_CAP]
    summary = str(body.get("requirementSummary") or "")[:4_000]
    products = body.get("products") if isinstance(body.get("products"), list) else []
    css_tokens = _css_tokens(str(body.get("css") or ""))
    extra = json.dumps(
        {
            "skeleton": skeleton,
            "cssTokens": css_tokens,
            "requirementSummary": summary,
            "fullBrdForCommercialSections": requirement,
            "allowedProducts": body.get("allowedProducts"),
            "products": products[:100],
        },
        ensure_ascii=False,
        default=str,
    )[: _CATALOG_CAP + _COMMERCIAL_BRD_CAP]
    logger.info(
        "[proposal-generate] template fill llm pages=%s sections=%s extra_chars=%s",
        len(images),
        len(skeleton),
        len(extra),
    )
    try:
        model = await generate_json(
            _system(),
            TemplateFillResult,
            image_bytes=images,
            extra_text=extra,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("proposal-fill-template failed: %s", exc)
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
