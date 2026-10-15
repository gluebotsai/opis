"""Full LLM + tool I/O audit log (human-readable file blocks).

Enable with LLM_IO_LOG=1. Default path: agents/logs/llm_io.log

Block shape:
  timestamp + optional session/module/round
  =====================INPUT=====================
  ...
  ====================OUTPUT====================
  ...
  ====================TOOL CALL==================
  ...
  ====================TOOL RESPONSE==================
"""

from __future__ import annotations

import json
import logging
import re
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_log = logging.getLogger("app.mas.runtime.llm_io")

_AGENTS_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_LOG = _AGENTS_ROOT / "logs" / "llm_io.log"

_LOCK = threading.Lock()

_HDR_INPUT = "=====================INPUT====================="
_HDR_OUTPUT = "====================OUTPUT===================="
_HDR_TOOL_CALL = "====================TOOL CALL=================="
_HDR_TOOL_RESPONSE = "====================TOOL RESPONSE=================="

_TOKEN_KEYS = frozenset(
    {
        "token",
        "campaigntoken",
        "campaign_token",
        "accesstoken",
        "access_token",
        "authorization",
        "api_token",
        "refreshtoken",
        "refresh_token",
        "client_secret",
        "clientsecret",
        "password",
        "password_hash",
    }
)

_ctx: ContextVar[dict[str, Any] | None] = ContextVar("llm_io_ctx", default=None)

_enabled_cache: bool | None = None
_path_cache: Path | None = None


def _settings() -> tuple[bool, Path]:
    global _enabled_cache, _path_cache
    if _enabled_cache is not None and _path_cache is not None:
        return _enabled_cache, _path_cache
    try:
        from app.config import get_settings

        s = get_settings()
        enabled = bool(getattr(s, "llm_io_log", False))
        raw = str(getattr(s, "llm_io_log_path", "") or "").strip()
        path = Path(raw) if raw else _DEFAULT_LOG
    except Exception:  # noqa: BLE001
        enabled = False
        path = _DEFAULT_LOG
    _enabled_cache = enabled
    _path_cache = path
    return enabled, path


def is_llm_io_log_enabled() -> bool:
    return _settings()[0]


def llm_io_log_path() -> Path:
    return _settings()[1]


def llm_io_set_context(
    *,
    session_id: str = "",
    module: str = "",
    chat_context: str = "",
    source: str = "",
) -> None:
    """Attach turn metadata to subsequent LLM / tool blocks."""
    if not is_llm_io_log_enabled():
        return
    prev = _ctx.get() or {}
    _ctx.set(
        {
            **prev,
            "session_id": str(session_id or prev.get("session_id") or "").strip(),
            "module": str(module or prev.get("module") or "").strip(),
            "chat_context": str(
                chat_context or prev.get("chat_context") or ""
            ).strip(),
            "source": str(source or prev.get("source") or "").strip(),
        }
    )


def llm_io_set_round(round_index: int) -> None:
    if not is_llm_io_log_enabled():
        return
    prev = _ctx.get() or {}
    _ctx.set({**prev, "round": int(round_index)})


def llm_io_clear_context() -> None:
    _ctx.set(None)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            norm = key.lower().replace("-", "_")
            if norm in _TOKEN_KEYS or key.lower() in _TOKEN_KEYS:
                out[key] = "***REDACTED***"
            else:
                out[key] = _redact(v)
        return out
    if isinstance(value, list):
        return [_redact(v) for v in value]
    if isinstance(value, str) and re.match(r"^Bearer\s+\S+", value, re.I):
        return "Bearer ***REDACTED***"
    return value


def _pretty(value: Any) -> str:
    return json.dumps(_redact(value), ensure_ascii=False, indent=2, default=str)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _meta_lines() -> list[str]:
    ctx = _ctx.get() or {}
    lines: list[str] = [_now_iso()]
    for key in ("session_id", "module", "chat_context", "source", "round"):
        val = ctx.get(key)
        if val is None or val == "":
            continue
        lines.append(f"{key}={val}")
    return lines


def _append_block(header: str, body: Any) -> None:
    enabled, path = _settings()
    if not enabled:
        return
    lines = [*_meta_lines(), "", header, _pretty(body), ""]
    text = "\n".join(lines)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _LOCK:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(text)
                if not text.endswith("\n"):
                    fh.write("\n")
    except Exception:  # noqa: BLE001
        _log.exception("failed to write llm_io log")


def log_llm_input(payload: dict[str, Any]) -> None:
    _append_block(_HDR_INPUT, payload)


def log_llm_output(payload: dict[str, Any]) -> None:
    _append_block(_HDR_OUTPUT, payload)


def log_tool_call(tool_name: str, arguments: Any) -> None:
    _append_block(
        _HDR_TOOL_CALL,
        {"tool": str(tool_name or "").strip(), "arguments": arguments},
    )


def log_tool_response(tool_name: str, result: Any) -> None:
    _append_block(
        _HDR_TOOL_RESPONSE,
        {"tool": str(tool_name or "").strip(), "result": result},
    )


__all__ = [
    "is_llm_io_log_enabled",
    "llm_io_clear_context",
    "llm_io_log_path",
    "llm_io_set_context",
    "llm_io_set_round",
    "log_llm_input",
    "log_llm_output",
    "log_tool_call",
    "log_tool_response",
]
