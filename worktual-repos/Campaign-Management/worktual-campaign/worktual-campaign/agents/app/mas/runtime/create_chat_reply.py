"""Create-campaign fallback reply when MAS returns empty HTML."""

from app.agents.create_campaign.user_facing import (
    sanitize_user_facing_reply,
    strip_inline_template_from_reply,
)


def fallback_create_campaign_reply(result: dict) -> str:
    reply = str(result.get("reply") or "").strip()
    if reply:
        return strip_inline_template_from_reply(sanitize_user_facing_reply(reply))
    state = result.get("state") if isinstance(result.get("state"), dict) else {}
    camp = state.get("campaign") if isinstance(state.get("campaign"), dict) else {}
    channels = [
        str(c).strip().lower()
        for c in (state.get("channels") or [])
        if str(c).strip()
    ]
    templates = state.get("templates") if isinstance(state.get("templates"), list) else []
    name = str(camp.get("name") or "").strip()
    if name and not channels:
        return (
            "<p>I've saved your campaign details.</p>"
            "<p>Which channels should we use — <b>email</b>, <b>whatsapp</b>, "
            "<b>web push</b>, or <b>app push</b>?</p>"
        )
    if channels and not templates:
        ch = ", ".join(channels)
        return (
            f"<p>Channels saved: <b>{ch}</b>.</p>"
            "<p>Shall I generate templates for these channels?</p>"
        )
    return "<p>Got it — what would you like to do next?</p>"
