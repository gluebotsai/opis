"""User-facing pack errors. Streamlit only displays these strings."""

from __future__ import annotations

from typing import Any

from .access import AccessDenied

_DRIVER_MARKERS = (
    "SyntaxError",
    "Neo.ClientError",
    "GROUP BY",
    "Traceback",
    "psycopg",
    "neo4j.",
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
        return (
            "I need UTC start and end on the time object "
            "(for example August 2026 → 2026-08-01T00:00:00+00:00 to 2026-09-01T00:00:00+00:00)."
        )
    if "unknown dimension" in text.lower() and "month" in text.lower():
        return (
            "Month, week, and day volume is a SQL ticket_count breakdown. "
            "Do not send that job to the graph."
        )
    if "calendar grouping" in text.lower() or "group_by month" in text.lower():
        return text
    if any(marker.lower() in text.lower() for marker in _DRIVER_MARKERS):
        return "That report could not run. Ask again with SQL for counts by month, or graph why-by queue, agent, or status."
    if "does not exist" in text.lower() and "column" in text.lower():
        return "That grouping is not available on this warehouse."
    if "connection to server" in text.lower() or "could not connect" in text.lower():
        return "I could not reach the ticketing database."
    return text


def repair_prompt(*, error: str, frame: dict, brief: str) -> str:
    return (
        "Python could not run the frame. Repair the JSON frame once. Do not write SQL or Cypher.\n"
        "If the job is volume or tickets by month/week/day, executor must be sql, "
        "measure ticket_count, shape breakdown, group_by month|week|day.\n"
        "Dates belong on time.start and time.end, not as status filters.\n"
        "Person names stay as filter mentions (field agent, resolver, queue, customer, created_by).\n"
        f"error: {error}\nbrief: {brief}\nframe: {frame}\n"
        'Return JSON: {"kind":"plan","steps":[{"executor":"sql"|"kg","brief":"...","frame":{...}}]}'
    )
