"""Campaign meta helpers — no regex / phrase matching."""

from __future__ import annotations

from typing import Any


def _last_user_text(session: dict[str, Any] | None) -> str:
    if not session:
        return ""
    for msg in reversed(session.get("messages") or []):
        if isinstance(msg, dict) and str(msg.get("role") or "") == "user":
            return str(msg.get("text") or msg.get("content") or "").strip()
    return ""


def chat_summary_from_session(session: dict[str, Any] | None, *, limit: int = 16) -> str:
    """Recent chat turns for Information Enhancer (no intent parsing)."""
    if not session:
        return ""
    from app.agents.create_campaign.memory_note import get_memory_note

    memory = get_memory_note(session)
    lines: list[str] = []
    if memory:
        clipped_mem = memory if len(memory) <= 1200 else memory[:1200] + "…"
        lines.append(f"memory_note: {clipped_mem}")
    for msg in session.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        text = str(msg.get("text") or msg.get("content") or "").strip()
        if not text:
            continue
        clipped = text if len(text) <= 900 else text[:900] + "…"
        lines.append(f"{role}: {clipped}")
    return "\n".join(lines[-limit:])


def merge_campaign_meta_from_history(
    args: dict[str, Any],
    session: dict[str, Any] | None,
) -> dict[str, Any]:
    """Fill missing goal/objective from session campaign only (LLM resolves the name)."""
    payload = dict(args) if isinstance(args, dict) else {}
    camp = (session or {}).get("campaign") if isinstance((session or {}).get("campaign"), dict) else {}
    for key in ("name", "goal", "objective"):
        if not str(payload.get(key) or "").strip() and str(camp.get(key) or "").strip():
            payload[key] = camp[key]
    return payload


def validate_campaign_details(*_a, **_k) -> None:
    return None


def meta_facts_message(campaign: dict[str, Any], session: dict[str, Any] | None = None) -> str:
    name = str(campaign.get("name") or "").strip()
    goal = str(campaign.get("goal") or "").strip()
    objective = str(campaign.get("objective") or "").strip()
    return (
        "Campaign meta saved "
        f"(name={name or '(none)'}; goal={goal or '(none)'}; objective={objective or '(none)'})."
    )
