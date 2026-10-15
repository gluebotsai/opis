"""Ticketing MCP server (FastMCP) — protocol adapter over Express domain APIs.

Auth:
  - Internal (ai-agents): X-Coworker-Tasks-Key + X-Coworker-Actor-* headers
  - External: Authorization Bearer wt_live_… / X-Api-Key → Express /api/mcp/session

Does not write SQL. Express remains RBAC/mutation authority.
"""

from __future__ import annotations

import inspect
import os
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from threading import Lock
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from fastmcp.tools.function_tool import FunctionTool
from starlette.requests import Request
from starlette.responses import JSONResponse

from express_bridge import call_express_tool, load_catalog, tool_err

_auth_ctx: ContextVar[dict[str, str] | None] = ContextVar("mcp_auth", default=None)

_AUTH_HEADER_NAMES = {
    "authorization",
    "x-api-key",
    "x-coworker-tasks-key",
    "x-coworker-actor-id",
    "x-coworker-org-id",
    "x-coworker-actor-role",
    "x-coworker-actor-name",
    "x-request-id",
}

# Simple in-process rate limit (per caller key). Override with MCP_RATE_LIMIT_*.
_RATE_LIMIT_WINDOW_SEC = float(os.environ.get("MCP_RATE_LIMIT_WINDOW_SEC", "60"))
_RATE_LIMIT_MAX = int(os.environ.get("MCP_RATE_LIMIT_MAX", "120"))
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = Lock()

mcp = FastMCP(
    "Worktual Ticketing",
    instructions=(
        "Worktual ticketing tools. Mutations go through Express with org RBAC. "
        "Pass coworker actor headers (internal) or an org API key (external)."
    ),
)


def _rate_limit_key(headers: dict[str, str]) -> str:
    lower = {str(k).lower(): str(v) for k, v in headers.items()}
    if lower.get("x-api-key"):
        return f"apikey:{lower['x-api-key'][:24]}"
    auth = lower.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return f"bearer:{auth[7:31]}"
    actor = lower.get("x-coworker-actor-id") or ""
    org = lower.get("x-coworker-org-id") or ""
    if actor or org:
        return f"actor:{org}:{actor}"
    return "ip:unknown"


def check_rate_limit(headers: dict[str, str]) -> dict[str, Any] | None:
    """Return tool_err dict if over limit; else None."""
    if _RATE_LIMIT_MAX <= 0:
        return None
    key = _rate_limit_key(headers)
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate_buckets[key]
        cutoff = now - _RATE_LIMIT_WINDOW_SEC
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= _RATE_LIMIT_MAX:
            return tool_err(
                "RATE_LIMITED",
                f"Too many tool calls ({_RATE_LIMIT_MAX} per "
                f"{int(_RATE_LIMIT_WINDOW_SEC)}s). Retry later.",
                http_status=429,
            )
        bucket.append(now)
    return None


def _incoming_auth_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    override = _auth_ctx.get()
    if override:
        headers.update({str(k): str(v) for k, v in override.items()})
    try:
        http_headers = get_http_headers(include=_AUTH_HEADER_NAMES)
    except Exception:  # noqa: BLE001
        http_headers = {}
    for key, val in (http_headers or {}).items():
        if val is not None:
            headers[str(key)] = str(val)
    return headers


def _json_type_to_python(schema: dict[str, Any]) -> Any:
    t = schema.get("type")
    if t == "string":
        return str
    if t == "integer":
        return int
    if t == "number":
        return float
    if t == "boolean":
        return bool
    if t == "array":
        items = schema.get("items") or {}
        return list[_json_type_to_python(items)]  # type: ignore[valid-type]
    if t == "object":
        return dict[str, Any]
    return Any


