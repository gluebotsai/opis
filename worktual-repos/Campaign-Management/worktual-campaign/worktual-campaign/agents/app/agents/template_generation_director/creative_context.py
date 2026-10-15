"""Assemble session context for Template Director (chat, memory, industry, image plan)."""

from __future__ import annotations

from typing import Any

from app.agents.create_campaign.memory_note import get_memory_note
from app.agents.create_campaign.meta_helpers import chat_summary_from_session


def gather_director_session_context(session: dict[str, Any] | None) -> dict[str, Any]:
    """Facts-only bundle for enhancer / style director — no intent regex."""
    sess = session if isinstance(session, dict) else {}
    campaign = sess.get("campaign") if isinstance(sess.get("campaign"), dict) else {}
    profile = (
        sess.get("campaign_profile")
        if isinstance(sess.get("campaign_profile"), dict)
        else {}
    )
    company = sess.get("company_pack") if isinstance(sess.get("company_pack"), dict) else {}
    from app.agents.template_library.email_brand import extract_brand_from_context

    brand_assets = extract_brand_from_context(
        company_pack=company,
        campaign=campaign,
    )
    image_plan = {}
    try:
        from app.agents.image.plan import get_image_plan

        image_plan = get_image_plan(sess)
    except Exception:  # noqa: BLE001
        pass
    pending_uploads: list[dict[str, Any]] = []
    confirmed_uploads: list[dict[str, Any]] = []
    try:
        from app.agents.image.user_assets import (
            list_confirmed_chat_images,
            list_pending_chat_images,
        )

        pending_uploads = list_pending_chat_images(sess)
        confirmed_uploads = list_confirmed_chat_images(sess)
    except Exception:  # noqa: BLE001
        pass
    return {
        "chat_summary": chat_summary_from_session(sess, limit=24),
        "chat_memory_note": get_memory_note(sess),
        "user_request": _last_user_request(sess),
        "campaign_profile_from_login": profile,
        "company_pack": company,
        "brand_assets": brand_assets,
        "campaign": campaign,
        "channels": list(sess.get("channels") or []),
        "image_plan_from_tools": image_plan,
        "pending_chat_images": pending_uploads[:8],
        "confirmed_chat_images": confirmed_uploads[:8],
        "selected_gallery_images": list(sess.get("selected_gallery_images") or [])[:8]
        if isinstance(sess.get("selected_gallery_images"), list)
        else [],
    }


def _last_user_request(session: dict[str, Any]) -> str:
    for msg in reversed(session.get("messages") or []):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "").strip().lower() != "user":
            continue
        text = str(msg.get("text") or msg.get("content") or "").strip()
        if text:
            return text
    return ""


def normalize_image_intent(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    slots_raw = data.get("slots") if isinstance(data.get("slots"), list) else []
    slots: list[dict[str, Any]] = []
    for row in slots_raw:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or row.get("purpose") or "visual").strip().lower()
        aspect = str(row.get("aspect_ratio") or row.get("aspect") or "").strip()
        display = str(row.get("display") or row.get("layout") or "").strip()
        slots.append(
            {
                "role": role or "visual",
                "aspect_ratio": aspect or "16:9",
                "display": display or "full_width",
                "subject_hint": str(row.get("subject_hint") or row.get("description") or "").strip(),
            }
        )
    needed = bool(data.get("images_needed"))
    if slots and not needed:
        needed = True
    count_hint = data.get("count_hint")
    try:
        count_hint = int(count_hint) if count_hint is not None else len(slots) or (1 if needed else 0)
    except (TypeError, ValueError):
        count_hint = len(slots) or (1 if needed else 0)
    if needed and count_hint < 1:
        count_hint = max(1, len(slots))
    return {
        "images_needed": needed,
        "count_hint": max(0, min(8, count_hint)),
        "rationale": str(data.get("rationale") or "").strip(),
        "user_asked_for_visuals": bool(data.get("user_asked_for_visuals")),
        "user_asked_for_custom_design": bool(data.get("user_asked_for_custom_design")),
        "slots": slots[:8],
    }


def effective_wants_images(
    *,
    tool_wants_images: bool,
    enhancer: dict[str, Any] | None,
    image_plan: dict[str, Any] | None,
    confirmed_chat_images: list[dict[str, Any]] | None = None,
) -> bool:
    plan = image_plan if isinstance(image_plan, dict) else {}
    if plan.get("wants_images") is False and plan.get("user_confirmed"):
        return False
    if tool_wants_images:
        return True
    if plan.get("wants_images"):
        return True
    for row in confirmed_chat_images or []:
        if not isinstance(row, dict):
            continue
        if row.get("include_in_templates") is False:
            continue
        if str(row.get("image_url") or "").strip():
            return True
    intent = normalize_image_intent((enhancer or {}).get("image_intent"))
    if not intent.get("images_needed"):
        return False
    if intent.get("count_hint", 0) <= 0 and not intent.get("slots"):
        return False
    return True


__all__ = [
    "effective_wants_images",
    "gather_director_session_context",
    "normalize_image_intent",
]
