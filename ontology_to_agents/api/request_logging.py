"""Log HTTP requests: client IP, incoming payload, outgoing payload."""

from __future__ import annotations

import json
import logging
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

access_logger = logging.getLogger("api.access")
io_logger = logging.getLogger("api.io")
ontology_logger = logging.getLogger("api.ontology")

_SKIP_PATHS = frozenset({"/health", "/docs", "/openapi.json", "/redoc", "/"})
_ONTOLOGY_PATHS = frozenset({"/v1/ontology/slice", "/v1/ontology/hub"})
_MAX_BODY = 65_536
_SMALL_OUT = 4_096


def _clip(raw: bytes) -> str:
    if not raw:
        return ""
    text = raw.decode("utf-8", errors="replace")
    if len(text) > _MAX_BODY:
        return text[:_MAX_BODY] + f"...[truncated {len(text) - _MAX_BODY} chars]"
    return text


def _parse_json(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _field(body: Any, *keys: str) -> str:
    if not isinstance(body, dict):
        return "-"
    for key in keys:
        value = body.get(key)
        if value not in (None, ""):
            return str(value)
    return "-"


def _ontology_kind(path: str) -> str:
    return "hub" if path.endswith("/hub") else "slice"


def _selector(incoming: Any) -> str:
    agent = _field(incoming, "agent")
    if agent == "-":
        agent = _field(incoming, "preset")
    if agent == "-" and isinstance(incoming, dict) and incoming.get("modules"):
        agent = "modules"
    if agent == "-" and isinstance(incoming, dict) and incoming.get("products"):
        agent = "products"
    return (
        f"org={_field(incoming, 'organizationId', 'organization_id')} "
        f"product={_field(incoming, 'product')} "
        f"agent={agent}"
    )


def _first_error(outgoing: Any) -> str | None:
    if not isinstance(outgoing, dict):
        return None
    detail = outgoing.get("detail")
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    if isinstance(detail, list) and detail:
        first = detail[0]
        if isinstance(first, dict):
            loc = ".".join(
                str(part) for part in (first.get("loc") or []) if part != "body"
            )
            msg = str(first.get("msg") or "").strip()
            text = f"{loc}: {msg}".strip(": ").strip()
            return text or None
        return str(first)
    return None


def _metric_ids(outgoing: Any) -> list[str]:
    if not isinstance(outgoing, dict):
        return []
    ids: list[str] = []
    for item in outgoing.get("metrics") or []:
        if isinstance(item, dict) and item.get("id"):
            ids.append(str(item["id"]))
        elif isinstance(item, str):
            ids.append(item)
    return ids


def _format_ontology_block(
    *,
    path: str,
    client: str,
    status: int,
    incoming: Any,
    outgoing: Any,
    out_text: str,
) -> str:
    lines = [
        f"---------- ontology {path} ----------",
        f"IN ip={client}",
        json.dumps(incoming, default=str, ensure_ascii=False, indent=2)
        if incoming is not None
        else "(empty body)",
        f"OUT status={status}",
    ]
    error = _first_error(outgoing)
    small = status >= 400 or len(out_text) <= _SMALL_OUT
    if small and outgoing is not None:
        lines.append(json.dumps(outgoing, default=str, ensure_ascii=False, indent=2))
    elif isinstance(outgoing, dict):
        ids = _metric_ids(outgoing)
        shown = ids[:12]
        extra = len(ids) - len(shown)
        id_text = ", ".join(shown)
        if extra > 0:
            id_text = f"{id_text}, ...+{extra}"
        prompt = outgoing.get("prompt") or ""
        lines.append(
            f"metrics={len(ids)} prompt_chars={len(prompt)}"
            + (f" metric_ids=[{id_text}]" if id_text else "")
        )
    elif error:
        lines.append(f"error={error}")
    return "\n".join(lines)


def _ontology_access_line(
    *,
    path: str,
    client: str,
    status: int,
    incoming: Any,
    outgoing: Any,
) -> str:
    kind = _ontology_kind(path)
    base = f"ontology {kind} status={status} ip={client} {_selector(incoming)}"
    if status >= 400:
        error = _first_error(outgoing) or "request rejected"
        return f"{base} error={error}"
    if isinstance(outgoing, dict):
        prompt = outgoing.get("prompt") or ""
        return (
            f"{base} metrics={len(_metric_ids(outgoing))} "
            f"prompt_chars={len(prompt)}"
        )
    return base


class RequestStartLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        client = request.client.host if request.client else "-"
        query = f"?{request.url.query}" if request.url.query else ""
        path = request.url.path
        access_logger.info(
            "→ %s %s%s client=%s",
            request.method,
            path,
            query,
            client,
        )

        in_body = b""
        if request.method in ("POST", "PUT", "PATCH"):
            in_body = await request.body()

            async def _receive() -> dict[str, Any]:
                return {"type": "http.request", "body": in_body, "more_body": False}

            request = Request(request.scope, _receive)

        response = await call_next(request)

        out_chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            out_chunks.append(chunk)
        out_body = b"".join(out_chunks)

        if path not in _SKIP_PATHS:
            in_text = _clip(in_body)
            out_text = _clip(out_body)
            incoming = _parse_json(in_text) if in_text else None
            outgoing = _parse_json(out_text) if out_text else None
            io_logger.info(
                json.dumps(
                    {
                        "ip": client,
                        "method": request.method,
                        "path": path,
                        "query": request.url.query or None,
                        "status": response.status_code,
                        "incoming": incoming,
                        "outgoing": outgoing,
                    },
                    default=str,
                    ensure_ascii=False,
                )
            )
            if path in _ONTOLOGY_PATHS:
                ontology_logger.info(
                    _format_ontology_block(
                        path=path,
                        client=client,
                        status=response.status_code,
                        incoming=incoming,
                        outgoing=outgoing,
                        out_text=out_text,
                    )
                )
                access_logger.info(
                    _ontology_access_line(
                        path=path,
                        client=client,
                        status=response.status_code,
                        incoming=incoming,
                        outgoing=outgoing,
                    )
                )

        headers = dict(response.headers)
        headers.pop("content-length", None)
        return Response(
            content=out_body,
            status_code=response.status_code,
            headers=headers,
            media_type=response.media_type,
            background=response.background,
        )
