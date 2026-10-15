"""Kafka producer for web tracking ingest envelopes."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from config import Settings, get_settings

logger = logging.getLogger(__name__)

_producer: Any | None = None


class KafkaPublishError(RuntimeError):
    """Raised when a message could not be published to Kafka."""


def build_kafka_envelope(body: dict[str, Any], *, published_at: datetime | None = None) -> dict[str, Any]:
    ts = published_at or datetime.now(timezone.utc)
    return {
        "payload": body,
        "published_at": ts.isoformat(),
    }


def partition_key_for_payload(body: dict[str, Any]) -> str:
    website_id = body.get("websiteId") or body.get("domainId")
    if website_id is not None:
        return str(website_id)
    return body.get("payloadId") or "unknown"


def _producer_config(settings: Settings) -> dict[str, Any]:
    config: dict[str, Any] = {
        "bootstrap.servers": settings.kafka_bootstrap_servers,
        "client.id": settings.kafka_client_id,
        "acks": "all",
        "retries": 3,
        "linger.ms": 5,
    }
    if settings.kafka_security_protocol:
        config["security.protocol"] = settings.kafka_security_protocol
    if settings.kafka_sasl_mechanism:
        config["sasl.mechanism"] = settings.kafka_sasl_mechanism
    if settings.kafka_sasl_username:
        config["sasl.username"] = settings.kafka_sasl_username
    if settings.kafka_sasl_password:
        config["sasl.password"] = settings.kafka_sasl_password
    return config


def get_producer(settings: Settings | None = None) -> Any:
    global _producer
    if _producer is not None:
        return _producer

    from confluent_kafka import Producer

    settings = settings or get_settings()
    _producer = Producer(_producer_config(settings))
    return _producer


def reset_producer() -> None:
    global _producer
    if _producer is not None:
        try:
            _producer.flush(5)
        except Exception:
            logger.exception("Kafka producer flush on reset failed")
    _producer = None


def publish_envelope(
    envelope: dict[str, Any],
    *,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    body = envelope.get("payload")
    if not isinstance(body, dict):
        raise KafkaPublishError("Kafka envelope missing payload object")

    message = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    key = partition_key_for_payload(body).encode("utf-8")
    delivery_error: list[Exception] = []

    def _on_delivery(err: Any, _msg: Any) -> None:
        if err is not None:
            delivery_error.append(KafkaPublishError(str(err)))

    producer = get_producer(settings)
    producer.produce(
        settings.kafka_topic,
        value=message,
        key=key,
        callback=_on_delivery,
    )
    producer.flush(10)

    if delivery_error:
        raise delivery_error[0]
