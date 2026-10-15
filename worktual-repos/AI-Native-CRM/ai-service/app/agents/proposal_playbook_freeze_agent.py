"""Freeze gold proposal theme + content template onto one playbook."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_layout import (
    infer_content_template,
    is_brd_cover_meta,
    preferred_cover_meta,
)
from app.agents.proposal_pdf_parse import (
    compile_theme_css,
    default_theme_tokens,
    usable_running_chrome,
)
from app.agents.proposal_render_html import render_skeleton_html
from app.agents.proposal_schemas import TenantContentTemplate
from app.services.proposal_gemini import generate_json, proposal_gemini_configured

logger = logging.getLogger(__name__)


def _display_section_title(raw: str) -> str:
    """Turn heading_pattern regex into a human section label."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("^"):
        s = s[1:]
    if s.endswith("$"):
        s = s[:-1]
    s = s.replace(r"\.", ".")
    if s.endswith(".*"):
        s = s[:-2]
    if s.endswith(".+"):
        s = s[:-2]
    for sep in (" — ", " – ", " - "):
        if sep in s:
            head = s.split(sep, 1)[0].strip()
            if len(head) >= 3:
                s = head
            break
    return " ".join(s.split())[:80]

TEMPLATE_INFER_PROMPT = sectioned_system_prompt(
    role="You infer a CONTENT template from proposal instance JSONs from the same vendor.",
    goal="Return TenantContentTemplate: shared sections, table types, boilerplate, slots.",
    instructions=(
        "- Shared headings across documents = required sections. Heading only in one file = optional.\n"
        "- Identical repeated sentences = boilerplate.\n"
        "- Same role, different values (client, date, amounts) = slot name.\n"
        "- Keep cover.tag_layout and cover.meta_rows labels as the commercial pattern "
        "if they appear on the gold cover (Client / Document / Validity).\n"
        "- table_types: cluster tables by similar headers (pricing, comparison, inclusions).\n"
        "- commercial_flags: set has_requested_vs_recommended true ONLY if those columns appear.\n"
        "- Do NOT include fonts, colors, CSS, logos, or spacing numbers."
    ),
    context="Gold proposal instance JSON (structure only).",
    output="Return JSON matching TenantContentTemplate.",
    guardrails="Do not assume Worktual or any other vendor structure if the instances do not show it.",
)


def _gold_cover(instance: dict[str, Any], layout: dict[str, Any]) -> dict[str, Any]:
    cover = dict(instance.get("cover") or {})
    cover["meta_rows"] = preferred_cover_meta(
        cover.get("meta_rows"),
        layout.get("meta_rows"),
    )
    if is_brd_cover_meta(cover.get("meta_rows")):
        cover["meta_rows"] = []
    cover["tag_layout"] = (
        cover.get("tag_layout")
        or layout.get("tags_layout")
        or "centered_wrap"
    )
    cover["brand_align"] = cover.get("brand_align") or layout.get("brand_align") or "center"
    cover["cover_align"] = (
        cover.get("cover_align")
        or layout.get("cover_align")
        or layout.get("title_align")
        or cover.get("brand_align")
        or "center"
    )
    return cover


def _merge_content_template(
    heuristic: dict[str, Any],
    llm: dict[str, Any] | None,
) -> dict[str, Any]:
    if not isinstance(llm, dict) or not (llm.get("sections") or []):
        return heuristic
    by_id: dict[str, dict[str, Any]] = {}
    for row in heuristic.get("sections") or []:
        if isinstance(row, dict):
            by_id[str(row.get("id") or row.get("key") or "")] = row
    merged_sections: list[dict[str, Any]] = []
    for i, row in enumerate(llm.get("sections") or []):
        if not isinstance(row, dict):
            continue
        hid = str(row.get("id") or row.get("heading_pattern") or f"section_{i + 1}")
        base = by_id.get(hid) or {}
        heading = str(
            row.get("heading_pattern") or base.get("title") or hid
        ).strip()
        kind = str(row.get("kind") or base.get("kind") or "prose")
        title = _display_section_title(heading) or _display_section_title(
            str(base.get("title") or hid)
        ) or hid
        merged_sections.append(
            {
                **base,
                "id": hid,
                "key": str(base.get("key") or hid),
                "title": title,
                "heading_pattern": heading,
                "kind": kind if kind in {"prose", "bullets", "table", "mixed"} else "prose",
                "required": bool(row.get("required", True)),
                "table_id": str(row.get("table_id") or base.get("table_id") or ""),
                "intent": str(base.get("intent") or f"Write {heading or hid} for this customer."),
                "tone": base.get("tone") or "formal",
                "contentPattern": base.get("contentPattern") or "medium",
            }
        )
    out = dict(heuristic)
    if merged_sections:
        out["sections"] = merged_sections
    if llm.get("table_types"):
        out["table_types"] = llm["table_types"]
    if llm.get("boilerplate"):
        out["boilerplate"] = llm["boilerplate"]
    if llm.get("slots"):
        out["slots"] = llm["slots"]
    if llm.get("commercial_flags"):
        out["commercial_flags"] = llm["commercial_flags"]
    return out


