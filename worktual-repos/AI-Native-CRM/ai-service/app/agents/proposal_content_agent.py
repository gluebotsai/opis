"""Rewrite proposal section bodies for a specific deal/customer (keep structure)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, TypedDict, Optional

from app.agents.native_pipeline import run_steps

from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.knowledge_base import get_sales_knowledge

logger = logging.getLogger(__name__)

TOKEN_RE = re.compile(r"\{\{[a-zA-Z0-9_]+\}\}")


class ContentState(TypedDict, total=False):
    sections: list[dict[str, Any]]
    context: dict[str, Any]
    vendor_name: str
    kb_context: str
    warnings: list[str]
    status: str
    reason: Optional[str]
    out_sections: list[dict[str, Any]]


def _normalize_plain_text(value: str) -> str:
    out = value or ""
    for _ in range(4):
        if "\\n" not in out and "\\t" not in out and "\\r" not in out:
            break
        out = (
            out.replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\r", "\n")
        )
    out = out.replace("\r\n", "\n").replace("\r", "\n")
    # Logo/hero belong in blueprint assets — drop raw markdown imagery from bodies
    out = re.sub(
        r"^!\[[^\]]*\]\((?:asset:[a-z0-9_-]+|data:image/[^)]+)\)\s*$",
        "",
        out,
        flags=re.I | re.M,
    )
    out = re.sub(
        r"!\[[^\]]*\]\((?:asset:[a-z0-9_-]+|data:image/[^)]+)\)",
        "",
        out,
        flags=re.I,
    )
    out = re.sub(r"\*\*([^*]+)\*\*", r"\1", out)
    out = re.sub(r"__([^_]+)__", r"\1", out)
    out = re.sub(r"`([^`]+)`", r"\1", out)
    out = re.sub(r"^#{1,6}\s+", "", out, flags=re.M)
    out = out.replace("**", "").replace("__", "")
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _extract_json_payload(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return {"sections": data}
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            pass
    return None


def _system_prompt(*, surgical: bool = False) -> str:
    if surgical:
        return """You surgically edit an existing sales proposal section.
The skeleton body is the source of truth. Return ONLY valid JSON (no markdown fences):
{
  "sections": [
    {"id": "...", "key": "...", "title": "...", "body": "...", "sortOrder": 1}
  ]
}

Rules:
- Keep the same section id, key, title, and sortOrder unless the user asked to rename the heading.
- Apply ONLY context.authorDirection to the existing body.
- Keep every current fact, name, product, number, and claim. Do not invent new capabilities, headings, or commercials.
- If the request is formatting (bullets, numbering, lists, tone, professional rewrite), reformat this text only.
- Structure the body as a proposal section, never a wall of text:
  - One short opening paragraph in sentence case.
  - Subheadings as "## Title Case" (never ALL CAPS shout lines).
  - Each capability or feature as its own "- " bullet under the matching subheading.
- Plain text: real newlines, "- " for bullets, "1. " for numbered lists. No **bold** and no literal \\n.
- Each body under ~4500 characters.
"""
    return """You write sales proposal section content for a B2B opportunity.
Write from the **vendor/company point of view** (we propose solutions to the
customer organization) — not a personal letter about an individual contact.
Match the tone and structure of a professional company proposal PDF: clear
offer, scope, features, commercials, next steps.
Return ONLY valid JSON (no markdown fences) with this shape:
{
  "sections": [
    {"id": "...", "key": "...", "title": "...", "body": "...", "sortOrder": 1}
  ]
}

