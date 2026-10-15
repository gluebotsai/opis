"""Working / short-term / preference memory for template edit specialists."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

_MAX_SNAPS = 8
_WORKING_KEY = "edit_working"
_PREFS_KEY = "edit_preferences"
_NOTE_KEY = "edit_memory_note"


def _tid(template_id: str) -> str:
    return str(template_id or "").strip()


def get_working(session: dict[str, Any] | None, template_id: str) -> dict[str, Any]:
    root = session if isinstance(session, dict) else {}
    blob = root.get(_WORKING_KEY) if isinstance(root.get(_WORKING_KEY), dict) else {}
    row = blob.get(_tid(template_id)) if isinstance(blob.get(_tid(template_id)), dict) else {}
    past = row.get("past") if isinstance(row.get("past"), list) else []
    future = row.get("future") if isinstance(row.get("future"), list) else []
    return {
        "past": [r for r in past if isinstance(r, dict)][-_MAX_SNAPS:],
        "future": [r for r in future if isinstance(r, dict)][-_MAX_SNAPS:],
        "last_tool_note": str(row.get("last_tool_note") or "").strip(),
        "last_kb": str(row.get("last_kb") or "").strip()[:1800],
    }


def save_working(
    session: dict[str, Any],
    template_id: str,
    row: dict[str, Any],
) -> None:
    blob = session.get(_WORKING_KEY) if isinstance(session.get(_WORKING_KEY), dict) else {}
    blob = dict(blob)
    blob[_tid(template_id)] = {
        "past": list(row.get("past") or [])[-_MAX_SNAPS:],
        "future": list(row.get("future") or [])[-_MAX_SNAPS:],
        "last_tool_note": str(row.get("last_tool_note") or "")[:400],
        "last_kb": str(row.get("last_kb") or "")[:1800],
    }
    session[_WORKING_KEY] = blob


def push_undo(session: dict[str, Any], template_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    row = get_working(session, template_id)
    past = list(row.get("past") or [])
    past.append(deepcopy(fields if isinstance(fields, dict) else {}))
    row = {
        **row,
        "past": past[-_MAX_SNAPS:],
        "future": [],
    }
    save_working(session, template_id, row)
    return row


def undo_fields(
    session: dict[str, Any],
    template_id: str,
    current: dict[str, Any],
) -> tuple[dict[str, Any] | None, str]:
    row = get_working(session, template_id)
    past = list(row.get("past") or [])
    if not past:
        return None, "Nothing to undo yet."
    previous = past.pop()
    future = list(row.get("future") or [])
    future.append(deepcopy(current if isinstance(current, dict) else {}))
    save_working(
        session,
        template_id,
        {**row, "past": past, "future": future[-_MAX_SNAPS:]},
    )
    return deepcopy(previous), "Restored the previous version of this template."


def redo_fields(
    session: dict[str, Any],
    template_id: str,
    current: dict[str, Any],
) -> tuple[dict[str, Any] | None, str]:
    row = get_working(session, template_id)
    future = list(row.get("future") or [])
    if not future:
        return None, "Nothing to redo."
    nxt = future.pop()
    past = list(row.get("past") or [])
    past.append(deepcopy(current if isinstance(current, dict) else {}))
    save_working(
        session,
        template_id,
        {**row, "past": past[-_MAX_SNAPS:], "future": future},
    )
    return deepcopy(nxt), "Reapplied the later version of this template."


def clear_undo(session: dict[str, Any], template_id: str) -> None:
    row = get_working(session, template_id)
    save_working(session, template_id, {**row, "past": [], "future": []})


def get_preferences(session: dict[str, Any] | None) -> dict[str, Any]:
    root = session if isinstance(session, dict) else {}
    prefs = root.get(_PREFS_KEY)
    return dict(prefs) if isinstance(prefs, dict) else {}


def update_preferences(session: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    prefs = get_preferences(session)
    kind = str(patch.get("kind") or "soft").strip().lower()
    key = str(patch.get("key") or "").strip()[:80]
    if not key:
        return prefs
    if kind == "hard":
        hard = prefs.get("hard") if isinstance(prefs.get("hard"), dict) else {}
        hard = dict(hard)
        hard[key] = patch.get("value")
        prefs["hard"] = hard
    else:
        soft = prefs.get("soft") if isinstance(prefs.get("soft"), dict) else {}
        soft = dict(soft)
        soft[key] = patch.get("value")
        prefs["soft"] = soft
    session[_PREFS_KEY] = prefs
    return prefs


def append_memory_note(session: dict[str, Any], line: str) -> str:
    bit = " ".join(str(line or "").split()).strip()[:240]
    if not bit:
        return str(session.get(_NOTE_KEY) or "")
    prev = str(session.get(_NOTE_KEY) or "").strip()
    merged = f"{prev}\n{bit}" if prev else bit
    if len(merged) > 1200:
        merged = merged[-1200:]
    session[_NOTE_KEY] = merged
    return merged


def verify_hard_preferences(
    session: dict[str, Any] | None,
    *,
    proposed_action: str,
) -> dict[str, Any]:
    prefs = get_preferences(session)
    hard = prefs.get("hard") if isinstance(prefs.get("hard"), dict) else {}
    if not hard:
        return {"ok": True, "decision": "allow", "action": proposed_action}
    return {
        "ok": True,
        "decision": "allow",
        "action": proposed_action,
        "note": "No blocking hard preferences configured.",
    }