def _register_catalog_tools() -> None:
    catalog = load_catalog()
    for tool in catalog["tools"]:
        name = str(tool["name"])
        description = str(tool.get("description") or name)
        schema = tool.get("input_schema") or {"type": "object", "properties": {}}
        props: dict[str, Any] = dict(schema.get("properties") or {})
        required = set(schema.get("required") or [])

        params: list[inspect.Parameter] = []
        annotations: dict[str, Any] = {"return": dict[str, Any]}
        for prop_name, prop_schema in props.items():
            py_t = _json_type_to_python(
                prop_schema if isinstance(prop_schema, dict) else {}
            )
            annotations[prop_name] = py_t if prop_name in required else (py_t | None)
            default = inspect.Parameter.empty if prop_name in required else None
            params.append(
                inspect.Parameter(
                    prop_name,
                    kind=inspect.Parameter.KEYWORD_ONLY,
                    default=default,
                    annotation=annotations[prop_name],
                )
            )

        def _make(tool_name: str):
            def handler(**kwargs: Any) -> dict[str, Any]:
                incoming = _incoming_auth_headers()
                limited = check_rate_limit(incoming)
                if limited:
                    return limited
                args = {k: v for k, v in kwargs.items() if v is not None}
                return call_express_tool(
                    tool_name, args, incoming_headers=incoming
                )

            handler.__name__ = tool_name
            handler.__doc__ = description
            handler.__annotations__ = annotations
            handler.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
                parameters=params, return_annotation=dict[str, Any]
            )
            return handler

        mcp.add_tool(
            FunctionTool.from_function(
                _make(name),
                name=name,
                description=description,
            )
        )


_register_catalog_tools()


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Request) -> JSONResponse:
    return JSONResponse({"ok": True, "service": "ticketing-mcp"})


@mcp.custom_route("/invoke", methods=["POST"])
async def invoke_tool(request: Request) -> JSONResponse:
    """
    Sync-friendly tool call for ai-agents (same Express mapping as MCP tools).

    Body: {"name": "list_tickets", "arguments": {...}}
    Auth: coworker tasks key + actor headers, or org API key.
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse(tool_err("BAD_INPUT", "JSON body required"), status_code=400)
    if not isinstance(body, dict):
        return JSONResponse(tool_err("BAD_INPUT", "JSON object required"), status_code=400)
    name = str(body.get("name") or "").strip()
    arguments = body.get("arguments") if isinstance(body.get("arguments"), dict) else {}
    if not name:
        return JSONResponse(tool_err("BAD_INPUT", "name is required"), status_code=400)
    incoming = {str(k): str(v) for k, v in request.headers.items()}
    limited = check_rate_limit(incoming)
    if limited:
        return JSONResponse(limited, status_code=429)
    result = call_express_tool(name, arguments, incoming_headers=incoming)
    status = 200 if result.get("success") else 400
    if result.get("error_code") == "RATE_LIMITED":
        status = 429
    elif result.get("error_code") in ("UNAUTHORIZED", "FORBIDDEN", "NO_ACTOR"):
        status = 401 if result.get("error_code") != "FORBIDDEN" else 403
    return JSONResponse(result, status_code=status)


def set_test_auth(headers: dict[str, str] | None) -> None:
    """Test helper: inject auth without HTTP request context."""
    _auth_ctx.set(headers)


def main() -> None:
    host = os.environ.get("MCP_HOST", "127.0.0.1")
    port = int(os.environ.get("MCP_PORT", "8020"))
    if host in ("0.0.0.0", "::") and os.environ.get("MCP_ALLOW_PUBLIC_BIND") != "1":
        raise SystemExit(
            "Refusing to bind MCP on a public interface. "
            "Use MCP_HOST=127.0.0.1 (default) or set MCP_ALLOW_PUBLIC_BIND=1 "
            "only behind a trusted gateway."
        )
    transport = (os.environ.get("MCP_TRANSPORT") or "http").strip().lower()
    # Legacy env from MCP SDK naming
    if transport in ("streamable-http", "streamable_http"):
        transport = "http"
    mcp.run(transport=transport, host=host, port=port)


if __name__ == "__main__":
    main()
