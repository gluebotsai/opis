"""Detect and replace internal agent/tool text before it reaches chat.

Product rule: users never see orchestration, tool names, JSON keys, soft_warnings,
or LLM self-instructions in any module (create, recommendation, library, edit).
"""

from __future__ import annotations

import re

# Substrings that mean text is for the LLM/tool loop — never show in chat bubbles.
_INTERNAL_REPLY_MARKERS = (
    "save meta and channels",
    "separate tool calls",
    "channels were not saved",
    "do not default to email",
    "channels_confirmed=true",
    "channels_confirmed",
    "ask which channels",
    "tell the user",
    "never paste this instruction",
    "do not paste this error",
    "do not paste this",
    "explain briefly in short html",
    "call update_campaign_setup",
    "you must call",
    "write a short html reply",
    "reply to the user now",
    "do not leave the reply blank",
    "tool failed internally",
    "in your html reply",
    "then call update_campaign_setup",
    "enhance_image_prompt",
    "raw user chat cannot reach the image api",
    "no image url — generate or refine an image first",
    "no image url - generate or refine an image first",
    "call enhance_image_prompt first",
    "generate or refine an image first",
    "haven't officially set the plan",
    "have not officially set the plan",
    "do not paste email html",
    "do not draft templates or paste html",
    # Orchestration / launch-plan leaks (seen in product screenshots)
    "soft design/audience/orchestration",
    "soft notes (do not block)",
    "soft notes (not blocked)",
    "soft pdoa notes",
    "ontology_ok",
    "ontology_miss",
    "semantic_ok",
    "reports_miss",
    "launch not blocked",
    "launch-not-blocked",
    "orchestration notes",
    "orchestration_mode",
    "prefer_primary",
    "broadcast_confirmed",
    "launch_channels=",
    "launch_channels",
    "explain the send plan in your own words",
    "no template blocks",
    "agent_instruction",
    "soft_warnings",
    "emails_matched=",
    "emails_missing=",
    "phones_matched=",
    "phones_missing=",
    "filters=",
    "matched_count",
    "campaign scores (top)",
    "never say",
    "pass broadcast_confirmed",
    "t0 limited to primary",
    "suggest_campaign_names",
    "confirm_chat_images",
    "clear_chat_images",
    "plan_campaign_images",
    "build_campaign(",
    "update_campaign_setup(",
    "launch_campaign(",
    "needs_name_suggestions",
    "[system]",
    "[internal_nudge]",
)

# Regex patterns for internal / machine-facing chat text.
_INTERNAL_PATTERNS = (
    re.compile(r"launch_channels\s*="),
    re.compile(r"orchestration[_ ]?mode", re.I),
    re.compile(r"prefer[_ ]?primary", re.I),
    re.compile(r"\bchannels_confirmed\b", re.I),
    re.compile(r"soft\s+(design|notes|warnings)", re.I),
    re.compile(r"\b(agent_instruction|soft_warnings|matched_count)\b", re.I),
    re.compile(r"\b(call|use)\s+(the\s+)?(tool|function)\b", re.I),
    re.compile(r"\buser_confirmed\s*=", re.I),
    re.compile(r"\bJSON\b.*\b(tool|session|field)", re.I),
)

# Strong signals of a full email/template body pasted into chat (not chat UI tables).
_STRONG_EMAIL_TEMPLATE_MARKERS = (
    "mso-table",
    "banner image]",
    "[festive",
    "explore festive",
    "dear {{",
    "dear aravindh",
    "unsubscribe",
    "cta_label",
    "special festive offer:",
    "wishing you a blessed",
    "{{first_name}}",
    "{{first name}}",
)