Rules:
- Keep the same section id, key, and sortOrder as the input skeleton. Do not add/remove/reorder sections.
- You may lightly refine titles; bodies must be tailored to THIS company opportunity and the selected product/solution.
- If context.productHint or context.product is set, stay strictly on that solution — do not introduce unrelated products or imagery.
- Especially: if the product is ticketing / ITSM / service desk, do NOT write Contact Centre / CCaaS / voice-bot / "Agentic AI Platform" cover-style copy. Keep features, scope, and commercials about tickets, queues, SLAs, and agent workflows for that product only.
- If the product is CCaaS / Contact Centre, do NOT pivot into a generic ticketing-system narrative.
- Use real names from context (already merged). Do NOT emit {{tokens}}.
- Vendor / seller facts come from context.seller and context.vendorName (accounts.organizations).
  Use those for who we are (industry, country, website, size) — never invent company branding.
- Address the customer **company** (context.companyName); mention the contact only where a stakeholder is needed.
- Do NOT emit markdown images (![Logo](...), ![Hero](...), data: URIs, or asset: refs).
  Letterhead logo and cover imagery are handled by the document blueprint separately.
- Plain human-readable text: real newlines, "- " for bullets, numbered lists as "1. ".
- Structure section bodies: opening paragraph, "## Title Case" subheadings for capability groups, then "- " bullets. Never ALL-CAPS shout lines as fake headings.
- When the skeleton or knowledge has schedules/pricing/RACI, keep or emit GFM pipe tables:
  | Col | Col |
  | --- | --- |
  | a | b |
