"""
Chat turn entrypoints — native orchestrator (LangGraph removed).

`run_chat` / `_run_chat_once` preserve the historical call signature used by
main.py, agent_turn.py, and tests, while executing the LLM-native supervisor
and bounded tool loop.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache
from typing import Any

from app.contracts.execution import ActorContext, RunBudgets, RunRequest
from app.memory import (
    ConversationContextLoadError,
    build_thread_id,
    load_conversation_context,
    persist_workflow_events,
    prune_thread,
    save_conversation_context,
    serialized_conversation_turn,
    touch,
)
from app.runtime.orchestrator import run_native_turn


def build_graph():
    """Deprecated: LangGraph StateGraph removed. Returns a noop marker."""
    return _NoopGraph()


@lru_cache
def get_compiled_graph():
    """Deprecated compatibility shim for tests that clear graph caches."""
    return _NoopCompiledGraph()


class _NoopGraph:
    def compile(self, checkpointer=None):
        return get_compiled_graph()


class _NoopCompiledGraph:
    def invoke(self, *args, **kwargs):
        raise RuntimeError("LangGraph compiled graph removed — use run_chat/native")

    def get_state(self, config=None):
        return _NoopState()

    def get_state_history(self, config=None):
        return []

    @staticmethod
    def cache_clear():
        get_compiled_graph.cache_clear()


class _NoopState:
    values: dict[str, Any] = {}
    config: dict[str, Any] = {}


def _execution_mode() -> str:
    return (os.environ.get("COWORKER_EXECUTION_MODE") or "native").strip().lower()


def _run_chat_once(
    message: str,
    page: str | None = None,
    organization_id: str | None = None,
    session_id: str | None = None,
    history: list[dict] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    user_email: str | None = None,
    user_phone: str | None = None,
    user_role: str | None = None,
    can_create_ticket: bool | None = None,
    ticket_draft: dict | None = None,
    customer_draft: dict | None = None,
    kb_draft: dict | None = None,
    macro_draft: dict | None = None,
    team_draft: dict | None = None,
    priority_draft: dict | None = None,
    next_step: str | None = None,
    request_id: str | None = None,
    surface: str | None = None,
    portal_customer_id: str | None = None,
    portal_auth_mode: str | None = None,
    focused_entity: dict | None = None,
    chat_module: str | None = None,
    chat_surface: str | None = None,
    session_memory: dict | None = None,
) -> dict:
    del next_step  # UI-owned prompt hint; unused by native runner
    org = str(organization_id or "").strip()
    if not org:
        raise ValueError("organization_id is required")
    sid = str(session_id or "").strip() or f"anon_{org}_{int(time.time())}"

    drafts: dict[str, Any] = {}
    if ticket_draft:
        drafts["ticket_draft"] = ticket_draft
    if customer_draft:
        drafts["customer_draft"] = customer_draft
    if kb_draft:
        drafts["kb_draft"] = kb_draft
    if macro_draft:
        drafts["macro_draft"] = macro_draft
    if team_draft:
        drafts["team_draft"] = team_draft
    if priority_draft:
        drafts["priority_draft"] = priority_draft

    # Role-aware default for can_create_ticket
    role_l = str(user_role or "").strip().lower()
    if can_create_ticket is None:
        from app.parity_inventory import ROLE_CAN_CREATE_TICKET

        can_create_ticket = bool(ROLE_CAN_CREATE_TICKET.get(role_l, False))

    request = RunRequest(
        message=message,
        request_id=request_id,
        session_id=sid,
        actor=ActorContext(
            user_id=user_id,
            organization_id=org,
            user_role=user_role,
            user_name=user_name,
            user_email=user_email,
            user_phone=user_phone,
            can_create_ticket=can_create_ticket,
            portal_customer_id=portal_customer_id,
            portal_auth_mode=portal_auth_mode,
            portal_authenticated=bool(portal_customer_id) or role_l == "portal_customer",
        ),
        module=chat_module,
        surface=surface or chat_surface,
        page=page,
        page_surface=chat_surface,
        history=list(history or []),
        focused_entity=focused_entity,
        drafts=drafts,
        session_memory=dict(session_memory or {}),
        execution_mode="native",  # type: ignore[arg-type]
        budgets=RunBudgets(),
    )
    try:
        result = run_native_turn(request)
    except ConversationContextLoadError:
        return {
            "reply": "",
            "agent": "general",
            "session_id": sid,
            "actions": [],
            "request_id": request_id,
            "data": {
                "serviceError": "SERVICE_ERROR",
                "retryable": True,
            },
            "intent": None,
        }
    if result.error:
        code = result.error.code
        return {
            "reply": "",
            "agent": result.agent or "general",
            "session_id": sid,
            "actions": [],
            "request_id": result.request_id or request_id,
            "data": {
                "serviceError": code if code == "SERVICE_ERROR" else result.error.model_dump(),
                "retryable": result.error.retryable,
                "conversation_context_version": result.durable_memory_version,
            },
            "intent": None,
        }

    data = dict(result.data or {})
    if result.durable_memory:
        for key, value in result.durable_memory.items():
            data.setdefault(key, value)
    data["conversation_context_version"] = result.durable_memory_version
    data["source"] = "ai"
    return {
        "reply": (result.assistant_text or "").strip(),
        "agent": result.agent or "general",
        "session_id": sid,
        "actions": list(result.ui_actions or []),
        "request_id": result.request_id or request_id,
        "data": data,
        "intent": None,
        "toolProposals": list(result.tool_proposals or []),
        "patch": result.patch,
        "sessionMemoryPatch": result.session_memory_patch,
        "uiRefresh": result.ui_refresh,
    }


def run_chat(
    message: str,
    page: str | None = None,
    organization_id: str | None = None,
    session_id: str | None = None,
    history: list[dict] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    user_email: str | None = None,
    user_phone: str | None = None,
    user_role: str | None = None,
    can_create_ticket: bool | None = None,
    ticket_draft: dict | None = None,
    customer_draft: dict | None = None,
    kb_draft: dict | None = None,
    macro_draft: dict | None = None,
    team_draft: dict | None = None,
    priority_draft: dict | None = None,
    next_step: str | None = None,
    request_id: str | None = None,
    surface: str | None = None,
    portal_customer_id: str | None = None,
    portal_auth_mode: str | None = None,
    focused_entity: dict | None = None,
    chat_module: str | None = None,
    chat_surface: str | None = None,
    session_memory: dict | None = None,
) -> dict:
    """Serialize a session turn so a mutation cannot execute twice concurrently."""
    org = str(organization_id or "").strip()
    if not org:
        raise ValueError("organization_id is required")
    sid = str(session_id or "").strip() or f"anon_{org}_{int(time.time())}"
    with serialized_conversation_turn(build_thread_id(org, sid)):
        return _run_chat_once(
            message,
            page=page,
            organization_id=org,
            session_id=sid,
            history=history,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            user_phone=user_phone,
            user_role=user_role,
            can_create_ticket=can_create_ticket,
            ticket_draft=ticket_draft,
            customer_draft=customer_draft,
            kb_draft=kb_draft,
            macro_draft=macro_draft,
            team_draft=team_draft,
            priority_draft=priority_draft,
            next_step=next_step,
            request_id=request_id,
            surface=surface,
            portal_customer_id=portal_customer_id,
            portal_auth_mode=portal_auth_mode,
            focused_entity=focused_entity,
            chat_module=chat_module,
            chat_surface=chat_surface,
            session_memory=session_memory,
        )


def persist_ui_focused_entity(
    *,
    organization_id: str,
    session_id: str,
    user_id: str | None,
    user_name: str | None,
    user_role: str | None,
    focused_entity: dict | None,
    request_id: str | None = None,
) -> dict:
    """Immediately inject the open UI item into durable conversation_context."""
    from app.focus_entity import apply_ui_focused_entity
    from app.memory import (
        ConversationContextLoadError,
        StaleConversationContextError,
        load_conversation_context,
        save_conversation_context,
    )

    del user_name, user_role, request_id
    org = str(organization_id or "").strip()
    sid = str(session_id or "").strip()
    if not org or not sid:
        raise ValueError("organization_id and session_id are required")
    with serialized_conversation_turn(build_thread_id(org, sid)):
        try:
            prior, version = load_conversation_context(org, user_id, sid)
        except ConversationContextLoadError:
            prior, version = {}, 0
        updated = apply_ui_focused_entity(
            prior if isinstance(prior, dict) else {},
            focused_entity,
        )
        try:
            new_version = save_conversation_context(
                org,
                user_id,
                sid,
                updated,
                expected_version=version,
            )
        except StaleConversationContextError:
            prior2, version2 = load_conversation_context(org, user_id, sid)
            updated2 = apply_ui_focused_entity(
                prior2 if isinstance(prior2, dict) else {},
                focused_entity,
            )
            try:
                new_version = save_conversation_context(
                    org,
                    user_id,
                    sid,
                    updated2,
                    expected_version=version2,
                )
            except StaleConversationContextError:
                prior3, version3 = load_conversation_context(org, user_id, sid)
                updated2 = apply_ui_focused_entity(
                    prior3 if isinstance(prior3, dict) else {},
                    focused_entity,
                )
                new_version = save_conversation_context(
                    org,
                    user_id,
                    sid,
                    updated2,
                    expected_version=version3,
                )
            updated = updated2
        return {
            "ok": True,
            "last_entity": (updated or {}).get("last_entity"),
            "version": new_version,
        }


def _ensure_navigate_actions(actions: list[dict] | None, view: str | None) -> list[dict]:
    """Compatibility helper used by navigation tests."""
    out = list(actions or [])
    if view and not any(a.get("type") == "navigate" for a in out if isinstance(a, dict)):
        out.append({"type": "navigate", "view": view})
    return out


def _messages_for_turn(history: list[dict] | None, message: str) -> list[dict]:
    """Compatibility helper: plain message list for a turn."""
    msgs: list[dict] = []
    for item in history or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "")
        text = str(item.get("text") or item.get("content") or "")
        if role in ("user", "assistant") and text.strip():
            msgs.append({"role": role, "content": text.strip()})
    if message:
        msgs.append({"role": "user", "content": message})
    return msgs
