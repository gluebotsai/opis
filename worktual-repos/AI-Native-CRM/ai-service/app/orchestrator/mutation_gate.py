"""LLM mutation intent verification and turn-level mutation detection (no keyword routing)."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Sequence

from pydantic import BaseModel, Field

from app.agents.llm_result import extract_json, sectioned_system_prompt


def with_leading_system_instruction(
    messages: Sequence[dict[str, Any]],
    instruction: str,
) -> list[dict[str, Any]]:
    """Add an instruction without violating providers that require system first."""
    extra = str(instruction or "").strip()
    copied = [dict(message) for message in messages]
    if not extra:
        return copied
    if copied and copied[0].get("role") == "system":
        existing = str(copied[0].get("content") or "").strip()
        copied[0]["content"] = f"{existing}\n\n{extra}" if existing else extra
        return copied
    return [{"role": "system", "content": extra}, *copied]


_MUTATION_REPAIR_AGENTS = frozenset(
    {
        "contact-agent",
        "company-agent",
        "deal-agent",
        "product-agent",
        "finance-agent",
        "quotes-agent",
        "proposal-agent",
    }
)

_MUTATION_TOOL_PREFIXES = (
    "propose_update_",
    "propose_delete_",
    "propose_stage_",
    "propose_reassign_",
    "propose_merge_",
    "propose_patch_",
    "patch_",
    "propose_create_",
    "propose_send_",
)


def mutation_repair_agent(agent_name: str) -> bool:
    return agent_name in _MUTATION_REPAIR_AGENTS


def turn_has_mutation_action(
    *,
    proposals: Sequence[dict[str, Any]],
    patch: dict[str, Any] | None,
) -> bool:
    """True when this turn already emitted a CRM mutation or draft patch."""
    if patch:
        return True
    for item in proposals:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        if any(name.startswith(prefix) for prefix in _MUTATION_TOOL_PREFIXES):
            return True
    return False


def turn_has_navigation_action(proposals: Sequence[dict[str, Any]]) -> bool:
    for item in proposals:
        if not isinstance(item, dict):
            continue
        if str(item.get("name") or "") in {"navigate", "open_entity"}:
            return True
    return False


_CREATE_HANDOFF_HREFS = frozenset(
    {
        "/contact/new",
        "/company/new",
        "/sales/new",
        "/product/new",
        "/finance/new",
        "/activities/log",
        "/sales/quotes/new",
        "/contact",
        "/company",
        "/sales",
        "/product",
        "/finance",
        "/activities",
        "/sales/quotes",
    }
)


def _proposal_href_path(args: dict[str, Any]) -> str:
    raw = str(args.get("href") or "").strip()
    path = raw.split("?")[0].split("#")[0].rstrip("/") or "/"
    return path if path.startswith("/") else ""


def seeded_create_navigate(proposals: Sequence[dict[str, Any]]) -> bool:
    """True when this turn only opens a create form that will continue via seedPrompt."""
    for item in proposals:
        if not isinstance(item, dict):
            continue
        args = item.get("args") if isinstance(item.get("args"), dict) else {}
        seed = str(args.get("seedPrompt") or "").strip()
        if not seed:
            continue
        name = str(item.get("name") or "")
        if name == "set_workspace" and str(args.get("mode") or "") in {
            "create",
            "create_quote",
        }:
            return True
        if name in {"navigate", "open_entity"}:
            if _proposal_href_path(args) in _CREATE_HANDOFF_HREFS:
                return True
    return False


def turn_already_acted(
    *,
    proposals: Sequence[dict[str, Any]],
    patch: dict[str, Any] | None,
    ui_refresh: dict[str, Any] | None = None,
) -> bool:
    """True when the specialist already ran a tool or wrote a draft patch.

    Navigate / open-create is a completed action. Do not overwrite that reply
    with a second 'mutation failed' line.
    """
    if turn_has_mutation_action(proposals=proposals, patch=patch):
        return True
    if ui_refresh:
        return True
    for item in proposals:
        if isinstance(item, dict) and str(item.get("name") or "").strip():
            return True
    return False


class MutationIntentDecision(BaseModel):
    mutation_requested: bool = Field(alias="mutationRequested")

    model_config = {"populate_by_name": True}


class SpeechClaimDecision(BaseModel):
    claimed_done: bool = Field(alias="claimedDone")

    model_config = {"populate_by_name": True}


def conversation_excerpt(messages: Sequence[dict[str, Any]] | None, *, limit: int = 8) -> str:
    """Last user/assistant turns for mutation verification (no keyword routing)."""
    rows: list[dict[str, str]] = []
    for item in messages or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        text = str(item.get("content") or item.get("text") or "").strip()
        if not text:
            continue
        rows.append({"role": role, "text": text[:500]})
    return json.dumps(rows[-limit:], ensure_ascii=False)


def _open_record_ctx(
    *,
    agent_name: str,
    module: str,
    surface: str,
    entity_id: str | None,
    catalog: dict[str, Any],
    conversation: str,
) -> dict[str, Any]:
    open_ctx: dict[str, Any] = {
        "agent": agent_name,
        "module": module,
        "surface": surface,
        "entityId": entity_id or "",
        "recentConversation": conversation,
    }
    for key in (
        "openContact",
        "openCompany",
        "openDeal",
        "openQuote",
        "openInvoice",
        "openProduct",
        "openProposal",
    ):
        val = catalog.get(key)
        if isinstance(val, dict) and val:
            open_ctx[key] = {
                k: val.get(k)
                for k in ("id", "displayName", "name", "title", "email", "stage", "status")
                if val.get(k) is not None
            }
    return open_ctx


async def llm_open_record_mutation_requested(
    *,
    user_text: str,
    agent_name: str,
    module: str,
    surface: str,
    entity_id: str | None,
    catalog: dict[str, Any],
    remaining_seconds: float,
    messages: Sequence[dict[str, Any]] | None = None,
) -> bool:
    """LLM decides whether this turn should persist a change on the open record."""
    text = (user_text or "").strip()
    if not text or remaining_seconds <= 2:
        return False
    from app.llm import chat_with_tools, is_ai_configured

    if not is_ai_configured():
        return False

    open_ctx = _open_record_ctx(
        agent_name=agent_name,
        module=module,
        surface=surface,
        entity_id=entity_id,
        catalog=catalog,
        conversation=conversation_excerpt(messages),
    )
    prompt = sectioned_system_prompt(
        role="You verify CRM mutation intent before tools run.",
        goal=(
            "Decide whether this turn should persist a change on the open CRM record "
            "or create-form draft."
        ),
        instructions=(
            "Use recentConversation. A short latest message is still a persist if it "
            "answers the assistant's request for a field value (source, email, stage, …). "
            "Answer mutationRequested=true for field assignment, delete, stage move, "
            "owner reassignment, or writing create-form draft fields (title, contact, "
            "company, amount). "
            "Answer false for navigation only, opening an empty create form with no "
            "fields yet, new questions, reports, greetings, or chat with no persistable change."
        ),
        context=json.dumps(open_ctx, default=str),
        output='Return only JSON: {"mutationRequested": true} or {"mutationRequested": false}.',
        guardrails="Do not invent field values. Routing only — no user-facing reply.",
    )
    try:
        response = await asyncio.wait_for(
            chat_with_tools(
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text},
                ],
                tools=None,
                max_tokens=80,
                timeout_ms=max(1, int(min(remaining_seconds, 12) * 1000)),
                temperature=0.0,
            ),
            timeout=min(remaining_seconds, 12),
        )
    except (asyncio.TimeoutError, Exception):
        return False
    parsed = extract_json(str((response or {}).get("content") or ""))
    if not parsed:
        return False
    try:
        decision = MutationIntentDecision.model_validate(parsed)
    except Exception:
        return False
    return bool(decision.mutation_requested)


async def llm_speech_claims_mutation_done(
    *,
    assistant_text: str,
    remaining_seconds: float,
) -> bool:
    """True when the draft reply claims a CRM persist already happened."""
    text = (assistant_text or "").strip()
    if not text or remaining_seconds <= 2:
        return False
    from app.llm import chat_with_tools, is_ai_configured

    if not is_ai_configured():
        return False
    prompt = sectioned_system_prompt(
        role="You audit coworker speech before it reaches the user.",
        goal="Detect a false claim that a CRM record was already updated or saved.",
        instructions=(
            "claimedDone=true if the text says the update/save/delete/stage change "
            "already succeeded. claimedDone=false if it only asks a question, "
            "navigates, or says it could not apply the change."
        ),
        context="",
        output='Return only JSON: {"claimedDone": true} or {"claimedDone": false}.',
        guardrails="No user-facing reply. Do not rewrite the speech.",
    )
    try:
        response = await asyncio.wait_for(
            chat_with_tools(
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text[:800]},
                ],
                tools=None,
                max_tokens=60,
                timeout_ms=max(1, int(min(remaining_seconds, 8) * 1000)),
                temperature=0.0,
            ),
            timeout=min(remaining_seconds, 8),
        )
    except (asyncio.TimeoutError, Exception):
        return False
    parsed = extract_json(str((response or {}).get("content") or ""))
    if not parsed:
        return False
    try:
        decision = SpeechClaimDecision.model_validate(parsed)
    except Exception:
        return False
    return bool(decision.claimed_done)


def open_record_mutation_repair_instruction(
    *,
    agent_name: str,
    module: str,
    surface: str,
    entity_id: str | None,
) -> str:
    """System addendum for a forced tool pass after a missed mutation."""
    record = entity_id or "(use entityId from page context)"
    if (surface or "").lower() == "create":
        return (
            f"The user already named create-form fields while {agent_name} is active "
            f"(module={module}, surface=create). "
            "You must call the matching patch_*_draft tool in this turn with every "
            "title, name, company, contact, or amount they already gave. "
            "Do not say the draft is set unless that tool ran. "
            "Then ask only for the next missing field."
        )
    return (
        f"The user asked to change CRM data while {agent_name} is active "
        f"(module={module}, surface={surface}, open record id={record}). "
        "You must call the correct mutation MCP tool in this turn with auto=true and the "
        "open record id before any confirmation text. "
        "Do not tell the user the update succeeded unless the tool result says ok. "
        "If required values are missing, call ask_clarification once with a specific question."
    )


async def llm_mutation_not_applied_speech(
    *,
    user_text: str,
    agent_name: str,
    remaining_seconds: float,
) -> str:
    """One honest sentence when mutation was requested but no tool ran (no false success)."""
    from app.llm import chat_with_tools, is_ai_configured

    if not is_ai_configured() or remaining_seconds <= 2:
        return "I couldn't queue that change yet — please repeat what you'd like updated."
    prompt = sectioned_system_prompt(
        role="CRM coworker",
        goal="Acknowledge that the requested CRM change was not applied yet.",
        instructions=(
            "Write one short sentence. Do not claim the update succeeded, saved, or went through. "
            "Ask them to repeat the field and value, or offer to try again."
        ),
        context=f"Specialist: {agent_name}. User asked: {user_text[:400]}",
        output="Plain text only, no markdown.",
        guardrails="Never say done, saved, updated, or success.",
    )
    try:
        response = await asyncio.wait_for(
            chat_with_tools(
                messages=[
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": f"Original user request:\n{user_text[:400]}",
                    },
                ],
                tools=None,
                max_tokens=120,
                timeout_ms=max(1, int(min(remaining_seconds, 10) * 1000)),
                temperature=0.2,
            ),
            timeout=min(remaining_seconds, 10),
        )
    except (asyncio.TimeoutError, Exception):
        return "I couldn't queue that change yet — please repeat what you'd like updated."
    text = str((response or {}).get("content") or "").strip()
    return text or "I couldn't queue that change yet — please repeat what you'd like updated."
