"""Structured logging for the NLP service."""

import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import NLP_ROOT, Settings, get_settings

_CONFIGURED = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in (
            "event",
            "tenant_id",
            "user_id",
            "conversation_id",
            "channel",
            "surface",
            "trace_id",
            "audit",
            "semantic_layer",
            "knowledge_search",
            "contact_enrich",
            "decision",
            "reason",
            "fields",
            "confirmation_fields",
            "contact_id",
            "contact_id_before",
            "contact_id_final",
            "canonical_contact_id",
            "previous_contact_id",
            "outcome",
            "applied_fields",
            "requires_confirmation",
            "fields_detected",
            "handoff_recommended",
        ):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def _handler(level: int, path: Path | None = None) -> logging.Handler:
    if path is None:
        handler: logging.Handler = logging.StreamHandler(sys.stdout)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(path, encoding="utf-8")
    handler.setLevel(level)
    handler.setFormatter(JsonFormatter())
    return handler


def configure_logging(settings: Settings | None = None) -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    settings = settings or get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    log_dir = Path(settings.log_dir)
    if not log_dir.is_absolute():
        log_dir = NLP_ROOT / log_dir

    root = logging.getLogger()
    root.setLevel(level)
    if not root.handlers:
        root.addHandler(_handler(level))

    for name, filename in (
        ("nlp.service", "nlp-service.log"),
        ("nlp.coworker", "coworker.log"),
        ("nlp.support_bot", "support-bot.log"),
        ("nlp.semantic_layer", "semantic-layer.log"),
    ):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.setLevel(level)
        logger.propagate = False
        logger.addHandler(_handler(level))
        logger.addHandler(_handler(level, log_dir / filename))
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)


def log_extra(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}
