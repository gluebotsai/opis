"""Request-scoped context for coworker MCP tool handlers."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any


@dataclass
class McpRequestContext:
    agent_name: str = ""
    execution_mode: str = ""
    acting_user_id: str = ""
    organization_id: str = ""
    role: str = ""
    business_type: str = ""
    module: str = ""
    surface: str = "list"
    policy_version: str = ""
    run_id: str = ""
    trace_id: str = ""
    idempotency_key: str = ""
    execution_token: str = ""
    entity_id: str | None = None
    pathname: str | None = None
    draft: dict[str, Any] = field(default_factory=dict)
    email_draft: dict[str, Any] = field(default_factory=dict)
    # Accumulated after write tools succeed — returned on agent-turn.
    ui_refresh: dict[str, Any] = field(default_factory=dict)

    def note_refresh(
        self,
        *,
        modules: list[str] | None = None,
        entity_ids: list[str] | None = None,
        reason: str | None = None,
        href: str | None = None,
        seo_progress: dict[str, Any] | None = None,
        seo_content: dict[str, Any] | None = None,
        seo_keywords: dict[str, Any] | None = None,
        seo_social: dict[str, Any] | None = None,
    ) -> None:
        ur = self.ui_refresh
        if modules:
            prev = ur.get("modules") if isinstance(ur.get("modules"), list) else []
            ur["modules"] = list({*prev, *modules})
        if entity_ids:
            prev = ur.get("entityIds") if isinstance(ur.get("entityIds"), list) else []
            ur["entityIds"] = list({*prev, *[e for e in entity_ids if e]})
        if reason:
            ur["reason"] = reason
        if href:
            ur["href"] = href
        if seo_progress:
            ur["seoProgress"] = seo_progress
        if seo_content:
            ur["seoContent"] = seo_content
            ur["modules"] = list(
                {
                    *(ur.get("modules") if isinstance(ur.get("modules"), list) else []),
                    "marketing",
                }
            )
            ur["reason"] = ur.get("reason") or "seo_content"
        if seo_keywords:
            ur["seoKeywords"] = seo_keywords
            ur["modules"] = list(
                {
                    *(ur.get("modules") if isinstance(ur.get("modules"), list) else []),
                    "marketing",
                }
            )
            ur["reason"] = ur.get("reason") or "seo_keywords"
        if seo_social:
            ur["seoSocial"] = seo_social
            ur["modules"] = list(
                {
                    *(ur.get("modules") if isinstance(ur.get("modules"), list) else []),
                    "marketing",
                }
            )
            ur["reason"] = ur.get("reason") or "seo_social"


_ctx: ContextVar[McpRequestContext | None] = ContextVar("mcp_ctx", default=None)


def get_ctx() -> McpRequestContext:
    cur = _ctx.get()
    if cur is None:
        return McpRequestContext()
    return cur


def set_ctx(ctx: McpRequestContext) -> None:
    _ctx.set(ctx)


def reset_ctx() -> None:
    _ctx.set(None)
