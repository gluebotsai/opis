"""Thin direct chat adapter for CRM UI assists (own-server LLM)."""

from __future__ import annotations

from typing import Any, TypedDict, Optional

from app.llm import generate_ai_text, is_ai_configured


class ChatState(TypedDict, total=False):
    system: str
    user: str
    max_tokens: int
    timeout_ms: int
    text: Optional[str]
    status: str
    reason: Optional[str]


async def generate(state: ChatState) -> ChatState:
    if not is_ai_configured():
        return {
            **state,
            "text": None,
            "status": "failed",
            "reason": "llm_not_configured",
        }
    text = await generate_ai_text(
        system=state["system"],
        user=state["user"],
        max_tokens=int(state.get("max_tokens") or 500),
        timeout_ms=int(state.get("timeout_ms") or 20_000),
    )
    return {
        **state,
        "text": text,
        "status": "ok" if text else "failed",
        "reason": None if text else "empty_response",
    }


async def run(
    system: str,
    user: str,
    max_tokens: int = 500,
    timeout_ms: int = 20_000,
    organization_id: str | None = None,
) -> dict[str, Any]:
    void = organization_id
    del void
    result = await generate(
        {
            "system": system,
            "user": user,
            "max_tokens": max_tokens,
            "timeout_ms": timeout_ms,
            "status": "running",
        }
    )
    return {
        "ok": result.get("status") == "ok",
        "text": result.get("text"),
        "reason": result.get("reason"),
    }
