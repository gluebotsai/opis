"""Thread-safe UTC day-rotated append-only log files. Never raises."""

from __future__ import annotations

import fcntl
import os
import threading
from datetime import date, datetime, timezone
from pathlib import Path

from app.config import get_settings

_LOCK = threading.Lock()
_DAY: dict[str, str] = {}

_DEFAULT_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"


def log_dir() -> Path:
    return _DEFAULT_LOG_DIR


def _path_for(prefix: str, day: date | None = None) -> Path:
    stamp = (day or date.today()).isoformat()
    return log_dir() / f"{prefix}-{stamp}.log"


def _prune(prefix: str, keep_days: int) -> None:
    root = log_dir()
    if not root.exists():
        return
    today = date.today()
    for path in root.glob(f"{prefix}-*.log"):
        name = path.name
        if not name.startswith(f"{prefix}-") or not name.endswith(".log"):
            continue
        try:
            day = date.fromisoformat(name[len(prefix) + 1 : -4])
        except ValueError:
            continue
        if (today - day).days >= keep_days:
            try:
                path.unlink()
            except OSError:
                pass


def append_text(*, prefix: str, text: str) -> None:
    """Append UTF-8 text to ``{prefix}-YYYY-MM-DD.log`` (process-wide lock + fcntl)."""
    if not text:
        return
    try:
        settings = get_settings()
        keep = max(1, int(getattr(settings, "agent_log_retention_days", 5) or 5))
        root = log_dir()
        root.mkdir(parents=True, exist_ok=True)
        path = _path_for(prefix)
        with _LOCK:
            if _DAY.get(prefix) != date.today().isoformat():
                _DAY[prefix] = date.today().isoformat()
                _prune(prefix, keep)
            with path.open("a", encoding="utf-8") as stream:
                try:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
                except (OSError, AttributeError):
                    pass
                stream.write(text)
                if not text.endswith("\n"):
                    stream.write("\n")
                stream.flush()
                try:
                    os.fsync(stream.fileno())
                except OSError:
                    pass
                try:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
                except (OSError, AttributeError):
                    pass
    except Exception:  # noqa: BLE001
        return


def append_jsonl(*, prefix: str, payload: dict) -> None:
    import json

    try:
        line = json.dumps(payload, ensure_ascii=False, default=str)
        root = log_dir()
        root.mkdir(parents=True, exist_ok=True)
        path = root / f"{prefix}-{date.today().isoformat()}.json"
        with _LOCK:
            with path.open("a", encoding="utf-8") as stream:
                try:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
                except (OSError, AttributeError):
                    pass
                stream.write(line + "\n")
                stream.flush()
                try:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
                except (OSError, AttributeError):
                    pass
    except Exception:  # noqa: BLE001
        return


def utc_now_header() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def utc_live_ts() -> str:
    now = datetime.now(timezone.utc)
    ms = now.microsecond // 1000
    return now.strftime("%H:%M:%S.") + f"{ms:03d}"
