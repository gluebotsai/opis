"""Shared section-key slugger. Keep in lockstep with backend canonicalizeSectionKey."""

from __future__ import annotations

import re
from typing import Any

_ALIASES = {
    "executive_summary": "overview",
    "exec_summary": "overview",
    "executive_overview": "overview",
    "cover_and_overview": "overview",
    "cover_overview": "overview",
    "scope_of_work": "scope",
    "sow": "scope",
    "proposed_solution": "requested_solution",
    "the_solution": "requested_solution",
    "recommended_solution": "requested_solution",
    "pricing": "commercials",
    "commercials_pricing": "commercials",
    "technical_architecture": "architecture",
    "solution_architecture": "architecture",
    "apis": "integrations",
    "api_integrations": "integrations",
    "implementation": "rollout",
    "implementation_plan": "rollout",
    "migration": "rollout",
}

# Gold headings sometimes wrap one of these concept keys in extra words
# ("Key Considerations & Assumptions", "Recommended Solution Overview").
# Rather than hand-alias every observed variant, collapse any heading whose
# slug contains one of these as a whole underscore-delimited word/phrase.
_CONTAINMENT_KEYS = ("considerations", "requested_solution", "recommended_solution")


def slug_section_key(raw: str) -> str:
    text = str(raw or "").strip().lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _slug_contains_key(haystack: str, needle: str) -> bool:
    """Whole-word containment on `_`-joined slugs — not a raw substring test,
    so "unrequested_solution" does not collapse onto "requested_solution"."""
    if not needle or needle == haystack:
        return False
    return re.search(rf"(?:^|_){re.escape(needle)}(?:_|$)", haystack) is not None


def canonicalize_section_key(raw: str) -> str:
    slug = slug_section_key(raw)
    if slug in _ALIASES:
        return _ALIASES[slug]
    for canon in _CONTAINMENT_KEYS:
        if _slug_contains_key(slug, canon):
            return _ALIASES.get(canon, canon)
    # Closing notes are signed to a different customer in every gold instance
    # by design ("note_for_vbike", "note_for_acme_corp", …) — this can never
    # collapse via containment/aliasing against a fixed canonical key, so it
    # gets its own normalization: strip the trailing customer-name token(s).
    if re.search(r"(?:^|_)note_for(?:_|$)", slug) and slug != "note_for":
        return "note_for_client"
    return slug


def canonicalize_section_specs(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    nested = value.get("sectionSpecs")
    mapping = nested if isinstance(nested, dict) and nested else value
    out: dict[str, Any] = {}
    for key, raw in mapping.items():
        if key == "sectionSpecs" or not isinstance(raw, dict):
            continue
        canon = canonicalize_section_key(
            str(raw.get("key") or raw.get("sectionKey") or key)
        )
        if not canon:
            continue
        out[canon] = {**raw, "key": canon}
    return out


def canonicalize_section_analysis(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = canonicalize_section_key(str(row.get("sectionKey") or row.get("key") or ""))
        if not key:
            continue
        out.append({**row, "sectionKey": key})
    return out
