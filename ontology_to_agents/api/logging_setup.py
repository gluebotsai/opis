"""Context layer logging — app log + dedicated error.log."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler, TimedRotatingFileHandler
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_LOG_DIR = PROJECT_DIR / "logs"


def configure_logging(log_dir: Path | None = None) -> Path:
    """Configure root logging: context_layer.log (INFO+) and error.log (ERROR+)."""
    target = log_dir or DEFAULT_LOG_DIR
    target.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    if getattr(root, "_context_layer_configured", False):
        return target

    root.setLevel(logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    app_log = target / "context_layer.log"
    app_handler = RotatingFileHandler(
        app_log, maxBytes=5_000_000, backupCount=5, encoding="utf-8"
    )
    app_handler.setLevel(logging.INFO)
    app_handler.setFormatter(fmt)

    err_log = target / "error.log"
    err_handler = RotatingFileHandler(
        err_log, maxBytes=5_000_000, backupCount=5, encoding="utf-8"
    )
    err_handler.setLevel(logging.ERROR)
    err_handler.setFormatter(fmt)

    io_log = target / "api_io.log"
    io_handler = TimedRotatingFileHandler(
        io_log,
        when="D",
        interval=10,
        backupCount=3,
        encoding="utf-8",
        utc=True,
    )
    io_handler.setLevel(logging.INFO)
    io_handler.setFormatter(fmt)
    io_logger = logging.getLogger("api.io")
    io_logger.setLevel(logging.INFO)
    io_logger.addHandler(io_handler)
    io_logger.propagate = False

    ontology_log = target / "ontology.log"
    ontology_handler = RotatingFileHandler(
        ontology_log, maxBytes=5_000_000, backupCount=5, encoding="utf-8"
    )
    ontology_handler.setLevel(logging.INFO)
    ontology_handler.setFormatter(fmt)
    ontology_logger = logging.getLogger("api.ontology")
    ontology_logger.setLevel(logging.INFO)
    ontology_logger.addHandler(ontology_handler)
    ontology_logger.propagate = False

    console = logging.StreamHandler()
    console.setLevel(logging.WARNING)
    console.setFormatter(fmt)

    root.addHandler(app_handler)
    root.addHandler(err_handler)
    root.addHandler(console)

    # Immediate request-hit lines in the terminal (before slow handlers finish).
    access = logging.getLogger("api.access")
    access.setLevel(logging.INFO)
    access_console = logging.StreamHandler()
    access_console.setLevel(logging.INFO)
    access_console.setFormatter(fmt)
    access.addHandler(access_console)

    root._context_layer_configured = True  # type: ignore[attr-defined]
    logging.getLogger(__name__).info(
        "Logging to %s, %s, %s (IO rotates every 10 days), and %s",
        app_log,
        err_log,
        io_log,
        ontology_log,
    )
    return target
