from __future__ import annotations

import json
import logging
import threading
from collections import defaultdict

from app.config import settings

log = logging.getLogger(__name__)

_local: dict[str, list] = defaultdict(list)
_lock = threading.Lock()
_redis = None


def _redis_client():
    global _redis
    if not settings.redis_url:
        return None
    if _redis is not None:
        return _redis
    try:
        import redis

        _redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        _redis.ping()
        return _redis
    except Exception:
        log.warning("redis_unavailable")
        _redis = None
        return None


def channel(meeting_id: str) -> str:
    return f"meeting:{meeting_id}"


def publish(meeting_id: str, payload: dict) -> None:
    raw = json.dumps(payload, default=str)
    r = _redis_client()
    if r is not None:
        try:
            r.publish(channel(meeting_id), raw)
            return
        except Exception:
            log.warning("redis_publish_failed", extra={"meeting_id": meeting_id})
    with _lock:
        _local[meeting_id].append(payload)
        _local[meeting_id] = _local[meeting_id][-200:]


def poll_local(meeting_id: str, after: int) -> tuple[list[dict], int]:
    with _lock:
        items = list(_local.get(meeting_id, []))
    return items[after:], len(items)


def subscribe_redis(meeting_id: str):
    r = _redis_client()
    if r is None:
        return None
    pubsub = r.pubsub()
    pubsub.subscribe(channel(meeting_id))
    return pubsub
