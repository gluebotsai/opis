"""Capped rolling chat_memory_note — tool facts only (no extra LLM)."""

from __future__ import annotations

from typing import Any

# Soft target ~800–1200 chars; hard stop so Context stays small.
_MAX_CHARS = 1600


def get_memory_note(session: dict[str, Any] | None) -> str:
    return str((session or {}).get("chat_memory_note") or "").strip()


def _trim_note(text: str) -> str:
    text = (text or "").strip()
    if len(text) <= _MAX_CHARS:
        return text
    # Drop oldest lines first (note is newest-last).
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    while lines and len("\n".join(lines)) > _MAX_CHARS:
        lines.pop(0)
    out = "\n".join(lines)
    if len(out) > _MAX_CHARS:
        out = out[-_MAX_CHARS:]
    return out


def append_memory_note(session: dict[str, Any], line: str) -> str:
    """Append one fact line; mutate session; return new note."""
    bit = " ".join(str(line or "").split()).strip()
    if not bit:
        return get_memory_note(session)
    if len(bit) > 240:
        bit = bit[:237] + "…"
    prev = get_memory_note(session)
    # Avoid exact duplicate of last line.
    if prev:
        last = prev.split("\n")[-1].strip()
        if last == bit:
            return prev
        merged = f"{prev}\n{bit}"
    else:
        merged = bit
    note = _trim_note(merged)
    session["chat_memory_note"] = note
    return note


def note_from_campaign_meta(campaign: dict[str, Any] | None) -> str:
    c = campaign if isinstance(campaign, dict) else {}
    name = str(c.get("name") or "").strip()
    goal = str(c.get("goal") or "").strip()
    objective = str(c.get("objective") or "").strip()
    parts = []
    if name:
        parts.append(f"name={name}")
    if goal:
        parts.append(f"goal={goal}")
    if objective:
        parts.append(f"objective={objective}")
    return ("Meta saved: " + "; ".join(parts)) if parts else ""


def note_from_channels(channels: list | None) -> str:
    ch = [str(c).strip() for c in (channels or []) if str(c).strip()]
    return f"Channels: {', '.join(ch)}" if ch else ""


def note_from_templates(channels: list | None) -> str:
    """One fact line after cards exist — survives a failed recap LLM call."""
    seen: list[str] = []
    for raw in channels or []:
        ch = str(raw or "").strip().lower()
        if ch and ch not in seen:
            seen.append(ch)
    if not seen:
        return "Templates generated."
    return f"Templates generated for {', '.join(seen)}."


_INDUSTRY_NOTE_PREFIX = "Login industry:"


def upsert_industry_memory_note(session: dict[str, Any], profile: Any) -> str:
    """Keep one login-industry fact line in working memory (replace, don't stack)."""
    from app.industry_packs.loader import normalize_campaign_profile

    p = normalize_campaign_profile(profile)
    vertical = p["industry_type"] or "generic"
    mode = str(p.get("mode") or "b2b").upper()
    line = (
        f"{_INDUSTRY_NOTE_PREFIX} {vertical} ({mode}). "
        f"Behave and generate templates as a {vertical} brand — "
        f"tone, offers, and visuals must fit that vertical."
    )
    prev = get_memory_note(session)
    kept = [
        ln.strip()
        for ln in prev.split("\n")
        if ln.strip() and not ln.strip().startswith(_INDUSTRY_NOTE_PREFIX)
    ]
    kept.append(line)
    note = _trim_note("\n".join(kept))
    session["chat_memory_note"] = note
    return note


_WHATSAPP_META_PREFIX = "WhatsApp Meta:"


def upsert_whatsapp_approval_memory_note(
    session: dict[str, Any], line: str
) -> str:
    """Replace prior WhatsApp Meta approval lines with one current fact."""
    bit = " ".join(str(line or "").split()).strip()
    if not bit:
        return get_memory_note(session)
    if not bit.startswith(_WHATSAPP_META_PREFIX):
        bit = f"{_WHATSAPP_META_PREFIX} {bit.lstrip(':').strip()}"
    prev = get_memory_note(session)
    kept = [
        ln.strip()
        for ln in prev.split("\n")
        if ln.strip() and not ln.strip().startswith(_WHATSAPP_META_PREFIX)
    ]
    kept.append(bit)
    note = _trim_note("\n".join(kept))
    session["chat_memory_note"] = note
    return note


def note_from_audience(audience: dict[str, Any] | None) -> str:
    a = audience if isinstance(audience, dict) else {}
    count = int(a.get("matched_count") or 0)
    desc = str(a.get("description") or a.get("summary") or "").strip()
    if count <= 0 and not desc:
        return ""
    if desc:
        return f"Audience: {desc} (matched={count})"
    return f"Audience matched_count={count}"


__all__ = [
    "append_memory_note",
    "get_memory_note",
    "note_from_audience",
    "note_from_campaign_meta",
    "note_from_channels",
    "note_from_templates",
    "upsert_industry_memory_note",
    "upsert_whatsapp_approval_memory_note",
]
