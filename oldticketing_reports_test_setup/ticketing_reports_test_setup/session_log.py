"""JSONL session logs: chat messages and LLM/tool calls."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
LOG_DIR = HERE / "logs"


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]


def log_path(session_id: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return LOG_DIR / f"session_{session_id}.jsonl"


def append_record(session_id: str, record: dict[str, Any]) -> Path:
    path = log_path(session_id)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")
    return path


def append_message(session_id: str, role: str, content: str) -> Path:
    return append_record(session_id, {"role": role, "content": content})
