"""Number grounding on Domain synthesis (from ticketing core/grounding.py)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

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


def extract_numbers(text: str) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for m in _NUM_RE.finditer(text):
        raw = m.group(0).strip().rstrip(".")
        if raw and raw not in seen:
            seen.add(raw)
            result.append(raw)
    return result


def _normalize(token: str) -> set[str]:
    t = token.strip().replace(",", "")
    is_pct = token.strip().endswith("%")
    try:
        value = float(t.rstrip("%"))
    except ValueError:
        return {t}
    forms: set[str] = {t.rstrip("%")}
    if value == int(value):
        forms.add(str(int(value)))
    if is_pct:
        forms.add(str(round(value / 100, 4)))
    elif 0 < value <= 1:
        forms.add(str(int(value * 100)) if value * 100 == int(value * 100) else str(round(value * 100, 1)))
    return forms


def ground_check(answer: str, facts: str) -> GroundingResult:
    answer_nums = extract_numbers(answer)
    fact_forms: set[str] = set()
    for fn in extract_numbers(facts):
        fact_forms.update(_normalize(fn))
    ungrounded = [an for an in answer_nums if not (_normalize(an) & fact_forms)]
    return GroundingResult(grounded=len(ungrounded) == 0, ungrounded=ungrounded)
