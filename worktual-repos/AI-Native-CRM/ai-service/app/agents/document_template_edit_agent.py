"""Chat-driven edits for proposal / quote / invoice configuration templates."""

from __future__ import annotations

import html
import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

def _mentioned_upload_section(
    sections: list[dict[str, Any]],
    message: str,
) -> str | None:
    lower = (message or "").lower()
    if not lower:
        return None
    ranked: list[tuple[int, str]] = []
    for s in sections:
        if not isinstance(s, dict):
            continue
        key = str(s.get("key") or "").strip()
        title = str(s.get("title") or "").strip()
        if title and title.lower() in lower:
            ranked.append((len(title), title))
        if key and re.search(rf"\b{re.escape(key.lower())}\b", lower):
            ranked.append((len(key), key))
    if not ranked:
        return None
    ranked.sort(key=lambda row: row[0], reverse=True)
    return ranked[0][1]


def _offline_reply(
    message: str,
    kind: str,
    sections: list[dict[str, Any]],
) -> dict[str, Any]:
    lower = (message or "").lower()
    mentioned = _mentioned_upload_section(sections, message)
    payload: dict[str, Any] = {
        "reply": (
            f"I can help edit your {kind} template — describe what to change using "
            "text from your uploaded sample, or use the clip icon for a new logo."
        ),
        "sectionUpdates": [],
        "textReplacements": [],
    }
    if mentioned and re.search(r"\b(update|change|edit|rewrite|revise)\b", lower):
        payload["reply"] = (
            f"Tell me what to change in “{mentioned}” and I'll apply it to your upload."
        )
    return label_fallback(payload, "llm_unavailable")


def _strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _visible_text_preview(blueprint_html: str, limit: int = 4000) -> str:
    plain = _strip_html(blueprint_html)
    if len(plain) <= limit:
        return plain
    return f"{plain[: limit - 3]}..."


def _section_summary(sections: list[dict[str, Any]], limit: int = 12) -> str:
    lines: list[str] = []
    for s in sections[:limit]:
        key = str(s.get("key") or "")
        title = str(s.get("title") or key or "Section")
        body = str(s.get("body") or "").strip()
        if len(body) > 220:
            body = f"{body[:217]}..."
        lines.append(f"- {key or title}: {title}\n  {body}")
    return "\n".join(lines) if lines else "(no sections)"


def _system_prompt(kind: str, page_clone: bool) -> str:
    doc = kind if kind != "quote" else "quote"
    layout = (
        "The template is an EXACT page clone of an uploaded sample. "
        "Never redesign layout, colors, or page structure. "
        "For visible static text on the sample pages, use textReplacements with exact find strings "
        "copied from visibleTextPreview. "
        "For logo/image swaps, set reply only and tell the user to tap + and upload an image."
    ) if page_clone else (
        "This is a standard section-based template (not a locked page clone). "
        "Use sectionUpdates to change headings and bodies."
    )
    return sectioned_system_prompt(
        role=f"You are a CRM assistant helping edit {doc} document templates.",
        goal=(
            "Interpret the user's edit request and return structured patches "
            "that update the template while preserving an exact uploaded layout when pageClone is true."
        ),
        instructions=(
            "Read templateContext and the user message.\n"
            "- Apply only what they asked; do not rewrite unrelated sections.\n"
            "- Keep merge tokens like {{customerName}} {{date}} {{total}} when appropriate.\n"
            "- sectionUpdates: array of {key, title?, body?} — keys must come from Sections in context.\n"
            "- textReplacements: array of {find, replace} for exact substring swaps in page-clone HTML "
            "(find must appear verbatim in visibleTextPreview).\n"
            "- rename: new template name when they ask to rename.\n"
            "- makeActive: true/false only when they explicitly ask to set or unset Active.\n"
            f"{layout}"
        ),
        context="",
        output=(
            "Return ONLY valid JSON (no markdown fences):\n"
            "{\n"
            '  "reply": "short conversational confirmation",\n'
            '  "sectionUpdates": [{"key":"introduction","title":"...","body":"..."}],\n'
            '  "textReplacements": [{"find":"Old Co","replace":"New Co"}],\n'
            '  "rename": "Optional new name",\n'
            '  "makeActive": true\n'
            "}"
        ),
        guardrails=(
            "Do not invent CRM features. Do not claim changes were saved — the app persists patches.\n"
            "If you cannot match text on a page clone, explain and suggest the exact phrase to change.\n"
            "If the user only asks a question, return empty arrays and answer in reply."
        ),
    )


async def run(
    kind: str = "proposal",
    message: str = "",
    templateName: str = "",
    template_name: str = "",
    blueprintMode: str = "",
    blueprint_mode: str = "",
    blueprintHtml: str = "",
    blueprint_html: str = "",
    sections: list[dict[str, Any]] | None = None,
    organization_id: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    del organization_id
    kind_norm = (kind or "proposal").strip().lower()
    if kind_norm not in ("proposal", "quote", "invoice"):
        kind_norm = "proposal"

    user_message = (message or "").strip()
    if not user_message:
        return label_fallback(
            {
                "ok": True,
                "reply": "What would you like to change in this template?",
                "sectionUpdates": [],
                "textReplacements": [],
            },
            "empty_message",
        )

    mode = (blueprintMode or blueprint_mode or "").strip().lower()
    page_clone = mode == "page-clone" or "bp-page-clone" in (blueprintHtml or blueprint_html or "")
    section_rows = sections if isinstance(sections, list) else []
    visible = _visible_text_preview(blueprintHtml or blueprint_html or "")
    name = (templateName or template_name or "").strip() or "Untitled"

    context = "\n".join(
        [
            f"Document kind: {kind_norm}",
            f"Template name: {name}",
            f"Page clone (layout locked): {'yes' if page_clone else 'no'}",
            "Sections:",
            _section_summary(section_rows),
            f"visibleTextPreview: {visible or '(empty)'}",
        ]
    )

    if not is_ai_configured():
        out = _offline_reply(user_message, kind_norm, section_rows)
        out["ok"] = True
        return out

    system = _system_prompt(kind_norm, page_clone)
    try:
        raw = await generate_ai_text(
            system=f"{system}\n\nContext:\n{context}",
            user=user_message,
            max_tokens=900,
            timeout_ms=25_000,
        )
    except Exception:
        logger.exception("document-template-edit LLM failed")
        out = _offline_reply(user_message, kind_norm, section_rows)
        out["ok"] = True
        return out

    parsed = extract_json(raw or "")
    if not parsed:
        return label_ai(
            {
                "ok": True,
                "reply": (raw or "").strip()
                or "I couldn't parse that edit — try naming the section or exact text to change.",
                "sectionUpdates": [],
                "textReplacements": [],
            }
        )

    reply = str(parsed.get("reply") or "").strip()
    section_updates = parsed.get("sectionUpdates")
    text_replacements = parsed.get("textReplacements")
    rename = parsed.get("rename")
    make_active = parsed.get("makeActive")

    if not isinstance(section_updates, list):
        section_updates = []
    if not isinstance(text_replacements, list):
        text_replacements = []

    out: dict[str, Any] = {
        "ok": True,
        "reply": reply or "Updated the template draft.",
        "sectionUpdates": section_updates,
        "textReplacements": text_replacements,
    }
    if isinstance(rename, str) and rename.strip():
        out["rename"] = rename.strip()
    if isinstance(make_active, bool):
        out["makeActive"] = make_active
    return label_ai(out)
