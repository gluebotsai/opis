"""Expand a natural-language question using the YAML glossary and fuzzy aliases."""

from __future__ import annotations

from typing import Any

from sql_agent.catalog import Catalog
from sql_agent.textutil import closest, tokenize


def expand_query(question: str, catalog: Catalog) -> dict[str, Any]:
    original_tokens = tokenize(question)
    terms = catalog.glossary.get("terms") or {}
    enum_aliases = catalog.glossary.get("enum_aliases") or {}
    expanded = list(original_tokens)
    glossary_hits: list[dict[str, str]] = []
    fuzzy_hits: list[dict[str, str]] = []

    alias_keys = [str(key) for key in terms]
    for token in original_tokens:
        direct = terms.get(token)
        if isinstance(direct, dict):
            extra = [str(item) for item in direct.get("tokens") or []]
            canonical = str(direct.get("canonical") or token)
            extra.append(canonical)
            expanded.extend(tokenize(" ".join(extra)))
            glossary_hits.append({"token": token, "canonical": canonical})
            continue
        match = closest(token, alias_keys, min_similarity=0.78)
        if match:
            payload = terms.get(match)
            if isinstance(payload, dict):
                extra = [str(item) for item in payload.get("tokens") or []]
                canonical = str(payload.get("canonical") or match)
                extra.append(canonical)
                expanded.extend(tokenize(" ".join(extra)))
                fuzzy_hits.append({"token": token, "matched": match, "canonical": canonical})

    for canonical, aliases in enum_aliases.items():
        if _enum_mentioned(str(canonical), aliases, question, original_tokens):
            expanded.append(str(canonical).casefold())

    # De-dupe, preserve order
    seen: set[str] = set()
    unique: list[str] = []
    for token in expanded:
        if token not in seen:
            seen.add(token)
            unique.append(token)
    return {
        "question": question,
        "original_tokens": original_tokens,
        "tokens": unique,
        "glossary_hits": glossary_hits,
        "fuzzy_hits": fuzzy_hits,
    }


def _enum_mentioned(
    canonical: str,
    aliases: list[str],
    question: str,
    tokens: list[str],
) -> bool:
    token_set = set(tokens)
    folded = question.casefold()
    phrases = [canonical.casefold(), *[str(alias).casefold() for alias in aliases]]
    for phrase in phrases:
        if not phrase:
            continue
        if " " in phrase or "_" in phrase:
            if phrase.replace("_", " ") in folded or phrase in folded:
                return True
            continue
        if phrase in token_set:
            return True
    return False

