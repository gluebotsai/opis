"""Shared live-agent handoff helpers for support bots."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from app.agents.queue_select import (
    parse_queue_profiles,
    select_queue_key,
    select_queue_with_llm,
    skills_for_queue_key,
)
from app.llm.client import LLMClient, get_llm_client

HANDOFF_TOOL_NAMES = frozenset({"recommend_live_agent_handoff", "LIVE_AGENT"})


@dataclass(frozen=True)
class HandoffFields:
    handoff_recommended: bool = False
    handoff_reason: str | None = None
    intent: str = "general_inquiry"
    selected_queue_key: str | None = None
    candidate_skills: list[str] | None = None

    def __post_init__(self) -> None:
        if self.candidate_skills is None:
            object.__setattr__(self, "candidate_skills", [])


def extract_handoff_from_messages(messages: list[dict[str, Any]]) -> tuple[bool, str | None]:
    for item in messages:
        if item.get("role") != "tool":
            continue
        if str(item.get("name") or "") not in HANDOFF_TOOL_NAMES:
            continue
        try:
            payload = json.loads(str(item.get("content") or "{}"))
        except (TypeError, ValueError):
            payload = {}
        if isinstance(payload, dict) and payload.get("handoff_recommended"):
            reason = payload.get("reason")
            return True, str(reason) if reason else "explicit_request"
        # Legacy Lola LIVE_AGENT tool message shape
        message = payload.get("message") if isinstance(payload, dict) else None
        if message == "LIVE_AGENT":
            return True, "explicit_request"
    return False, None


async def resolve_handoff_fields(
    *,
    messages: list[dict[str, Any]],
    tenant_context: dict[str, Any],
    transcript: list[dict[str, Any]] | None,
    message: str,
    llm: LLMClient | None = None,
) -> HandoffFields:
    handoff_recommended, handoff_reason = extract_handoff_from_messages(messages)
    if not handoff_recommended:
        return HandoffFields()

    intent = "explicit_live_agent"
    conversation_lines = [
        f"{str(item.get('role') or 'user').strip()}: {str(item.get('content') or '').strip()}"
        for item in (transcript or [])[-10:]
        if str(item.get("content") or "").strip()
    ]
    conversation_lines.append(f"user: {message.strip()}")
    queue_profiles = tenant_context.get("queue_profiles")
    parsed_profiles = parse_queue_profiles(queue_profiles)
    client = llm if llm is not None else (get_llm_client() if parsed_profiles else None)
    selected_queue_key, candidate_skills = await select_queue_with_llm(
        client,
        parsed_profiles,
        "\n".join(conversation_lines),
    )
    if not selected_queue_key:
        selected_queue_key = select_queue_key(
            tenant_context,
            intent=intent,
        )
        candidate_skills = skills_for_queue_key(parsed_profiles, selected_queue_key)

    return HandoffFields(
        handoff_recommended=True,
        handoff_reason=handoff_reason,
        intent=intent,
        selected_queue_key=selected_queue_key,
        candidate_skills=candidate_skills or [],
    )
