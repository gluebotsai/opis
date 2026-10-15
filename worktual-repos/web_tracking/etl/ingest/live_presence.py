"""Redis live presence for dashboard /api/analytics/live (hot path)."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from config import Settings, get_settings

logger = logging.getLogger(__name__)

_CLIENT: Any = None
_CLIENT_URL: str | None = None

EVENTS_TYPES = frozenset({"events_v2", "events_v3"})


def _redis_client(redis_url: str) -> Any:
    global _CLIENT, _CLIENT_URL
    if _CLIENT is not None and _CLIENT_URL == redis_url:
        return _CLIENT
    import redis

    _CLIENT = redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=2)
    _CLIENT_URL = redis_url
    return _CLIENT


def _nested(obj: Any, *keys: str) -> Any:
    cur = obj
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _country_from_body(body: dict[str, Any]) -> str:
    geo = body.get("_geo")
    if isinstance(geo, dict):
        country = geo.get("country") or geo.get("countryCode")
        if country:
            return str(country).strip().upper()[:8]
    profiles = body.get("profiles")
    if isinstance(profiles, dict):
        loc = profiles.get("location")
        if isinstance(loc, dict):
            country = loc.get("country") or loc.get("countryCode")
            if country:
                return str(country).strip().upper()[:8]
    return ""


def _session_id_from_body(body: dict[str, Any]) -> str:
    sid = body.get("sessionId") or body.get("session_id")
    if sid:
        return str(sid).strip()
    profiles = body.get("profiles")
    if isinstance(profiles, dict):
        session = profiles.get("session")
        if isinstance(session, dict) and session.get("id"):
            return str(session["id"]).strip()
    return ""


def _norm_path(raw: Any) -> str:
    if raw is None:
        return ""
    return str(raw).strip()[:2048]


def _path_from_props(props: Any) -> str:
    if not isinstance(props, dict):
        return ""
    return _norm_path(props.get("path") or props.get("pagePath") or props.get("page_path"))


def _pages_index(body: dict[str, Any]) -> dict[str, Any]:
    profiles = body.get("profiles")
    if not isinstance(profiles, dict):
        return {}
    pages = profiles.get("pages")
    return pages if isinstance(pages, dict) else {}


def _event_path(event: dict[str, Any], pages: dict[str, Any]) -> str:
    props = event.get("properties") or event.get("props") or {}
    path = _path_from_props(props)
    if path:
        return path
    pid = event.get("pid") or event.get("pageId")
    if pid is None:
        return ""
    page = pages.get(str(pid))
    if page is None:
        page = pages.get(pid)
    if isinstance(page, dict):
        return _norm_path(page.get("path"))
    return ""


def _event_ts(event: dict[str, Any]) -> int:
    ts = event.get("ts") or event.get("timestamp") or 0
    try:
        return int(ts)
    except (TypeError, ValueError):
        return 0


def _event_name(event: dict[str, Any]) -> str:
    return str(event.get("name") or event.get("event") or "").strip()


def _page_view_from_body(body: dict[str, Any]) -> tuple[str, int]:
    """Latest page_view path and its event ts. Ignores heartbeat/click/scroll paths."""
    pages = _pages_index(body)
    events = body.get("events")
    best_path = ""
    best_ts = -1
    if isinstance(events, list):
        for event in events:
            if not isinstance(event, dict):
                continue
            if _event_name(event) != "page_view":
                continue
            path = _event_path(event, pages)
            if not path:
                continue
            ts = _event_ts(event)
            if ts >= best_ts:
                best_ts = ts
                best_path = path
    return best_path, (best_ts if best_ts >= 0 else 0)


def _current_page_from_body(body: dict[str, Any]) -> str:
    path, _ts = _page_view_from_body(body)
    return path


def _last_activity_ms(body: dict[str, Any]) -> int:
    now_ms = int(time.time() * 1000)
    max_ts = 0
    events = body.get("events")
    if isinstance(events, list):
        for event in events:
            if not isinstance(event, dict):
                continue
            ts = event.get("ts") or event.get("timestamp")
            if isinstance(ts, (int, float)) and ts > 0:
                max_ts = max(max_ts, int(ts))
    sent_at = body.get("sentAt")
    if isinstance(sent_at, (int, float)) and sent_at > 0:
        max_ts = max(max_ts, int(sent_at))
    return max_ts if max_ts > 0 else now_ms


def _as_positive_int(raw: Any) -> int | None:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def extract_live_fields(body: dict[str, Any]) -> dict[str, Any] | None:
    """Parse v3/v2 collect body into live presence fields."""
    website_id = _as_positive_int(body.get("websiteId") or body.get("website_id"))
    if website_id is None:
        return None
    visitor_id = str(body.get("visitorId") or body.get("visitor_id") or "").strip()
    session_id = _session_id_from_body(body)
    if not visitor_id or not session_id:
        return None
    current_page, current_page_ts = _page_view_from_body(body)
    return {
        "website_id": website_id,
        "visitor_id": visitor_id,
        "session_id": session_id,
        "current_page": current_page,
        "current_page_ts": current_page_ts,
        "country": _country_from_body(body),
        "last_activity_ms": _last_activity_ms(body),
        "organization_id": body.get("organizationId") or body.get("organization_id"),
    }


def _sessions_zkey(website_id: int) -> str:
    return f"wt:live:{website_id}:sessions"


def _session_hash_key(website_id: int, session_id: str) -> str:
    return f"wt:live:{website_id}:session:{session_id}"


def _visitor_session_key(website_id: int, visitor_id: str) -> str:
    return f"wt:live:{website_id}:visitor:{visitor_id}"


def resolve_stored_page(
    existing_page: str,
    existing_page_ts: int,
    incoming_page: str,
    incoming_page_ts: int,
) -> tuple[str, int, bool]:
    """Apply a page_view only when its ts is at least as new as the stored page."""
    existing_page = (existing_page or "").strip()
    incoming_page = (incoming_page or "").strip()
    if incoming_page and incoming_page_ts > 0 and incoming_page_ts >= existing_page_ts:
        changed = (
            not existing_page
            or incoming_page != existing_page
            or incoming_page_ts > existing_page_ts
        )
        return incoming_page, incoming_page_ts, changed
    return existing_page, existing_page_ts, False


def update_from_collect_body(body: dict[str, Any], settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.live_presence_enabled or not settings.redis_url:
        return
    payload_type = str(body.get("type") or "")
    if payload_type not in EVENTS_TYPES:
        return

    fields = extract_live_fields(body)
    if not fields:
        return

    try:
        client = _redis_client(settings.redis_url)
        website_id = fields["website_id"]
        session_id = fields["session_id"]
        ttl = settings.live_presence_ttl_seconds
        score = fields["last_activity_ms"]
        cutoff = score - (ttl * 1000)

        mapping = {
            "visitor_id": fields["visitor_id"],
            "last_activity_ms": str(score),
        }
        org = fields.get("organization_id")
        if org is not None and org != "":
            mapping["organization_id"] = str(org)

        zkey = _sessions_zkey(website_id)
        hkey = _session_hash_key(website_id, session_id)
        visitor_key = _visitor_session_key(website_id, fields["visitor_id"])
        existing: dict[str, Any] = {}
        try:
            existing = client.hgetall(hkey) or {}
        except Exception:
            existing = {}
        prev_session_id = ""
        try:
            prev_session_id = str(client.get(visitor_key) or "").strip()
        except Exception:
            prev_session_id = ""
        if prev_session_id and prev_session_id != session_id:
            try:
                prev_hash = client.hgetall(_session_hash_key(website_id, prev_session_id)) or {}
            except Exception:
                prev_hash = {}
            try:
                prev_activity = int(prev_hash.get("last_activity_ms") or 0)
            except (TypeError, ValueError):
                prev_activity = 0
            if prev_activity > score:
                return
        existing_page = str(existing.get("current_page") or "").strip()
        try:
            existing_page_ts = int(existing.get("current_page_ts") or 0)
        except (TypeError, ValueError):
            existing_page_ts = 0
        if existing_page and existing_page_ts <= 0:
            try:
                existing_page_ts = int(existing.get("last_activity_ms") or 0)
            except (TypeError, ValueError):
                existing_page_ts = 0
        incoming_page = (fields["current_page"] or "").strip()
        try:
            incoming_page_ts = int(fields.get("current_page_ts") or 0)
        except (TypeError, ValueError):
            incoming_page_ts = 0
        page, page_ts, page_changed = resolve_stored_page(
            existing_page,
            existing_page_ts,
            incoming_page,
            incoming_page_ts,
        )
        country = (fields["country"] or "").strip() or str(existing.get("country") or "").strip()
        if page:
            mapping["current_page"] = page
            mapping["current_page_ts"] = str(page_ts)
        if country:
            mapping["country"] = country

        pipe = client.pipeline(transaction=False)
        pipe.hset(hkey, mapping=mapping)
        pipe.expire(hkey, ttl)
        pipe.zadd(zkey, {session_id: score})
        pipe.zremrangebyscore(zkey, "-inf", cutoff)
        if prev_session_id and prev_session_id != session_id:
            pipe.zrem(zkey, prev_session_id)
            pipe.delete(_session_hash_key(website_id, prev_session_id))
        pipe.set(visitor_key, session_id, ex=ttl)
        # Only broadcast page_view when the stored page actually changes.
        if page_changed:
            pipe.publish(
                f"wt:sse:{website_id}",
                json.dumps(
                    {
                        "v": 1,
                        "type": "page_view",
                        "website_id": website_id,
                        "visitor_id": fields["visitor_id"],
                        "session_id": session_id,
                        "ts": incoming_page_ts or score,
                        "session": {
                            "session_id": session_id,
                            "visitor_id": fields["visitor_id"],
                            "current_page": page,
                            "current_page_ts": page_ts,
                            "country": country,
                            "last_activity_ms": score,
                        },
                    },
                    separators=(",", ":"),
                ),
            )
        pipe.execute()
    except Exception as exc:
        logger.warning("live presence redis update failed: %s", exc)


def maybe_update_live_presence(body: dict[str, Any], settings: Settings | None = None) -> None:
    """Non-blocking wrapper for ingest write path."""
    try:
        update_from_collect_body(body, settings=settings)
    except Exception as exc:
        logger.warning("live presence skipped: %s", exc)
