"""Generate page-clone textReplacements for a specific deal (meeting-grounded)."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

MAX_PAGE_TEXT_CHARS = 8000


def _system_prompt(kind: str, page_role: str, *, content_fill: bool) -> str:
    role_hint = page_role.strip() or "body"
    fill_instructions = (
        "CONTENT FILL MODE is on: replace sample customer narrative with the "
        "provided sectionBodies while preserving headings, table structure, and "
        "legal/footer chrome.\n"
        "- Prefer replacing whole sample paragraphs / bullet clusters with matching "
        "generated section body text (keep a similar length when possible).\n"
        "- CRITICAL: each `replace` must be roughly the same length as `find` "
        "(at most ~10% longer). Absolute page-clone spans cannot reflow — longer "
        "text overlaps neighboring lines.\n"
        "- Prefer several short finds over one long paragraph dump.\n"
        "- Use sectionBodies keyed by role (cover/intro/scope/commercials/etc.).\n"
        "- Keep brand words like WORKTUAL / Commercial Proposal unless context "
        "requires a different vendorName.\n"
        "- Still only return exact `find` substrings that appear in visibleTextPreview.\n"
    ) if content_fill else (
            "- Prefer replacing sample customer names, cover scope lines, and generic intro "
            "paragraphs with customer-specific copy grounded in dealNotes.\n"
            "- On cover pages: replace template catalog bullet lists (multiple products joined "
            "by •) with context.productScope only — never preserve the uploaded PDF's full "
            "product lineup when the meeting discussed fewer solutions.\n"
            "- Keep replacements short-to-medium; never replace an entire page in one find.\n"
    )
    return sectioned_system_prompt(
        role="You personalize uploaded sales document templates for one customer opportunity.",
        goal=(
            "Return exact substring replacements so page-clone layout stays identical "
            "while customer name, scope, and narrative match this deal's requirement."
        ),
        instructions=(
            "You are editing ONE page of an uploaded template for VISUAL LAYOUT only. "
            f"Page role: {role_hint}.\n"
            "Read visibleTextPreview and context.dealNotes (meetings, transcripts, BRD).\n"
            "- The uploaded PDF is a layout master — do NOT preserve its sample customer "
            "story when sectionBodies provides requirement-driven copy.\n"
            "- Return ONLY JSON: "
            '{"textReplacements":[{"find":"exact substring","replace":"new text"}],'
            '"fragmentEdits":[{"index":12,"find":"exact cell text","replace":"approved value"}],'
            '"warnings":[]}\n'
            "- Every `find` MUST appear verbatim in visibleTextPreview.\n"
            "- For PDF tables/forms, use fragmentEdits. Each index/find pair MUST exactly "
            "match one supplied textFragments entry. Edit one cell/label at a time; never "
            "return a whole flattened table row as a find.\n"
            "- Preserve form labels. For a blank form field, append its approved value to "
            "the label fragment (for example `Quote No.: Q-123`), rather than deleting the label.\n"
            "- Do NOT replace layout/CSS/asset refs. Do NOT invent {{tokens}}.\n"
            f"{fill_instructions}"
            "- Match the page role: cover = customer + scope headline; scope/intro = narrative; "
            "commercials = line descriptions only when meeting notes support it.\n"
            "- Quote/invoice commercial cells MUST copy context.documentFacts exactly. "
            "Never estimate, distribute, recompute, or invent prices, taxes, discounts, totals, "
            "quantities, products, addresses, or identifiers. Blank unsupported fields.\n"
            "- Replace EVERY sample line-item cell (description, unit, quantity, price, tax, "
            "amount) and EVERY sample subtotal/discount/total value. If documentFacts has no "
            "approved counterpart (for example no unit or GST rate), replace that sample cell "
            "with an empty string so sample data never survives into the generated document.\n"
            "- Skip strings listed in alreadyApplied.\n"
            "- sectionOutline / sectionBodies (when present) list CRM section titles and "
            "generated copy — align tone and replace matching sample content.\n"
            f"- Document kind: {kind}."
        ),
        context="Deal company, product scope, meeting notes, and page metadata are in the user payload.",
        output='JSON only: {"textReplacements":[...],"fragmentEdits":[...],"warnings":[...]}',
        guardrails=(
            "Never change prices/totals unless context includes approved commercial numbers. "
            "Do not remove legal/footer boilerplate. "
            "Never rename scenario labels 'Requested Solution' or 'Recommended Solution' "
            "(including with customer/vendor prefixes like 'Acme Requested'). "
            "Keep those exact phrases — they are column headers, not customer names. "
            "Never keep a template's full product catalog on the cover when "
            "context.productScope lists fewer products."
        ),
    )


async def run(
    *,
    organization_id: str | None = None,
    organizationId: str | None = None,
    kind: str = "proposal",
    visibleTextPreview: str = "",
    visible_text_preview: str = "",
    pageIndex: int | None = None,
    page_index: int | None = None,
    pageCount: int | None = None,
    page_count: int | None = None,
    pageRole: str | None = None,
    page_role: str | None = None,
    pageId: str | None = None,
    page_id: str | None = None,
    textFragments: list[dict[str, Any]] | None = None,
    text_fragments: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    alreadyApplied: list[str] | None = None,
    already_applied: list[str] | None = None,
    sectionOutline: list[dict[str, Any]] | None = None,
    section_outline: list[dict[str, Any]] | None = None,
    sectionBodies: list[dict[str, Any]] | None = None,
    section_bodies: list[dict[str, Any]] | None = None,
    contentFill: bool | None = None,
    content_fill: bool | None = None,
    **_: Any,
) -> dict[str, Any]:
    org = (organizationId or organization_id or "").strip()
    preview = (visibleTextPreview or visible_text_preview or "").strip()
    ctx = context if isinstance(context, dict) else {}
    applied = alreadyApplied if isinstance(alreadyApplied, list) else already_applied
    applied_list = [str(x) for x in (applied or []) if str(x).strip()]
    page_idx = pageIndex if pageIndex is not None else page_index
    page_total = pageCount if pageCount is not None else page_count
    role = (pageRole or page_role or "body").strip() or "body"
    page_id_val = (pageId or page_id or "").strip()
    fragments = (
        textFragments if isinstance(textFragments, list) else text_fragments
    )
    fragment_rows = [
        {
            "index": int(row.get("index")),
            "text": str(row.get("text") or "")[:500],
        }
        for row in (fragments or [])[:240]
        if isinstance(row, dict)
        and isinstance(row.get("index"), int)
        and str(row.get("text") or "").strip()
    ]
    outline = sectionOutline if isinstance(sectionOutline, list) else section_outline
    outline_rows = outline if isinstance(outline, list) else []
    bodies = sectionBodies if isinstance(sectionBodies, list) else section_bodies
    body_rows = bodies if isinstance(bodies, list) else []
    fill_mode = bool(
        contentFill if contentFill is not None else content_fill
    ) or bool(body_rows)

    if not preview:
        return label_fallback(
            {"textReplacements": [], "warnings": ["empty_visible_text"]},
            "empty_visible_text",
        )

    if not is_ai_configured():
        return label_fallback(
            {
                "textReplacements": [],
                "warnings": ["llm_unavailable"],
            },
            "llm_unavailable",
        )

    # Keep payload compact for 16k-class models.
    compact_bodies = []
    for row in body_rows[:10]:
        if not isinstance(row, dict):
            continue
        compact_bodies.append(
            {
                "key": str(row.get("key") or "")[:80],
                "title": str(row.get("title") or "")[:120],
                "body": str(row.get("body") or "")[:1800],
            }
        )

    user = json.dumps(
        {
            "kind": (kind or "proposal").strip().lower(),
            "organizationId": org,
            "visibleTextPreview": preview[:MAX_PAGE_TEXT_CHARS],
            "pageIndex": page_idx,
            "pageCount": page_total,
            "pageRole": role,
            "pageId": page_id_val or None,
            "textFragments": fragment_rows,
            "context": ctx,
            "alreadyApplied": applied_list[:40],
            "sectionOutline": outline_rows[:12],
            "sectionBodies": compact_bodies,
            "contentFill": fill_mode,
        },
        ensure_ascii=False,
    )

    try:
        raw = await generate_ai_text(
            system=_system_prompt(kind, role, content_fill=fill_mode),
            user=user,
            max_tokens=2400,
            timeout_ms=45_000,
        )
    except Exception:
        logger.exception("document-clone-personalize LLM failed")
        return label_fallback(
            {"textReplacements": [], "warnings": ["llm_error"]},
            "llm_error",
        )

    parsed = extract_json(raw or "")
    if not parsed:
        return label_ai({"textReplacements": [], "warnings": ["unparseable_llm"]})

    replacements = parsed.get("textReplacements")
    fragment_edits = parsed.get("fragmentEdits")
    warnings = parsed.get("warnings")
    if not isinstance(replacements, list):
        replacements = []
    if not isinstance(fragment_edits, list):
        fragment_edits = []
    if not isinstance(warnings, list):
        warnings = []

    cleaned: list[dict[str, str]] = []
    for row in replacements:
        if not isinstance(row, dict):
            continue
        find = str(row.get("find") or "").strip()
        replace = str(row.get("replace") or "")
        if not find or find not in preview:
            continue
        if find in applied_list:
            continue
        if find == replace:
            continue
        # Absolute page-clone boxes cannot reflow; cap runaway replacements.
        max_len = max(8, int(len(find) * 1.12))
        if len(replace) > max_len:
            clipped = replace[:max_len]
            cut = clipped.rfind(" ")
            replace = (clipped[:cut] if cut > max_len * 0.6 else clipped).rstrip()
        cleaned.append({"find": find, "replace": replace})

    fragments_by_index = {
        int(row["index"]): str(row["text"]) for row in fragment_rows
    }
    # Smaller/local models sometimes obey the values but put PDF cell edits in
    # textReplacements. Promote exact fragment matches into indexed edits so the
    # positioned PDF HTML can actually be patched.
    promoted_indexes: set[int] = set()
    for row in replacements:
        if not isinstance(row, dict):
            continue
        find = str(row.get("find") or "").strip()
        replace = str(row.get("replace") or "")
        if not find or find == replace:
            continue
        match_index = next(
            (
                index
                for index, text in fragments_by_index.items()
                if index not in promoted_indexes and text == find
            ),
            None,
        )
        if match_index is None:
            continue
        fragment_edits.append(
            {"index": match_index, "find": find, "replace": replace}
        )
        promoted_indexes.add(match_index)

    clean_fragment_edits: list[dict[str, Any]] = []
    seen_fragment_indexes: set[int] = set()
    for row in fragment_edits:
        if not isinstance(row, dict):
            continue
        index = row.get("index")
        if not isinstance(index, int) or index in seen_fragment_indexes:
            continue
        current = fragments_by_index.get(index)
        find = str(row.get("find") or "").strip()
        replace = str(row.get("replace") or "")
        if not current or find != current or replace == current:
            continue
        # Form labels are layout chrome. Models occasionally return only the value;
        # retain the label unless they intentionally supplied a new labelled phrase.
        if find.rstrip().endswith(":") and replace and ":" not in replace:
            replace = f"{find} {replace}".strip()
        # A single positioned PDF span can grow modestly; overlap repair remains
        # authoritative in the renderer. Reject only obvious paragraph dumps.
        max_len = max(80, int(len(find) * 8.0))
        if len(replace) > max_len:
            clipped = replace[:max_len]
            cut = clipped.rfind(" ")
            replace = (clipped[:cut] if cut > max_len * 0.55 else clipped).rstrip()
        clean_fragment_edits.append(
            {"index": index, "find": find, "replace": replace}
        )
        seen_fragment_indexes.add(index)

    return label_ai(
        {
            "textReplacements": cleaned[:24],
            "fragmentEdits": clean_fragment_edits[:80],
            "warnings": [str(w) for w in warnings if str(w).strip()][:5],
        }
    )
