"""Frozen coworker response / tool result helpers."""

from __future__ import annotations

from typing import Any
from uuid import uuid4


SCHEMA_VERSION = "1.0"


def new_request_id() -> str:
    return str(uuid4())


TOOL_ERROR_CODES = frozenset(
    {
        "VALIDATION_ERROR",
        "FORBIDDEN",
        "NOT_FOUND",
        "CONFLICT",
        "RETRYABLE",
        "CONFIRMATION_REQUIRED",
        "MISSING_FIELDS",
        "CUSTOMER_NOT_VERIFIED",
        "MISSING_CATALOG_ID",
    }
)
_TOOL_ERROR_ALIASES = {
    "BAD_INPUT": "VALIDATION_ERROR",
    "UNPROCESSABLE": "VALIDATION_ERROR",
    "UNAUTHORIZED": "FORBIDDEN",
    "NO_ACTOR": "FORBIDDEN",
    "FORBIDDEN_PATH": "FORBIDDEN",
    "TOOL_NOT_ALLOWED": "FORBIDDEN",
    "TRANSPORT": "RETRYABLE",
    "HTTP_ERROR": "RETRYABLE",
    "NEEDS_CONFIRM": "CONFIRMATION_REQUIRED",
}


def tool_ok(payload: Any = None) -> dict[str, Any]:
    return {"success": True, "payload": {} if payload is None else payload}


def tool_err(
    error_code: str,
    message: str,
    *,
    payload: dict[str, Any] | None = None,
    http_status: int | None = None,
    field_errors: list[dict[str, Any]] | None = None,
    retryable: bool | None = None,
) -> dict[str, Any]:
    normalized = _TOOL_ERROR_ALIASES.get(
        str(error_code or "").strip().upper(),
        str(error_code or "").strip().upper(),
    )
    if normalized not in TOOL_ERROR_CODES:
        normalized = "RETRYABLE"
    if retryable is None:
        retryable = normalized == "RETRYABLE" or (
            http_status is not None and int(http_status) >= 500
        )
    out: dict[str, Any] = {
        "success": False,
        "error_code": normalized,
        "message": message,
        "retryable": bool(retryable),
    }
    if payload:
        out["payload"] = payload
    if field_errors:
        out["field_errors"] = field_errors
    if http_status is not None:
        out["http_status"] = http_status
    return out


def write_failure_retryable(result: dict[str, Any]) -> bool:
    """Whether a failed tool result should be treated as retryable."""
    if not isinstance(result, dict) or result.get("success"):
        return False
    if "retryable" in result:
        return bool(result.get("retryable"))
    code = str(result.get("error_code") or "").strip().upper()
    if code == "RETRYABLE":
        return True
    try:
        status = int(result.get("http_status") or 0)
    except (TypeError, ValueError):
        status = 0
    return status >= 500


def format_chat_response(
    *,
    reply: str,
    agent: str,
    ui_actions: list[dict[str, Any]] | None = None,
    data: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    """Response Formatter envelope — single shape for all agents."""
    return {
        "schema_version": SCHEMA_VERSION,
        "reply": reply or "",
        "ui_actions": list(ui_actions or []),
        "data": data or {},
        "agent": agent or "general",
        "request_id": request_id or new_request_id(),
    }
