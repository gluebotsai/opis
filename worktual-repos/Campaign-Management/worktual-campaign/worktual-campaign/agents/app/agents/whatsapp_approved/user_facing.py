"""User-facing chat HTML for approved WhatsApp runs (shared create-campaign helpers)."""

from __future__ import annotations

from typing import Any

from app.agents.create_campaign.user_facing import (
    looks_like_internal_reply,
    pick_user_facing_tool_message,
    sanitize_user_facing_reply,
)


def fact_reply_from_wa_tools(
    round_tool_results: list[tuple[str, dict[str, Any]]],
) -> str:
    """HTML for chat when tools succeeded but the model returned empty text."""
    if not round_tool_results:
        return ""
    names = [n for n, _ in round_tool_results]
    prefer_launch = "LAUNCH_APPROVED_CAMPAIGN" in names
    prefer_send = "SEND_APPROVED_TEMPLATE" in names and not prefer_launch
    parts: list[str] = []
    for name, result in round_tool_results:
        if not isinstance(result, dict):
            continue
        if prefer_launch and name != "LAUNCH_APPROVED_CAMPAIGN":
            continue
        if prefer_send and name != "SEND_APPROVED_TEMPLATE":
            continue
        facing = pick_user_facing_tool_message(result)
        if facing:
            parts.append(facing if facing.startswith("<") else f"<p>{facing}</p>")
            continue
        if result.get("ok") is False:
            err = str(result.get("error") or result.get("message") or "").strip()
            if err and not looks_like_internal_reply(err):
                parts.append(f"<p>{err[:400]}</p>")
            continue
        if name == "FILTER_CONTACTS":
            count = int(result.get("matched_count") or result.get("contact_id_count") or 0)
            if count > 0:
                parts.append(
                    f"<p>Matched <b>{count}</b> contact(s) in CRM. "
                    "Audience is on the overview panel.</p>"
                )
        elif name == "SET_AUDIENCE":
            n = int(result.get("phone_count") or 0) + int(
                result.get("contact_id_count") or 0
            )
            if n > 0:
                parts.append(
                    f"<p>Audience set to <b>{n}</b> recipient(s). "
                    "Confirm send timing when ready.</p>"
                )
        elif name == "UPLOAD_TEMPORARY_CONTACTS":
            parts.append(
                "<p>Temporary contact sheet saved for this run. "
                "Confirm when to send or schedule.</p>"
            )
    return "".join(parts)


def _repair_entity_encoded_html(text: str) -> str:
    """Fix model output that HTML-escaped an anchor we asked it to paste verbatim."""
    import html as html_lib

    t = str(text or "")
    if "&lt;" in t and ("temporary-contact-template" in t or "download sample" in t.lower()):
        t = html_lib.unescape(t)
    return t


def finalize_wa_user_reply(text: str) -> str:
    return sanitize_user_facing_reply(_repair_entity_encoded_html(text))


__all__ = ["fact_reply_from_wa_tools", "finalize_wa_user_reply"]
