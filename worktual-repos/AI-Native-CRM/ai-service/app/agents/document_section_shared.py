"""Shared section aliases + intent detection for proposal / quote document edits."""

from __future__ import annotations

import re
from typing import Any

PROPOSAL_SECTION_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("introduction", ("introduction", "intro", "opening", "cover letter")),
    (
        "overview",
        ("overview", "executive summary", "background", "situation"),
    ),
    (
        "business_context",
        (
            "business context",
            "business context & strategic alignment",
            "strategic alignment",
            "context",
        ),
    ),
    (
        "features",
        ("features", "feature", "capabilities", "product features", "key product features"),
    ),
    ("scope", ("scope", "scope of work", "scope_of_work", "sow")),
    (
        "requested_solution",
        (
            "requested solution",
            "requested_solution",
            "proposed solution",
            "the solution",
        ),
    ),
    (
        "plan_of_action",
        ("plan of action", "plan_of_action", "action plan", "milestones", "timeline"),
    ),
    ("commercials", ("commercials", "pricing", "price", "commercial", "cost")),
    ("onboarding", ("onboarding", "onboard", "onboarding process")),
    (
        "implementation",
        (
            "implementation plan",
            "implementation_plan",
            "implementation",
            "implement",
            "rollout",
        ),
    ),
    ("support", ("support", "sla", "service level")),
    ("conclusion", ("conclusion", "closing", "summary", "next steps")),
]

QUOTE_SECTION_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("introduction", ("introduction", "intro", "cover letter", "opening")),
    ("tax_note", ("tax note", "tax_note", "taxes", "tax", "gst", "vat")),
    (
        "bank",
        (
            "bank details",
            "bank_detail",
            "bank",
            "payment details",
            "account details",
            "banking",
            "ifsc",
            "iban",
            "routing",
        ),
    ),
    (
        "terms",
        (
            "terms and conditions",
            "terms & conditions",
            "terms_conditions",
            "terms",
            "t&c",
            "conditions",
        ),
    ),
    (
        "payment_terms",
        ("payment terms", "payment_terms", "payment term", "payment schedule"),
    ),
    (
        "delivery",
        ("delivery timeline", "delivery_timeline", "delivery", "timeline", "lead time", "shipping"),
    ),
    ("footer", ("footer", "closing", "signature", "sign off")),
]

DOCUMENT_SECTION_ALIASES: list[tuple[str, tuple[str, ...]]] = (
    PROPOSAL_SECTION_ALIASES + QUOTE_SECTION_ALIASES
)


def wants_document_section_rewrite(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(rewrite|re-write|rework|revise|improve|enhance|regenerate|refresh|"
            r"update|change|edit|add|append|insert|include|replace|expand|shorten|"
            r"remove|delete|put|write)\b",
            lower,
        )
    )


def detect_section_key_from_catalog(
    text: str,
    sections: list[dict[str, Any]] | None,
    *,
    aliases: list[tuple[str, tuple[str, ...]]] | None = None,
) -> str | None:
    """Match a section key from openProposal section titles or canonical aliases."""
    lower = (text or "").lower()
    ranked: list[tuple[str, str, int]] = []
    for item in sections or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        title = str(item.get("title") or "").strip()
        if not key and not title:
            continue
        plain = re.sub(r"^\d+\.\s*", "", title).strip()
        for label in filter(None, {plain.lower(), key.lower()}):
            ranked.append((key or plain.lower().replace(" ", "_"), label, len(label)))
    ranked.sort(key=lambda row: row[2], reverse=True)
    for key, label, _ in ranked:
        if not label:
            continue
        if label in lower or re.search(rf"\b{re.escape(label)}\b", lower):
            return key
    return detect_document_section_key(text, aliases=aliases)


def detect_document_section_key(
    text: str,
    *,
    aliases: list[tuple[str, tuple[str, ...]]] | None = None,
) -> str | None:
    """Best-effort canonical section key from free text."""
    lower = (text or "").lower()
    pool = aliases or DOCUMENT_SECTION_ALIASES
    # Longest alias first so "implementation plan" wins over "implementation".
    ranked: list[tuple[str, str, int]] = []
    for key, names in pool:
        for alias in names:
            ranked.append((key, alias, len(alias)))
    ranked.sort(key=lambda row: row[2], reverse=True)
    for key, alias, _ in ranked:
        if re.search(rf"\b{re.escape(alias)}\b", lower) or alias in lower:
            return key
    return None


