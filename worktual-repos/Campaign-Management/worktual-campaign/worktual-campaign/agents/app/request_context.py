"""Request-scoped JWT for agent → campaign_db session API calls."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

_token: ContextVar[str | None] = ContextVar("agent_request_token", default=None)
_mas_transcript_managed: ContextVar[bool] = ContextVar(
    "mas_transcript_managed", default=False
)


def set_request_token(token: str | None) -> None:
    _token.set(token)


def get_request_token() -> str:
    token = (_token.get() or "").strip()
    if not token:
        raise RuntimeError("Missing request JWT for campaign session API")
    return token


def peek_request_token() -> str:
    """JWT from the active chat turn, or '' when unset (e.g. background worker)."""
    return (_token.get() or "").strip()


def is_mas_transcript_managed() -> bool:
    return bool(_mas_transcript_managed.get())


@contextmanager
def mas_transcript_scope(*, managed: bool) -> Iterator[None]:
    """When managed=True, append_message skips user/assistant rows (transcript owns them)."""
    token = _mas_transcript_managed.set(bool(managed))
    try:
        yield
    finally:
        _mas_transcript_managed.reset(token)
