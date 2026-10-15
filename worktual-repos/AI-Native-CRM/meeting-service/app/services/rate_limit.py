from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from app.config import settings
from app.metrics import RATE_LIMITED

log = logging.getLogger(__name__)
_hits: dict[str, deque[float]] = defaultdict(deque)


def allow_post_meeting(org_id: str) -> bool:
    now = time.time()
    window = 60.0
    q = _hits[org_id]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= settings.post_meetings_rate_per_min:
        RATE_LIMITED.inc()
        log.info("rate_limited", extra={"org_id": org_id})
        return False
    q.append(now)
    return True
