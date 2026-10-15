"""Single intent enum for SQL Super (gate, Gemma, SqlPlan, harness)."""

from __future__ import annotations

from typing import Literal

IntentKind = Literal["list", "count_scalar", "count_grouped", "kpi"]

_VALID: frozenset[str] = frozenset({"list", "count_scalar", "count_grouped", "kpi"})

# Legacy Gemma / plan values → IntentKind
_LEGACY_MAP: dict[str, IntentKind] = {
    "list": "list",
    "kpi": "kpi",
    "count": "count_grouped",  # breakdown; scalar count uses count_scalar
    "merge": "list",
}


def normalize_intent(raw: str | None, *, has_group_by: bool = False) -> IntentKind:
    """Map planner/Gemma intent strings to IntentKind."""
    key = (raw or "list").strip().lower()
    if key in _VALID:
        intent: IntentKind = key  # type: ignore[assignment]
    else:
        intent = _LEGACY_MAP.get(key, "list")
    if has_group_by and intent in ("kpi", "count_scalar", "count"):
        return "count_grouped"
    if has_group_by:
        return "count_grouped"
    return intent


def is_scalar_instruction(instruction: str | None) -> bool:
    """True when instruction looks like a scalar how-many / rate ask."""
    import re

    text = (instruction or "").lower()
    if re.search(r"\b(how many|count of|number of)\b", text):
        return True
    if re.search(r"\b(list|show|get|fetch|display|browse)\b", text):
        return False
    return bool(
        re.search(
            r"\b(total|rate|average|avg|kpi|metric)\b",
            text,
        )
    )
