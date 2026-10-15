"""Semrush MCP credentials — prefer in-memory payload from Fastify (Onboarding connected-apps API)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class SemrushConfig:
    mcp_url: str
    token_url: str
    client_id: str
    scope: str
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    token_file: Path | None = None
    persist_tokens: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any], *, token_file: Path | None = None) -> "SemrushConfig":
        token_response = data.get("token_response") or {}
        return cls(
            mcp_url=str(data.get("mcp_url") or "https://mcp.semrush.com/v2/mcp"),
            token_url=str(
                data.get("token_url")
                or "https://api.semrush.com/apis/v4-raw/auth/v1/oauth2/access_token"
            ),
            client_id=str(data.get("client_id") or data.get("oauth_client_id") or ""),
            scope=str(data.get("scope") or data.get("scope_requested") or "mcp.access"),
            access_token=str(data.get("access_token") or token_response.get("access_token") or ""),
            refresh_token=str(
                data.get("refresh_token") or token_response.get("refresh_token") or ""
            ),
            token_type=str(data.get("token_type") or token_response.get("token_type") or "Bearer"),
            token_file=token_file,
            persist_tokens=bool(data.get("persist_tokens")),
            extra={
                k: v
                for k, v in data.items()
                if k
                not in {
                    "mcp_url",
                    "token_url",
                    "client_id",
                    "oauth_client_id",
                    "scope",
                    "scope_requested",
                    "access_token",
                    "refresh_token",
                    "token_type",
                    "token_response",
                    "persist_tokens",
                }
            },
        )


def config_from_connection_payload(payload: dict[str, Any]) -> SemrushConfig:
    """Build config from Fastify connector payload (onboarding API or legacy DB)."""
    return SemrushConfig.from_dict(
        {
            "mcp_url": payload.get("mcpUrl") or payload.get("mcp_url"),
            "token_url": payload.get("tokenUrl") or payload.get("token_url"),
            "client_id": payload.get("oauthClientId") or payload.get("client_id"),
            "scope": payload.get("scopes") or payload.get("scope") or "mcp.access",
            "access_token": payload.get("accessToken") or payload.get("access_token"),
            "refresh_token": payload.get("refreshToken") or payload.get("refresh_token"),
            "token_type": payload.get("tokenType") or "Bearer",
            "persist_tokens": False,
        }
    )
