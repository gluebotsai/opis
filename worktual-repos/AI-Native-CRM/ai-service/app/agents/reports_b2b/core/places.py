"""Match a named region or country to one stored value."""

from __future__ import annotations


def fold_place(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


def match_place(asked: str, stored: list[str]) -> dict[str, object]:
    """Case-insensitive exact match. chennai and Chennai are one value.

    A shorter code is not treated as part of a longer name, so TN does not
    select Tamil Nadu. Zero matches, or more than one different value, asks.
    """
    key = fold_place(asked)
    if not key:
        return {"status": "empty"}

    groups: dict[str, list[str]] = {}
    for raw in stored:
        text = str(raw or "").strip()
        if not text:
            continue
        groups.setdefault(fold_place(text), []).append(text)

    if key in groups:
        return {"status": "one", "value": key, "label": groups[key][0]}

    return {"status": "ask", "choices": _choice_labels(groups)}


def _choice_labels(groups: dict[str, list[str]]) -> list[str]:
    labels = [items[0] for items in groups.values()]
    labels.sort(key=lambda item: item.lower())
    return labels[:12]
