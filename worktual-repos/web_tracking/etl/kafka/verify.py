"""Helpers for end-to-end Kafka ingest verification."""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib import error, request

from config import Settings, get_settings
from ingest.service import IngestService, PayloadRejectedError, insert_from_kafka_envelope
from kafka.producer import build_kafka_envelope, publish_envelope
from shared.clickhouse import get_client


class VerificationError(RuntimeError):
    """Verification step failed."""


def fetch_registered_organization_id(website_id: int) -> int | None:
    """Look up organization_id from dict_admin_accounts for a website."""
    db = os.environ.get("CLICKHOUSE_DATABASE", "web_tracking")
    dict_name = f"{db}.dict_admin_accounts"
    client = get_client()
    try:
        row = client.query(
            f"""
            SELECT
                dictHas('{dict_name}', toUInt64({{d:UInt32}})) AS found,
                dictGet('{dict_name}', 'organization_id', toUInt64({{d:UInt32}})) AS organization_id
            """,
            parameters={"d": website_id},
        ).result_rows[0]
        found, organization_id = row
        if not found or not organization_id:
            return None
        org_id = int(organization_id)
        return org_id if org_id > 0 else None
    finally:
        client.close()


def build_test_payload(
    *,
    payload_id: str | None = None,
    website_id: int = 12345,
    website_url: str = "https://beta.worktual.co.uk",
    visitor_id: str | None = None,
    sdk_version: str = "dnalnlafn",
    organization_id: int | None = None,
) -> dict[str, Any]:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    pid = payload_id or str(uuid.uuid4())
    vid = visitor_id or f"visitor_kafka_verify_{uuid.uuid4().hex[:12]}"
    sid = f"session_kafka_verify_{uuid.uuid4().hex[:12]}"
    pvid = f"pg_kafka_verify_{uuid.uuid4().hex[:12]}"
    payload: dict[str, Any] = {
        "type": "events_v3",
        "payloadId": pid,
        "websiteId": website_id,
        "websiteUrl": website_url,
        "visitorId": vid,
        "sessionId": sid,
        "sdkVersion": sdk_version,
        "sentAt": now_ms,
        "clientIp": "203.0.113.77",
        "events": [
            {
                "eventId": str(uuid.uuid4()),
                "name": "page_view",
                "ts": now_ms,
                "pid": pvid,
                "props": {"path": "/kafka-verify", "title": "Kafka verify"},
            }
        ],
        "profiles": {"pages": {pvid: {"path": "/kafka-verify"}}},
        "_verify": {"source": "verify_kafka_ingest_pipeline", "created_at": now_ms},
    }
    # SDK does not send organization_id — omit unless explicitly testing a client value
    if organization_id is not None:
        payload["organization_id"] = organization_id
    return payload


def validate_envelope(envelope: dict[str, Any], expected_payload_id: str) -> None:
    if not isinstance(envelope, dict):
        raise VerificationError("Kafka message is not a JSON object")

    payload = envelope.get("payload")
    published_at = envelope.get("published_at")
    if not isinstance(payload, dict):
        raise VerificationError("Kafka envelope missing payload object")
    if not isinstance(published_at, str) or not published_at.strip():
        raise VerificationError("Kafka envelope missing published_at")

    if payload.get("payloadId") != expected_payload_id:
        raise VerificationError(
            f"payloadId mismatch: expected {expected_payload_id}, got {payload.get('payloadId')!r}"
        )

    if payload.get("websiteId") is None and payload.get("domainId") is None:
        raise VerificationError("payload missing websiteId")

    try:
        datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise VerificationError(f"invalid published_at: {published_at}") from exc


