"""One JSON line per co-worker turn — user, standalone, context/semantic, response."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import AI_CHAT_ROOT, ROOT

logger = logging.getLogger(__name__)


def turn_log_directory() -> Path:
    override = os.environ.get("AI_CHAT_TURN_LOG_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (AI_CHAT_ROOT / "logs").resolve()


def turn_log_directories() -> list[Path]:
    """Primary AI_CHAT/logs plus repo .local/logs (same area as ai-chat.log)."""
    day_dir_name = "logs"
    dirs = [turn_log_directory()]
    local = (ROOT / ".local" / day_dir_name).resolve()
    if local not in dirs:
        dirs.append(local)
    return dirs


def ensure_turn_log_directory() -> Path:
    primary = turn_log_directory()
    for directory in turn_log_directories():
        directory.mkdir(parents=True, exist_ok=True)
    return primary


def turn_log_file_paths() -> list[Path]:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name = f"coworker-turn-{day}.log"
    ensure_turn_log_directory()
    return [directory / name for directory in turn_log_directories()]


def log_turn(payload: dict[str, Any]) -> None:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    try:
        line = json.dumps(record, ensure_ascii=False, default=str)
    except Exception:
        logger.exception("Failed to serialize turn log record")
        line = json.dumps(
            {"ts": record["ts"], "error": "serialize_failed", "user_query": payload.get("user_query")},
            default=str,
        )

    written: list[str] = []
    for path in turn_log_file_paths():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            written.append(str(path))
        except Exception:
            logger.exception("Failed to write co-worker turn log to %s", path)

    if written:
        logger.info("Turn log written %s", written[0])
        if len(written) > 1:
            logger.info("Turn log mirror %s", written[1])
    else:
        logger.error("Turn log not written to any path")


def log_startup_probe() -> None:
    """Create today's log file immediately so operators know where to tail."""
    log_turn(
        {
            "event": "ai_chat_startup",
            "turn_log_paths": [str(p) for p in turn_log_file_paths()],
            "ai_chat_root": str(AI_CHAT_ROOT.resolve()),
        }
    )
