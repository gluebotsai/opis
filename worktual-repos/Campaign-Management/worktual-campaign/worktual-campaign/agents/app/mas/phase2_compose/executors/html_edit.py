"""Edit compiled HTML from compose pipeline."""

from __future__ import annotations

import json
from typing import Any

from app.mas.phase2_compose.llm import (
    TEMPLATE_COMPOSE_SYSTEM,
    achat_completion,
    extract_email_html,
    looks_like_html,
)
from app.text_cleanup import strip_html_tags

HTML_EDIT_SYSTEM = (
    TEMPLATE_COMPOSE_SYSTEM
    + "\n\nYou are editing an existing HTML email. Apply the user's instruction. "
    "Return the full updated HTML only.\n"
    "Never write explanations, refusals, or editor commentary into the email body.\n"
    "Never invent image URLs (no gstatic, unsplash, placeholder, or stock photos).\n"
    "If the user asked to add or replace a photo, return the original HTML unchanged "
    "with no extra sentences — a separate image step generates a real Gemini photo."
)

_COMMENTARY_MARKERS = (
    "i can't add an image",
    "i cannot add an image",
    "do not add img tags",
    "leaving the template unchanged",
    "no image url was provided",
    "plan explicitly says",
    "no images — do not",
    "no images -- do not",
)


def html_looks_like_editor_commentary(updated: str, original: str = "") -> bool:
    """True when the model wrote a refusal/note instead of an email."""
    html = str(updated or "").strip()
    if not html:
        return True
    if not looks_like_html(html):
        return True
    plain = strip_html_tags(html).strip().lower()
    if any(marker in plain for marker in _COMMENTARY_MARKERS):
        return True
    orig_plain = strip_html_tags(str(original or "")).strip()
    if orig_plain and len(plain) < 420 and len(orig_plain) > 600:
        head = plain[:120]
        if head.startswith("i ") or "i'm " in head or "i cannot" in head or "i can't" in head:
            return True
    return False


async def run_html_edit_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    task = dict(ctx.get("task_spec") or {})
    query = str(task.get("query") or ctx.get("query") or "").strip()
    fields = task.get("fields") if isinstance(task.get("fields"), dict) else ctx.get("fields")
    if not isinstance(fields, dict) or not fields:
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "html_edit",
            "error": "fields required for html_edit",
        }
    html = str(fields.get("compiled_html") or "").strip()
    if not html:
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "html_edit",
            "error": "compiled_html required for html_edit",
        }
    if not query:
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "html_edit",
            "error": "query (edit instruction) is required",
        }

    chat_summary = str(task.get("chat_summary") or "").strip()
    plan = fields.get("plan")
    assets = fields.get("image_assets") or []
    parts = []
    if chat_summary:
        parts.append(f"Chat context:\n{chat_summary}")
    if plan:
        parts.append(f"Email plan (preserve intent):\n{json.dumps(plan, indent=2)}")
    if assets:
        parts.append(
            "Keep using only these image URLs (do not invent others):\n"
            + json.dumps(assets, indent=2)
        )
    else:
        parts.append(
            "There is no generated photo URL yet. Do not add img tags or stock "
            "URLs. If the instruction is to add a photo, return the original HTML unchanged."
        )
    parts.append(f"Edit instruction:\n{query}")
    parts.append(f"Current HTML:\n{html[:120000]}")
    user = "\n\n".join(parts)

    raw = await achat_completion(system=HTML_EDIT_SYSTEM, user=user)
    updated = extract_email_html(raw)
    if not updated:
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "html_edit",
            "error": "html_edit_empty",
        }
    if html_looks_like_editor_commentary(updated, html):
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "html_edit",
            "error": "html_edit_needs_image",
            "message": strip_html_tags(updated)[:400],
        }
    try:
        from app.mas.phase2_compose.plugin import ensure_unsubscribe

        updated = ensure_unsubscribe(updated)
    except Exception:  # noqa: BLE001
        pass
    from app.mas.phase2_compose.html_images import (
        collect_allowed_image_urls,
        strip_untrusted_content_images,
    )

    updated = strip_untrusted_content_images(
        updated,
        allowed_urls=collect_allowed_image_urls(fields),
    )
    new_fields = dict(fields)
    new_fields["compiled_html"] = updated
    new_fields["pipeline"] = "compose"
    new_fields.pop("sections", None)
    new_fields.pop("blocks", None)

    return {
        "ok": True,
        "action_status": "completed",
        "executor_id": "html_edit",
        "message": "Updated email template.",
        "fields": new_fields,
    }
