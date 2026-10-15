"""Log every Hub↔CRM HTTP request and response into the A2A day log."""

from __future__ import annotations

import time
from typing import Any

from starlette.requests import Request
from starlette.responses import Response

from app.a2a.log import decode_body, log_http_exchange

_SKIP_PATHS = frozenset({"/health"})


def _client_host(request: Request) -> str | None:
    if request.client is None:
        return None
    return request.client.host


async def a2a_traffic_middleware(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or path in _SKIP_PATHS:
        return await call_next(request)
    started = time.perf_counter()
    raw = await request.body()
    req_payload = decode_body(raw, request.headers.get("content-type"))
    error: str | None = None
    response: Any = None
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001
        error = str(exc) or type(exc).__name__
        log_http_exchange(
            direction="hub_to_crm",
            method=request.method,
            url=path,
            request=req_payload,
            client=_client_host(request),
            ms=(time.perf_counter() - started) * 1000,
            error=error,
        )
        raise
    chunks = [chunk async for chunk in response.body_iterator]
    resp_raw = b"".join(chunks)
    log_http_exchange(
        direction="hub_to_crm",
        method=request.method,
        url=path,
        status=response.status_code,
        request=req_payload,
        response=decode_body(resp_raw, response.headers.get("content-type")),
        client=_client_host(request),
        ms=(time.perf_counter() - started) * 1000,
    )
    headers = dict(response.headers)
    headers["content-length"] = str(len(resp_raw))
    return Response(
        content=resp_raw,
        status_code=response.status_code,
        headers=headers,
        media_type=response.media_type,
    )