- No **bold** asterisks and no literal \\n escape sequences in strings.
- Be honest: do not invent signed contracts, fake legal commitments, or pricing not supported by context / product / quote lines / knowledge.
- Prefer product description, specifications, quote lines, and sales knowledge for Features, Scope, and Commercials.
- If deal amount or notes exist, reflect them in commercials/scope where appropriate.
- If context.authorDirection is set, follow it for the section(s) provided — still do not invent unsupported claims.
- Each body under ~4500 characters. Professional B2B tone. Prefer substantial multi-paragraph content over stubs.
"""


def _kb_query(ctx: dict[str, Any]) -> str:
    parts: list[str] = []
    if ctx.get("productHint"):
        parts.append(str(ctx["productHint"]))
    product = ctx.get("product")
    if isinstance(product, dict) and product.get("name"):
        parts.append(str(product["name"]))
    elif ctx.get("productName"):
        parts.append(str(ctx["productName"]))
    if ctx.get("dealTitle"):
        parts.append(str(ctx["dealTitle"]))
    if ctx.get("dealNotes"):
        parts.append(str(ctx["dealNotes"])[:400])
    if ctx.get("companyIndustry"):
        parts.append(str(ctx["companyIndustry"]))
    q = " ".join(p.strip() for p in parts if p and str(p).strip())
    return q.strip() or "sales proposal product features scope commercials"


async def _load_kb(ctx: dict[str, Any]) -> str:
    q = _kb_query(ctx)
    if not q:
        return ""
    try:
        kb = await get_sales_knowledge(q, limit=4)
    except Exception as exc:  # noqa: BLE001
        logger.warning("proposal-content KB retrieve failed: %s", exc)
        return ""
    if isinstance(kb, dict) and kb.get("status") == "success":
        return str(kb.get("context") or "").strip()[:6000]
    return ""


def _merge_sections(
    skeleton: list[dict[str, Any]],
    generated: list[Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    by_key: dict[str, dict[str, Any]] = {}
    for item in generated:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id") or "").strip()
        key = str(item.get("key") or "").strip()
        if sid:
            by_id[sid] = item
        if key:
            by_key[key] = item

    out: list[dict[str, Any]] = []
    for src in skeleton:
        sid = str(src.get("id") or "")
        key = str(src.get("key") or "")
        gen = by_id.get(sid) or by_key.get(key)
        title = str(src.get("title") or "")
        body = str(src.get("body") or "")
        if gen:
            t = _normalize_plain_text(str(gen.get("title") or title))
            b = _normalize_plain_text(str(gen.get("body") or body))
            if t:
                title = t
            if b:
                body = b
            for match in TOKEN_RE.findall(body):
                warnings.append(f"Removed leftover token {match}")
                body = body.replace(match, "")
            for match in TOKEN_RE.findall(title):
                title = title.replace(match, "")
        out.append(
            {
                "id": sid or str(src.get("id") or "sec"),
                "key": key or "section",
                "title": title or "Section",
                "body": body,
                "sortOrder": int(src.get("sortOrder") or len(out) + 1),
            }
        )
    return out, warnings


async def prepare(state: ContentState) -> ContentState:
    sections = list(state.get("sections") or [])
    warnings = list(state.get("warnings") or [])
    if not sections:
        return {
            **state,
            "out_sections": [],
            "warnings": warnings + ["No sections to personalize."],
            "status": "skipped",
            "reason": "empty",
        }
    if not is_ai_configured():
        return {
            **state,
            "out_sections": sections,
            "warnings": warnings
            + ["AI not configured; kept token-merged skeleton."],
            "status": "failed",
            "reason": "llm_not_configured",
        }
    kb_context = await _load_kb(state.get("context") or {})
    if not kb_context:
        warnings.append("Sales knowledge unavailable; using deal and product context only.")
    return {
        **state,
        "kb_context": kb_context,
        "warnings": warnings,
        "status": "running",
    }


async def generate(state: ContentState) -> ContentState:
    if state.get("status") != "running":
        return state

    ctx = state.get("context") or {}
    vendor = (state.get("vendor_name") or ctx.get("vendorName") or "Our company").strip()
    sections = list(state.get("sections") or [])
    warnings = list(state.get("warnings") or [])
    kb = (state.get("kb_context") or "").strip()

    user_parts = [
        f"Vendor: {vendor}",
        "Deal / customer / product context (JSON):\n"
        + json.dumps(ctx, ensure_ascii=False)[:12000],
        "Skeleton sections to rewrite (keep id/key/sortOrder):\n"
        + json.dumps(sections[:20], ensure_ascii=False)[:28000],
    ]
    if kb:
        user_parts.append(
            "Sales knowledge (ground Features/Scope/Commercials; do not invent):\n" + kb
        )
    direction = str(ctx.get("authorDirection") or "").strip()
    if direction:
        user_parts.append(f"Author direction:\n{direction}")

    text = await generate_ai_text(
        system=_system_prompt(surgical=bool(direction)),
        user="\n\n".join(user_parts),
        max_tokens=8000,
        timeout_ms=120_000,
    )
    payload = _extract_json_payload(text or "")
    if not payload:
        return {
            **state,
            "out_sections": sections,
            "warnings": warnings
            + ["Model returned invalid JSON; kept token-merged skeleton."],
            "status": "failed",
            "reason": "bad_json",
        }

    raw_list = payload.get("sections")
    if not isinstance(raw_list, list) or not raw_list:
        return {
            **state,
            "out_sections": sections,
            "warnings": warnings + ["No sections in model response; kept skeleton."],
            "status": "failed",
            "reason": "empty_sections",
        }

    merged, merge_warns = _merge_sections(sections, raw_list)
    warnings.extend(merge_warns)
    return {
        **state,
        "out_sections": merged,
        "warnings": warnings,
        "status": "ok",
        "reason": None,
    }


_PIPELINE_STEPS = (
    prepare,
    generate,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    sections: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    vendorName: str = "",
    vendor_name: str = "",
    organization_id: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    del organization_id
    result = await _run_pipeline(
        {
            "sections": sections or [],
            "context": context or {},
            "vendor_name": vendorName or vendor_name or "",
            "kb_context": "",
            "warnings": [],
            "status": "running",
        }
    )
    out = result.get("out_sections") or result.get("sections") or []
    status = result.get("status")
    ok = status in ("ok", "skipped") and bool(out)
    if status == "failed" and out:
        ok = True  # usable fallback sections
    return {
        "ok": ok or bool(out),
        "sections": out,
        "warnings": result.get("warnings") or [],
        "status": status,
        "reason": result.get("reason"),
    }
