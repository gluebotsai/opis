"""Integration tests for Kafka → ClickHouse ingest (requires live Kafka + ClickHouse).

Run locally:
  cd etl && pytest tests/test_kafka_pipeline_integration.py -v -s

Skip automatically when KAFKA_INTEGRATION_TEST is not set to 1/true/yes.
"""

from __future__ import annotations

import os
import uuid

import pytest

from config import get_settings
from kafka.verify import (
    VerificationError,
    build_test_payload,
    consume_envelope_to_clickhouse,
    fetch_clickhouse_row,
    find_kafka_message,
    publish_test_payload,
    validate_clickhouse_row,
    validate_envelope,
)


def _integration_enabled() -> bool:
    return os.environ.get("KAFKA_INTEGRATION_TEST", "").strip().lower() in {"1", "true", "yes"}


pytestmark = pytest.mark.skipif(
    not _integration_enabled(),
    reason="Set KAFKA_INTEGRATION_TEST=1 to run live Kafka/ClickHouse integration tests",
)


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def unique_payload_id() -> str:
    return str(uuid.uuid4())


def test_kafka_envelope_publish_and_read(settings, unique_payload_id):
    body = build_test_payload(payload_id=unique_payload_id)
    envelope = publish_test_payload(body, settings=settings)

    assert "payload" in envelope
    assert "published_at" in envelope
    assert envelope["payload"]["payloadId"] == unique_payload_id

    found = find_kafka_message(unique_payload_id, settings=settings, timeout_s=45.0)
    validate_envelope(found, unique_payload_id)
    assert found["payload"]["websiteId"] == body["websiteId"]


def test_kafka_to_clickhouse_inline_consumer(settings, unique_payload_id):
    body = build_test_payload(payload_id=unique_payload_id)
    envelope = publish_test_payload(body, settings=settings)

    found = find_kafka_message(unique_payload_id, settings=settings, timeout_s=45.0)
    payload_id, status = consume_envelope_to_clickhouse(found, settings=settings)

    assert payload_id == unique_payload_id
    assert status in {"accepted", "duplicate"}

    row = fetch_clickhouse_row(unique_payload_id)
    assert row is not None, "row should exist in raw_payloads after inline consume"
    validate_clickhouse_row(row, body)


def test_kafka_envelope_rejects_missing_fields():
    with pytest.raises(VerificationError, match="missing payload"):
        validate_envelope({"published_at": "2026-01-01T00:00:00+00:00"}, "x")

    with pytest.raises(VerificationError, match="missing published_at"):
        validate_envelope({"payload": {"payloadId": "x", "websiteId": 1}}, "x")
