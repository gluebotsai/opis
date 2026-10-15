import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from config import Settings, get_settings, uses_direct_clickhouse, uses_kafka
from ingest.geoip import enrich_geo
from ingest.geo_merge import merge_client_location
from ingest.schemas import CollectRequest, ReplayChunkRequest
from ingest.org_field import ORG_JSON_KEY, read_organization_id, set_organization_id
from ingest.validation import website_url_key
from kafka.producer import KafkaPublishError, build_kafka_envelope, publish_envelope
from ingest.staging_sync import sync_staging_for_payload
from ingest.live_commerce import maybe_update_live_commerce
from ingest.live_presence import maybe_update_live_presence

logger = logging.getLogger(__name__)


class PayloadRejectedError(ValueError):
    """Business rule rejected the payload after schema validation."""


class WebsiteNotRegisteredError(PayloadRejectedError):
    """website_id is not registered for ingestion."""


class DomainNotRegisteredError(WebsiteNotRegisteredError):
    """Backward-compatible alias."""


@dataclass(frozen=True)
class PreparedIngest:
    payload_id: str
    website_id: int
    website_url: str
    visitor_id: str
    payload_type: str
    body: dict[str, Any]
    client_ip: Optional[str]
    user_agent: Optional[str]


def _website_id_from_body(body: dict[str, Any]) -> int:
    raw = body.get("websiteId", body.get("domainId"))
    if not isinstance(raw, int) or raw <= 0:
        raise PayloadRejectedError("payload missing websiteId")
    return raw


def _website_url_from_body(body: dict[str, Any]) -> str:
    raw = body.get("websiteUrl", body.get("domainName"))
    if not isinstance(raw, str) or not raw.strip():
        raise PayloadRejectedError("payload missing websiteUrl")
    return raw.strip()


