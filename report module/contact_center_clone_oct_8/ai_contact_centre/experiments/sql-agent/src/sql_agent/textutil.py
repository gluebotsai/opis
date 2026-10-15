"""Tokenization and fuzzy matching for vector-less catalog retrieval."""

from __future__ import annotations

import re

TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return [token for token in TOKEN_RE.findall(text.casefold()) if len(token) > 1]


def levenshtein(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for i, left_ch in enumerate(left, start=1):
        current = [i]
        for j, right_ch in enumerate(right, start=1):
            insert_cost = current[j - 1] + 1
            delete_cost = previous[j] + 1
            replace_cost = previous[j - 1] + (left_ch != right_ch)
            current.append(min(insert_cost, delete_cost, replace_cost))
        previous = current
    return previous[-1]


def similarity(left: str, right: str) -> float:
    if not left and not right:
        return 1.0
    distance = levenshtein(left, right)
    return 1.0 - (distance / max(len(left), len(right)))


def closest(needle: str, candidates: list[str], *, min_similarity: float = 0.72) -> str | None:
    folded = needle.casefold()
    best_name: str | None = None
    best_score = min_similarity
    for candidate in candidates:
        score = similarity(folded, candidate.casefold())
        if score > best_score:
            best_score = score
            best_name = candidate
    return best_name
