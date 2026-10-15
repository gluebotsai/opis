"""Extract and validate JSON from LLM content; one repair attempt helper."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from app.contracts.errors import LLMInvalidOutput

_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")
_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]")


def extract_json(text: str | None, *, expect: type = dict) -> Any | None:
    """Pull the first JSON object/array from model text. Returns None if absent."""
    trimmed = (text or "").strip()
    if not trimmed:
        return None
    try:
        parsed = json.loads(trimmed)
        if expect is dict and isinstance(parsed, dict):
            return parsed
        if expect is list and isinstance(parsed, list):
            return parsed
        if expect is dict and not isinstance(parsed, dict):
            return None
        if expect is list and not isinstance(parsed, list):
            return None
        return parsed
    except json.JSONDecodeError:
        pass

    pattern = _JSON_OBJECT_RE if expect is dict else _JSON_ARRAY_RE
    match = pattern.search(trimmed)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if expect is dict and not isinstance(parsed, dict):
        return None
    if expect is list and not isinstance(parsed, list):
        return None
    return parsed


def validate_json_object(
    text: str | None,
    *,
    required_keys: set[str] | frozenset[str] | None = None,
) -> dict[str, Any]:
    """Parse a JSON object or raise LLMInvalidOutput."""
    obj = extract_json(text, expect=dict)
    if not isinstance(obj, dict):
        raise LLMInvalidOutput(
            "Model output was not a JSON object",
            details={"preview": (text or "")[:240]},
        )
    if required_keys:
        missing = [k for k in required_keys if k not in obj]
        if missing:
            raise LLMInvalidOutput(
                "Model JSON missing required keys",
                details={"missing": missing, "preview": (text or "")[:240]},
            )
    return obj


def repair_json_once(
    *,
    original_text: str | None,
    repair_fn: Callable[[str], str],
    required_keys: set[str] | frozenset[str] | None = None,
) -> dict[str, Any]:
    """
    Validate JSON from original_text; on failure call repair_fn once with a
    repair prompt hint and validate again. Raises LLMInvalidOutput if still bad.
    """
    try:
        return validate_json_object(original_text, required_keys=required_keys)
    except LLMInvalidOutput:
        pass

    hint = (
        "Your previous reply was not valid JSON. "
        "Reply with a single JSON object only — no markdown, no prose.\n\n"
        f"Previous output:\n{(original_text or '')[:2000]}"
    )
    repaired = repair_fn(hint)
    return validate_json_object(repaired, required_keys=required_keys)
