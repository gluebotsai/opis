"""Feature flag for instruction-first SQL Super path."""

from __future__ import annotations

import os


def instruction_first_enabled() -> bool:
    """INSTRUCTION_FIRST=1 → new behavior; unset/0 → shadow (legacy response)."""
    return os.environ.get("INSTRUCTION_FIRST", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