class IngestService:
    def __init__(self, ch_client: Any, settings: Settings | None = None):
        self.client = ch_client
        self.settings = settings or get_settings()
        db = os.environ.get("CLICKHOUSE_DATABASE", "web_tracking")
        self._dict_name = f"{db}.dict_admin_accounts"

    def _load_admin_for_website(self, website_id: int, website_url: str) -> dict[str, Any]:
        row = self.client.query(
            f"""
            SELECT
                dictHas('{self._dict_name}', toUInt64({{d:UInt32}})) AS found,
                dictGet('{self._dict_name}', 'website_url', toUInt64({{d:UInt32}})) AS website_url,
                dictGet('{self._dict_name}', 'status', toUInt64({{d:UInt32}})) AS status,
                dictGet('{self._dict_name}', 'is_active', toUInt64({{d:UInt32}})) AS is_active,
                dictGet('{self._dict_name}', 'organization_id', toUInt64({{d:UInt32}})) AS organization_id
            """,
            parameters={"d": website_id},
        ).result_rows[0]

        found, dict_website_url, status, is_active, organization_id = row
        if not found or not is_active or str(status).lower() != "active":
            raise WebsiteNotRegisteredError(
                f"website_id {website_id} is not registered or inactive"
            )
        if website_url_key(dict_website_url) != website_url_key(website_url):
            raise WebsiteNotRegisteredError(
                f"website_url mismatch for website_id {website_id}"
            )

        org_id: int | None = int(organization_id) if organization_id else None
        if org_id == 0:
            org_id = None
        return {"organization_id": org_id, "website_url": dict_website_url}

    def _payload_exists(self, payload_id: str) -> bool:
        rows = self.client.query(
            """
            SELECT 1 FROM raw_payloads
            WHERE payload_id = {payload_id:UUID}
            LIMIT 1
            """,
            parameters={"payload_id": payload_id},
        ).result_rows
        return bool(rows)

    @staticmethod
    def _apply_geo(body: dict[str, Any], client_ip: Optional[str], settings: Settings) -> None:
        if not client_ip:
            return
        geo = enrich_geo(client_ip, settings)
        geo["location_source"] = "client_ip"
        body["_geo"] = geo

    @staticmethod
    def _apply_organization_id(body: dict[str, Any], admin: dict[str, Any]) -> None:
        server_org = admin.get("organization_id")
        try:
            client_org = read_organization_id(body)
        except ValueError as exc:
            raise PayloadRejectedError(str(exc)) from exc
        if server_org:
            if client_org is not None and int(client_org) != int(server_org):
                raise PayloadRejectedError(f"{ORG_JSON_KEY} does not match registered website")
            set_organization_id(body, int(server_org))
        elif client_org is not None:
            set_organization_id(body, client_org)

    def enrich_body_from_website_registry(self, body: dict[str, Any]) -> tuple[int, str]:
        """Validate website_id + website_url and inject organization_id from admin dict."""
        website_id = _website_id_from_body(body)
        website_url = _website_url_from_body(body)
        admin = self._load_admin_for_website(website_id, website_url)
        self._apply_organization_id(body, admin)
        canonical_url = admin.get("website_url") or website_url
        body["websiteUrl"] = canonical_url
        return website_id, canonical_url

    def insert_raw(
        self,
        payload_id: str,
        website_id: int,
        website_url: str,
        visitor_id: str,
        payload_type: str,
        body: dict[str, Any],
        client_ip: Optional[str],
        user_agent: Optional[str],
        *,
        received_at: datetime | None = None,
        skip_duplicate_check: bool = False,
    ) -> tuple[str, str]:
        if not skip_duplicate_check and self._payload_exists(payload_id):
            return payload_id, "duplicate"

        now = received_at or datetime.now(timezone.utc)
        ingested_at = datetime.now(timezone.utc)
        self.client.insert(
            "raw_payloads",
            [[
                payload_id,
                website_id,
                website_url,
                visitor_id,
                payload_type,
                client_ip or "",
                user_agent or "",
                now,
                json.dumps(body, separators=(",", ":"), ensure_ascii=False),
                "accepted",
                ingested_at,
            ]],
            column_names=[
                "payload_id",
                "website_id",
                "website_url",
                "visitor_id",
                "payload_type",
                "source_ip",
                "user_agent",
                "received_at",
                "payload",
                "processing_status",
                "ingested_at",
            ],
        )
        if payload_type in ("events_v2", "events_v3"):
            try:
                sync_staging_for_payload(self.client, payload_id)
            except Exception:
                logger.exception("staging_sync failed for payload_id=%s", payload_id)
                raise
        return payload_id, "accepted"

    def insert_prepared(
        self,
        prepared: PreparedIngest,
        *,
        received_at: datetime | None = None,
        skip_duplicate_check: bool = False,
    ) -> tuple[str, str]:
        return self.insert_raw(
            prepared.payload_id,
            prepared.website_id,
            prepared.website_url,
            prepared.visitor_id,
            prepared.payload_type,
            prepared.body,
            prepared.client_ip,
            prepared.user_agent,
            received_at=received_at,
            skip_duplicate_check=skip_duplicate_check,
        )

    def prepare_collect(
        self,
        payload: CollectRequest,
        user_agent: Optional[str],
    ) -> PreparedIngest:
        if payload.type not in {"events_v2", "events_v3"}:
            raise PayloadRejectedError(f"unsupported payload type: {payload.type}")

        admin = self._load_admin_for_website(payload.website_id, payload.website_url)

        payload_id = str(payload.payload_id or uuid4())
        body = payload.model_dump(mode="json", by_alias=True, exclude_none=True)
        body["payloadId"] = payload_id
        body["type"] = payload.type
        self._apply_organization_id(body, admin)

        client_ip = payload.client_ip
        self._apply_geo(body, client_ip, self.settings)
        merge_client_location(body, self.settings)

        return PreparedIngest(
            payload_id=payload_id,
            website_id=payload.website_id,
            website_url=admin.get("website_url") or payload.website_url,
            visitor_id=payload.visitor_id,
            payload_type=payload.type,
            body=body,
            client_ip=client_ip,
            user_agent=user_agent,
        )

    def prepare_replay_chunk(
        self,
        payload: ReplayChunkRequest,
        user_agent: Optional[str],
    ) -> PreparedIngest:
        if payload.type != "replay_chunk_v1":
            raise PayloadRejectedError(f"unsupported payload type: {payload.type}")

        admin = self._load_admin_for_website(payload.website_id, payload.website_url)

        payload_id = str(payload.payload_id or uuid4())
        body = payload.model_dump(mode="json", by_alias=True, exclude_none=True)
        body["payloadId"] = payload_id
        body["type"] = payload.type
        self._apply_organization_id(body, admin)

        client_ip = payload.client_ip
        self._apply_geo(body, client_ip, self.settings)

        return PreparedIngest(
            payload_id=payload_id,
            website_id=payload.website_id,
            website_url=admin.get("website_url") or payload.website_url,
            visitor_id=payload.visitor_id,
            payload_type=payload.type,
            body=body,
            client_ip=client_ip,
            user_agent=user_agent,
        )

    def write_prepared(self, prepared: PreparedIngest) -> tuple[str, str]:
        if self._payload_exists(prepared.payload_id):
            return prepared.payload_id, "duplicate"

        envelope = build_kafka_envelope(prepared.body)
        published_at = datetime.fromisoformat(envelope["published_at"])

        if prepared.payload_type in ("events_v2", "events_v3"):
            maybe_update_live_presence(prepared.body, self.settings)
            maybe_update_live_commerce(prepared.body, self.settings)

        if uses_kafka(self.settings):
            publish_envelope(envelope, settings=self.settings)

        if uses_direct_clickhouse(self.settings):
            # Live Users only needs Redis+SSE above. Ack before ClickHouse so the
            # SDK flush returns in ~ms instead of waiting on CH insert (~2–3s).
            fast_ack = os.environ.get("INGEST_FAST_ACK", "true").strip().lower() not in (
                "0",
                "false",
                "no",
                "off",
            )
            if fast_ack and prepared.payload_type in ("events_v2", "events_v3"):
                self._insert_prepared_bg(prepared, published_at)
                return prepared.payload_id, "accepted"
            return self.insert_prepared(prepared, received_at=published_at)

        return prepared.payload_id, "accepted"

    def _insert_prepared_bg(self, prepared: PreparedIngest, published_at: datetime) -> None:
        def _run() -> None:
            from shared.clickhouse import get_client

            client = get_client()
            try:
                IngestService(client, self.settings).insert_prepared(
                    prepared, received_at=published_at
                )
            except Exception as exc:
                logger.warning("background ClickHouse insert failed: %s", exc)
            finally:
                try:
                    client.close()
                except Exception:
                    pass

        threading.Thread(target=_run, name="ingest-ch-bg", daemon=True).start()

    def ingest(
        self,
        payload: CollectRequest,
        user_agent: Optional[str],
    ) -> tuple[str, str]:
        prepared = self.prepare_collect(payload, user_agent)
        return self.write_prepared(prepared)

    def ingest_replay_chunk(
        self,
        payload: ReplayChunkRequest,
        user_agent: Optional[str],
    ) -> tuple[str, str]:
        prepared = self.prepare_replay_chunk(payload, user_agent)
        return self.write_prepared(prepared)

    @staticmethod
    def parse_body(raw: dict[str, Any]) -> CollectRequest:
        return CollectRequest.from_validated_body(raw)


def insert_from_kafka_envelope(
    service: IngestService,
    body: dict[str, Any],
    published_at: datetime,
) -> tuple[str, str]:
    payload_id = str(body.get("payloadId") or uuid4())
    body["payloadId"] = payload_id
    payload_type = str(body.get("type") or "events_v3")
    visitor_id = str(body.get("visitorId") or "")

    website_id, website_url = service.enrich_body_from_website_registry(body)

    prepared = PreparedIngest(
        payload_id=payload_id,
        website_id=website_id,
        website_url=website_url,
        visitor_id=visitor_id,
        payload_type=payload_type,
        body=body,
        client_ip=body.get("clientIp"),
        user_agent=None,
    )
    return service.insert_prepared(prepared, received_at=published_at)


__all__ = [
    "DomainNotRegisteredError",
    "IngestService",
    "KafkaPublishError",
    "PayloadRejectedError",
    "PreparedIngest",
    "WebsiteNotRegisteredError",
    "insert_from_kafka_envelope",
]
