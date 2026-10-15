"""Tenant-scoped Lola Assist for suggested replies and Inbox coworker chat."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from html import unescape
from pathlib import Path
from typing import Any

from app.agents.coworker.conversation_assist import normalise_assist_state
from app.agents.custom_booxoo_bot.memory import SessionManager
from app.agents.custom_booxoo_bot.multi_agent import Agent as AssistToolAgent
from app.agents.custom_booxoo_bot.runner import TurnContext, TurnRequest
from app.agents.custom_lola_assist.context_snapshot import load_lola_customer_context
from app.agents.custom_lola_assist.llm import get_lola_assist_llm
from app.agents.custom_lola_assist.tools import build_lola_assist_tools
from app.logging import get_logger
from app.mcp.context import CcCoreError, CcCoreHTTPAdapter
from app.runtime.context import RunContext
from app.runtime.sse import sse_assist_state, sse_done, sse_text_delta
from app.schemas.copilot import ToolContext

logger = get_logger("nlp.custom_lola_assist")

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "assist.md"
_sessions = SessionManager()
_TAG = re.compile(r"<[^>]+>")
_CALL_CHANNELS = {"call", "voice", "phone"}
_SNAPSHOT_SHAPE = "lola-v1-tickets-all-appointment-sentiment"
PROMPT_VERSION = "v3"


def _plain(value: Any) -> str:
    text = unescape(_TAG.sub(" ", str(value or "")))
    return " ".join(text.split())


def _prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _session_key(organization_id: str, conversation_id: str) -> str:
    return f"assist:{organization_id}:{conversation_id}"


def lola_assist_session(organization_id: str, conversation_id: str):
    return _sessions.get_or_create(_session_key(organization_id, conversation_id))


def _history_role(role: str) -> str | None:
    normalized = role.strip().lower()
    if normalized in {"customer", "user", "visitor"}:
        return "user"
    if normalized in {"agent", "bot", "assistant"}:
        return "assistant"
    return None


def _transcript(context_payload: dict[str, Any]) -> list[dict[str, str]]:
    messages = context_payload.get("messages")
    if not isinstance(messages, list):
        return []
    history: list[dict[str, str]] = []
    for item in messages[-30:]:
        if not isinstance(item, dict):
            continue
        role = _history_role(str(item.get("role") or item.get("senderType") or ""))
        content = _plain(item.get("body") or item.get("content"))
        if role and content:
            history.append({"role": role, "content": content})
    return history


def _customer_and_conversation(
    context_payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    customer = (
        context_payload.get("customer")
        if isinstance(context_payload.get("customer"), dict)
        else {}
    )
    contact = customer.get("contact") if isinstance(customer.get("contact"), dict) else {}
    conversation = (
        context_payload.get("conversation")
        if isinstance(context_payload.get("conversation"), dict)
        else {}
    )
    return customer, contact, conversation


def _seed_contact(session, context_payload: dict[str, Any]) -> str:
    customer, contact, conversation = _customer_and_conversation(context_payload)
    name = _plain(contact.get("fullName"))
    if not name:
        name = " ".join(
            part
            for part in (
                _plain(contact.get("firstName")),
                _plain(contact.get("lastName")),
            )
            if part
        )
    email = _plain(contact.get("primaryEmail") or contact.get("email"))
    phone = _plain(contact.get("primaryPhone") or contact.get("phone"))
    cdp_id = _plain(contact.get("id") or customer.get("contactId"))
    if name and not session.contact.get("name"):
        session.contact["name"] = name
    if email and not session.contact.get("email"):
        session.contact["email"] = email
    if phone and not session.contact.get("phone"):
        session.contact["phone"] = phone
    if cdp_id and not session.cdp_id:
        session.cdp_id = cdp_id
    return _plain(customer.get("visitorId") or conversation.get("visitorId") or email)


def _caller_number(context_payload: dict[str, Any]) -> str:
    customer, _contact, conversation = _customer_and_conversation(context_payload)
    raw = _plain(customer.get("visitorId") or conversation.get("visitorId"))
    return raw if len("".join(character for character in raw if character.isdigit())) >= 7 else ""


def _channel(context_payload: dict[str, Any]) -> str:
    _customer, _contact, conversation = _customer_and_conversation(context_payload)
    return _plain(conversation.get("channel")).lower() or "webchat"


def _digits(value: Any) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())


def _channel_identity_verified(
    session,
    channel: str,
    context_payload: dict[str, Any],
) -> bool:
    customer, _contact, conversation = _customer_and_conversation(context_payload)
    visitor = _plain(customer.get("visitorId") or conversation.get("visitorId"))
    if channel == "email":
        return bool(
            visitor
            and any(visitor.lower() == value.lower() for value in session.stored_emails)
        )
    if channel in _CALL_CHANNELS:
        caller = _digits(visitor)
        return bool(
            len(caller) >= 7
            and any(caller == _digits(value) for value in session.stored_phones)
        )
    return False


def _channel_note(channel: str, verified: bool) -> str:
    note = f"\n\nThe human agent is handling this customer on the {channel} channel."
    if channel == "email" and verified:
        return note + " The sender address verifies this customer. Do not request OTP."
    if channel == "email":
        return note + " The sender address did not resolve to this customer. The session is not verified."
    if channel in _CALL_CHANNELS and verified:
        return note + " The caller number resolved to this customer, so the session is verified."
    if channel in _CALL_CHANNELS:
        return (
            note
            + " The caller number did not resolve to a Worktual customer. The session is not verified."
        )
    if verified:
        return note + " This assist session is verified. Do not request another OTP."
    return note + " This assist session is not verified. Business mutations must not run."


async def _load_context(context: RunContext) -> dict[str, Any]:
    if not context.conversation_id:
        return {}
    tool_context = ToolContext(
        tenant_id=context.tenant_id,
        user_id=context.user_id,
        authorization=str(context.extra.get("authorization") or "") or None,
        role=context.role if context.role in {"admin", "agent"} else "agent",  # type: ignore[arg-type]
        conversation_id=context.conversation_id,
    )
    try:
        payload = await CcCoreHTTPAdapter().request(
            "GET",
            f"/api/v1/workspace/conversations/{context.conversation_id}/context",
            tool_context,
        )
    except CcCoreError:
        logger.warning(
            "lola assist context unavailable organization_id=%s conversation_id=%s",
            context.tenant_id,
            context.conversation_id,
        )
        return {}
    if isinstance(payload, dict) and isinstance(payload.get("context"), dict):
        return payload["context"]
    return {}


def _ensure_context_block(
    session,
    organization_id: str,
    conversation_id: str,
    context_payload: dict[str, Any],
) -> str:
    email = str(session.contact.get("email") or "")
    phone = str(session.contact.get("phone") or "")
    cache_key = (
        f"{_session_key(organization_id, conversation_id)}:{email.lower()}:"
        f"{''.join(character for character in phone if character.isdigit())}:{_SNAPSHOT_SHAPE}"
    )
    if session.context_block_key == cache_key and session.context_block:
        return session.context_block
    customer, contact, conversation = _customer_and_conversation(context_payload)
    loaded = load_lola_customer_context(
        organization_id,
        cdp_id=str(session.cdp_id or _plain(contact.get("id") or customer.get("contactId"))),
        email=email or _plain(contact.get("primaryEmail") or contact.get("email")),
        phone=phone or _plain(contact.get("primaryPhone") or contact.get("phone")),
        visitor_id=_plain(customer.get("visitorId") or conversation.get("visitorId")),
        conversation_id=conversation_id,
        context_payload=context_payload,
    )
    session.customer_found = loaded.found
    if loaded.cdp_id:
        session.cdp_id = loaded.cdp_id
    if loaded.email:
        session.contact["email"] = loaded.email
    if loaded.phone:
        session.contact["phone"] = loaded.phone
    session.stored_emails = loaded.emails
    session.stored_phones = loaded.phones
    session.context_block = loaded.block
    session.context_block_key = cache_key
    return loaded.block


def _audience_note(audience: str) -> str:
    if audience == "agent":
        return (
            "\n\nThis turn audience is the support agent in Inbox coworker chat. "
            "The latest user message is from that support agent. Answer in plain sentences, not JSON. "
            "Do not send a customer message. Use create_lola_ticket or cancel_lola_appointment only "
            "when this support agent explicitly asks for that action. If asked for customer wording, "
            "provide sendable text and label it as a draft."
        )
    return (
        "\n\nThis turn audience is the customer suggested-reply draft. Return exactly one JSON object. "
        "replyDraft is only the exact sendable customer message in the human agent's voice. "
        "Start by addressing the customer directly. Do not preface it, discuss drafting it, mention "
        "AI assistance or a knowledge base, or include instructions to the support agent. "
        "actionProposal is null. "
        "Do not create tickets, cancel appointments, send OTP, or claim any such action happened. "
        "When verification or an action is needed, explain the next step in replyDraft. "
        "Do not tell the customer to contact a sales agent, support agent, or another agent."
    )


def _run_turn(session, request: TurnRequest, query: str, context_block: str, audience: str) -> str:
    agent = AssistToolAgent(
        name="custom_lola_assist",
        system=(
            _prompt()
            + _channel_note(request.channel, bool(session.authenticated))
            + "\n\n"
            + context_block
            + _audience_note(audience)
        ),
        tools=build_lola_assist_tools(audience),
        llm=get_lola_assist_llm(),
        handoff_instruction="",
        max_tool_rounds=8,
    )
    result = agent.run(query or None, TurnContext(request=request, session=session, agent_name=agent.name))
    if result.get("response_type") == "terminal_response":
        payload = result.get("result") or {}
        return str(payload.get("text") or "")
    return str(result.get("text") or "")


def _agent_answer(text: str) -> str:
    plain = _plain(text)
    start = plain.find("{")
    end = plain.rfind("}")
    if start == -1 or end <= start:
        return plain
    try:
        payload = json.loads(plain[start : end + 1])
    except json.JSONDecodeError:
        return plain
    draft = payload.get("replyDraft") if isinstance(payload, dict) else None
    return draft.strip() if isinstance(draft, str) and draft.strip() else plain


def _coworker_turns(messages: list[dict[str, Any]]) -> tuple[list[dict[str, str]], str]:
    turns: list[dict[str, str]] = []
    for item in messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = _plain(item.get("content"))
        if role in {"user", "assistant"} and content:
            turns.append({"role": role, "content": content})
    if turns and turns[-1]["role"] == "user":
        return turns[:-1], turns[-1]["content"]
    return turns, ""


async def stream_lola_assist(
    messages: list[dict[str, Any]],
    context: RunContext,
    audience: str = "customer",
) -> AsyncIterator[str]:
    conversation_id = str(context.conversation_id or "")
    context_payload = await _load_context(context)
    session = lola_assist_session(context.tenant_id, conversation_id)
    channel = _channel(context_payload)
    session.channel = channel
    caller = _caller_number(context_payload) if channel in _CALL_CHANNELS else ""
    visitor_id = _seed_contact(session, context_payload)
    if caller and not session.contact.get("phone"):
        session.contact["phone"] = caller
    context_block = await asyncio.to_thread(
        _ensure_context_block,
        session,
        context.tenant_id,
        conversation_id,
        context_payload,
    )
    if session.customer_found and _channel_identity_verified(session, channel, context_payload):
        session.authenticated = True

    if audience == "agent":
        history, query = _coworker_turns(messages)
    else:
        history = _transcript(context_payload)
        query = str(messages[-1].get("content") or "").strip() if messages else ""
        if history and query and history[-1]["role"] == "user" and history[-1]["content"] == query:
            query = ""
    session.memory.replace_history(history)
    request = TurnRequest(
        organization_id=context.tenant_id,
        session_id=conversation_id,
        conversation_id=conversation_id,
        message=query,
        visitor_id=visitor_id,
        channel=channel,
    )
    text = await asyncio.to_thread(_run_turn, session, request, query, context_block, audience)
    if audience == "agent":
        answer = _agent_answer(text) or "I could not complete that. Please try again."
        yield sse_text_delta(answer)
        yield sse_done(
            route="inbox",
            routing_chain=["custom_lola_assist"],
            prompt_versions={"custom_lola_assist": PROMPT_VERSION},
        )
        return

    state = normalise_assist_state(text, context)
    state["actionProposal"] = None
    if not str(state.get("replyDraft") or "").strip():
        state["replyDraft"] = (
            "Could you share the email address or phone number you use with Worktual "
            "so I can check this for you?"
        )
    yield sse_text_delta(str(state["replyDraft"]))
    yield sse_assist_state(state)
    yield sse_done(
        route="inbox",
        routing_chain=["custom_lola_assist"],
        prompt_versions={"custom_lola_assist": PROMPT_VERSION},
    )
