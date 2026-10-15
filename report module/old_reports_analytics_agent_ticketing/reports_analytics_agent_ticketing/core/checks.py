"""Read-only checks on compiled SQL."""

from __future__ import annotations

_FORBIDDEN = ("insert", "update", "delete", "drop", "alter", "truncate", "grant", "revoke", "copy", "create")


def assert_read_only(sql: str) -> None:
    head = sql.strip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        raise ValueError("SQL must be a SELECT")
    blob = f" {head} "
    for word in _FORBIDDEN:
        if f" {word} " in blob or f" {word};" in blob:
            raise ValueError(f"forbidden keyword {word}")
