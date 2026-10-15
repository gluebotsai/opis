"""ASGI entry for Campaign A2A spoke.

  PYTHONPATH=. .venv/bin/python -m uvicorn app.a2a_main:app --host 0.0.0.0 --port 8040
"""

import logging
import sys
from logging.handlers import RotatingFileHandler

from app.a2a.traffic_log import spoke_log_path, traffic_log_path


class _FlushHandler(logging.StreamHandler):
    def emit(self, record: logging.LogRecord) -> None:  # noqa: D102
        super().emit(record)
        self.flush()


def _configure_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(levelname)s:%(name)s:%(message)s")

    for h in list(root.handlers):
        root.removeHandler(h)

    stream = _FlushHandler(sys.stderr)
    stream.setFormatter(fmt)
    root.addHandler(stream)

    # In-repo spoke log (agents/logs/a2a_spoke.log)
    spoke = spoke_log_path()
    spoke.parent.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        spoke,
        maxBytes=5_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)

    # Keep /tmp mirror for quick tail while developing
    tmp_handler = RotatingFileHandler(
        "/tmp/campaign-a2a.log",
        maxBytes=5_000_000,
        backupCount=2,
        encoding="utf-8",
    )
    tmp_handler.setFormatter(fmt)
    root.addHandler(tmp_handler)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger(__name__).info(
        "A2A logging → spoke=%s traffic=%s tmp=/tmp/campaign-a2a.log",
        spoke,
        traffic_log_path(),
    )


_configure_logging()

from app.a2a.server import create_a2a_app

app = create_a2a_app()
