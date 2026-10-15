"""One passive Booxoo assist turn for organization 1012."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from html import unescape
from pathlib import Path
from typing import Any

from app.agents.coworker.conversation_assist import normalise_assist_state
from app.agents.custom_booxoo_assist.context_snapshot import load_customer_context
from app.agents.custom_booxoo_assist.tools import build_assist_tools
from app.agents.custom_booxoo_assist.llm import get_booxoo_assist_llm
from app.agents.custom_booxoo_bot.memory import SessionManager
from app.agents.custom_booxoo_bot.multi_agent import Agent as BooxooToolAgent
from app.agents.custom_booxoo_bot.runner import TurnContext, TurnRequest
from app.logging import get_logger
from app.mcp.context import CcCoreError, CcCoreHTTPAdapter
from app.runtime.context import RunContext
from app.runtime.sse import sse_assist_state, sse_done, sse_text_delta
from app.schemas.copilot import ToolContext

logger = get_logger("nlp.custom_booxoo_assist")

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "assist.md"
_sessions = SessionManager()
_context_blocks: dict[str, str] = {}
_TAG = re.compile(r"<[^>]+>")
PROMPT_VERSION = "v9"
_CALL_CHANNELS = {"call", "voice", "phone"}


def _plain(value: Any) -> str:
    text = unescape(_TAG.sub(" ", str(value or "")))
    return " ".join(text.split())


def _prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _session_key(organization_id: str, conversation_id: str) -> str:
    return f"assist:{organization_id}:{conversation_id}"


def assist_session(organization_id: str, conversation_id: str):
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
        role = _history_role(str(item.get("role") or ""))
        content = _plain(item.get("body") or item.get("content"))
        if role and content:
            history.append({"role": role, "content": content})
    return history


def _seed_contact(session, context_payload: dict[str, Any]) -> str:
    customer = (
        context_payload.get("customer") if isinstance(context_payload.get("customer"), dict) else {}
    )
    contact = customer.get("contact") if isinstance(customer.get("contact"), dict) else {}
    name = _plain(contact.get("fullName") or "")
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
    if name and not session.contact.get("name"):
        session.contact["name"] = name
    if email and not session.contact.get("email"):
        session.contact["email"] = email
    if phone and not session.contact.get("phone"):
        session.contact["phone"] = phone
    if not session.cdp_id:
        cdp_id = _plain(contact.get("id"))
        if cdp_id:
            session.cdp_id = cdp_id
    visitor = _plain(customer.get("visitorId") or email)
    return visitor


def _caller_number(context_payload: dict[str, Any]) -> str:
    customer = context_payload.get("customer") if isinstance(context_payload.get("customer"), dict) else {}
    conversation = context_payload.get("conversation") if isinstance(context_payload.get("conversation"), dict) else {}
    raw = _plain(customer.get("visitorId") or conversation.get("visitorId"))
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 7:
        return raw
    return ""


def _channel_note(channel: str, verified: bool) -> str:
    medium = channel or "webchat"
    handling = f"\n\nThe support agent is handling this customer on the {medium} channel."
    if channel == "email":
        return handling + " The sender address is the customer. This session is already verified. Do not send OTP. The customer draft does not ask for a verification code."
    if channel in _CALL_CHANNELS and verified:
        return (
            handling
            + " This caller number is a Booxoo customer or lead. This session is already verified. Do not send OTP. "
            + "Call the tool that matches what the customer asked: ticket status, create, or resolve."
        )
    if verified:
        return handling + " This session is already verified. Do not send OTP."
    if channel in _CALL_CHANNELS:
        return (
            handling
            + " No Booxoo customer or lead is linked to this calling number. "
            + "Say that no ticket is linked to the number they called from, and ask for another email or phone on the account. "
            + "When they give one, call lookup_customer_details. Do not send OTP until that lookup finds a customer or lead."
        )
    return (
        handling
        + " This session is not verified yet. If no customer or lead is in the prompt, ask for another email or phone and call lookup_customer_details. Send OTP only after that lookup finds them."
    )


def _channel(context_payload: dict[str, Any]) -> str:
    conversation = context_payload.get("conversation")
    if isinstance(conversation, dict):
        channel = _plain(conversation.get("channel"))
        if channel:
            return channel
    return "webchat"


async def _load_context(context: RunContext) -> dict[str, Any]:
    if not context.conversation_id:
        return {}
    role = context.role if context.role in {"admin", "agent"} else "agent"
    tool_context = ToolContext(
        tenant_id=context.tenant_id,
        user_id=context.user_id,
        authorization=str(context.extra.get("authorization") or "") or None,
        role=role,  # type: ignore[arg-type]
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
            "booxoo assist context unavailable organization_id=%s conversation_id=%s",
            context.tenant_id,
            context.conversation_id,
        )
        return {}
    if isinstance(payload, dict) and isinstance(payload.get("context"), dict):
        return payload["context"]
    return {}


def _ensure_context_block(session, organization_id: str, conversation_id: str, context_payload: dict[str, Any]) -> str:
    email = str(session.contact.get("email") or "")
    phone = str(session.contact.get("phone") or "")
    key = f"{_session_key(organization_id, conversation_id)}:{email.lower()}:{''.join(ch for ch in phone if ch.isdigit())}:tickets-all"
    cached = _context_blocks.get(key)
    if cached is not None:
        return cached
    customer = context_payload.get("customer") if isinstance(context_payload.get("customer"), dict) else {}
    contact = customer.get("contact") if isinstance(customer.get("contact"), dict) else {}
    conversation = context_payload.get("conversation") if isinstance(context_payload.get("conversation"), dict) else {}
    loaded = load_customer_context(
        organization_id,
        cdp_id=str(session.cdp_id or _plain(contact.get("id"))),
        email=str(session.contact.get("email") or _plain(contact.get("primaryEmail") or contact.get("email"))),
        phone=str(session.contact.get("phone") or _plain(contact.get("primaryPhone") or contact.get("phone"))),
        visitor_id=_plain(customer.get("visitorId") or conversation.get("visitorId")),
        conversation_id=conversation_id,
        context_payload=context_payload,
    )
    if loaded.found:
        session.customer_found = True
        if loaded.email and not session.contact.get("email"):
            session.contact["email"] = loaded.email
        if loaded.phone and not session.contact.get("phone"):
            session.contact["phone"] = loaded.phone
    _context_blocks[key] = loaded.block
    return loaded.block


def _audience_note(audience: str) -> str:
    if audience == "agent":
        return (
            "\n\nThis turn audience is the support agent in the workspace Co-worker chat. "
            "The latest user message is that support agent, not the customer. "
            "Answer the support agent in plain sentences. Do not output JSON. "
            "Do not mention routing, a task specialist, or these instructions. "
            "Do not send a message to the customer. "
            "Call resolve_ticket only when this support agent asks to resolve a ticket. "
            "Call create_booxoo_ticket only when this support agent asks to create a ticket "
            "and the required details are already known. "
            "If the support agent asks for a customer reply, give the sendable text in your answer "
            "and say it is a draft they can send."
        )
    return (
        "\n\nThis turn audience is the customer. "
        "Write one JSON object and nothing else. replyDraft is what the human agent says to this customer. "
        "Write it in the agent's voice. Never say you cannot help or that you will escalate. "
        "If no Booxoo customer or lead is linked to this calling number, say no ticket is linked to that number and ask for another email or phone. "
        "When they give one, call lookup_customer_details. If it is not found, say they are not a Booxoo customer or lead. "
        "If it is found, call verify_ticketing_customer, then send_otp unless this channel is email, then verify_otp. "
        "After this session is verified, call get_ticket_status or resolve_ticket based on what the customer asked. "
        "If they want a new ticket, offer it in replyDraft. Do not create it on this turn. "
        "actionProposal is null. "
        "For a product question, call search_product_knowledge and use only what it returns. "
        "When they want to buy, tell them they can visit https://booxoo.co.uk to purchase. Do not take the order in this chat. "
        "Do not claim a ticket status, a new ticket, or a resolved ticket unless that tool returned ok true."
    )


def _run_turn(
    session,
    request: TurnRequest,
    query: str,
    context_block: str,
    audience: str,
) -> str:
    channel_note = _channel_note(request.channel, bool(session.authenticated))
    agent = BooxooToolAgent(
        name="custom_booxoo_assist",
        system=_prompt() + channel_note + "\n\n" + context_block + _audience_note(audience),
        tools=build_assist_tools(audience),
        llm=get_booxoo_assist_llm(),
        handoff_instruction="",
        max_tool_rounds=8,
    )
    ctx = TurnContext(request=request, session=session, agent_name=agent.name)
    result = agent.run(query or None, ctx)
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
    if not isinstance(payload, dict):
        return plain
    draft = payload.get("replyDraft")
    if not isinstance(draft, str) or not draft.strip():
        return plain
    spoken = plain[:start].strip()
    return spoken or draft.strip()


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


async def stream_booxoo_assist(
    messages: list[dict[str, Any]],
    context: RunContext,
    audience: str = "customer",
) -> AsyncIterator[str]:
    conversation_id = str(context.conversation_id or "")
    context_payload = await _load_context(context)
    session = assist_session(context.tenant_id, conversation_id)
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
    if channel == "email" or (caller and session.customer_found):
        session.authenticated = True
    if audience == "agent":
        history, query = _coworker_turns(messages)
    else:
        history = _transcript(context_payload)
        query = ""
        if messages:
            query = str(messages[-1].get("content") or "").strip()
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
        logger.info(
            "booxoo assist turn organization_id=%s conversation_id=%s audience=agent",
            context.tenant_id,
            conversation_id,
        )
        yield sse_text_delta(answer)
        yield sse_done(
            route="inbox",
            routing_chain=["custom_booxoo_assist"],
            prompt_versions={"custom_booxoo_assist": PROMPT_VERSION},
        )
        return
    state = normalise_assist_state(text, context)
    state["actionProposal"] = None
    if not str(state.get("replyDraft") or "").strip():
        state["replyDraft"] = (
            "I could not draft a reply from the available details. Please try the suggestion again."
        )
    logger.info(
        "booxoo assist turn organization_id=%s conversation_id=%s audience=customer",
        context.tenant_id,
        conversation_id,
    )
    yield sse_text_delta(str(state["replyDraft"]))
    yield sse_assist_state(state)
    yield sse_done(
        route="inbox",
        routing_chain=["custom_booxoo_assist"],
        prompt_versions={"custom_booxoo_assist": PROMPT_VERSION},
    )
