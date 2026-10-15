from datetime import datetime, timezone
import json
from unittest.mock import MagicMock, patch

import pytest

from config import Settings, uses_direct_clickhouse, uses_kafka
from ingest.service import IngestService, PreparedIngest, insert_from_kafka_envelope
from kafka.producer import (
    KafkaPublishError,
    build_kafka_envelope,
    partition_key_for_payload,
    publish_envelope,
)


def _settings(mode: str) -> Settings:
    return Settings(
        ip_hash_salt="test-salt",
        geoip_db_path=None,
        geoip_http_fallback=False,
        ingest_upstream_url=None,
        reverse_geocode_enabled=False,
        reverse_geocode_url="https://example.com/reverse",
        reverse_geocode_user_agent="test",
        reverse_geocode_timeout=1.0,
        ingest_write_mode=mode,
        kafka_bootstrap_servers="127.0.0.1:9092",
        kafka_topic="cdp.ingestion.webtracking",
        kafka_client_id="test-ingest",
        kafka_consumer_group="test-ch-writer",
        kafka_security_protocol=None,
        kafka_sasl_mechanism=None,
        kafka_sasl_username=None,
        kafka_sasl_password=None,
    )


def test_build_kafka_envelope_shape():
    body = {"payloadId": "abc", "websiteId": 12345, "type": "events_v3"}
    ts = datetime(2026, 8, 25, 12, 0, 0, tzinfo=timezone.utc)
    envelope = build_kafka_envelope(body, published_at=ts)

    assert envelope["payload"] == body
    assert envelope["published_at"] == "2026-08-25T12:00:00+00:00"


def test_partition_key_prefers_website_id():
    assert partition_key_for_payload({"websiteId": 99}) == "99"
    assert partition_key_for_payload({"domainId": 88}) == "88"
    assert partition_key_for_payload({"payloadId": "pid-1"}) == "pid-1"


def test_uses_kafka_and_direct_flags():
    assert uses_kafka(_settings("kafka")) is True
    assert uses_kafka(_settings("dual")) is True
    assert uses_kafka(_settings("direct")) is False
    assert uses_direct_clickhouse(_settings("direct")) is True
    assert uses_direct_clickhouse(_settings("dual")) is True
    assert uses_direct_clickhouse(_settings("kafka")) is False


@patch("kafka.producer.get_producer")
def test_publish_envelope_flushes_and_delivers(mock_get_producer):
    producer = MagicMock()
    mock_get_producer.return_value = producer
    settings = _settings("kafka")

    def _capture_produce(*args, **kwargs):
        callback = kwargs["callback"]
        callback(None, None)

    producer.produce.side_effect = _capture_produce

    envelope = build_kafka_envelope({"websiteId": 1, "payloadId": "p1"})
    publish_envelope(envelope, settings=settings)

    producer.produce.assert_called_once()
    producer.flush.assert_called_once_with(10)
    call_kwargs = producer.produce.call_args.kwargs
    assert call_kwargs["key"] == b"1"


@patch("kafka.producer.get_producer")
def test_publish_envelope_raises_on_delivery_error(mock_get_producer):
    producer = MagicMock()
    mock_get_producer.return_value = producer

    def _fail(*args, **kwargs):
        callback = kwargs["callback"]
        callback("broker unavailable", None)

    producer.produce.side_effect = _fail

    with pytest.raises(KafkaPublishError, match="broker unavailable"):
        publish_envelope(build_kafka_envelope({"websiteId": 1}), settings=_settings("kafka"))


def _mock_admin_dict_row(org_id: int = 7778):
    return [(1, "https://beta.worktual.co.uk", "active", 1, org_id)]


def test_insert_from_kafka_envelope_uses_published_at_and_injects_org():
    client = MagicMock()

    def _query_side_effect(*_args, **_kwargs):
        result = MagicMock()
        sql = _kwargs.get("parameters") or (_args[1] if len(_args) > 1 else None)
        if isinstance(sql, dict) and "payload_id" in sql:
            result.result_rows = []
        else:
            result.result_rows = _mock_admin_dict_row(7778)
        return result

    client.query.side_effect = _query_side_effect
    service = IngestService(client, _settings("direct"))

    published_at = datetime(2026, 8, 25, 12, 0, 0, tzinfo=timezone.utc)
    body = {
        "payloadId": "8f8e55ce-464e-4140-b189-577fbf1577e6",
        "websiteId": 12345,
        "websiteUrl": "https://beta.worktual.co.uk",
        "visitorId": "visitor_abc",
        "type": "events_v3",
        "events": [{"eventType": "page_view"}],
    }

    payload_id, status = insert_from_kafka_envelope(service, body, published_at)

    assert payload_id == "8f8e55ce-464e-4140-b189-577fbf1577e6"
    assert status == "accepted"
    assert body["organization_id"] == 7778
    client.insert.assert_called_once()
    row = client.insert.call_args.args[1][0]
    assert row[0] == "8f8e55ce-464e-4140-b189-577fbf1577e6"
    assert row[7] == published_at
    stored = json.loads(row[8])
    assert stored["organization_id"] == 7778


@patch("ingest.service.publish_envelope")
def test_write_prepared_kafka_only(mock_publish):
    client = MagicMock()
    client.query.return_value.result_rows = []
    service = IngestService(client, _settings("kafka"))

    prepared = PreparedIngest(
        payload_id="pid-1",
        website_id=12345,
        website_url="https://beta.worktual.co.uk",
        visitor_id="visitor_abc",
        payload_type="events_v3",
        body={"payloadId": "pid-1", "websiteId": 12345, "type": "events_v3"},
        client_ip="1.2.3.4",
        user_agent="test-agent",
    )

    payload_id, status = service.write_prepared(prepared)

    assert payload_id == "pid-1"
    assert status == "accepted"
    mock_publish.assert_called_once()
    client.insert.assert_not_called()


@patch("ingest.service.publish_envelope")
def test_write_prepared_dual_writes_clickhouse(mock_publish):
    client = MagicMock()
    client.query.return_value.result_rows = []
    service = IngestService(client, _settings("dual"))

    prepared = PreparedIngest(
        payload_id="pid-2",
        website_id=12345,
        website_url="https://beta.worktual.co.uk",
        visitor_id="visitor_abc",
        payload_type="events_v3",
        body={"payloadId": "pid-2", "websiteId": 12345, "type": "events_v3"},
        client_ip="1.2.3.4",
        user_agent="test-agent",
    )

    payload_id, status = service.write_prepared(prepared)

    assert status == "accepted"
    mock_publish.assert_called_once()
    client.insert.assert_called_once()


def test_write_prepared_skips_duplicate():
    client = MagicMock()
    client.query.return_value.result_rows = [(1,)]
    service = IngestService(client, _settings("kafka"))

    prepared = PreparedIngest(
        payload_id="dup-1",
        website_id=12345,
        website_url="https://beta.worktual.co.uk",
        visitor_id="visitor_abc",
        payload_type="events_v3",
        body={"payloadId": "dup-1", "websiteId": 12345},
        client_ip=None,
        user_agent=None,
    )

    with patch("ingest.service.publish_envelope") as mock_publish:
        payload_id, status = service.write_prepared(prepared)

    assert status == "duplicate"
    mock_publish.assert_not_called()
    client.insert.assert_not_called()
