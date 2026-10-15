"""Errors raised before or after a partner HTTP call."""

from __future__ import annotations

from typing import Any


class TicketingAuthError(Exception):
    """Missing base URL, credential, or an invalid locale. No request was sent."""

    code = "AUTH_CONFIG"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.name = "TicketingAuthError"


class TicketingApiError(Exception):
    """Non-2xx response, or a co-worker payload the client will not surface."""

    def __init__(self, message: str, status: int, body: Any, code: str | None = None) -> None:
        super().__init__(message)
        self.name = "TicketingApiError"
        self.status = status
        self.body = body
        self.code = code
