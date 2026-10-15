"""Day-wise Hub A2A traces — CRM-style timestamped JSON lines.

Example:
2026-08-28 23:29:12,096 ERROR {"agent": "a2a-spoke", "step": "token", ...}

Files: ai-agents/logs/a2a-YYYY-MM-DD.log and .json (secrets redacted).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from pathlib import Path
from typing import Any

LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
LOGGER_NAME = "a2a-spoke"
_SECRET_KEYS = re.compile(
    r"(secret|token|password|authorization|client_secret|refresh_token|access_token)",
    re.I,
)
_configured = False
_formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")


def log_file_path(day: str | None = None) -> Path:
    return LOG_DIR / f"a2a-{day or date.today().isoformat()}.log"


def json_file_path(day: str | None = None) -> Path:
    return LOG_DIR / f"a2a-{day or date.today().isoformat()}.json"


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if _SECRET_KEYS.search(str(k)):
                out[k] = "***"
            else:
                out[k] = _redact(v)
        return out
    if isinstance(obj, list):
        return [_redact(x) for x in obj]
    return obj


class _DailyFileHandler(logging.Handler):
    """Append CRM-style lines to the current day's .log file."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            line = self.format(record)
            with log_file_path().open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except Exception:  # noqa: BLE001
            pass


def _ensure_logger() -> logging.Logger:
    global _configured
    logger = logging.getLogger(LOGGER_NAME)
    if _configured:
        return logger
    logger.setLevel(logging.INFO)
    logger.propagate = False
    stream = logging.StreamHandler()
    stream.setFormatter(_formatter)
    logger.addHandler(stream)
    daily = _DailyFileHandler()
    daily.setFormatter(_formatter)
    logger.addHandler(daily)
    _configured = True
    return logger


def log_event(
    step: str,
    *,
    ok: bool = True,
    hub: dict[str, Any] | None = None,
    ticketing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write one CRM-style A2A spoke line. Returns the JSON object (tests)."""
    payload: dict[str, Any] = {
        "agent": "a2a-spoke",
        "step": step,
        "channel": "a2a",
        "ok": ok,
    }
    if hub is not None:
        payload["hub"] = _redact(hub)
    if ticketing is not None:
        payload["ticketing"] = _redact(ticketing)
    text = json.dumps(payload, default=str)
    logger = _ensure_logger()
    logger.log(logging.INFO if ok else logging.ERROR, text)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with json_file_path().open("a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    except Exception:  # noqa: BLE001
        pass
    return payload


def log_ready() -> dict[str, Any]:
    from app.a2a.card import public_base_url
    from app.config import get_settings

    settings = get_settings()
    server = (settings.a2a_server_name or "worktual-ticketing").strip()
    return log_event(
        "ready",
        ok=True,
        ticketing={
            "server": server,
            "url": public_base_url(),
            "logPath": str(log_file_path()),
        },
    )


def log_trace(*, direction: str, event: str, payload: dict[str, Any]) -> None:
    """Compat wrapper — prefer log_event."""
    if direction == "hub":
        log_event(event, ok=True, hub=payload)
    else:
        log_event(event, ok=True, ticketing=payload)
