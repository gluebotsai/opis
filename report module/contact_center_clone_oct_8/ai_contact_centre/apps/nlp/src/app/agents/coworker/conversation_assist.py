"""Passive direct-L3 conversation drafting for human support agents."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.agents.definitions import CONVERSATION_ASSIST_DEFINITION
from app.llm.providers import parse_json_object
from app.runtime.agent import Agent
from app.runtime.context import RunContext
from app.runtime.memory import SessionMemory
from app.runtime.sse import sse_assist_state, sse_done, sse_text_delta


def _frame_event(frame: str) -> tuple[str, dict[str, Any]]:
    event = ""
    data = ""
    for line in frame.splitlines():
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data = line[5:].strip()
    try:
        payload = json.loads(data) if data else {}
    except (TypeError, ValueError):
        payload = {}
    return event, payload if isinstance(payload, dict) else {}


def _normalise_notes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    notes: list[dict[str, Any]] = []
    for item in value[:20]:
        if isinstance(item, str) and item.strip():
            notes.append({"kind": "fact", "text": item.strip()})
        elif isinstance(item, dict):
            text = str(item.get("text") or "").strip()
            if text:
                notes.append(
                    {
                        "kind": str(item.get("kind") or "fact")[:32],
                        "text": text[:1000],
                    }
                )
    return notes


def normalise_assist_state(
    content: str,
    context: RunContext,
) -> dict[str, Any]:
    try:
        payload = parse_json_object(content)
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {"replyDraft": content}

    reply_draft = str(
        payload.get("replyDraft")
        or payload.get("reply_draft")
        or payload.get("reply")
        or ""
    ).strip()
    action = payload.get("actionProposal", payload.get("action_proposal"))
    action_proposal: dict[str, Any] | None = None
    if isinstance(action, dict) and str(action.get("actionType") or action.get("action_type") or ""):
        action_type = str(action.get("actionType") or action.get("action_type")).strip()
        action_proposal = {
            "id": str(action.get("id") or uuid.uuid4()),
            "actionType": action_type[:128],
            "summary": str(action.get("summary") or "").strip()[:2000],
            "collectedInputs": (
                action.get("collectedInputs")
                if isinstance(action.get("collectedInputs"), dict)
                else action.get("collected_inputs")
                if isinstance(action.get("collected_inputs"), dict)
                else {}
            ),
            "missingInputs": [
                str(item)
                for item in (
                    action.get("missingInputs")
                    or action.get("missing_inputs")
                    or []
                )
                if str(item).strip()
            ][:30],
            "confirmationText": str(
                action.get("confirmationText")
                or action.get("confirmation_text")
                or "Would you like me to perform this action?"
            ).strip()[:1000],
            "status": "proposed",
        }

    return {
        "version": 1,
        "replyDraft": reply_draft,
        "privateNotes": _normalise_notes(
            payload.get("privateNotes", payload.get("private_notes"))
        ),
        "actionProposal": action_proposal,
        "revision": int(context.extra.get("assist_revision") or payload.get("revision") or 1),
        "sourceMessageId": str(
            context.extra.get("source_message_id")
            or payload.get("sourceMessageId")
            or payload.get("source_message_id")
            or ""
        ),
    }


class ConversationAssistAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(CONVERSATION_ASSIST_DEFINITION, **kwargs)

    async def stream(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory | None = None,
    ) -> AsyncIterator[str]:
        response_parts: list[str] = []
        done_turn_id: str | None = None
        async for frame in super().stream(messages, context, memory):
            event, data = _frame_event(frame)
            if event == "text_delta":
                response_parts.append(str(data.get("delta") or ""))
                continue
            if event == "done":
                done_turn_id = str(data.get("turnId") or "") or None
                continue
            yield frame

        state = normalise_assist_state("".join(response_parts), context)
        if state["replyDraft"]:
            yield sse_text_delta(str(state["replyDraft"]))
        yield sse_assist_state(state)
        yield sse_done(
            turn_id=done_turn_id,
            route="inbox",
            routing_chain=[self.definition.name],
            prompt_versions={
                self.definition.name: self.definition.prompt_version,
            },
        )

