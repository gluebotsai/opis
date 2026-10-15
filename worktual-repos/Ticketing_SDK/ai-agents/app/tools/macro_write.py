"""Macro write tools — Express mutate APIs (or MCP when tools_transport=mcp)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.contracts import tool_err
from app.tools.express_client import express_request
from app.tools.transport import invoke_tool


def create_macro(*, title: str, body: str) -> dict[str, Any]:
    """Create via POST /api/macros (same as MacrosView)."""
    t = (title or "").strip()
    b = (body or "").strip()
    if not t or not b:
        return tool_err("BAD_INPUT", "title and body are required")

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            "/api/macros",
            json_body={"title": t, "body": b},
        )

    return invoke_tool(
        "create_macro",
        {"title": t, "body": b},
        express_call=_express,
    )


def update_macro(
    macro_id: str,
    *,
    title: str | None = None,
    body: str | None = None,
) -> dict[str, Any]:
    from app.tools.catalog_tools import catalog_row_id_usable

    mid = catalog_row_id_usable(macro_id)
    if not mid:
        return tool_err(
            "BAD_INPUT",
            "macro id must be the numeric id from list_macros. "
            "Do not invent placeholders.",
        )
    patch: dict[str, Any] = {}
    if title is not None:
        patch["title"] = str(title).strip()
    if body is not None:
        patch["body"] = str(body).strip()
    if not patch:
        return tool_err("BAD_INPUT", "title or body is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/macros/{quote(mid, safe='')}",
            json_body=patch,
        )

    return invoke_tool(
        "update_macro",
        {"macro_id": mid, **patch},
        express_call=_express,
    )


def delete_macro(macro_id: str) -> dict[str, Any]:
    from app.tools.catalog_tools import catalog_row_id_usable

    mid = catalog_row_id_usable(macro_id)
    if not mid:
        return tool_err(
            "BAD_INPUT",
            "macro id must be the numeric id from list_macros. "
            "Do not invent placeholders.",
        )

    def _express() -> dict[str, Any]:
        return express_request("DELETE", f"/api/macros/{quote(mid, safe='')}")

    return invoke_tool(
        "delete_macro",
        {"macro_id": mid},
        express_call=_express,
    )
