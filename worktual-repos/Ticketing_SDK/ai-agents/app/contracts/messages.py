"""Native chat message shapes (no LangChain)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Literal

from pydantic import BaseModel


Role = Literal["system", "user", "assistant", "tool"]


@dataclass
class ChatMessage:
    """Plain message dict shape for the native LLM client."""

    role: Role
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    reasoning: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        return {k: v for k, v in out.items() if v is not None}


class ToolCallFunction(BaseModel):
    name: str
    arguments: str | dict[str, Any] = "{}"


class NativeToolCall(BaseModel):
    id: str
    type: str = "function"
    function: ToolCallFunction


class NativeMessage(BaseModel):
    role: Role
    content: str | None = None
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[NativeToolCall] | None = None
    reasoning: str | None = None

    def to_openai(self) -> dict[str, Any]:
        out: dict[str, Any] = {"role": self.role}
        if self.content is not None:
            out["content"] = self.content
        if self.name:
            out["name"] = self.name
        if self.tool_call_id:
            out["tool_call_id"] = self.tool_call_id
        if self.tool_calls:
            out["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": tc.type,
                    "function": {
                        "name": tc.function.name,
                        "arguments": (
                            tc.function.arguments
                            if isinstance(tc.function.arguments, str)
                            else json.dumps(tc.function.arguments)
                        ),
                    },
                }
                for tc in self.tool_calls
            ]
        return out


def history_to_messages(
    history: list[dict[str, Any]] | None,
    *,
    limit: int = 80,
) -> list[NativeMessage]:
    items = list(history or [])[-limit:]
    out: list[NativeMessage] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = str(item.get("text") or item.get("content") or "").strip()
        if role not in ("user", "assistant") or not text:
            continue
        out.append(NativeMessage(role=role, content=text))  # type: ignore[arg-type]
    return out


def messages_to_openai(messages: list[NativeMessage | dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for msg in messages:
        if isinstance(msg, NativeMessage):
            out.append(msg.to_openai())
        elif isinstance(msg, dict):
            out.append(msg)
    return out
