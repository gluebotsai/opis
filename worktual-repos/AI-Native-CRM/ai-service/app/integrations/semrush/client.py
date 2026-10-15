"""Semrush remote MCP client via streamable HTTP JSON-RPC (no mcp SDK required)."""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from app.integrations.semrush.config import SemrushConfig

log = logging.getLogger(__name__)

MCP_URL_DEFAULT = "https://mcp.semrush.com/v2/mcp"
TOKEN_URL_DEFAULT = "https://api.semrush.com/apis/v4-raw/auth/v1/oauth2/access_token"
EXPIRY_BUFFER_SECONDS = 60


def _semrush_mcp_enabled() -> bool:
    raw = (os.environ.get("SEMRUSH_MCP_ENABLED") or "").strip().lower()
    return raw in ("true", "1", "on")


class SemrushMcpError(Exception):
    def __init__(self, stage: str, message: str, *, refresh_expired: bool = False) -> None:
        super().__init__(f"{stage}: {message}")
        self.stage = stage
        self.message = message
        self.refresh_expired = refresh_expired


class SemrushMcpClient:
    """OAuth + JSON-RPC tools/list and tools/call against Semrush MCP."""

    def __init__(self, config: SemrushConfig) -> None:
        self.config = config
        self._initialized = False
        self._cached_tools: list[dict[str, Any]] | None = None
        self._session_id: str | None = None

    @property
    def _mcp_url(self) -> str:
        return self.config.mcp_url or MCP_URL_DEFAULT

    @property
    def _token_url(self) -> str:
        return self.config.token_url or TOKEN_URL_DEFAULT

    def _token_store(self) -> dict[str, Any]:
        if self.config.access_token and self.config.refresh_token and self.config.client_id:
            return {
                "client_id": self.config.client_id,
                "token_response": {
                    "access_token": self.config.access_token,
                    "refresh_token": self.config.refresh_token,
                    "token_type": self.config.token_type or "bearer",
                },
            }
        raise SemrushMcpError(
            "token_load",
            "Missing OAuth tokens for Semrush MCP.",
        )

    def _apply_tokens(self, saved: dict[str, Any]) -> None:
        token_data = saved.get("token_response") or {}
        self.config.access_token = str(token_data.get("access_token") or "")
        self.config.refresh_token = str(
            token_data.get("refresh_token") or self.config.refresh_token or ""
        )

    @staticmethod
    def _access_token_expired(access_token: str) -> bool:
        try:
            payload = access_token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            expiry = int(json.loads(base64.urlsafe_b64decode(payload))["exp"])
            return time.time() >= expiry - EXPIRY_BUFFER_SECONDS
        except Exception as exc:
            raise SemrushMcpError("token_parse", "Cannot read access-token expiry") from exc

    def refresh_access_token(self) -> str:
        if not _semrush_mcp_enabled():
            raise SemrushMcpError(
                "disabled",
                "Semrush MCP is disconnected (SEMRUSH_MCP_ENABLED is off).",
            )
        saved = self._token_store()
        token_data = saved.get("token_response") or {}
        client_id = saved.get("client_id") or self.config.client_id
        refresh_token = token_data.get("refresh_token") or self.config.refresh_token
        if not client_id or not refresh_token:
            raise SemrushMcpError(
                "token_refresh",
                "Missing client_id or refresh token",
                refresh_expired=True,
            )

        form = urllib.parse.urlencode(
            {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": refresh_token,
                "resource": self._mcp_url,
            }
        ).encode()
        req = urllib.request.Request(
            self._token_url,
            data=form,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                refreshed = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode().lower()
            expired = exc.code in (400, 401) and (
                "invalid_grant" in body or "expired" in body
            )
            raise SemrushMcpError(
                "token_refresh",
                f"Semrush rejected token refresh (HTTP {exc.code})",
                refresh_expired=expired,
            ) from exc
        except Exception as exc:
            raise SemrushMcpError("token_refresh", str(exc)) from exc

        access_token = refreshed.get("access_token")
        if not access_token:
            raise SemrushMcpError("token_refresh", "Semrush returned no access token")

        refreshed["refresh_token"] = refreshed.get("refresh_token") or refresh_token
        saved["client_id"] = client_id
        saved["token_response"] = {
            **token_data,
            **refreshed,
            "obtained_at": datetime.now(timezone.utc).isoformat(),
        }
        self._apply_tokens(saved)
        log.info("Semrush access token refreshed")
        return str(access_token)

    def get_valid_token(self) -> str:
        saved = self._token_store()
        access_token = (saved.get("token_response") or {}).get("access_token") or self.config.access_token
        if not access_token:
            raise SemrushMcpError("token_load", "Saved access token is missing")
        if self._access_token_expired(str(access_token)):
            log.info("Semrush access token expired; refreshing")
            return self.refresh_access_token()
        return str(access_token)

    def _rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        if not _semrush_mcp_enabled():
            raise SemrushMcpError(
                "disabled",
                "Semrush MCP is disconnected (SEMRUSH_MCP_ENABLED is off).",
            )
        access_token = self.get_valid_token()
        body = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method,
            "params": params or {},
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id

        with httpx.Client(timeout=httpx.Timeout(30.0, read=300.0), follow_redirects=True) as client:
            res = client.post(self._mcp_url, headers=headers, json=body)
            sid = res.headers.get("mcp-session-id") or res.headers.get("Mcp-Session-Id")
            if sid:
                self._session_id = sid
            text = res.text or ""
            if res.status_code >= 400:
                raise SemrushMcpError(
                    "mcp_connect",
                    f"HTTP {res.status_code}: {text[:400]}",
                )
            payload = _parse_mcp_http_body(text)
            if isinstance(payload, dict) and payload.get("error"):
                err = payload["error"]
                msg = err.get("message") if isinstance(err, dict) else str(err)
                raise SemrushMcpError("mcp_rpc", str(msg))
            if isinstance(payload, dict) and "result" in payload:
                return payload["result"]
            return payload

    def initialize(self) -> dict[str, Any]:
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "worktual-crm-seo", "version": "1.0.0"},
            },
        )
        try:
            self._rpc("notifications/initialized", {})
        except SemrushMcpError:
            # Some servers reject notifications without id; ignore soft failures.
            pass
        self._initialized = True
        return result if isinstance(result, dict) else {"ok": True}

    def list_tools(self) -> list[dict[str, Any]]:
        if self._cached_tools is not None:
            return self._cached_tools
        if not self._initialized:
            self.initialize()
        result = self._rpc("tools/list", {})
        tools_raw = []
        if isinstance(result, dict):
            tools_raw = result.get("tools") or []
        elif isinstance(result, list):
            tools_raw = result
        tools: list[dict[str, Any]] = []
        for tool in tools_raw:
            if not isinstance(tool, dict) or not tool.get("name"):
                continue
            tools.append(
                {
                    "name": tool.get("name"),
                    "description": tool.get("description") or "",
                    "inputSchema": tool.get("inputSchema")
                    or tool.get("input_schema")
                    or {"type": "object", "properties": {}},
                }
            )
        self._cached_tools = tools
        return tools

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        if not _semrush_mcp_enabled():
            raise SemrushMcpError(
                "disabled",
                "Semrush MCP is disconnected (SEMRUSH_MCP_ENABLED is off).",
            )
        if not self._initialized:
            self.initialize()
        result = self._rpc(
            "tools/call",
            {"name": name, "arguments": arguments or {}},
        )
        if isinstance(result, dict) and result.get("isError"):
            raise SemrushMcpError("tool_call", f"{name}: {_tool_payload(result)}")
        return _tool_payload(result)


def _parse_mcp_http_body(text: str) -> Any:
    text = (text or "").strip()
    if not text:
        return {}
    if text.startswith("{"):
        return json.loads(text)
    # SSE: data: {...}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            data = line[5:].strip()
            if data and data != "[DONE]":
                try:
                    return json.loads(data)
                except json.JSONDecodeError:
                    continue
    raise SemrushMcpError("mcp_parse", "Unrecognized MCP HTTP response")


def _tool_payload(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    if result.get("structuredContent") is not None:
        return result["structuredContent"]
    content = result.get("content")
    if not isinstance(content, list):
        return result
    blocks: list[Any] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            try:
                blocks.append(json.loads(text))
            except (TypeError, ValueError, json.JSONDecodeError):
                blocks.append(text)
        else:
            blocks.append(block)
    if len(blocks) == 1:
        return blocks[0]
    return blocks if blocks else result
