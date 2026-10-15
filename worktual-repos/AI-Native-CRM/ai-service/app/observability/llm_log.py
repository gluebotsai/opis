"""LLM day log (``llm-YYYY-MM-DD.log``) — all model traffic."""

from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Any

from app.observability.file_sink import append_text, utc_now_header
from app.observability.redact import clip_text

_LLM_PREFIX = "llm"
_SEP = "=" * 88
_DASH = "-" * 88

_LLM_CTX: ContextVar[dict[str, Any]] = ContextVar("llm_log_ctx", default={})


def set_llm_log_context(**fields: Any) -> None:
    current = dict(_LLM_CTX.get() or {})
    for key, val in fields.items():
        if val not in (None, "", [], {}):
            current[key] = val
    _LLM_CTX.set(current)


def clear_llm_log_context() -> None:
    _LLM_CTX.set({})


def log_llm(
    kind: str,
    response: str,
    *,
    user_text: str = "",
    agent: str | None = None,
    page: str | None = None,
    session_id: str | None = None,
    organization_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    error: str | None = None,
    ms: float | None = None,
) -> None:
    try:
        ctx = _LLM_CTX.get() or {}
        agent_v = agent or ctx.get("agent") or "-"
        page_v = page or ctx.get("page") or "-"
        session_v = session_id or ctx.get("session_id") or "-"
        org_v = organization_id or ctx.get("organization_id") or "-"
        user_v = user_id or ctx.get("user_id") or "-"
        model_v = model or ctx.get("model") or "-"
        ms_int = int(round(ms)) if isinstance(ms, (int, float)) else None
        secs = ""
        if ms_int is not None:
            secs = f"  secs={ms_int / 1000:.2f}s" if ms_int < 10_000 else f"  secs={ms_int // 1000}s"
        header = (
            f"{_SEP}\n"
            f"{utc_now_header()} UTC | kind={kind} | agent={agent_v} | page={page_v} | "
            f"session={session_v} | org={org_v} | user={user_v} | model={model_v}"
        )
        if ms_int is not None:
            header += f" | ms={ms_int}{secs}"
        block = (
            f"{header}\n"
            f"{_DASH}\n"
            f"USER:\n{clip_text(user_text or '(summary omitted)', limit=8000)}\n\n"
            f"RESPONSE:\n{clip_text(response or '(empty)', limit=8000)}\n"
        )
        if error:
            block += f"\nERROR: {clip_text(error, limit=800)}\n"
        block += f"{_SEP}\n"
        append_text(prefix=_LLM_PREFIX, text=block)
        if os.environ.get("LLM_LOG_CONSOLE", "").strip().lower() in {"1", "true", "yes"}:
            try:
                print(block, end="", flush=True)
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001
        return
