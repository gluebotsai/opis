"""Day-wise file logging for LLM requests and responses."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path

_LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
_LOCK = threading.Lock()


def _log_path(day: datetime | None = None) -> Path:
    when = day or datetime.now(timezone.utc)
    return _LOG_DIR / f"llm-{when.strftime('%Y-%m-%d')}.log"


def _format_secs(ms: float | int | None) -> str | None:
    """Human-readable response time for log headers."""
    if ms is None:
        return None
    try:
        value = float(ms)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    secs = value / 1000.0
    if secs < 10:
        return f"{secs:.2f}s"
    return f"{secs:.1f}s"


def log_llm(
    *,
    kind: str,
    response: str,
    user_text: str = "",
    agent: str | None = None,
    page: str | None = None,
    session_id: str | None = None,
    organization_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    error: str | None = None,
    ms: float | int | None = None,
) -> None:
    """
    Append one LLM exchange to today's log file.

    Files: ai-agents/logs/llm-YYYY-MM-DD.log

    `ms` is wall-clock duration for this call/turn (milliseconds).
    Logged as secs=… and ms=… when provided.
    """
    now = datetime.now(timezone.utc)
    path = _log_path(now)
    meta_parts = [
        f"kind={kind}",
        f"agent={agent or '-'}",
        f"page={page or '-'}",
        f"session={session_id or '-'}",
        f"org={organization_id or '-'}",
        f"user={user_id or '-'}",
        f"model={model or '-'}",
    ]
    secs_label = _format_secs(ms)
    if secs_label is not None:
        meta_parts.append(f"secs={secs_label}")
        meta_parts.append(f"ms={int(round(float(ms)))}")
    lines = [
        "",
        "=" * 88,
        f"{now.strftime('%Y-%m-%d %H:%M:%S')} UTC | {' | '.join(meta_parts)}",
        "-" * 88,
        "USER:",
        (user_text or "").strip() or "(empty)",
        "",
        "RESPONSE:",
        (response or "").strip() or "(empty)",
    ]
    if error:
        lines.extend(["", f"ERROR: {error}"])
    lines.append("=" * 88)
    lines.append("")
    payload = "\n".join(lines)

    try:
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(payload)
    except OSError:
        # Logging must never break chat
        pass
