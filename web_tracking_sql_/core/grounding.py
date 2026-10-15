"""Number grounding check on the Domain's synthesised answer.

V2 Design §4.5 and §8:
  1. Extract every number from the Domain's final answer.
  2. Check that each number exists in the fact block (after formatting/rounding).
  3. If any number is ungrounded: call regenerate_fn once with the offending numbers listed.
  4. If still failing: fall back to a facts-only answer.

Tolerance: percentage <-> decimal (18% ≈ 0.18), commas stripped, trailing zeros ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

# Match integers, decimals, percentages — but NOT version strings like 2.0.1
_NUM_RE = re.compile(
    r"(?<![\w.])"                  # not preceded by word char or dot
    r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+|\d+)"   # the number (with optional commas)
    r"\s*%?"                       # optional trailing %
    r"(?![\w.])",                  # not followed by word char or dot
    re.UNICODE,
)


@dataclass
class GroundingResult:
    grounded: bool
    ungrounded: list[str] = field(default_factory=list)
    answer_numbers: list[str] = field(default_factory=list)
    fact_numbers: set[str] = field(default_factory=set)


def _normalize(token: str) -> set[str]:
    """Return all normalised forms of a numeric token.

    Forms produced:
        - token as-is (commas stripped, whitespace stripped)
        - integer form if it is a whole number (e.g. 18.0 -> 18)
        - decimal / percentage cross-form (18% -> 0.18, 0.18 -> 18%)
        - rounded variants at 0, 1, 2 decimal places
    """
    t = token.strip().replace(",", "")
    is_pct = token.strip().endswith("%")
    try:
        value = float(t.rstrip("%"))
    except ValueError:
        return {t}

    forms: set[str] = set()
    # The raw value
    forms.add(t.rstrip("%"))
    # Integer form for whole numbers
    if value == int(value):
        forms.add(str(int(value)))
    # Rounded variants
    for dp in (0, 1, 2):
        rounded = round(value, dp)
        if rounded == int(rounded):
            forms.add(str(int(rounded)))
        else:
            forms.add(str(rounded))
    # Percentage <-> decimal cross-forms
    if is_pct:
        decimal = value / 100
        forms.add(str(round(decimal, 4)))
        forms.add(str(round(decimal, 2)))
    elif 0 < value <= 1:
        # Looks like a decimal that might be expressed as a percentage
        pct = value * 100
        if pct == int(pct):
            forms.add(str(int(pct)))
        else:
            forms.add(str(round(pct, 1)))
            forms.add(str(round(pct, 2)))
    return forms


def extract_numbers(text: str) -> list[str]:
    """Extract all numeric tokens from text, de-duplicated, preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for m in _NUM_RE.finditer(text):
        raw = m.group(0).strip().rstrip(".")
        if raw and raw not in seen:
            seen.add(raw)
            result.append(raw)
    return result


def ground_check(answer: str, facts: str, *, tolerance: float = 0.5) -> GroundingResult:
    """Verify every number in the answer exists in the facts.

    Args:
        answer:    the Domain's synthesised CEO answer text
        facts:     the combined fact block (output of assemble_facts)
        tolerance: unused currently; cross-form matching handles formatting differences

    Returns:
        GroundingResult with grounded=True if every answer number was found in facts.
    """
    answer_nums = extract_numbers(answer)
    fact_nums = extract_numbers(facts)

    # Build a flat set of all normalised forms from the fact block
    fact_forms: set[str] = set()
    for fn in fact_nums:
        fact_forms.update(_normalize(fn))

    ungrounded: list[str] = []
    for an in answer_nums:
        # A number is grounded if any of its normalised forms is in fact_forms
        if not (_normalize(an) & fact_forms):
            ungrounded.append(an)

    return GroundingResult(
        grounded=len(ungrounded) == 0,
        ungrounded=ungrounded,
        answer_numbers=answer_nums,
        fact_numbers=fact_forms,
    )


def apply_grounding(
    answer: str,
    facts: str,
    regenerate_fn: Callable[[str, list[str]], str],
    *,
    max_retries: int = 1,
) -> tuple[str, bool]:
    """Run the grounding check and attempt regeneration if numbers are ungrounded.

    Args:
        answer:         the Domain's synthesised answer
        facts:          the combined fact block
        regenerate_fn:  callable(answer, ungrounded_numbers) -> new_answer
                        called once when the check fails
        max_retries:    how many times to attempt regeneration (default 1)

    Returns:
        (final_answer, was_grounded: bool)
        If all retries fail, falls back to a facts-only answer.
    """
    result = ground_check(answer, facts)
    if result.grounded:
        return answer, True

    for _ in range(max_retries):
        new_answer = regenerate_fn(answer, result.ungrounded)
        new_result = ground_check(new_answer, facts)
        if new_result.grounded:
            return new_answer, True
        result = new_result  # track latest for fallback

    # All retries exhausted — fall back to a facts-only answer
    fallback = _facts_only_answer(facts, result.ungrounded)
    return fallback, False


def _facts_only_answer(facts: str, ungrounded: list[str]) -> str:
    """Produce a conservative facts-only answer when grounding fails."""
    lines = [
        "Based on the available data:",
        "",
    ]
    for line in facts.splitlines():
        line = line.strip()
        if line and not line.startswith("EXECUTION_ERROR"):
            lines.append(line)
    if ungrounded:
        lines.append("")
        lines.append(
            f"Note: {len(ungrounded)} figure(s) in the generated answer could not be "
            f"verified against the source data and have been removed: {', '.join(ungrounded)}."
        )
    return "\n".join(lines)
