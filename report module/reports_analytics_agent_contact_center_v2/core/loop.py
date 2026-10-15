"""One SQL repair, then one replan, then stop. Deny is never retried."""

from __future__ import annotations

from typing import Any

MAX_ATTEMPTS = 3


class LoopState:
    def __init__(self, max_attempts: int = MAX_ATTEMPTS) -> None:
        self.max_attempts = max_attempts
        self.attempts = 0
        self.errors: list[dict[str, Any]] = []

    @property
    def exhausted(self) -> bool:
        return self.attempts >= self.max_attempts

    def record_attempt(self) -> int:
        self.attempts += 1
        return self.attempts

    def record_error(self, result: dict[str, Any]) -> None:
        self.errors.append(
            {
                "attempt": self.attempts,
                "error_type": result.get("error_type", "UNKNOWN"),
                "error": result.get("error", "Unknown error"),
            }
        )

    def should_retry(self, result: dict[str, Any]) -> str | None:
        """Return REPAIR, REPLAN, or None. DENY always None."""
        err_type = result.get("error_type")
        if result.get("status") != "error":
            return None
        if err_type == "DENY":
            return None
        if err_type == "REPAIR" and self.attempts < self.max_attempts:
            return "REPAIR"
        if err_type == "REPLAN" and self.attempts < self.max_attempts:
            return "REPLAN"
        return None

    def final_error(self) -> dict[str, Any]:
        last = self.errors[-1] if self.errors else {}
        return {
            "status": "error",
            "kind": "final_error",
            "error_type": last.get("error_type", "UNKNOWN"),
            "attempts_made": self.attempts,
            "errors": self.errors,
            "message": (
                f"Could not complete the request after {self.attempts} attempt(s). "
                f"Reason: {last.get('error', 'unknown error')}"
            ),
        }
