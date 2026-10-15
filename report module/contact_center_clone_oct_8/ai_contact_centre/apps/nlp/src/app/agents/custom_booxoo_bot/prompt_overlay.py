"""Channel prompt overlay for custom_booxoo_bot."""

from __future__ import annotations

SOCIAL_CHANNELS = frozenset({"whatsapp", "instagram", "facebook", "social"})

_SOCIAL_LABELS = {
    "whatsapp": "WhatsApp",
    "instagram": "Instagram",
    "facebook": "Facebook",
    "social": "social media",
}


def build_channel_overlay(channel: str) -> str:
    normalized = (channel or "webchat").strip().lower()
    if normalized in SOCIAL_CHANNELS:
        label = _SOCIAL_LABELS.get(normalized, normalized)
        return f"""

### SOCIAL CHANNEL ({label})
- The customer is messaging on {label}. Keep replies short (under 3 short paragraphs).
- Do not use heavy HTML formatting; plain text with light emphasis is fine.
- Acknowledge you are assisting them on {label} when helpful.
- Avoid web-only instructions (for example, "click this link in the widget").
- Product links are allowed only when a tool returned that URL.
"""
    if normalized == "webchat":
        return """

### WEBCHAT CHANNEL
- The customer is in the webchat widget. Write the reply as HTML the widget can render.
- Use <p> for sentences and <b> for the few words that need emphasis. Do not bold whole sentences.
- For a list of categories, products, or steps, use <ul> and <li>.
- Do not use markdown. Never use **, *, # headings, or code fences.
- Do not use heading tags such as <h1> or <h2>.
"""
    if normalized == "email":
        return """

### EMAIL CHANNEL
- The customer wrote an email. The message starts with the subject, then a blank line, then the body.
- Write a normal email reply: a short greeting, the answer, and a short closing.
- Do not mention a chat widget, "this chat", or clicking a button in a widget.
- Do not shorten the reply to fit a messaging-app limit.
- Product links are allowed only when a tool returned that URL.
"""
    return ""


def apply_channel_overlay(prompt: str, channel: str) -> str:
    overlay = build_channel_overlay(channel)
    return f"{prompt.rstrip()}{overlay}" if overlay else prompt
