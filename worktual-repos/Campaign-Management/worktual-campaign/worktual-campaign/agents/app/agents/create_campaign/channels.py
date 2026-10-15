"""Channel id normalization — allowlist only (no chat-intent parsing).

Chat meaning (add/remove channels, all channels, broadcast, proceed) is
LLM-only via tool arguments. This module only maps tool-supplied ids.
"""

from __future__ import annotations

from typing import Any

_ALLOWED = {
    "email": "email",
    "whatsapp": "whatsapp",
    "web": "web",
    "webpush": "web",
    "web_push": "web",
    "push": "push",
    "apppush": "push",
    "app_push": "push",
    "app": "push",
}

_CHANNEL_DISPLAY: dict[str, str] = {
    "email": "Email",
    "whatsapp": "WhatsApp",
    "push": "App push (mobile)",
    "web": "Web push (browser)",
    "sms": "SMS",
}

_PUSH_FAMILY = frozenset({"web", "push"})


def _canon_tool_channel_key(raw: Any) -> str:
    """Normalize a tool-supplied id only (spaces/hyphens), not chat intent."""
    return str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")


def channel_display_name(channel: str) -> str:
    key = _canon_tool_channel_key(channel)
    mapped = _ALLOWED.get(key, key)
    return _CHANNEL_DISPLAY.get(mapped, mapped or "channel")


def normalize_channels(raw: Any) -> list[str]:
    """Map tool-supplied channel ids onto the allowlist (order preserved)."""
    out: list[str] = []
    items = raw if isinstance(raw, list) else []
    for item in items:
        key = _canon_tool_channel_key(item)
        mapped = _ALLOWED.get(key)
        if mapped and mapped not in out:
            out.append(mapped)
    return out


def reconcile_launch_channels(
    requested: Any,
    session_channels: Any,
) -> tuple[list[str], str | None]:
    """Keep saved web vs app push when launch args pick the other family.

    Compares already-chosen tool ids to session.channels. Does not parse chat.
    """
    req = normalize_channels(requested if isinstance(requested, list) else [])
    sess = normalize_channels(
        session_channels if isinstance(session_channels, list) else []
    )
    if not req:
        return list(sess), None
    if not sess:
        return req, None
    if set(req) <= set(sess):
        return req, None
    req_push = {c for c in req if c in _PUSH_FAMILY}
    sess_push = {c for c in sess if c in _PUSH_FAMILY}
    if req_push and sess_push and req_push.isdisjoint(sess_push):
        kept = [c for c in req if c not in _PUSH_FAMILY]
        for c in sess:
            if c in _PUSH_FAMILY and c not in kept:
                kept.append(c)
        saved = ",".join(
            f"{c}={channel_display_name(c)}" for c in sess if c in _PUSH_FAMILY
        )
        note = (
            "launch_channels had the other push type than the saved session. "
            f"Kept session {saved}. Canonical: web=web push (browser); "
            "push=app push (mobile). Pass web or web_push for browser; "
            "push or app_push for mobile."
        )
        return kept or list(sess), note
    return req, None


def launch_blocked_reason(session: dict) -> str | None:
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    if int(aud.get("matched_count") or 0) <= 0:
        return "Audience is empty — select contacts first."
    channels = normalize_channels(session.get("channels") or [])
    if not channels:
        return "Channels are not set — choose channels first."
    if not list(session.get("templates") or []):
        return "Templates are missing — create templates before launch."
    return None
