"""LLM: generate proposal content JSON + frozen-CSS HTML. Prices from products."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.agents.llm_result import label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_layout import (
    apply_frozen_cover,
    clamp_requested_solutions,
    content_to_crm_sections,
    select_cover_product_tags,
)
from app.agents.proposal_pdf_parse import compile_theme_css, default_theme_tokens
from app.agents.proposal_render_html import render_proposal_html
from app.agents.proposal_schemas import BrdExtraction, GeneratedProposalContent
from app.services.knowledge_base import (
    KB_UNAVAILABLE_MESSAGE,
    KB_UNAVAILABLE_REASON,
    probe_product_knowledge,
)
from app.services.proposal_gemini import generate_json, proposal_gemini_configured
from app.services.proposal_knowledge import load_product_catalog_kb

logger = logging.getLogger(__name__)

BRD_PROMPT = sectioned_system_prompt(
    role="You extract a structured requirement from a deal BRD and/or meeting notes.",
    goal="Return BrdExtraction JSON for this customer only: what they want, prefer, and asked for.",
    instructions=(
        "- The source may be a BRD (PDF, Word, or text), meeting notes/transcript, or both. Use all of it.\n"
        "- Capture client name, objectives, pain points, preferred products, "
        "channels, languages, integrations, and quantities when present.\n"
        "- requested_solutions must match products discussed in THIS requirement.\n"
        "- Do not invent a customer or products that are not in the requirement."
    ),
    context="Current deal requirement (BRD and/or meeting).",
    output="Return JSON matching the BrdExtraction schema.",
    guardrails="Never invent prices. Never copy historical proposal prose.",
)

GENERATE_PROMPT = sectioned_system_prompt(
    role=(
        "You write a new commercial proposal as CONTENT JSON only, filling the "
        "tenant's content template. Theme CSS is frozen and you never emit CSS."
    ),
    goal=(
        "Fill GeneratedProposalContent for the CURRENT requirement. The BRD is the "
        "statement of work. Knowledge-base excerpts may only substantiate BRD items "
        "for ALLOWED SOLUTIONS. Prices only from PRODUCTS (inventory.products)."
    ),
    instructions=(
        "- Follow the content template section order and kinds. Do not invent a new genre.\n"
        "- Write for THIS customer ask only (BRD and/or meeting). Do not reuse gold-proposal copy.\n"
        "- cover.title MUST name THIS customer's solution from the BRD (project / "
        "requested solution). Do not copy \"Commercial Proposal\" or a catalog SKU list.\n"
        "- Keep tag_layout and meta_rows labels from the FROZEN COVER / example cover. "
        "Fill values for THIS client (Client, Document, Validity). Do not drop that table "
        "when the gold cover has it.\n"
        "- Do NOT invent a Client Name / Industry / Website / Lead Source table. "
        "Those are BRD fields, not cover meta.\n"
        "- cover.product_tags: 1–4 solution names as THIS draft actually proposes "
        "(from the BRD / written sections). Do not copy gold cover chips or dump the catalog.\n"
        "- Cover every BRD item that belongs in a section. KB may support those items; "
        "if the BRD asks and KB is silent, keep the BRD item.\n"
        "- Do not introduce SKUs, campaigns, or invented percentages unless they are "
        "in THIS requirement or ALLOWED SOLUTIONS.\n"
        "- tables: use learned headers. Commercial amounts only from PRODUCTS.\n"
        "- price_lines: one line per PRODUCTS row that applies. sku_name + qty from the "
        "requirement. Leave unit_price empty; the CRM fills catalog prices. Never invent INR/USD.\n"
        "- If a product is not in PRODUCTS / ALLOWED SOLUTIONS, do not recommend it.\n"
        "- Do not emit CSS, HTML, or markdown images."
    ),
    context=(
        "Frozen content template, frozen cover layout, BRD/meeting JSON, nearest gold "
        "instance (structure only), KB snippets for preferred products, and catalog PRODUCTS."
    ),
    output="Return JSON matching the GeneratedProposalContent schema. No CSS.",
    guardrails=(
        "Never invent signed contracts or catalog SKUs. Never invent prices. "
        "Never reuse historical customer names from training PDFs. "
        "Never dump BRD ClientInfo fields onto the cover."
    ),
)


def _instance_for_generate(inst: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(inst, dict):
        return {}
    cover = inst.get("cover") if isinstance(inst.get("cover"), dict) else {}
    sections = []
    for sec in inst.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        sections.append(
            {
                "id": sec.get("id"),
                "heading": sec.get("heading"),
                "kind": sec.get("kind"),
                "blocks": [
                    {"kind": b.get("kind"), "table_id": b.get("table_id")}
                    for b in (sec.get("blocks") or [])
                    if isinstance(b, dict)
                ],
            }
        )
    tables = []
    for table in inst.get("tables") or []:
        if not isinstance(table, dict):
            continue
        tables.append(
            {
                "id": table.get("id"),
                "title": table.get("title"),
                "headers": table.get("headers"),
                "emphasize_last_col": table.get("emphasize_last_col"),
            }
        )
    return {
        "cover": cover,
        "sections": sections,
        "tables": tables,
        "boilerplate": inst.get("boilerplate") or [],
    }


def _kb_unavailable_result() -> dict[str, Any]:
    return label_fallback(
        {
            "ok": False,
            "status": "failed",
            "sections": [],
            "error": KB_UNAVAILABLE_MESSAGE,
            "reason": KB_UNAVAILABLE_REASON,
        },
        KB_UNAVAILABLE_REASON,
    )


async def _load_product_kb(
    products: list[dict[str, Any]],
    *,
    organization_id: str | None,
    requirement_summary: str,
    allowed_product_names: list[str] | None = None,
) -> tuple[str, str | None]:
    return await load_product_catalog_kb(
        products,
        organization_id=organization_id,
        requirement_summary=requirement_summary,
        allowed_product_names=allowed_product_names,
    )


async def _generate_content_via_crm_llm(
    *,
    sections: list[Any],
    requirement_text: str,
    vendor_name: str,
    allowed_names: list[str],
    brd: dict[str, Any],
) -> dict[str, Any] | None:
    """Fill GeneratedProposalContent via LLM_BASE_URL when Gemini fails."""
    from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
    from app.agents.proposal_schemas import GeneratedProposalContent

    skeleton = [
        {
            "id": str(s.get("key") or s.get("id") or f"s{i}"),
            "heading": str(s.get("title") or s.get("heading") or f"Section {i + 1}"),
            "kind": str(s.get("kind") or "prose"),
        }
        for i, s in enumerate(sections)
        if isinstance(s, dict)
    ]
    if not skeleton:
        return None
    system = sectioned_system_prompt(
        role="You write a commercial proposal as JSON for the current customer requirement.",
        goal="Return GeneratedProposalContent JSON with a cover and one section per template row.",
        instructions=(
            "Write for THIS customer only. Follow the section ids and headings. "
            "Each section needs blocks with kind prose or bullets and real sentences. "
            "Do not invent catalog prices. Do not copy historical customer names."
        ),
        context=(
            f"vendor={vendor_name or 'Vendor'}; allowed={allowed_names}; "
            f"brd={json.dumps(brd, ensure_ascii=False)[:3000]}"
        ),
        output='{"cover":{"title":"Commercial Proposal","prepared_for":"..."},"sections":[{"id":"...","heading":"...","kind":"prose","blocks":[{"kind":"prose","text":"..."}]}]}',
        guardrails="JSON object only. Never invent SKUs or signed contracts.",
    )
    user = (
        f"Section template:\n{json.dumps(skeleton, ensure_ascii=False)[:4000]}\n\n"
        f"Requirement:\n{requirement_text[:8000]}\n\n"
        "Return the JSON object now."
    )

    def validate(parsed: dict[str, Any]) -> dict[str, Any]:
        model = GeneratedProposalContent.model_validate(parsed)
        dumped = model.model_dump()
        if len(dumped.get("sections") or []) < min(3, len(skeleton)):
            raise ValueError("too few sections")
        return dumped

    parsed, reason = await generate_json_with_retries(
        system=system,
        user=user,
        max_tokens=5000,
        timeout_ms=40_000,
        validate=validate,
    )
    if not parsed:
        logger.warning("proposal-generate CRM LLM fallback failed: %s", reason)
        return None
    return parsed if isinstance(parsed, dict) else None


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return await _run_generate(body or {})
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-generate crashed")
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "sections": [],
                "reason": f"llm_error:{type(exc).__name__}:{exc}"[:400],
            },
            f"llm_error:{type(exc).__name__}",
        )


async def _run_generate(body: dict[str, Any]) -> dict[str, Any]:
    sections = body.get("sections") if isinstance(body.get("sections"), list) else []
    playbook = body.get("playbook") if isinstance(body.get("playbook"), dict) else {}
    profile = body.get("profile") if isinstance(body.get("profile"), dict) else {}
    context = body.get("context") if isinstance(body.get("context"), dict) else {}
    products = body.get("products") if isinstance(body.get("products"), list) else []
    requirement_text = str(body.get("requirementText") or "")[:16_000]
    requirement_source = str(
        body.get("requirementSource") or context.get("requirementSource") or "manual"
    ).strip()[:40]
    vendor_name = str(body.get("vendorName") or context.get("vendorName") or "")
    organization_id = str(body.get("organizationId") or context.get("organizationId") or "")
    blueprint = body.get("blueprint") if isinstance(body.get("blueprint"), dict) else {}
    assets = body.get("assets") if isinstance(body.get("assets"), dict) else {}
    if not blueprint:
        blueprint = playbook.get("blueprint") if isinstance(playbook.get("blueprint"), dict) else {}
    if not assets:
        assets = playbook.get("assets") if isinstance(playbook.get("assets"), dict) else {}

    tokens = assets.get("tokens") if isinstance(assets.get("tokens"), dict) else {}
    if not tokens:
        tokens = blueprint.get("tokens") if isinstance(blueprint.get("tokens"), dict) else {}
    if not tokens:
        tokens = default_theme_tokens()
    theme_css = str(
        blueprint.get("themeCss") or blueprint.get("css") or assets.get("themeCss") or ""
    )
    if not theme_css:
        theme_css = compile_theme_css(tokens, has_logo=bool(assets.get("logoDataUrl")))
    logo_data_url = str(assets.get("logoDataUrl") or "")
    frozen_cover = assets.get("coverLayout") if isinstance(assets.get("coverLayout"), dict) else {}
    if not frozen_cover:
        frozen_cover = blueprint.get("coverLayout") if isinstance(blueprint.get("coverLayout"), dict) else {}
    content_template = (
        assets.get("contentTemplate")
        if isinstance(assets.get("contentTemplate"), dict)
        else {}
    )
    if not content_template:
        playbook_content = (
            playbook.get("content")
            if isinstance(playbook.get("content"), dict)
            else {}
        )
        extra = (
            body.get("playbookContent")
            if isinstance(body.get("playbookContent"), dict)
            else {}
        )
        content_template = {
            "sections": playbook.get("sections")
            or playbook_content.get("sections")
            or extra.get("sections")
            or []
        }

    quote_lines = (
        context.get("quoteLines") if isinstance(context.get("quoteLines"), list) else []
    )
    allowed = context.get("allowedProducts") or context.get("discussedProducts") or []
    allowed_names = [str(x).strip() for x in allowed if str(x).strip()]
    if not allowed_names:
        allowed_names = [
            str(p.get("name") or "").strip()
            for p in products
            if isinstance(p, dict) and str(p.get("name") or "").strip()
        ]
    kb_context = ""
    probe = await probe_product_knowledge(organization_id=organization_id or None)
    if not probe.get("available"):
        logger.warning(
            "proposal-generate fail-fast: product KB unavailable org=%s error=%s",
            organization_id,
            probe.get("error"),
        )
        return _kb_unavailable_result()

    nearest = body.get("nearestInstances")
    if not isinstance(nearest, list):
        nearest = []
    if not nearest:
        gold_inst = assets.get("goldInstance")
        if isinstance(gold_inst, dict):
            nearest = [gold_inst]
        elif isinstance(frozen_cover, dict) and frozen_cover:
            nearest = [{"cover": frozen_cover}]

    if not proposal_gemini_configured():
        brd_offline: dict[str, Any] = {
            "client": {"name": str(context.get("companyName") or "")},
            "overview": requirement_text[:2000],
            "requested_solutions": [
                {"name": n, "details": "", "quantities": {}} for n in allowed_names
            ],
        }
        content = await _generate_content_via_crm_llm(
            sections=sections or content_template.get("sections") or [],
            requirement_text=requirement_text,
            vendor_name=vendor_name,
            allowed_names=allowed_names,
            brd=brd_offline,
        )
        if content:
            return await _finalize_generated(
                content,
                frozen_cover=frozen_cover,
                brd=brd_offline,
                vendor_name=vendor_name,
                content_template=content_template,
                context=context,
                products=products,
                quote_lines=quote_lines,
                allowed_names=allowed_names,
                theme_css=theme_css,
                tokens=tokens,
                logo_data_url=logo_data_url,
                sections=sections,
                kb_context="",
            )
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "sections": [],
                "reason": "proposal_gemini_not_configured",
            },
            "proposal_gemini_not_configured",
        )

    brd: dict[str, Any] = body.get("brd") if isinstance(body.get("brd"), dict) else {}
    pdf_b64 = body.get("requirementPdfBase64")
    pdf_bytes: list[bytes] = []
    # Ingest already extracted text — skip a second Gemini PDF pass that often exceeds 120s.
    # Only send PDF bytes to Gemini; Word/text BRDs are already in requirement_text.
    if len(requirement_text.strip()) < 80 and isinstance(pdf_b64, str) and pdf_b64.strip():
        import base64

        try:
            raw = base64.b64decode(pdf_b64.strip())
        except Exception:  # noqa: BLE001
            raw = b""
        filename = str(body.get("requirementFilename") or "").lower()
        if raw.startswith(b"%PDF") or filename.endswith(".pdf"):
            pdf_bytes = [raw] if raw else []

    try:
        if not brd:
            extra = (
                f"Requirement source: {requirement_source}\n"
                f"ALLOWED catalog products: {json.dumps(allowed_names, ensure_ascii=False)}\n\n"
                f"{requirement_text}"
            )
            brd_model = await generate_json(
                BRD_PROMPT,
                BrdExtraction,
                pdf_bytes=pdf_bytes or None,
                extra_text=extra,
            )
            brd = brd_model.model_dump()
    except Exception as exc:  # noqa: BLE001
        logger.warning("proposal-generate BRD extract failed: %s", exc)
        brd = {
            "client": {"name": str(context.get("companyName") or "")},
            "overview": requirement_text[:2000],
            "requested_solutions": [
                {"name": n, "details": "", "quantities": {}} for n in allowed_names
            ],
        }

    brd = clamp_requested_solutions(brd, products, allowed_names)
    kb_products = list(products)
    for sol in brd.get("requested_solutions") or []:
        if not isinstance(sol, dict):
            continue
        name = str(sol.get("name") or "").strip()
        if not name:
            continue
        if any(
            isinstance(p, dict)
            and str(p.get("name") or "").strip().lower() == name.lower()
            for p in kb_products
        ):
            continue
        kb_products.append({"name": name})
    kb_context, kb_fail = await _load_product_kb(
        kb_products,
        organization_id=organization_id or None,
        requirement_summary=" ".join(
            part
            for part in (
                str(brd.get("overview") or ""),
                " ".join(str(x) for x in (brd.get("objectives") or [])[:4]),
                " ".join(str(x) for x in (brd.get("pain_points") or [])[:4]),
                str(profile.get("summary") or ""),
                " ".join(str(t) for t in (profile.get("themes") or [])[:6]),
                " ".join(str(p) for p in (profile.get("products") or [])[:8]),
                str(context.get("dealTitle") or ""),
                requirement_text[:1500],
            )
            if part
        ),
        allowed_product_names=[
            str(p).strip()
            for p in (profile.get("products") or [])
            if str(p).strip()
        ],
    )
    if kb_fail == KB_UNAVAILABLE_REASON:
        return _kb_unavailable_result()

    nearest_struct = [_instance_for_generate(row) for row in nearest[:3] if isinstance(row, dict)]
    user = (
        f"Vendor: {vendor_name or 'Vendor'}\n"
        f"Requirement source: {requirement_source}\n"
        "Use MEETING NOTES for what they prefer / asked for, and the BRD for "
        "stated scope. Combine both when present.\n"
        f"ALLOWED SOLUTIONS: {json.dumps(allowed_names, ensure_ascii=False)}\n\n"
        f"CONTENT TEMPLATE (follow section kinds; do not restyle):\n"
        f"{json.dumps(content_template, ensure_ascii=False)[:8000]}\n\n"
        f"FROZEN COVER LAYOUT (keep labels and alignments; fill values for THIS client):\n"
        f"{json.dumps(frozen_cover, ensure_ascii=False)[:4000]}\n\n"
        f"STRUCTURED REQUIREMENT (this customer):\n"
        f"{json.dumps(brd, ensure_ascii=False)[:8000]}\n\n"
        f"FULL CUSTOMER REQUIREMENT (meeting and/or BRD):\n{requirement_text}\n\n"
        f"NEAREST EXAMPLE PROPOSAL INSTANCE (voice + structure only — never clone prose):\n"
        f"{json.dumps(nearest_struct, ensure_ascii=False)[:8000]}\n\n"
        f"PRODUCTS (full catalog from inventory.products — all rates and amounts):\n"
        f"{json.dumps(products[:100], ensure_ascii=False)[:16000]}\n\n"
        f"QUOTE LINES (scope hint from deal; amounts still from PRODUCTS + BRD):\n"
        f"{json.dumps(quote_lines[:20], ensure_ascii=False)[:2000]}\n\n"
        f"KNOWLEDGE BASE EXCERPTS (product capabilities for ALLOWED SOLUTIONS):\n"
        f"{kb_context or '(none)'}\n\n"
        "Fill GeneratedProposalContent from the structured requirement + KB. "
        "Populate commercial tables and price_lines from PRODUCTS prices/addons/tiers "
        "as the BRD requires — do not invent amounts outside PRODUCTS. "
        "Do not emit CSS."
    )

    try:
        content_model = await generate_json(
            GENERATE_PROMPT + "\n\n" + user,
            GeneratedProposalContent,
        )
        content = content_model.model_dump()
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-generate Gemini failed")
        content = await _generate_content_via_crm_llm(
            sections=sections or content_template.get("sections") or [],
            requirement_text=requirement_text,
            vendor_name=vendor_name,
            allowed_names=allowed_names,
            brd=brd,
        )
        if not content:
            return label_fallback(
                {
                    "ok": False,
                    "status": "failed",
                    "sections": [],
                    "reason": f"llm_error:{exc}",
                },
                f"llm_error:{exc}",
            )

    return await _finalize_generated(
        content,
        frozen_cover=frozen_cover,
        brd=brd,
        vendor_name=vendor_name,
        content_template=content_template,
        context=context,
        products=products,
        quote_lines=quote_lines,
        allowed_names=allowed_names,
        theme_css=theme_css,
        tokens=tokens,
        logo_data_url=logo_data_url,
        sections=sections,
        kb_context=kb_context,
    )


async def _finalize_generated(
    content: dict[str, Any],
    *,
    frozen_cover: dict[str, Any],
    brd: dict[str, Any],
    vendor_name: str,
    content_template: dict[str, Any],
    context: dict[str, Any],
    products: list[Any],
    quote_lines: list[Any],
    allowed_names: list[str],
    theme_css: str,
    tokens: dict[str, Any],
    logo_data_url: str,
    sections: list[Any],
    kb_context: str,
) -> dict[str, Any]:
    content["cover"] = apply_frozen_cover(
        content.get("cover"),
        frozen_cover,
        brd,
        vendor_name=vendor_name,
        content_template=content_template,
    )
    customer = str(
        (brd.get("client") or {}).get("name")
        or context.get("companyName")
        or ""
    ).strip()
    cover = dict(content.get("cover") or {})
    if customer:
        cover["prepared_for"] = f"Prepared for {customer}"
    cover["date"] = datetime.now(timezone.utc).strftime("%d %B %Y").lstrip("0")
    content["cover"] = cover
    content["price_lines"] = [
        p for p in (content.get("price_lines") or []) if isinstance(p, dict)
    ]
    content["tables"] = [
        t for t in (content.get("tables") or []) if isinstance(t, dict)
    ]
    content["cover"]["product_tags"] = select_cover_product_tags(
        content.get("cover", {}).get("product_tags"),
        allowed_names=allowed_names,
    )

    html = render_proposal_html(
        content,
        theme_css=theme_css,
        tokens=tokens,
        logo_data_url=logo_data_url,
        include_style_tag=True,
    )
    crm_sections = content_to_crm_sections(content, skeleton=sections or None)
    css_leak = "stylesheet" in json.dumps(content).lower() or "<style" in json.dumps(
        {k: content.get(k) for k in ("cover", "sections")}
    )
    warnings: list[str] = []
    if css_leak:
        warnings.append("Stripped CSS from model content")

    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "sections": crm_sections,
            "content": content,
            "html": html,
            "css": theme_css,
            "brd": brd,
            "warnings": warnings,
            "kbUsed": bool(kb_context),
        }
    )
