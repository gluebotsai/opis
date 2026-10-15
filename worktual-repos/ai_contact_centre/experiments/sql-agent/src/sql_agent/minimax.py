"""OpenAI-compatible client for worktual-minimax. No GLM extra_body."""

from __future__ import annotations

import re
from typing import Any

from openai import OpenAI

from sql_agent.settings import MiniMaxSettings, get_minimax_settings

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_OPEN = re.compile(r"<think>", re.IGNORECASE)


def strip_thinking(text: str) -> str:
    if not text:
        return ""
    visible = _THINK_BLOCK.sub("", text)
    close_index = visible.casefold().find("</think>")
    if close_index >= 0:
        visible = visible[close_index + len("</think>") :]
    open_match = _THINK_OPEN.search(visible)
    if open_match:
        visible = visible[: open_match.start()]
    return visible.strip()


class MiniMaxClient:
    def __init__(self, settings: MiniMaxSettings | None = None) -> None:
        self.settings = settings or get_minimax_settings()
        self.client = OpenAI(
            api_key=self.settings.api_key or "123",
            base_url=self.settings.base_url,
            timeout=self.settings.timeout_seconds,
            max_retries=1,
        )

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.settings.model,
            "messages": messages,
            "temperature": self.settings.temperature,
            "max_tokens": self.settings.max_tokens,
            "stream": False,
        }
        # MiniMax profile: omit extra_body so the gateway does not switch to GLM.
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        response = self.client.chat.completions.create(**kwargs)
        message = response.choices[0].message
        tool_calls = []
        for call in message.tool_calls or []:
            tool_calls.append(
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments or "{}",
                    },
                }
            )
        return {
            "content": strip_thinking(str(message.content or "")),
            "tool_calls": tool_calls or None,
            "model": response.model or self.settings.model,
        }
