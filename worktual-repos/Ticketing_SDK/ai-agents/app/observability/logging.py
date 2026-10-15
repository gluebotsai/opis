"""Observability helpers for native runs."""

from __future__ import annotations

from typing import Any

from app.llm_log import log_llm


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = str(k).lower()
            if any(s in key for s in ("password", "secret", "token", "api_key", "authorization")):
                out[k] = "[redacted]"
            else:
                out[k] = redact(v)
        return out
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def trace_run(event: str, **fields: Any) -> None:
    log_llm(
        kind=f"native_{event}",
        user_text=str(fields.get("user_text") or ""),
        response=str(fields.get("response") or "")[:500],
        error=str(fields.get("error") or "") or None,
        ms=float(fields.get("ms") or 0),
        organization_id=fields.get("organization_id"),
        user_id=fields.get("user_id"),
    )
