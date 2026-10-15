"""Legacy helpers — template edit chat no longer uses a second compose LLM."""

from __future__ import annotations

from typing import Any

def is_canned_edit_reply(text: str) -> bool:
    return not str(text or "").strip()


__all__ = ["is_canned_edit_reply"]
