"""CDP customer_profile.preferences_json — 0/1 channel map + optional windows.

Contract (spokes + Campaign):
  Flat flags (audience SQL): {email, whatsapp, push, web, sms} each 0|1
  Optional extras (not used by send/audience yet):
    timezone, timing {days, start, end}, channel_timing { <channel>: window }

Missing channel keys → 0. Timing keys omitted when unknown.
"""

from __future__ import annotations

from typing import Any, Mapping

from app.contacts.preference_timing import (
    parse_channel_timing,
    parse_send_window,
    safe_timezone,
)

PREFERENCE_CHANNELS: tuple[str, ...] = (
    "email",
    "whatsapp",
    "push",
    "web",
    "sms",
)

# When several channels score equally, prefer this order.
_TIE_BREAK: tuple[str, ...] = (
    "whatsapp",
    "email",
    "push",
    "web",
    "sms",
)


def empty_preferences() -> dict[str, int]:
    return {channel: 0 for channel in PREFERENCE_CHANNELS}


def _as_flag(value: Any) -> int:
    if value is True or value == 1:
        return 1
    if value is False or value == 0 or value is None:
        return 0
    if isinstance(value, (int, float)) and int(value) == 1:
        return 1
    text = str(value).strip().lower()
    if text in {"1", "true", "yes"}:
        return 1
    return 0


def _channel_flags(raw: Mapping[str, Any]) -> dict[str, int]:
    out = empty_preferences()
    nested = raw.get("channels")
    source: Mapping[str, Any] = raw
    if isinstance(nested, Mapping) and not any(
        str(k).strip().lower() in PREFERENCE_CHANNELS for k in raw
    ):
        source = nested
    for channel in PREFERENCE_CHANNELS:
        if channel in source:
            out[channel] = _as_flag(source.get(channel))
            continue
        aliases = {
            "push": ("app_push", "apppush"),
            "web": ("web_push", "webpush"),
        }.get(channel, ())
        for alias in aliases:
            if alias in source:
                out[channel] = _as_flag(source.get(alias))
                break
    return out


def _extras_from(raw: Mapping[str, Any]) -> dict[str, Any]:
    extras: dict[str, Any] = {}
    if raw.get("timezone"):
        extras["timezone"] = safe_timezone(raw.get("timezone"))
    window = parse_send_window(raw.get("timing"))
    if window:
        extras["timing"] = window
    channel_timing = parse_channel_timing(raw.get("channel_timing"))
    if channel_timing:
        extras["channel_timing"] = channel_timing
    return extras


def normalize_preferences_json(raw: Any) -> dict[str, Any]:
    """Normalize flags; preserve valid timezone / timing / channel_timing."""
    if not isinstance(raw, Mapping):
        return empty_preferences()
    out: dict[str, Any] = _channel_flags(raw)
    out.update(_extras_from(raw))
    return out


def merge_preferences_json(existing: Any, incoming: Any) -> dict[str, Any]:
    """Overlay incoming flags; extras from incoming only when present there."""
    base = normalize_preferences_json(existing)
    patch = normalize_preferences_json(incoming)
    out: dict[str, Any] = dict(base)
    for channel in PREFERENCE_CHANNELS:
        out[channel] = patch[channel]
    incoming_map = incoming if isinstance(incoming, Mapping) else {}
    if incoming_map.get("timezone"):
        out["timezone"] = patch.get("timezone") or safe_timezone(
            incoming_map.get("timezone")
        )
    if "timing" in incoming_map:
        window = parse_send_window(incoming_map.get("timing"))
        if window:
            out["timing"] = window
    if "channel_timing" in incoming_map:
        channel_timing = parse_channel_timing(incoming_map.get("channel_timing"))
        if channel_timing:
            out["channel_timing"] = channel_timing
    return out


def preferences_from_engagement(
    *,
    email_open_count: int = 0,
    email_click_count: int = 0,
    email_unsubscribed: bool = False,
    whatsapp_engage_count: int = 0,
    push_engage_count: int = 0,
    web_engage_count: int = 0,
    sms_engage_count: int = 0,
) -> dict[str, int]:
    """Derive 0/1 map from engagement counts. Winner → 1, rest → 0.

    Email score = opens + 2×clicks (0 if unsubscribed).
    Other channels use engage counts when spokes/Campaign provide them.
    No positive signal → all 0.
    """
    scores: dict[str, float] = {
        "email": 0.0,
        "whatsapp": max(0, int(whatsapp_engage_count or 0)),
        "push": max(0, int(push_engage_count or 0)),
        "web": max(0, int(web_engage_count or 0)),
        "sms": max(0, int(sms_engage_count or 0)),
    }
    if not email_unsubscribed:
        opens = max(0, int(email_open_count or 0))
        clicks = max(0, int(email_click_count or 0))
        scores["email"] = float(opens + 2 * clicks)

    best = max(scores.values()) if scores else 0.0
    if best <= 0:
        return empty_preferences()

    winners = [c for c, s in scores.items() if s >= best]
    if len(winners) == 1:
        chosen = winners[0]
    else:
        chosen = next((c for c in _TIE_BREAK if c in winners), winners[0])

    out = empty_preferences()
    out[chosen] = 1
    return out
