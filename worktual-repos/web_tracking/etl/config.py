import os
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.env import load_project_env

load_project_env()

INGEST_WRITE_MODES = frozenset({"direct", "kafka", "dual"})


@dataclass(frozen=True)
class Settings:
    ip_hash_salt: str
    geoip_db_path: str | None
    geoip_http_fallback: bool
    ingest_upstream_url: str | None
    reverse_geocode_enabled: bool
    reverse_geocode_url: str
    reverse_geocode_user_agent: str
    reverse_geocode_timeout: float
    ingest_write_mode: str
    kafka_bootstrap_servers: str
    kafka_topic: str
    kafka_client_id: str
    kafka_consumer_group: str
    kafka_security_protocol: str | None
    kafka_sasl_mechanism: str | None
    kafka_sasl_username: str | None
    kafka_sasl_password: str | None
    redis_url: str | None
    live_presence_enabled: bool
    live_presence_ttl_seconds: int


def get_settings() -> Settings:
    upstream = os.environ.get("INGEST_UPSTREAM_URL", "").strip() or None
    write_mode = os.environ.get("INGEST_WRITE_MODE", "direct").strip().lower()
    if write_mode not in INGEST_WRITE_MODES:
        write_mode = "direct"

    def _optional(name: str) -> str | None:
        value = os.environ.get(name, "").strip()
        return value or None

    return Settings(
        ip_hash_salt=os.environ.get("IP_HASH_SALT", "webtracking-default-salt"),
        geoip_db_path=os.environ.get("GEOIP_DB_PATH") or None,
        geoip_http_fallback=os.environ.get("GEOIP_HTTP_FALLBACK", "true").lower()
        in ("1", "true", "yes"),
        ingest_upstream_url=upstream,
        reverse_geocode_enabled=os.environ.get("REVERSE_GEOCODE_ENABLED", "true").lower()
        in ("1", "true", "yes"),
        reverse_geocode_url=os.environ.get(
            "REVERSE_GEOCODE_URL",
            "https://nominatim.openstreetmap.org/reverse",
        ).strip(),
        reverse_geocode_user_agent=os.environ.get(
            "REVERSE_GEOCODE_USER_AGENT",
            "WorktualWebTracking/1.0 (contact: support@worktual.com)",
        ).strip(),
        reverse_geocode_timeout=float(os.environ.get("REVERSE_GEOCODE_TIMEOUT", "5")),
        ingest_write_mode=write_mode,
        kafka_bootstrap_servers=os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "192.168.13.207:9092"),
        kafka_topic=os.environ.get("KAFKA_TOPIC", "cdp.ingestion.webtracking"),
        kafka_client_id=os.environ.get("KAFKA_CLIENT_ID", "webtracking-ingest"),
        kafka_consumer_group=os.environ.get("KAFKA_CONSUMER_GROUP", "webtracking-ch-writer"),
        kafka_security_protocol=_optional("KAFKA_SECURITY_PROTOCOL"),
        kafka_sasl_mechanism=_optional("KAFKA_SASL_MECHANISM"),
        kafka_sasl_username=_optional("KAFKA_SASL_USERNAME"),
        kafka_sasl_password=_optional("KAFKA_SASL_PASSWORD"),
        redis_url=_optional("REDIS_URL"),
        live_presence_enabled=_live_presence_enabled(_optional("REDIS_URL")),
        live_presence_ttl_seconds=int(os.environ.get("LIVE_PRESENCE_TTL_SECONDS", "300")),
    )


def _live_presence_enabled(redis_url: str | None) -> bool:
    if not redis_url:
        return False
    raw = os.environ.get("LIVE_PRESENCE_ENABLED", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def uses_kafka(settings: Settings | None = None) -> bool:
    mode = (settings or get_settings()).ingest_write_mode
    return mode in {"kafka", "dual"}


def uses_direct_clickhouse(settings: Settings | None = None) -> bool:
    mode = (settings or get_settings()).ingest_write_mode
    return mode in {"direct", "dual"}
