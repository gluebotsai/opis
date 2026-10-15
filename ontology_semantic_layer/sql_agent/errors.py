"""Typed errors for SQL agent — map to HTTP 400/503 in api/main."""

from __future__ import annotations


class SqlAgentError(ValueError):
    """Client-facing validation / catalog / warehouse shape errors (HTTP 400)."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "bad_request",
        reason: str | None = None,
        missing: list[str] | None = None,
        candidates: list[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.reason = reason
        self.missing = list(missing or [])
        self.candidates = list(candidates or [])

    def to_detail(self) -> dict[str, object]:
        detail: dict[str, object] = {"code": self.code, "message": self.message}
        if self.code == "needs_clarification" or self.reason:
            if self.reason:
                detail["reason"] = self.reason
            if self.missing:
                detail["missing"] = self.missing
            if self.candidates:
                detail["candidates"] = self.candidates
        return detail


class WarehouseUnavailableError(RuntimeError):
    """Postgres/ClickHouse unreachable (HTTP 503)."""

    def __init__(self, message: str, *, code: str = "unavailable") -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def to_detail(self) -> dict[str, object]:
        return {"code": self.code, "message": self.message, "retry": True}
