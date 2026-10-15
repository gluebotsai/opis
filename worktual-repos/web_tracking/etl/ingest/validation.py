"""Strict validation for POST /v1/tracking/collect payloads."""

from __future__ import annotations

import ipaddress
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from ingest.org_field import ORG_JSON_KEY, read_organization_id

MAX_BODY_BYTES = int(os.environ.get("INGEST_MAX_BODY_BYTES", "524288"))
MAX_REPLAY_BODY_BYTES = int(os.environ.get("INGEST_MAX_REPLAY_BODY_BYTES", "2097152"))
MAX_EVENTS = int(os.environ.get("INGEST_MAX_EVENTS", "100"))
MAX_WEBSITE_URL_LEN = 512
MAX_ID_LEN = 64
MAX_EVENT_ID_LEN = 128
MAX_EVENT_NAME_LEN = 64
MAX_PROPERTIES_KEYS = 50
MAX_STRING_LEN = 2000
MAX_NEST_DEPTH = 4
MAX_TIMESTAMP_MS = 86_400_000 * 7
MAX_FUTURE_MS = 300_000

ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
EVENT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
EVENT_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
HOSTNAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9.-]{0,254}$")

ALLOWED_CHANNELS = frozenset({"web", "android", "ios"})

KNOWN_EVENT_NAMES = frozenset(
    {
        "page_view",
        "click",
        "move",
        "scroll",
        "scroll_depth",
        "rage_click",
        "dead_click",
        "hover",
        "form_view",
        "form_start",
        "form_focus",
        "form_blur",
        "form_change",
        "form_validation",
        "form_submit",
        "form_success",
        "form_failure",
        "form_abandon",
        "performance_lcp",
        "performance_cls",
        "performance_inp",
        "performance_fcp",
        "performance_navigation",
        "performance_resource",
        "performance_long_task",
        "performance_memory",
        "error",
        "product_view",
        "add_to_cart",
        "remove_from_cart",
        "add_to_wishlist",
        "remove_from_wishlist",
        "begin_checkout",
        "payment_failure",
        "purchase",
        "refund",
        "identify",
        "alias",
        "group",
        "login",
        "logout",
        "register",
        "signup",
        "user_properties",
        "user_active",
        "user_idle",
        "page_visible",
        "page_hidden",
        "scroll_milestone",
        "page_transition",
        "heartbeat",
        "performance_vitals",
        "outbound_link",
        "file_download",
        "site_search",
        "product_rating",
        # Mobile app tracking (docs/APP_TRACKING_AGENT_PAYLOAD_IDENTITY_READONLY.md)
        "screen_view",
        "screen_leave",
        "tap",
        "long_press",
        "app_open",
        "app_background",
        "app_foreground",
        "app_error",
        "crash",
        "screen_load",
        "app_start",
    }
)


class PayloadValidationError(ValueError):
    """Raised when a collect payload fails business validation."""


def website_url_key(url: str) -> str:
    """Normalize website URL for dict comparison (full URL or hostname)."""
    cleaned = url.strip().rstrip("/").lower()
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        parsed = urlparse(cleaned)
        host = parsed.netloc or parsed.path.split("/")[0]
        path = parsed.path.rstrip("/") if parsed.path and parsed.path != "/" else ""
        return f"{host}{path}"
    return cleaned


