"""Social channel prompt overlay for custom_lola_worktual."""

from __future__ import annotations

SOCIAL_CHANNELS = frozenset({"whatsapp", "instagram", "facebook", "social"})


def build_social_overlay(channel: str) -> str:
    normalized = (channel or "webchat").strip().lower()
    if normalized not in SOCIAL_CHANNELS:
        return ""
    label = {
        "whatsapp": "WhatsApp",
        "instagram": "Instagram",
        "facebook": "Facebook",
        "social": "social media",
    }.get(normalized, normalized)
    return f"""

### SOCIAL CHANNEL ({label})
- The customer is messaging on {label}. Keep replies short (under 3 short paragraphs).
- Do not use heavy HTML formatting; plain text with light emphasis is fine.
- Acknowledge you are assisting them on {label} when helpful.
- Avoid web-only instructions (e.g. "click this link in the widget").
"""


def apply_social_overlay(prompt: str, channel: str) -> str:
    overlay = build_social_overlay(channel)
    return f"{prompt.rstrip()}{overlay}" if overlay else prompt
