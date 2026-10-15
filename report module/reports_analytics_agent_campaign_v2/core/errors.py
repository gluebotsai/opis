"""User-facing pack errors."""

from __future__ import annotations

from typing import Any

from .access import AccessDenied

_DRIVER_MARKERS = (
    "SyntaxError",
    "GROUP BY",
    "Traceback",
    "psycopg",
)


class UnmatchedName(Exception):
    def __init__(self, kind: str, mention: str) -> None:
        super().__init__(f"No {kind} named '{mention}' was found")
        self.kind = kind
        self.mention = mention


class AmbiguousName(Exception):
    def __init__(self, kind: str, mention: str, candidates: list[dict[str, Any]]) -> None:
        labels = []
        for row in candidates:
            label = str(row.get("label") or "").strip()
            if label and label not in labels:
                labels.append(label)
        shown = ", ".join(labels[:8]) if labels else "several ids"
        super().__init__(f"Several {kind} matches for '{mention}': {shown}")
        self.kind = kind
        self.mention = mention
        self.candidates = candidates


def public_message(exc: BaseException) -> str:
    if isinstance(exc, UnmatchedName):
        return f"No {exc.kind} named '{exc.mention}' was found."
    if isinstance(exc, AmbiguousName):
        return str(exc)
    if isinstance(exc, AccessDenied):
        return str(exc)
    text = str(exc)
    if "unsupported time expression" in text.lower():
        return "I need a UTC time window I can parse (today, last 7 days, this month, or YYYY-MM-DD to YYYY-MM-DD)."
    if any(marker.lower() in text.lower() for marker in _DRIVER_MARKERS):
        return "That report could not run. Try a certified KPI or a simpler list on rpt.* views."
    if "does not exist" in text.lower() and "column" in text.lower():
        return "That grouping is not available on this warehouse."
    if "connection to server" in text.lower() or "could not connect" in text.lower():
        return "I could not reach the campaign database."
    return text
