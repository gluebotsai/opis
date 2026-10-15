"""Two-attempt Domain re-plan loop controller (Option A).

Attempt flow:
  1. Domain plans -> executor runs -> success -> return facts.
  2. If error_type == DENY: return final error immediately (no retry).
  3. If error_type == REPAIR: executor repairs SQL/Cypher once -> retry execution.
     If repair also fails: escalate to REPLAN.
  4. If error_type == REPLAN and attempt < 2:
     Send typed error back to Domain -> Domain re-plans -> attempt += 1 -> retry.
  5. If attempt == 2 and still error: return final error (no more retries).
"""

from __future__ import annotations

from typing import Any

MAX_DOMAIN_ATTEMPTS = 2


def _replan_instruction(error_type: str | None, error: str) -> str:
    if error_type == "REPLAN":
        if "kpi_not_found" in error:
            return (
                "The KPI id was not found in the certified template library. "
                "Use run_sql with a free SQL task against rpt.* views instead, or correct the kpi id."
            )
        if "kpi_template_slot_error" in error:
            return (
                "The certified template needed parameters that the task did not supply. "
                "Supply the required time or scope parameters, or switch to run_sql."
            )
        if "db_error" in error or "could not reach" in error.lower():
            return "Database execution error. Re-plan with a simpler query or check the time/column filters."
        return f"Execution failed: {error}. Re-plan the task differently."
    if error_type == "REPAIR":
        return (
            "The executor repaired the SQL once but it still failed. "
            "Re-plan the task using different rpt.* views or a simpler approach."
        )
    return f"Execution error ({error_type}): {error}. Re-plan."


class LoopState:
    """Tracks attempt count and error history across Domain re-plans for one user question."""

    def __init__(self, max_attempts: int = MAX_DOMAIN_ATTEMPTS) -> None:
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
            "error": result.get("error", "Unknown error"),
        })

    def should_replan(self, result: dict[str, Any]) -> bool:
        """True if error is re-plannable and attempts < max_attempts."""
        err_type = result.get("error_type")
        if err_type == "DENY":
            return False
        return self.attempts < self.max_attempts

    def replan_payload(self) -> dict[str, Any]:
        """Construct the prompt payload to send to Domain for re-planning."""
        last = self.errors[-1] if self.errors else {}
        err_type = last.get("error_type")
        err_msg = last.get("error", "")
        return {
            "kind": "replan_request",
            "attempt": self.attempts,
            "max_attempts": self.max_attempts,
            "error_type": err_type,
            "error": err_msg,
            "instruction": _replan_instruction(err_type, err_msg),
        }

    def final_error(self) -> dict[str, Any]:
        """Final error object when exhausted or denied."""
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
