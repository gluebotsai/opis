"""OpenAI-compatible model providers with bounded calls and fallback."""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol

from openai import AsyncOpenAI

from app.llm.thinking_filter import ThinkingFilter, strip_thinking, thinking_options
from app.logging import get_logger

logger = get_logger("nlp.llm")

Message = dict[str, Any]
ToolDefinition = dict[str, Any]


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    api_key: str
    base_url: str
    model: str
    timeout_seconds: float = 90.0
    temperature: float = 0.2
    max_tokens: int = 4096
    thinking_mode: str = "medium"
    thinking_profile: str = ""


@dataclass
class LLMResponse:
    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    provider: str = ""


class Provider(Protocol):
    name: str
    model: str

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> LLMResponse: ...

    def stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> AsyncIterator[str]: ...


ROLE_ALIASES = {
    "bot": "assistant",
    "agent": "assistant",
    "assistant": "assistant",
    "customer": "user",
    "visitor": "user",
    "user": "user",
    "system": "system",
    "tool": "tool",
}


def normalize_messages(messages: list[Message]) -> list[Message]:
    normalized: list[Message] = []
    allowed = {"role", "content", "name", "tool_call_id", "tool_calls"}
    for message in messages:
        item = {key: value for key, value in message.items() if key in allowed}
        role = ROLE_ALIASES.get(str(item.get("role", "")).strip().lower(), str(item.get("role", "")).strip().lower())
        if role not in {"system", "user", "assistant", "tool"}:
            raise ValueError(f"Unsupported message role: {role}")
        item["role"] = role
        if "content" not in item:
            item["content"] = ""
        normalized.append(item)
    return normalized


class OpenAICompatibleProvider:
    def __init__(
        self,
        config: ProviderConfig,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self.config = config
        self.name = config.name
        self.model = config.model
        self._client = client

    @property
    def client(self) -> AsyncOpenAI:
        if self._client is None:
            if not self.config.api_key:
                raise RuntimeError(f"{self.name} API key is not configured")
            self._client = AsyncOpenAI(
                api_key=self.config.api_key,
                base_url=self.config.base_url,
                timeout=self.config.timeout_seconds,
                max_retries=1,
            )
        return self._client

    def _arguments(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None,
        *,
        stream: bool,
    ) -> dict[str, Any]:
        extra_body = thinking_options(
            self.config.thinking_mode,
            profile=self.config.thinking_profile,
        )
        logger.info(
            "llm.chat.completions provider=%s model=%s url=%s profile=%s extra_body=%s"
            % (
                self.name,
                self.model,
                self.config.base_url,
                self.config.thinking_profile or "none",
                sorted(extra_body) or "none",
            ),
            extra={"event": "llm_request"},
        )
        arguments: dict[str, Any] = {
            "model": self.model,
            "messages": normalize_messages(messages),
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "stream": stream,
        }
        if extra_body:
            arguments["extra_body"] = extra_body
        if tools:
            arguments["tools"] = tools
            arguments["tool_choice"] = "auto"
        return arguments

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> LLMResponse:
        async with asyncio.timeout(self.config.timeout_seconds):
            response = await self.client.chat.completions.create(
                **self._arguments(messages, tools, stream=False)
            )
        message = response.choices[0].message
        calls = []
        for call in message.tool_calls or []:
            calls.append(
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments or "{}",
                    },
                }
            )
        return LLMResponse(
            content=strip_thinking(str(message.content or "")),
            tool_calls=calls,
            model=response.model or self.model,
            provider=self.name,
        )

    async def complete_json(
        self,
        messages: list[Message],
    ) -> LLMResponse:
        async with asyncio.timeout(self.config.timeout_seconds):
            response = await self.client.chat.completions.create(
                **{
                    **self._arguments(messages, None, stream=False),
                    "response_format": {"type": "json_object"},
                }
            )
        message = response.choices[0].message
        return LLMResponse(
            content=strip_thinking(str(message.content or "")),
            tool_calls=[],
            model=response.model or self.model,
            provider=self.name,
        )

    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> AsyncIterator[str]:
        async with asyncio.timeout(self.config.timeout_seconds):
            stream = await self.client.chat.completions.create(
                **self._arguments(messages, tools, stream=True)
            )
            thinking_filter = ThinkingFilter()
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if getattr(delta, "reasoning_content", None) and not delta.content:
                    continue
                visible = thinking_filter.feed(str(delta.content or ""))
                if visible:
                    yield visible
            trailing = thinking_filter.flush()
            if trailing:
                yield trailing


class FallbackProvider:
    def __init__(self, providers: list[Provider]) -> None:
        if not providers:
            raise ValueError("At least one LLM provider is required")
        self.providers = providers
        self.name = "fallback"
        self.model = providers[0].model

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> LLMResponse:
        errors: list[str] = []
        for provider in self.providers:
            try:
                return await provider.complete(messages, tools)
            except Exception as error:
                errors.append(f"{provider.name}: {error}")
                logger.warning("LLM provider failed", extra={"event": "provider_fallback"})
        raise RuntimeError("All LLM providers failed: " + "; ".join(errors))

    async def complete_json(
        self,
        messages: list[Message],
    ) -> LLMResponse:
        errors: list[str] = []
        for provider in self.providers:
            complete_json = getattr(provider, "complete_json", None)
            if not callable(complete_json):
                continue
            try:
                return await complete_json(messages)
            except Exception as error:
                errors.append(f"{provider.name}: {error}")
                logger.warning(
                    "LLM JSON provider failed",
                    extra={"event": "provider_json_fallback"},
                )
        raise RuntimeError("All LLM JSON providers failed: " + "; ".join(errors))

    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> AsyncIterator[str]:
        errors: list[str] = []
        for provider in self.providers:
            emitted = False
            try:
                async for chunk in provider.stream(messages, tools):
                    emitted = True
                    yield chunk
                return
            except Exception as error:
                if emitted:
                    raise
                errors.append(f"{provider.name}: {error}")
        raise RuntimeError("All LLM providers failed: " + "; ".join(errors))


def parse_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Model response did not contain a JSON object")
    payload = json.loads(stripped[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("Model response JSON must be an object")
    return payload
