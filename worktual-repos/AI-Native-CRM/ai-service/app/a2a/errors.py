"""Spoke dispatch outcomes that map to A2A task states."""

from __future__ import annotations

from typing import Any, Sequence


class SpokeRejectError(Exception):
    def __init__(self, message: str, *, code: str = "rejected") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class InputRequiredError(Exception):
    """Hub AI must supply missing fields on the same task/context."""

    def __init__(self, fields: Sequence[str], message: str | None = None) -> None:
        self.fields = tuple(str(item) for item in fields if str(item).strip())
        self.message = message or (
            "Missing required fields: " + ", ".join(self.fields)
            if self.fields
            else "Additional input is required."
        )
        super().__init__(self.message)


def receipt(
    *,
    status: str,
    skill_id: str,
    agent_name: str,
    result: Any = None,
    error: str | None = None,
    missing_fields: Sequence[str] = (),
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status,
        "skillId": skill_id,
        "agent": agent_name,
    }
    if result is not None:
        payload["result"] = result
    if error:
        payload["error"] = error
    if missing_fields:
        payload["missingFields"] = list(missing_fields)
    return payload
