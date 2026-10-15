"""Build memory + restated user_request for QUERY_CONTACTS / SQL agent."""

from __future__ import annotations

from typing import Any

from app.agents.contacts.memory_note import get_memory_note
from app.session_store import get_llm_memory


def _recent_chat_lines(session: dict[str, Any], *, max_turns: int = 8) -> list[str]:
    mem = get_llm_memory(session)
    lines: list[str] = []
    for msg in reversed(mem):
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        text = str(msg.get("content") or "").strip()
        if not text or text.startswith("{"):
            continue
        prefix = "User" if role == "user" else "Assistant"
        lines.append(f"{prefix}: {text[:400]}")
        if len(lines) >= max_turns:
            break
    lines.reverse()
    return lines


def build_contact_query_memory(
    session: dict[str, Any],
    *,
    user_text: str = "",
) -> dict[str, Any]:
    """Structured context for the read-only SQL agent (no intent parsing)."""
    recent = _recent_chat_lines(session)
    note = str(get_memory_note(session) or "").strip()
    live = {
        "candidates_count": len(session.get("candidates") or []),
        "focus_contact_id": session.get("focus_contact_id"),
        "draft_mode": session.get("draft_mode"),
        "last_action": session.get("last_action"),
    }
    return {
        "chat_memory_note": note,
        "recent_chat": recent,
        "latest_user_message": str(user_text or "").strip(),
        "live_session": live,
    }


def build_query_user_request(session: dict[str, Any], user_text: str) -> str:
    """
    Full restatement for QUERY_CONTACTS: latest message + prior thread context
    for the SQL agent to interpret (not for keyword routing).
    """
    text = str(user_text or "").strip()
    mem = build_contact_query_memory(session, user_text=text)
    note = mem.get("chat_memory_note") or ""
    recent = mem.get("recent_chat") or []
    parts: list[str] = []
    if note:
        parts.append(f"Memory note: {note}")
    if recent:
        parts.append("Recent conversation:\n" + "\n".join(recent))
    parts.append(f"Current request (show matching contacts): {text}")
    return "\n\n".join(p for p in parts if p).strip() or text


__all__ = [
    "build_contact_query_memory",
    "build_query_user_request",
]