def looks_like_internal_reply(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    if t.startswith("[internal_nudge]") or t.startswith("[system]"):
        return True
    if any(marker in t for marker in _INTERNAL_REPLY_MARKERS):
        return True
    return any(p.search(t) for p in _INTERNAL_PATTERNS)


def looks_like_inline_template_html(text: str) -> bool:
    """True when the assistant pasted a full email/template preview in chat.

    Must NOT match normal create-chat HTML (audience option tables, channel lists).
    A lone ``<table>`` or long reply is not enough — that caused false
    "Your template is ready" bubbles with no cards on the panel.
    """
    t = (text or "").strip()
    if len(t) < 180:
        return False
    lower = t.lower()
    strong = sum(1 for m in _STRONG_EMAIL_TEMPLATE_MARKERS if m in lower)
    if strong >= 2:
        return True
    if strong >= 1 and len(t) > 280:
        return True
    # Styled email shell: inline styles + table + substantial body.
    if (
        "<div style" in lower
        and "<table" in lower
        and len(t) > 450
        and ("<h1" in lower or "dear " in lower or "cta" in lower)
    ):
        return True
    if (
        "<div style" in lower
        and ("<h1" in lower or "<h2" in lower)
        and len(t) > 400
        and strong >= 1
    ):
        return True
    return False


def strip_inline_template_from_reply(text: str) -> str:
    """Strip pasted email HTML — never claim cards exist (build_campaign owns that)."""
    if not looks_like_inline_template_html(text):
        return text
    return (
        "<p>The full email lives on the right — open the email card and use "
        "<b>View</b> to preview or edit.</p>"
        "<p>If a card isn't there yet, ask me to <b>generate</b> or "
        "<b>regenerate</b> templates.</p>"
    )


def pick_user_facing_tool_message(result: dict | None) -> str:
    """Prefer explicit user HTML from a tool result over internal message fields."""
    if not isinstance(result, dict):
        return ""
    for key in ("user_message", "user_html", "reply"):
        raw = str(result.get(key) or "").strip()
        if raw and not looks_like_internal_reply(raw):
            return raw
    # Never fall back to raw `message` — that field often holds agent_instruction text.
    msg = str(result.get("message") or "").strip()
    if msg and not looks_like_internal_reply(msg) and msg.startswith("<"):
        return msg
    return ""


def sanitize_user_facing_reply(text: str) -> str:
    """Never show tool/LLM instruction leaks or inline template HTML in chat."""
    from app.agents.create_campaign.chat_html_normalize import normalize_chat_html

    t = (text or "").strip()
    if not t:
        return t
    out = ""
    if looks_like_internal_reply(t):
        lowered = t.lower()
        if "enhance_image" in lowered or "no image url" in lowered:
            out = (
                "<p>I couldn't finish the hero image step. "
                "Try again, or describe the image you want in the edit chat.</p>"
            )
        elif "orchestrat" in lowered or "prefer_primary" in lowered or "launch_channels" in lowered:
            out = (
                "<p>I've updated the send plan. "
                "Say when you want to launch, or tell me what to change.</p>"
            )
        elif "channel" in lowered:
            out = (
                "<p>Got it — I'll update your channel setup. "
                "One moment while I save that.</p>"
            )
        elif "launch" in lowered or "missing" in lowered or "set the plan" in lowered:
            out = (
                "<p>We can't launch yet — some templates or setup are still missing. "
                "Check the overview panel, regenerate missing channels, or remove them.</p>"
            )
        elif "template" in lowered and ("generate" in lowered or "build" in lowered):
            out = (
                "<p>I'm generating your templates now — you'll see cards appear "
                "on the right when they're ready.</p>"
            )
        elif "audience" in lowered or "matched" in lowered or "contact" in lowered:
            out = (
                "<p>Audience is updated — check the overview panel for the match count. "
                "Tell me if you want to change who we send to.</p>"
            )
        else:
            out = (
                "<p>I'm finishing that update — if anything still looks off in the overview, "
                "tell me what you'd like to change next.</p>"
            )
    elif t.startswith("Cannot launch yet — still missing") or t.startswith(
        "Launch blocked — missing"
    ):
        out = (
            "<p>We can't launch yet — some templates or setup are still missing. "
            "Check the overview panel, regenerate missing channels, or remove them.</p>"
        )
    else:
        cleaned = strip_inline_template_from_reply(t)
        out = ensure_temporary_sheet_hypertext(cleaned)
    return normalize_chat_html(out)


# Bare sheet URLs that must never appear as plain text in chat.
_SHEET_BARE_URL_RE = re.compile(
    r"https?://[^\s\"'<>]*temporary-contact-template\.csv[^\s\"'<>]*",
    re.IGNORECASE,
)
_SHEET_ANCHOR_RE = re.compile(
    r"<a\b[^>]*temporary-contact-template\.csv[^>]*>.*?</a>",
    re.IGNORECASE | re.DOTALL,
)


def ensure_temporary_sheet_hypertext(text: str) -> str:
    """Rewrite bare sheet URLs to Download sample sheet hypertext; never leave naked URLs.

    Does not invent audience/sheet offers — the agent must include the link via prompts.
    """
    t = str(text or "")
    if not t.strip():
        return t
    try:
        from app.agents.create_campaign.prompts import (
            temporary_contact_template_link_html,
        )

        link = temporary_contact_template_link_html()
    except Exception:  # noqa: BLE001
        return t

    # Replace any bare CSV URL (outside existing anchors) with the official hypertext.
    def _replace_bare(match: re.Match[str]) -> str:
        return link

    # Protect existing anchors, replace bare URLs in the rest.
    parts: list[str] = []
    last = 0
    for m in _SHEET_ANCHOR_RE.finditer(t):
        chunk = t[last : m.start()]
        parts.append(_SHEET_BARE_URL_RE.sub(_replace_bare, chunk))
        parts.append(m.group(0))
        last = m.end()
    parts.append(_SHEET_BARE_URL_RE.sub(_replace_bare, t[last:]))
    return "".join(parts)


def user_facing_image_failure(raw: str, *, kind: str = "generate") -> str:
    """Plain-text edit-space message when image attach/generate failed.

    kind=generate: AI photo then save to campaign media (not a chat file pick).
    kind=upload: user attached a file in chat.
    """
    msg = str(raw or "").strip()
    lower = msg.lower()
    mode = str(kind or "generate").strip().lower() or "generate"
    if "refused" in lower or "can't generate that kind" in lower:
        return (
            "I couldn't use that brief for a campaign image. "
            "Tell me what you want to show — people, product, setting — and I'll try again."
        )
    media_save = (
        "media upload" in lower
        or "did not attach" in lower
        or "connection" in lower
        or "connecterror" in lower
    )
    if media_save and mode != "upload":
        return (
            "I couldn't save the generated photo to campaign media. "
            "Try again in a moment, or attach a photo from chat."
        )
    if media_save:
        return "Image upload failed — please try again in a moment."
    if (
        "gemini_api_key" in lower
        or "not configured on the agents" in lower
        or "isn't set up" in lower
        or "not enabled" in lower
        or "not available" in lower
        or "not available in this environment" in lower
    ):
        return (
            "AI image generation isn't available here yet. "
            "Upload a photo instead, or ask me to keep editing the copy."
        )
    if msg and len(msg) < 160 and "enhance_image" not in lower and not looks_like_internal_reply(msg):
        return msg
    return (
        "I couldn't finish that image yet. "
        "Try again, attach a photo from chat, or describe what you want in a short sentence."
    )


def edit_space_reply(text: str) -> str:
    """Template edit chat — plain text only, no HTML or internal tool leaks."""
    from app.text_cleanup import strip_html_tags

    cleaned = sanitize_user_facing_reply(text)
    plain = strip_html_tags(cleaned)
    if plain and looks_like_internal_reply(plain):
        if "image" in plain.lower():
            return user_facing_image_failure(plain)
        return (
            "Something didn't apply — tell me what to change and I'll try again."
        )
    return plain or cleaned


def tool_result_for_llm(result: dict | None) -> dict:
    """Strip user-hostile fields from tool JSON the model reads on the next turn."""
    if not isinstance(result, dict):
        return result if isinstance(result, dict) else {}
    out = dict(result)
    msg = str(out.get("message") or "").strip()
    if msg and looks_like_internal_reply(msg):
        instr = str(out.get("agent_instruction") or msg).strip()
        out["agent_instruction"] = instr
        out.pop("message", None)
    # Soft warnings are for the model / panel — never treat as chat copy.
    if "soft_warnings" in out and "agent_instruction" not in out:
        warns = out.get("soft_warnings")
        if isinstance(warns, list) and warns:
            out["agent_instruction"] = (
                "Internal soft notes (never paste to user): "
                + " ".join(str(w) for w in warns[:6])
            )
    return out
