# origin: ticketing_v2/core/grounding.py
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, List, Tuple, Set

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

def _normalize(token: str) -> set[str]:
    t = token.strip().replace(",", "")
    is_pct = token.strip().endswith("%")
    try:
        value = float(t.rstrip("%"))
    except ValueError:
        return {t}

    forms: set[str] = set()
    forms.add(t.rstrip("%"))
    if value == int(value):
        forms.add(str(int(value)))
    for dp in (0, 1, 2):
        rounded = round(value, dp)
        if rounded == int(rounded):
            forms.add(str(int(rounded)))
        else:
            forms.add(str(rounded))
    if is_pct:
        decimal = value / 100
        forms.add(str(round(decimal, 4)))
        forms.add(str(round(decimal, 2)))
    elif 0 < value <= 1:
        pct = value * 100
        if pct == int(pct):
            forms.add(str(int(pct)))
        else:
            forms.add(str(round(pct, 1)))
            forms.add(str(round(pct, 2)))
    return forms

def extract_numbers(text: str) -> list[str]:
    """Extract string tokens representing numbers."""
    seen: set[str] = set()
    result: list[str] = []
    for m in _NUM_RE.finditer(text):
        raw = m.group(0).strip().rstrip(".")
        if raw and raw not in seen:
            seen.add(raw)
            result.append(raw)
    return result

def extract_numbers_from_text(text: str) -> list[float]:
    """Extract float values representing numbers."""
    str_tokens = extract_numbers(text)
    floats = []
    for s in str_tokens:
        clean = s.replace(",", "").rstrip("%")
        try:
            floats.append(float(clean))
        except ValueError:
            pass
    return floats

def ground_check(answer: str, facts: str, *, tolerance: float = 0.5) -> GroundingResult:
    answer_nums = extract_numbers(answer)
    fact_nums = extract_numbers(facts)

    fact_forms: set[str] = set()
    for fn in fact_nums:
        fact_forms.update(_normalize(fn))

    ungrounded: list[str] = []
    for an in answer_nums:
        if not (_normalize(an) & fact_forms):
            ungrounded.append(an)

    return GroundingResult(
        grounded=len(ungrounded) == 0,
        ungrounded=ungrounded,
        answer_numbers=answer_nums,
        fact_numbers=fact_forms,
    )

def verify_grounding(response_markdown: str, grounded_numbers: List[Any]) -> Tuple[bool, List[float]]:
    extracted = extract_numbers_from_text(response_markdown)
    grounded_set = set(float(n) for n in grounded_numbers)
    ungrounded = []
    for num in extracted:
        if num in (0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 100.0):
            continue
        if num not in grounded_set:
            ungrounded.append(num)
    return (len(ungrounded) == 0), ungrounded

def apply_grounding(
    answer: str,
    facts: str,
    regenerate_fn: Callable[[str, list[str]], str],
    *,
    max_retries: int = 1,
) -> tuple[str, bool]:
    result = ground_check(answer, facts)
    if result.grounded:
        return answer, True

    last = answer
    for _ in range(max_retries):
        last = regenerate_fn(last, result.ungrounded)
        new_result = ground_check(last, facts)
        if new_result.grounded:
            return last, True
        result = new_result

    note = ""
    if result.ungrounded:
        note = (
            "\n\nSome figures in this briefing could not be checked against the warehouse "
            f"({', '.join(result.ungrounded)}). Treat those as unverified."
        )
    return last + note, False