def _sanitize_string(value: Any, field: str, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise PayloadValidationError(f"{field} must be a string")
    cleaned = value.strip()
    if not cleaned:
        if required:
            raise PayloadValidationError(f"{field} must not be empty")
        return ""
    if len(cleaned) > MAX_STRING_LEN:
        cleaned = cleaned[:MAX_STRING_LEN]
    if "<script" in cleaned.lower() or "javascript:" in cleaned.lower():
        raise PayloadValidationError(f"{field} contains disallowed content")
    return cleaned


def _sanitize_properties(value: Any, field: str = "properties", depth: int = 0) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise PayloadValidationError(f"{field} must be an object")
    if depth > MAX_NEST_DEPTH:
        raise PayloadValidationError(f"{field} exceeds maximum nesting depth")
    if len(value) > MAX_PROPERTIES_KEYS:
        raise PayloadValidationError(f"{field} exceeds maximum key count ({MAX_PROPERTIES_KEYS})")

    cleaned: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key:
            raise PayloadValidationError(f"{field} contains an invalid key")
        if len(key) > 128:
            raise PayloadValidationError(f"{field} key too long: {key[:32]}...")
        cleaned[key] = _sanitize_value(item, f"{field}.{key}", depth + 1)
    return cleaned


def _sanitize_value(value: Any, field: str, depth: int) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _sanitize_string(value, field, required=False)
    if isinstance(value, list):
        if len(value) > MAX_PROPERTIES_KEYS:
            raise PayloadValidationError(f"{field} list too long")
        return [_sanitize_value(item, field, depth + 1) for item in value]
    if isinstance(value, dict):
        return _sanitize_properties(value, field, depth)
    raise PayloadValidationError(f"{field} contains unsupported value type")


def validate_id(value: str, field: str) -> str:
    cleaned = _sanitize_string(value, field)
    if len(cleaned) > MAX_ID_LEN:
        raise PayloadValidationError(f"{field} exceeds maximum length ({MAX_ID_LEN})")
    if not ID_PATTERN.match(cleaned):
        raise PayloadValidationError(f"{field} has invalid format")
    return cleaned


def validate_event_id(value: str) -> str:
    cleaned = _sanitize_string(value, "eventId")
    if len(cleaned) > MAX_EVENT_ID_LEN:
        raise PayloadValidationError(f"eventId exceeds maximum length ({MAX_EVENT_ID_LEN})")
    if not EVENT_ID_PATTERN.match(cleaned):
        raise PayloadValidationError("eventId has invalid format")
    return cleaned


def validate_event_name(value: str) -> str:
    cleaned = _sanitize_string(value, "name")
    if len(cleaned) > MAX_EVENT_NAME_LEN:
        raise PayloadValidationError(f"event name exceeds maximum length ({MAX_EVENT_NAME_LEN})")
    if cleaned in KNOWN_EVENT_NAMES:
        return cleaned
    if EVENT_NAME_PATTERN.match(cleaned):
        return cleaned
    raise PayloadValidationError(f"unsupported event name: {cleaned}")


def validate_event_mode(name: str, raw_value: Any) -> str | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, str):
        raise PayloadValidationError("event_mode must be a string")
    cleaned = _sanitize_string(raw_value, "event_mode")
    if cleaned != "custom":
        raise PayloadValidationError("event_mode must be 'custom' when provided")
    if name in KNOWN_EVENT_NAMES:
        raise PayloadValidationError(f"event_mode is not allowed on built-in event: {name}")
    return cleaned


def _apply_event_mode(name: str, raw: dict[str, Any], event: dict[str, Any]) -> None:
    event_mode = validate_event_mode(name, raw.get("event_mode"))
    if event_mode is not None:
        event["event_mode"] = event_mode


def validate_timestamp(value: int, sent_at: int | None = None) -> int:
    if not isinstance(value, int):
        raise PayloadValidationError("timestamp must be an integer (milliseconds)")
    if value <= 0:
        raise PayloadValidationError("timestamp must be positive")
    server_now = int(datetime.now(timezone.utc).timestamp() * 1000)
    if sent_at and sent_at > 0:
        reference = min(sent_at, server_now)
    else:
        reference = server_now
    if value - reference > MAX_FUTURE_MS:
        raise PayloadValidationError("timestamp too far in the future")
    if reference - value > MAX_TIMESTAMP_MS:
        raise PayloadValidationError("timestamp too far in the past")
    if value > server_now:
        return server_now
    return value


