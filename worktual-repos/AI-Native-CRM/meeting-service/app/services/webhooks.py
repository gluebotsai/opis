from __future__ import annotations

import hmac
import logging
import time
from hashlib import sha256

from app.config import settings

log = logging.getLogger(__name__)


def verify_vexa_signature(body: bytes, signature: str | None, timestamp: str | None) -> bool:
    secret = settings.webhook_secret
    if not secret:
        return False
    if timestamp:
        try:
            ts = int(timestamp)
        except ValueError:
            return False
        if abs(time.time() - ts) > settings.webhook_skew_sec:
            log.info("webhook_skew", extra={"error_code": "invalid_url"})
            return False
    if signature:
        sig = signature.removeprefix("sha256=")
        digest = hmac.new(secret.encode(), ("." + body.decode("utf-8")).encode(), sha256).hexdigest()
        if hmac.compare_digest(sig, digest):
            return True
        # some senders sign raw body
        alt = hmac.new(secret.encode(), body, sha256).hexdigest()
        if hmac.compare_digest(sig, alt):
            return True
    return False


def verify_legacy_bearer(authorization: str | None) -> bool:
    if not authorization or not authorization.lower().startswith("bearer "):
        return False
    token = authorization.split(" ", 1)[1].strip()
    return hmac.compare_digest(token, settings.webhook_secret)