def _consumer_config(settings: Settings, group_id: str) -> dict[str, Any]:
    config: dict[str, Any] = {
        "bootstrap.servers": settings.kafka_bootstrap_servers,
        "group.id": group_id,
        "client.id": f"{settings.kafka_client_id}-verify",
        "auto.offset.reset": "latest",
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


def _assign_at_end(consumer: Any, topic: str) -> None:
    from confluent_kafka import TopicPartition

    metadata = consumer.list_topics(topic, timeout=10)
    if topic not in metadata.topics:
        raise VerificationError(f"Kafka topic not found: {topic}")

    assignments: list[TopicPartition] = []
    for partition_id in metadata.topics[topic].partitions:
        tp = TopicPartition(topic, partition_id)
        _, high = consumer.get_watermark_offsets(tp, timeout=10)
        assignments.append(TopicPartition(topic, partition_id, high))

    consumer.assign(assignments)


def _assign_at_recent(consumer: Any, topic: str, *, lookback_messages: int = 5000) -> None:
    """Seek near the end of each partition so recently published messages are visible."""
    from confluent_kafka import TopicPartition

    metadata = consumer.list_topics(topic, timeout=10)
    if topic not in metadata.topics:
        raise VerificationError(f"Kafka topic not found: {topic}")

    assignments: list[TopicPartition] = []
    for partition_id in metadata.topics[topic].partitions:
        tp = TopicPartition(topic, partition_id)
        low, high = consumer.get_watermark_offsets(tp, timeout=10)
        offset = max(low, high - lookback_messages)
        assignments.append(TopicPartition(topic, partition_id, offset))

    consumer.assign(assignments)


def find_kafka_message(
    payload_id: str,
    *,
    settings: Settings | None = None,
    timeout_s: float = 30.0,
    lookback_messages: int = 5000,
) -> dict[str, Any]:
    from confluent_kafka import Consumer, KafkaError

    settings = settings or get_settings()
    group_id = f"webtracking-verify-{uuid.uuid4().hex[:12]}"
    consumer = Consumer(_consumer_config(settings, group_id))

    try:
        _assign_at_recent(consumer, settings.kafka_topic, lookback_messages=lookback_messages)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                raise VerificationError(f"Kafka consumer error: {msg.error()}")

            envelope = json.loads(msg.value().decode("utf-8"))
            if isinstance(envelope, dict):
                inner = envelope.get("payload")
                if isinstance(inner, dict) and inner.get("payloadId") == payload_id:
                    validate_envelope(envelope, payload_id)
                    return envelope
    finally:
        consumer.close()

    raise VerificationError(
        f"Message with payloadId={payload_id} not found on topic {settings.kafka_topic} "
        f"within {timeout_s}s"
    )


def publish_and_find_kafka_message(
    body: dict[str, Any],
    *,
    settings: Settings | None = None,
    timeout_s: float = 30.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Subscribe at partition tail, publish, then read back the new message."""
    from confluent_kafka import Consumer, KafkaError

    settings = settings or get_settings()
    payload_id = body["payloadId"]
    group_id = f"webtracking-verify-{uuid.uuid4().hex[:12]}"
    consumer = Consumer(_consumer_config(settings, group_id))

    try:
        _assign_at_end(consumer, settings.kafka_topic)
        envelope = publish_test_payload(body, settings=settings)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                raise VerificationError(f"Kafka consumer error: {msg.error()}")

            found = json.loads(msg.value().decode("utf-8"))
            if isinstance(found, dict):
                inner = found.get("payload")
                if isinstance(inner, dict) and inner.get("payloadId") == payload_id:
                    validate_envelope(found, payload_id)
                    return envelope, found
    finally:
        consumer.close()

    raise VerificationError(
        f"Message with payloadId={payload_id} not found on topic {settings.kafka_topic} "
        f"within {timeout_s}s after publish"
    )


def publish_test_payload(
    body: dict[str, Any],
    *,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    envelope = build_kafka_envelope(body)
    publish_envelope(envelope, settings=settings)
    return envelope


def post_to_ingest_api(
    body: dict[str, Any],
    ingest_url: str,
    *,
    timeout_s: float = 30.0,
) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = request.Request(
        ingest_url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "kafka-verify/1.0"},
    )
    try:
        with request.urlopen(req, timeout=timeout_s) as resp:
            text = resp.read().decode("utf-8")
            if resp.status != 200:
                raise VerificationError(f"Ingest API returned {resp.status}: {text}")
            return json.loads(text)
    except error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise VerificationError(f"Ingest API returned {exc.code}: {text}") from exc
    except error.URLError as exc:
        raise VerificationError(f"Ingest API unreachable at {ingest_url}: {exc}") from exc


def consume_envelope_to_clickhouse(
    envelope: dict[str, Any],
    *,
    settings: Settings | None = None,
) -> tuple[str, str]:
    settings = settings or get_settings()
    payload = envelope["payload"]
    published_at_raw = envelope["published_at"]
    text = published_at_raw.replace("Z", "+00:00")
    published_at = datetime.fromisoformat(text)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)

    client = get_client()
    try:
        service = IngestService(client, settings)
        try:
            return insert_from_kafka_envelope(service, payload, published_at)
        except PayloadRejectedError as exc:
            client_org = payload.get("organization_id")
            website_id = payload.get("websiteId")
            registered_org = None
            if isinstance(website_id, int):
                registered_org = fetch_registered_organization_id(website_id)
            hint = ""
            if client_org is not None and registered_org is not None:
                hint = (
                    f" Client sent organization_id={client_org}; "
                    f"registered value for website_id={website_id} is {registered_org}."
                )
            elif registered_org is not None:
                hint = f" Registered organization_id for website_id={website_id} is {registered_org}."
            raise VerificationError(f"{exc}.{hint}") from exc
    finally:
        client.close()


def wait_for_clickhouse_row(
    payload_id: str,
    *,
    timeout_s: float = 30.0,
) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        row = fetch_clickhouse_row(payload_id)
        if row is not None:
            return row
        time.sleep(0.5)
    raise VerificationError(
        f"payload_id {payload_id} not found in raw_payloads within {timeout_s}s "
        "(is the Kafka consumer running?)"
    )


def fetch_clickhouse_row(payload_id: str) -> dict[str, Any] | None:
    client = get_client()
    try:
        result = client.query(
            """
            SELECT
                payload_id,
                website_id,
                website_url,
                visitor_id,
                payload_type,
                received_at,
                payload,
                processing_status
            FROM raw_payloads
            WHERE payload_id = {payload_id:UUID}
            LIMIT 1
            """,
            parameters={"payload_id": payload_id},
        )
        if not result.result_rows:
            return None
        cols = result.column_names
        return dict(zip(cols, result.result_rows[0]))
    finally:
        client.close()


def validate_clickhouse_row(row: dict[str, Any], expected_body: dict[str, Any]) -> None:
    expected_id = expected_body["payloadId"]
    if str(row.get("payload_id")) != expected_id:
        raise VerificationError(f"ClickHouse payload_id mismatch: {row.get('payload_id')!r}")

    stored = row.get("payload")
    if isinstance(stored, str):
        stored = json.loads(stored)
    if not isinstance(stored, dict):
        raise VerificationError("ClickHouse payload column is not JSON")

    if stored.get("payloadId") != expected_id:
        raise VerificationError("Stored payload JSON missing expected payloadId")
    if stored.get("websiteId") != expected_body.get("websiteId"):
        raise VerificationError(
            f"websiteId mismatch: CH={stored.get('websiteId')} expected={expected_body.get('websiteId')}"
        )
    if row.get("processing_status") != "accepted":
        raise VerificationError(f"unexpected processing_status: {row.get('processing_status')!r}")


def run_pipeline_verification(
    *,
    via_api: bool = False,
    ingest_url: str | None = None,
    consume_one: bool = False,
    kafka_timeout_s: float = 30.0,
    clickhouse_timeout_s: float = 30.0,
    settings: Settings | None = None,
    log: Any | None = print,
    sdk_version: str = "dnalnlafn",
    website_id: int = 12345,
    website_url: str = "https://beta.worktual.co.uk",
    organization_id: int | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    body = build_test_payload(
        sdk_version=sdk_version,
        website_id=website_id,
        website_url=website_url,
        organization_id=organization_id,
    )
    payload_id = body["payloadId"]
    org_id = body.get("organization_id")
    registered_org = fetch_registered_organization_id(website_id)
    if registered_org is not None and log:
        log(f"Registered organization_id for website_id={website_id}: {registered_org}")
    if organization_id is not None and registered_org is not None and organization_id != registered_org:
        raise VerificationError(
            f"--organization-id {organization_id} does not match registered value {registered_org} "
            f"for website_id={website_id}. Omit --organization-id to simulate the SDK (server injects org), "
            f"or pass --organization-id {registered_org}."
        )

    result: dict[str, Any] = {
        "payload_id": payload_id,
        "sdk_version": sdk_version,
        "organization_id": org_id,
        "via_api": via_api,
        "consume_one": consume_one,
        "kafka_topic": settings.kafka_topic,
        "kafka_brokers": settings.kafka_bootstrap_servers,
        "steps": {},
    }

    if via_api:
        if log:
            log(f"Step 1/4: POST test payload to ingest API (payloadId={payload_id})...")
        url = ingest_url or _default_ingest_url()
        api_response = post_to_ingest_api(body, url)
        result["steps"]["ingest_api"] = api_response
        if api_response.get("payloadId") != payload_id:
            raise VerificationError(f"Ingest API payloadId mismatch: {api_response}")
        if log:
            log("Step 2/4: Searching Kafka topic for message...")
        envelope = find_kafka_message(payload_id, settings=settings, timeout_s=kafka_timeout_s)
    else:
        if log:
            log(f"Step 1/4: Publishing to Kafka (payloadId={payload_id})...")
        published, envelope = publish_and_find_kafka_message(
            body, settings=settings, timeout_s=kafka_timeout_s
        )
        result["steps"]["kafka_publish"] = {
            "published_at": published["published_at"],
            "partition_key": str(body.get("websiteId")),
        }
        if log:
            log("Step 2/4: Kafka message verified on topic.")

    result["steps"]["kafka_verify"] = {
        "published_at": envelope["published_at"],
        "website_id": envelope["payload"].get("websiteId"),
        "organization_id": envelope["payload"].get("organization_id"),
    }

    if consume_one:
        if log:
            log("Step 3/4: Inserting into ClickHouse raw_payloads (inline consumer)...")
        ch_status = consume_envelope_to_clickhouse(envelope, settings=settings)
        result["steps"]["clickhouse_insert"] = {"status": ch_status[1]}
    else:
        result["steps"]["clickhouse_wait"] = {"timeout_s": clickhouse_timeout_s}
        if log:
            log(f"Step 3/4: Waiting up to {clickhouse_timeout_s}s for consumer → ClickHouse...")

    if log:
        log("Step 4/4: Verifying row in raw_payloads...")
    row = wait_for_clickhouse_row(payload_id, timeout_s=clickhouse_timeout_s)
    validate_clickhouse_row(row, body)
    stored_org = None
    stored_payload = row.get("payload")
    if isinstance(stored_payload, str):
        try:
            stored_org = json.loads(stored_payload).get("organization_id")
        except json.JSONDecodeError:
            pass
    elif isinstance(stored_payload, dict):
        stored_org = stored_payload.get("organization_id")
    result["steps"]["clickhouse_verify"] = {
        "website_id": row.get("website_id"),
        "visitor_id": row.get("visitor_id"),
        "payload_type": row.get("payload_type"),
        "received_at": str(row.get("received_at")),
        "organization_id": stored_org,
    }
    if via_api or consume_one:
        if stored_org is None:
            raise VerificationError(
                "organization_id missing in ClickHouse payload JSON after insert — "
                "check dict_admin_accounts for this website_id"
            )
    return result


def _default_ingest_url() -> str:
    import os

    explicit = os.environ.get("INGEST_PUBLIC_URL", "").strip()
    if explicit:
        return explicit
    port = os.environ.get("INGEST_PORT", "7860")
    return f"http://127.0.0.1:{port}/v1/tracking/nfs-ingestions"
