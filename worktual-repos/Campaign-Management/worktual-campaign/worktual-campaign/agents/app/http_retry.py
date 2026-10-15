"""Small httpx retry helper for flaky campaign API connections."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")

_RETRYABLE = (
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.ReadTimeout,
    httpx.WriteTimeout,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
)


async def with_http_retry(
    label: str,
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay_s: float = 0.35,
) -> T:
    """Retry transient transport failures (disconnect / connect / timeout)."""
    last: BaseException | None = None
    for i in range(max(1, attempts)):
        try:
            return await fn()
        except _RETRYABLE as exc:
            last = exc
            if i + 1 >= attempts:
                break
            delay = base_delay_s * (i + 1)
            logger.warning(
                "%s attempt %s/%s failed (%s); retry in %.2fs",
                label,
                i + 1,
                attempts,
                type(exc).__name__,
                delay,
            )
            await asyncio.sleep(delay)
    assert last is not None
    raise last