_MONTH_CANON = {
    "january": "January",
    "jan": "January",
    "february": "February",
    "feb": "February",
    "march": "March",
    "mar": "March",
    "april": "April",
    "apr": "April",
    "may": "May",
    "june": "June",
    "jun": "June",
    "july": "July",
    "jul": "July",
    "august": "August",
    "aug": "August",
    "september": "September",
    "sept": "September",
    "sep": "September",
    "october": "October",
    "oct": "October",
    "november": "November",
    "nov": "November",
    "december": "December",
    "dec": "December",
}
_MONTH_ALT = "|".join(sorted(_MONTH_CANON, key=len, reverse=True))
_LOOSE_DATE_RE = re.compile(
    rf"\b(?P<day>\d{{1,2}})\s+(?P<month>{_MONTH_ALT})(?:\s+(?P<year>\d{{4}}))?\b",
    re.I,
)
_CHANGE_INTENT_RE = re.compile(r"\b(change|replace|update|set)\b", re.I)
_EXACT_TO_RE = re.compile(
    r"^\s*(?:please\s+)?(?:change|replace|update|set)\s+(?:the\s+)?(.+?)\s+to\s+(.+?)\s*$",
    re.I,
)
_REPLACE_WITH_RE = re.compile(
    r"^\s*(?:please\s+)?replace\s+(.+?)\s+with\s+(.+?)\s*$",
    re.I,
)
_CHANGE_THIS_RE = re.compile(
    r"^\s*(.+?)\s+change\s+(?:this|that|it)\s+to\s+(.+?)\s*$",
    re.I,
)


def _format_date_match(match: re.Match[str], *, year_fallback: str | None = None) -> str | None:
    month = _MONTH_CANON.get(str(match.group("month") or "").lower())
    year = match.group("year") or year_fallback
    if not month or not year:
        return None
    return f"{int(match.group('day'))} {month} {year}"


def _normalize_date_pair(find: str, replace: str) -> tuple[str, str] | None:
    find_match = _LOOSE_DATE_RE.search(find)
    replace_match = _LOOSE_DATE_RE.search(replace)
    if not find_match or not replace_match:
        return None
    year = find_match.group("year") or replace_match.group("year")
    formatted_find = _format_date_match(find_match, year_fallback=year)
    formatted_replace = _format_date_match(replace_match, year_fallback=year)
    if (
        not formatted_find
        or not formatted_replace
        or formatted_find.lower() == formatted_replace.lower()
    ):
        return None
    return formatted_find, formatted_replace


def parse_proposal_visible_text_swap(text: str) -> tuple[str, str] | None:
    """Exact on-page find/replace (cover date, brand line), not section rewrite."""
    raw = (text or "").strip().strip("\"'")
    if not raw:
        return None
    lower = raw.lower()
    if re.search(r"\bsection\b", lower):
        return None
    date_hits = list(_LOOSE_DATE_RE.finditer(raw))
    if len(date_hits) >= 2 and _CHANGE_INTENT_RE.search(raw):
        paired = _normalize_date_pair(date_hits[0].group(0), date_hits[1].group(0))
        if paired:
            return paired
    match = (
        _EXACT_TO_RE.match(raw)
        or _REPLACE_WITH_RE.match(raw)
        or _CHANGE_THIS_RE.match(raw)
    )
    if not match:
        return None
    find = match.group(1).strip().strip("\"'").strip()
    replace = match.group(2).strip().strip("\"'").strip(" .")
    if not find or not replace or find.lower() == replace.lower():
        return None
    if len(find) < 4 or len(find) > 120 or len(replace) > 120:
        return None
    if re.search(r"\bsection\b", find.lower()):
        return None
    paired = _normalize_date_pair(find, replace)
    if paired:
        return paired
    if detect_document_section_key(find):
        return None
    return find, replace


def parse_proposal_table_border_intent(text: str) -> str | None:
    """Return 'on' or 'off' when the user asks to change table borders."""
    lower = (text or "").lower()
    if not re.search(r"\btable", lower):
        return None
    if not re.search(r"\b(borders?|boarders?|grid\s*lines?|outlines?)\b", lower):
        return None
    if re.search(
        r"\b(remove|delete|clear|drop|hide|without|disable|undo|stop)\b"
        r"|\b(no more|get rid of|take off|turn off)\b"
        r"|\bno\s+(the\s+)?(table\s+)?(borders?|boarders?)\b",
        lower,
    ):
        return "off"
    return "on"


def wants_proposal_table_borders(text: str) -> bool:
    return parse_proposal_table_border_intent(text) is not None
