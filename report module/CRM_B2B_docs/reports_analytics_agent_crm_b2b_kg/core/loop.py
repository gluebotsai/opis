"""Two-attempt Re-plan Loop Controller for CRM B2B Knowledge Graph."""

from __future__ import annotations

from typing import Any

MAX_KG_ATTEMPTS = 2


def get_replan_instruction(error_type: str | None, error_msg: str) -> str:
    """Generate precise self-correction instruction for the CRM B2B KG Planner."""
    if error_type == "DENY":
        return "Access denied or mutating Cypher rejected. Do not attempt write operations or unauthorized credentials."
    if "template_not_found" in error_msg:
        return "The requested CRM B2B template was not found. Write a custom read-only Cypher query using allowed node labels."
    if "by zero" in error_msg.lower() or "arithmeticerror" in error_msg.lower():
        return "Arithmetic error: division by zero. Protect all divisions using CASE WHEN denominator > 0 THEN round(...) ELSE 0.0 END."
    if "DB_ERROR" in str(error_type) or "connection" in error_msg.lower():
        return "Database execution failed. Simplify the query or verify relationship patterns."
    return f"Execution failed with error: {error_msg}. Generate an alternative, simplified Cypher query."


class LoopState:
    """Tracks attempts and errors across KG re-plans for a single user query."""

    def __init__(self, max_attempts: int = MAX_KG_ATTEMPTS) -> None:
        self.max_attempts = max_attempts
        self.attempts: int = 0
        self.errors: list[dict[str, Any]] = []

    @property
    def exhausted(self) -> bool:
        return self.attempts >= self.max_attempts

    def record_attempt(self) -> int:
        self.attempts += 1
        return self.attempts

    def record_error(self, result: dict[str, Any]) -> None:
        self.errors.append({
            "attempt": self.attempts,
            "error_type": result.get("error_type", "UNKNOWN"),
            "error": result.get("error", "Unknown execution failure"),
        })

    def should_replan(self, result: dict[str, Any]) -> bool:
        """Return True if the failure is eligible for a re-plan attempt."""
        if result.get("error_type") in ("DENY", "UNSUPPORTED"):
            return False
        return self.attempts < self.max_attempts

    def replan_payload(self) -> dict[str, Any]:
        """Construct feedback payload for the re-plan turn."""
        last_error = self.errors[-1] if self.errors else {}
        err_type = last_error.get("error_type")
        err_msg = last_error.get("error", "")
        return {
            "kind": "replan_request",
            "attempt": self.attempts,
            "max_attempts": self.max_attempts,
            "error_type": err_type,
            "error": err_msg,
            "instruction": get_replan_instruction(err_type, err_msg),
        }

    def final_error(self) -> dict[str, Any]:
        """Produce final error payload when attempts are exhausted."""
        last_error = self.errors[-1] if self.errors else {}
        return {
            "status": "error",
            "error_type": last_error.get("error_type", "EXHAUSTED"),
            "message": last_error.get("error", "Failed to retrieve CRM B2B facts within maximum allowed attempts."),
            "attempts_made": self.attempts,
        }
