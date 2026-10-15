"""LLM client for custom_booxoo_bot."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from openai import OpenAI

from app.config import get_settings
from app.llm.thinking_filter import strip_thinking


class BooxooLLM:
    def __init__(
        self,
        *,
        api_key: str,
        model_name: str,
        base_url: str,
        max_tokens: int,
        extra_body: dict[str, Any] | None = None,
    ) -> None:
        self.client = OpenAI(api_key=api_key or "DUMMY", base_url=base_url)
        self.model_name = model_name
        self.max_tokens = max_tokens
        self.extra_body = extra_body

    def run(self, messages: list[dict], tools: list[dict]) -> dict:
        kwargs: dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": self.max_tokens,
        }
        if tools:
            kwargs["tools"] = tools
        if self.extra_body:
            kwargs["extra_body"] = self.extra_body
        resp = self.client.chat.completions.create(**kwargs).model_dump()
        message = resp["choices"][0]["message"]
        content = message.get("content")
        if isinstance(content, str):
            content = strip_thinking(content)
        return {
            "content": content,
            "tool_calls": message.get("tool_calls"),
            "reasoning": message.get("reasoning"),
        }


@lru_cache
def get_booxoo_llm() -> BooxooLLM:
    settings = get_settings()
    return BooxooLLM(
        api_key=settings.custom_booxoo_bot_llm_api_key or "DUMMY",
        model_name=settings.custom_booxoo_bot_llm_model,
        base_url=settings.custom_booxoo_bot_llm_base_url,
        max_tokens=settings.custom_booxoo_bot_llm_max_tokens,
        extra_body={"reasoning_effort": "low"},
    )
