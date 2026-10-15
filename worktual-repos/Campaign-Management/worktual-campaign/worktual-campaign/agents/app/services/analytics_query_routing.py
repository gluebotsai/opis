"""Legacy helpers — chat intent must come from the LLM + tools, not phrase routing."""

from __future__ import annotations

# Kept for backward-compatible imports only; reports agent no longer calls this.

def question_wants_monitoring_status_counts(question: str) -> bool:
    """Deprecated: do not use for chat routing."""
    _ = question
    return False
