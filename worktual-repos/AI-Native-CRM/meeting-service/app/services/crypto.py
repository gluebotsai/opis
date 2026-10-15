from __future__ import annotations

import base64
import hashlib
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _fernet() -> Fernet:
    key = settings.passcode_fernet_key.strip()
    if not key:
        digest = hashlib.sha256(settings.crm_service_jwt_secret.encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    if len(key) != 44:
        digest = hashlib.sha256(key.encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_passcode(value: str | None) -> str | None:
    if not value:
        return None
    return _fernet().encrypt(value.encode()).decode()


def decrypt_passcode(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None


_SECRET_KEYS = {"pwd", "password", "passcode", "p", "zak"}


def redact_meeting_url(url: str) -> str:
    parsed = urlparse(url)
    qs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in _SECRET_KEYS]
    return urlunparse(parsed._replace(query=urlencode(qs)))
