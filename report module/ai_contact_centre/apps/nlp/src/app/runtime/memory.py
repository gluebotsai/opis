"""Shared, OpenAI-message-shaped session memory."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionMemory:
    conversation_id: str = "default"
    messages: list[dict[str, Any]] = field(default_factory=list)
    important_facts: list[str] = field(default_factory=list)
    summary: str | None = None

    def add_message(self, message: dict[str, Any]) -> None:
        """Store a visible OpenAI message without translating it."""
        self.messages.append(dict(message))

    def extend(self, messages: list[dict[str, Any]]) -> None:
        self.messages.extend(dict(message) for message in messages)

    def add_user_message(self, content: str) -> None:
        self.add_message({"role": "user", "content": content})

    def add_assistant_message(self, content: str, tool_calls: list[dict[str, Any]] | None = None) -> None:
        msg: dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        self.add_message(msg)

    def add_tool_result(self, tool_call_id: str, tool_name: str, result: str) -> None:
        self.add_message(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "content": result,
            }
        )

    def add_fact(self, fact: str) -> None:
        if fact and fact not in self.important_facts:
            self.important_facts.append(fact)

    def get_messages(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.messages[-limit:]

    def clear(self) -> None:
        self.messages.clear()
        self.important_facts.clear()
        self.summary = None