def _page_images_for_assets(raw: Any) -> list[dict[str, Any]]:
    """Keep at most 8 page rasters. Accept dataBase64 or dataUrl."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict) or len(out) >= 8:
            continue
        b64 = str(row.get("dataBase64") or "").strip()
        data_url = str(row.get("dataUrl") or "").strip()
        if not b64 and "," in data_url:
            b64 = data_url.split(",", 1)[1]
        if len(b64) < 32:
            continue
        mime = str(row.get("mime") or "image/png")
        out.append(
            {
                "page": int(row.get("page") or len(out) + 1),
                "mime": mime,
                "dataBase64": b64,
            }
        )
    return out


def freeze_playbook(
    *,
    gold: dict[str, Any],
    instances: list[dict[str, Any]],
    name: str = "Learned proposal pattern",
    content_template: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tokens = gold.get("themeTokens") if isinstance(gold.get("themeTokens"), dict) else {}
    if not tokens:
        tokens = default_theme_tokens()
    layout = gold.get("layout") if isinstance(gold.get("layout"), dict) else {}
    layout = dict(layout)
    if str(layout.get("cover_align") or "").strip().lower() not in {
        "left",
        "center",
        "right",
    }:
        layout["cover_align"] = (
            layout.get("title_align") or layout.get("brand_align") or "center"
        )
    header_text = str(
        tokens.get("header_text")
        or gold.get("headerText")
        or gold.get("header_text")
        or ""
    ).strip()
    if not usable_running_chrome(header_text):
        header_text = ""
    footer_text = str(
        tokens.get("footer_text")
        or gold.get("footerText")
        or gold.get("footer_text")
        or ""
    ).strip()
    if not usable_running_chrome(footer_text):
        footer_text = ""
    tokens = {
        **tokens,
        "layout": layout or tokens.get("layout") or {},
        "header_text": header_text,
        "footer_text": footer_text,
    }
    logo_b64 = str(gold.get("logoB64") or "")
    logo_data_url = f"data:image/png;base64,{logo_b64}" if logo_b64 else ""
    theme_css = compile_theme_css(tokens, has_logo=bool(logo_b64))
    instance = gold.get("instance") if isinstance(gold.get("instance"), dict) else {}
    gold_instances = [instance] if instance else []
    gold_instances.extend(i for i in instances if isinstance(i, dict) and i is not instance)
    heuristic = infer_content_template(gold_instances)
    template = _merge_content_template(heuristic, content_template)
    if not (template.get("sections") or []):
        template = {
            **template,
            "sections": [
                {
                    "id": "scope",
                    "key": "scope",
                    "title": "Proposal",
                    "heading_pattern": "",
                    "kind": "prose",
                    "required": True,
                    "intent": "Write the proposal body for this customer.",
                    "tone": "formal",
                    "contentPattern": "medium",
                }
            ],
        }
    cover = _gold_cover(instance, layout)
    if instance:
        instance = {**instance, "cover": cover}
    cover_layout = {**cover, "layout": layout}
    html = render_skeleton_html(
        template,
        theme_css=theme_css,
        tokens=tokens,
        logo_data_url=logo_data_url,
        gold_cover=cover,
    )
    sections = template.get("sections") or []
    blueprint = {
        "version": 1,
        "mode": "playbook-template",
        "frozenTheme": True,
        "html": html,
        "css": theme_css,
        "themeCss": theme_css,
        "tokens": tokens,
        "coverLayout": cover_layout,
        "theme": {
            "primary": (tokens.get("colors") or {}).get("primary"),
            "fonts": (tokens.get("fonts") or {}).get("body", {}).get("family"),
        },
    }
    assets = {
        "logoDataUrl": logo_data_url,
        "tokens": tokens,
        "coverLayout": cover_layout,
        "contentTemplate": template,
        "goldInstance": instance,
        "pageImages": _page_images_for_assets(gold.get("pageImages")),
    }
    return {
        "name": name,
        "blueprint": blueprint,
        "assets": assets,
        "sections": sections,
        "contentTemplate": template,
        "themeCss": theme_css,
    }


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    gold = body.get("gold") if isinstance(body.get("gold"), dict) else {}
    instances = body.get("instances") if isinstance(body.get("instances"), list) else []
    if not gold:
        return label_fallback(
            {"ok": False, "status": "failed", "reason": "missing_gold"},
            "missing_gold",
        )
    name = str(body.get("name") or "Learned proposal pattern")
    llm_template: dict[str, Any] | None = None
    gold_instance = gold.get("instance") if isinstance(gold.get("instance"), dict) else {}
    infer_payload = [{"client": "", "instance": gold_instance}]
    infer_payload.extend(
        {"client": "", "instance": row}
        for row in instances
        if isinstance(row, dict) and row is not gold_instance
    )
    if proposal_gemini_configured() and (gold_instance or instances):
        try:
            tmpl = await generate_json(
                TEMPLATE_INFER_PROMPT
                + "\n\nPROPOSAL INSTANCES:\n"
                + json.dumps(infer_payload, ensure_ascii=False)[:24_000],
                TenantContentTemplate,
            )
            llm_template = tmpl.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-playbook-freeze template infer failed: %s", exc)
    frozen = freeze_playbook(
        gold=gold,
        instances=instances,
        name=name,
        content_template=llm_template,
    )
    html = str(frozen["blueprint"].get("html") or "")
    css = str(frozen["blueprint"].get("css") or "")
    html_ok = (
        ("bp-playbook-cover" in html or "proposal-doc" in html)
        and "data-slot=" in html
    )
    css_ok = "font-size" in css and (
        "bp-cover-title" in css or "cover-title" in css
    )
    if not html_ok:
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "reason": "skeleton_incomplete",
                **frozen,
            },
            "skeleton_incomplete",
        )
    if not css_ok:
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "reason": "css_incomplete",
                **frozen,
            },
            "css_incomplete",
        )
    return label_ai({"ok": True, "status": "ok", **frozen})
