"""Number grounding on a written answer. Mechanical numeric parse, not routing."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

_NUM_RE = re.compile(
    r"(?<![\w.])"
    r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+|\d+)"
    r"\s*%?"
    r"(?![\w.])",
    re.UNICODE,
)


@dataclass
class GroundingResult:
    grounded: bool
    ungrounded: list[str] = field(default_factory=list)
    answer_numbers: list[str] = field(default_factory=list)
    fact_numbers: set[str] = field(default_factory=set)


def _forms(token: str) -> set[str]:
    t = token.strip().replace(",", "")
    try:
        value = float(t.rstrip("%"))
    except ValueError:
        return {t}
    forms = {t.rstrip("%")}
    if value == int(value):
        forms.add(str(int(value)))
    for dp in (0, 1, 2):
        forms.add(str(round(value, dp)))
    if token.strip().endswith("%"):
        forms.add(str(round(value / 100, 4)))
        forms.add(str(int(value)) + "%")
    else:
        forms.add(str(round(value * 100, 1)) + "%")
    return forms


def fact_numbers(facts: str) -> set[str]:
    found: set[str] = set()
    for match in _NUM_RE.finditer(facts or ""):
        found |= _forms(match.group(0))
    return found


def check_answer(answer: str, facts: str) -> GroundingResult:
    nums = [m.group(0) for m in _NUM_RE.finditer(answer or "")]
    pool = fact_numbers(facts)
    ungrounded = [n for n in nums if not (_forms(n) & pool)]
    return GroundingResult(
        grounded=not ungrounded,
        ungrounded=ungrounded,
        answer_numbers=nums,
        fact_numbers=pool,
    )


def apply_grounding(
    answer: str,
    facts: str,
    *,
    regenerate_fn: Callable[[str, list[str]], str] | None = None,
) -> dict[str, Any]:
    first = check_answer(answer, facts)
    if first.grounded:
        return {"answer": answer, "grounded": True, "attempts": 1}
    if regenerate_fn:
        retry = regenerate_fn(answer, first.ungrounded)
        second = check_answer(retry, facts)
        if second.grounded:
            return {"answer": retry, "grounded": True, "attempts": 2}
        return {"answer": facts, "grounded": False, "attempts": 2, "fallback": "facts_only"}
    return {"answer": facts, "grounded": False, "attempts": 1, "fallback": "facts_only"}
