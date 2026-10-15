"""Kafka consumer: envelope → ClickHouse raw_payloads."""

from __future__ import annotations

import json
import logging
import signal
from datetime import datetime, timezone
from typing import Any

from config import Settings, get_settings
from ingest.service import IngestService, insert_from_kafka_envelope
from shared.clickhouse import get_client

logger = logging.getLogger(__name__)

_running = True


def _consumer_config(settings: Settings) -> dict[str, Any]:
    config: dict[str, Any] = {
        "bootstrap.servers": settings.kafka_bootstrap_servers,
        "group.id": settings.kafka_consumer_group,
        "client.id": f"{settings.kafka_client_id}-consumer",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
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


def _parse_published_at(value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        return datetime.now(timezone.utc)
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"invalid published_at: {value}") from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def process_message(raw: bytes, service: IngestService) -> None:
    envelope = json.loads(raw.decode("utf-8"))
    if not isinstance(envelope, dict):
        raise ValueError("Kafka message must be a JSON object")
    payload = envelope.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Kafka envelope missing payload object")
    published_at = _parse_published_at(envelope.get("published_at"))
    insert_from_kafka_envelope(service, payload, published_at)


def _handle_signal(signum: int, _frame: Any) -> None:
    global _running
    logger.info("Received signal %s, shutting down consumer", signum)
    _running = False


def run_consumer(settings: Settings | None = None) -> None:
    from confluent_kafka import Consumer, KafkaError

    settings = settings or get_settings()
    consumer = Consumer(_consumer_config(settings))
    consumer.subscribe([settings.kafka_topic])

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info(
        "Kafka consumer started topic=%s group=%s brokers=%s",
        settings.kafka_topic,
        settings.kafka_consumer_group,
        settings.kafka_bootstrap_servers,
    )

    client = get_client()
    service = IngestService(client, settings)

    try:
        while _running:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("Kafka consumer error: %s", msg.error())
                continue

            try:
                process_message(msg.value(), service)
                consumer.commit(asynchronous=False)
            except Exception:
                logger.exception("Failed to process Kafka message at offset %s", msg.offset())
    finally:
        consumer.close()
        client.close()
        logger.info("Kafka consumer stopped")
