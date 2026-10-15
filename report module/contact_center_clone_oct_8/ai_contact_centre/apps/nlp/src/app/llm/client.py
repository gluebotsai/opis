"""Application LLM client and provider composition."""

from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from app.config import Settings, get_settings
from app.llm.providers import (
    FallbackProvider,
    LLMResponse,
    Message,
    OpenAICompatibleProvider,
    Provider,
    ProviderConfig,
    ToolDefinition,
)
from app.llm.thinking_filter import thinking_profile_for_model


class LLMClient:
    def __init__(self, provider: Provider) -> None:
        self.provider = provider

    @property
    def model(self) -> str:
        return self.provider.model

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> LLMResponse:
        return await self.provider.complete(messages, tools)

    async def chat(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> dict[str, Any]:
        response = await self.complete(messages, tools)
        return {
            "content": response.content,
            "tool_calls": response.tool_calls,
            "model": response.model,
            "provider": response.provider,
        }

    def stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
    ) -> AsyncIterator[str]:
        return self.provider.stream(messages, tools)

    async def json(
        self,
        messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        from app.llm.providers import parse_json_object

        complete_json = getattr(self.provider, "complete_json", None)
        if callable(complete_json):
            try:
                response = await complete_json(messages)
                return parse_json_object(response.content)
            except Exception:
                pass
        response = await self.complete(messages)
        return parse_json_object(response.content)


def build_llm_client(settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    max_tokens = settings.resolved_llm_max_tokens
    thinking_mode = settings.llm_thinking_mode
    providers: list[Provider] = []
    if settings.together_api_key:
        providers.append(
            OpenAICompatibleProvider(
                ProviderConfig(
                    name="together",
                    api_key=settings.together_api_key,
                    base_url=settings.together_base_url,
                    model=settings.together_model,
                    timeout_seconds=settings.together_timeout_seconds,
                    temperature=settings.together_temperature,
                    max_tokens=max_tokens,
                    thinking_mode=thinking_mode,
                    thinking_profile=thinking_profile_for_model(settings.together_model),
                )
            )
        )
    if settings.chat_openai_api_key:
        providers.append(
            OpenAICompatibleProvider(
                ProviderConfig(
                    name="openai-compatible",
                    api_key=settings.chat_openai_api_key,
                    base_url=settings.chat_openai_base_url,
                    model=settings.chat_openai_model,
                    timeout_seconds=settings.chat_openai_timeout_seconds,
                    temperature=settings.chat_openai_temperature,
                    max_tokens=max_tokens,
                    thinking_mode=thinking_mode,
                    thinking_profile=thinking_profile_for_model(settings.chat_openai_model),
                )
            )
        )
    if not providers:
        providers.append(
            OpenAICompatibleProvider(
                ProviderConfig(
                    name="openai-compatible",
                    api_key="",
                    base_url=settings.chat_openai_base_url,
                    model=settings.chat_openai_model,
                    timeout_seconds=settings.chat_openai_timeout_seconds,
                    max_tokens=max_tokens,
                    thinking_mode=thinking_mode,
                    thinking_profile=thinking_profile_for_model(settings.chat_openai_model),
                )
            )
        )
    return LLMClient(FallbackProvider(providers))


@lru_cache
def get_llm_client() -> LLMClient:
    return build_llm_client()