def validate_event(raw: dict[str, Any], sent_at: int | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadValidationError("each event must be an object")

    event_id = validate_event_id(str(raw.get("eventId", "")))
    name = validate_event_name(str(raw.get("name", "")))
    timestamp = validate_timestamp(raw.get("timestamp"), sent_at)

    properties = _sanitize_properties(raw.get("properties") or {}, "properties")
    context = raw.get("context")
    sanitized_context = None
    if context is not None:
        sanitized_context = _sanitize_properties(context, "context")

    event = {
        "eventId": event_id,
        "name": name,
        "timestamp": timestamp,
        "properties": properties,
        **({"context": sanitized_context} if sanitized_context is not None else {}),
    }
    return _finalize_validated_event(name, raw, event)


def validate_event_v3(raw: dict[str, Any], sent_at: int | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadValidationError("each event must be an object")

    event_id = validate_event_id(str(raw.get("eventId", "")))
    name = validate_event_name(str(raw.get("name", "")))
    timestamp = raw.get("ts", raw.get("timestamp"))
    timestamp = validate_timestamp(int(timestamp), sent_at)

    props = raw.get("props", raw.get("properties"))
    sanitized_props = _sanitize_properties(props or {}, "props")

    event: dict[str, Any] = {
        "eventId": event_id,
        "name": name,
        "ts": timestamp,
    }
    if sanitized_props:
        event["props"] = sanitized_props
    for ref in ("pid", "sid", "cid"):
        if ref in raw and raw[ref] is not None:
            event[ref] = validate_id(str(raw[ref]), ref)
    return _finalize_validated_event(name, raw, event)


def _finalize_validated_event(name: str, raw: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    _apply_event_mode(name, raw, event)
    return event


def _sanitize_profiles(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise PayloadValidationError("profiles must be an object")
    return _sanitize_properties(value, "profiles", depth=0)


def validate_uuid(value: str, field: str) -> str:
    cleaned = _sanitize_string(value, field)
    if not UUID_PATTERN.match(cleaned):
        raise PayloadValidationError(f"{field} must be a valid UUID")
    return cleaned.lower()


def validate_client_ip(value: str) -> str:
    cleaned = _sanitize_string(value, "clientIp", required=True)
    if cleaned.lower().startswith("::ffff:"):
        cleaned = cleaned[7:]
    try:
        return str(ipaddress.ip_address(cleaned))
    except ValueError as exc:
        raise PayloadValidationError("clientIp must be a valid IPv4 or IPv6 address") from exc


def _apply_optional_client_ip(body: dict[str, Any], sanitized: dict[str, Any]) -> None:
    if "clientIp" in body and body["clientIp"] is not None:
        sanitized["clientIp"] = validate_client_ip(str(body["clientIp"]))


def validate_website_url(value: str) -> str:
    cleaned = _sanitize_string(value, "websiteUrl")
    if len(cleaned) > MAX_WEBSITE_URL_LEN:
        cleaned = cleaned[:MAX_WEBSITE_URL_LEN]
    if cleaned.lower().startswith(("http://", "https://")):
        parsed = urlparse(cleaned)
        if not parsed.netloc and not parsed.path:
            raise PayloadValidationError("websiteUrl has invalid format")
        return cleaned.rstrip("/")
    if HOSTNAME_PATTERN.match(cleaned):
        return cleaned
    raise PayloadValidationError("websiteUrl has invalid format")


def _validate_website_fields(body: dict[str, Any]) -> tuple[int, str, str, str, int | None]:
    website_id = body.get("websiteId", body.get("domainId"))
    if not isinstance(website_id, int) or website_id <= 0:
        raise PayloadValidationError("websiteId must be a positive integer")

    website_url_raw = body.get("websiteUrl", body.get("domainName", ""))
    website_url = validate_website_url(str(website_url_raw))

    visitor_id = validate_id(str(body.get("visitorId", "")), "visitorId")
    session_id = validate_id(str(body.get("sessionId", "")), "sessionId")

    organization_id = None
    try:
        organization_id = read_organization_id(body)
    except ValueError as exc:
        raise PayloadValidationError(str(exc)) from exc

    return website_id, website_url, visitor_id, session_id, organization_id


def _apply_common_optional_fields(body: dict[str, Any], sanitized: dict[str, Any]) -> None:
    for optional_field, alias in (
        ("userId", "userId"),
        ("anonymousId", "anonymousId"),
        ("sdkVersion", "sdkVersion"),
        ("sentAt", "sentAt"),
        ("payloadId", "payloadId"),
    ):
        if alias in body and body[alias] is not None:
            if alias in {"userId", "anonymousId"}:
                sanitized[alias] = validate_id(str(body[alias]), alias)
            elif alias == "sdkVersion":
                sanitized[alias] = _sanitize_string(str(body[alias]), alias)[:32]
            elif alias == "sentAt":
                sanitized[alias] = int(body[alias])
            else:
                sanitized[alias] = str(body[alias])
    _apply_optional_client_ip(body, sanitized)
    _apply_channel_and_os(body, sanitized)


def _apply_channel_and_os(body: dict[str, Any], sanitized: dict[str, Any]) -> None:
    """Keep top-level channel/os in stored payload (staging_sync + mv_parse_events read these)."""
    channel_raw = body.get("channel")
    if channel_raw is None and isinstance(body.get("profiles"), dict):
        app = body["profiles"].get("app")
        if isinstance(app, dict):
            channel_raw = app.get("channel")
    if channel_raw is not None:
        channel = _sanitize_string(str(channel_raw), "channel").lower()
        if channel not in ALLOWED_CHANNELS:
            raise PayloadValidationError("channel must be one of: web, android, ios")
        sanitized["channel"] = channel
    os_raw = body.get("os")
    if os_raw is not None:
        sanitized["os"] = _sanitize_string(str(os_raw), "os")[:32]


def validate_collect_body(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise PayloadValidationError("payload must be a JSON object")

    payload_type = body.get("type", "events_v2")
    if payload_type not in {"events_v2", "events_v3"}:
        raise PayloadValidationError("type must be 'events_v2' or 'events_v3'")

    website_id, website_url, visitor_id, session_id, organization_id = _validate_website_fields(body)

    events_raw = body.get("events")
    if not isinstance(events_raw, list):
        raise PayloadValidationError("events must be an array")
    if len(events_raw) == 0:
        raise PayloadValidationError("events must contain at least one event")
    if len(events_raw) > MAX_EVENTS:
        raise PayloadValidationError(f"events exceeds maximum batch size ({MAX_EVENTS})")

    sent_at = body.get("sentAt")
    if sent_at is not None and (not isinstance(sent_at, int) or sent_at <= 0):
        raise PayloadValidationError("sentAt must be a positive integer when provided")

    sent_ref = sent_at if isinstance(sent_at, int) else None
    if payload_type == "events_v3":
        events = [validate_event_v3(event, sent_ref) for event in events_raw]
    else:
        events = [validate_event(event, sent_ref) for event in events_raw]

    sanitized: dict[str, Any] = {
        "websiteId": website_id,
        "websiteUrl": website_url,
        "visitorId": visitor_id,
        "sessionId": session_id,
        "type": payload_type,
        "events": events,
    }
    if organization_id is not None:
        sanitized[ORG_JSON_KEY] = organization_id

    profiles = _sanitize_profiles(body.get("profiles"))
    if profiles:
        sanitized["profiles"] = profiles

    _apply_common_optional_fields(body, sanitized)
    return sanitized


ALLOWED_REPLAY_ENCODINGS = frozenset({"gzip_b64"})


def validate_replay_chunk_body(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise PayloadValidationError("payload must be a JSON object")

    payload_type = body.get("type")
    if payload_type != "replay_chunk_v1":
        raise PayloadValidationError("type must be 'replay_chunk_v1'")

    website_id, website_url, visitor_id, session_id, organization_id = _validate_website_fields(body)
    page_view_id = validate_id(str(body.get("pageViewId", "")), "pageViewId")

    chunk_index = body.get("chunkIndex")
    if not isinstance(chunk_index, int) or chunk_index < 0:
        raise PayloadValidationError("chunkIndex must be a non-negative integer")

    chunk_id = validate_uuid(str(body.get("chunkId", "")), "chunkId")

    encoding = _sanitize_string(str(body.get("encoding", "")), "encoding")
    if encoding not in ALLOWED_REPLAY_ENCODINGS:
        raise PayloadValidationError("encoding must be 'gzip_b64'")

    events_data = body.get("eventsData")
    if not isinstance(events_data, str) or not events_data.strip():
        raise PayloadValidationError("eventsData must be a non-empty string")
    if len(events_data) > MAX_REPLAY_BODY_BYTES:
        raise PayloadValidationError(
            f"eventsData exceeds maximum size ({MAX_REPLAY_BODY_BYTES} bytes)"
        )

    event_count = body.get("eventCount")
    if not isinstance(event_count, int) or event_count <= 0:
        raise PayloadValidationError("eventCount must be a positive integer")

    source = _sanitize_string(str(body.get("source", "rrweb")), "source")[:32]

    sanitized: dict[str, Any] = {
        "type": payload_type,
        "websiteId": website_id,
        "websiteUrl": website_url,
        "visitorId": visitor_id,
        "sessionId": session_id,
        "pageViewId": page_view_id,
        "chunkIndex": chunk_index,
        "chunkId": chunk_id,
        "encoding": encoding,
        "eventsData": events_data.strip(),
        "eventCount": event_count,
        "source": source,
    }
    if organization_id is not None:
        sanitized[ORG_JSON_KEY] = organization_id

    if "payloadId" in body and body["payloadId"] is not None:
        sanitized["payloadId"] = validate_uuid(str(body["payloadId"]), "payloadId")

    _apply_optional_client_ip(body, sanitized)
    return sanitized
