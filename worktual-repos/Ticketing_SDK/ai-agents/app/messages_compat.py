"""Minimal chat message shims replacing LangChain message classes."""

from __future__ import annotations

from typing import Any


class _BaseMsg:
    def __init__(self, content: Any = "", **kwargs: Any):
        self.content = content
        self.additional_kwargs = kwargs.get("additional_kwargs") or {}
        for k, v in kwargs.items():
            if k != "additional_kwargs":
                setattr(self, k, v)

    def __str__(self) -> str:
        return str(self.content or "")


class SystemMessage(_BaseMsg):
    type = "system"
    role = "system"


class HumanMessage(_BaseMsg):
    type = "human"
    role = "user"


class AIMessage(_BaseMsg):
    type = "ai"
    role = "assistant"

    def __init__(self, content: Any = "", tool_calls: list | None = None, **kwargs: Any):
        super().__init__(content, **kwargs)
        self.tool_calls = tool_calls or []


class ToolMessage(_BaseMsg):
    type = "tool"
    role = "tool"

    def __init__(self, content: Any = "", tool_call_id: str = "", **kwargs: Any):
        super().__init__(content, **kwargs)
        self.tool_call_id = tool_call_id


class RemoveMessage(_BaseMsg):
    type = "remove"


def to_openai_dict(msg: Any) -> dict[str, Any]:
    if isinstance(msg, dict):
        return msg
    role = getattr(msg, "role", None) or getattr(msg, "type", None) or "user"
    if role in ("human",):
        role = "user"
    if role in ("ai",):
        role = "assistant"
    out: dict[str, Any] = {"role": role, "content": getattr(msg, "content", "")}
    if getattr(msg, "tool_call_id", None):
        out["tool_call_id"] = msg.tool_call_id
    if getattr(msg, "tool_calls", None):
        out["tool_calls"] = msg.tool_calls
    return out
