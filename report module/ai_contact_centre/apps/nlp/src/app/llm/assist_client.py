"""Dedicated LLM client for the suggested-reply draft (worktual-gemma)."""

from functools import lru_cache

from app.config import Settings, get_settings
from app.llm.client import LLMClient
from app.llm.providers import OpenAICompatibleProvider, ProviderConfig


def build_assist_llm_client(settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    return LLMClient(
        OpenAICompatibleProvider(
            ProviderConfig(
                name="assist-gemma",
                api_key=settings.assist_llm_api_key,
                base_url=settings.assist_llm_base_url,
                model=settings.assist_llm_model,
                timeout_seconds=settings.assist_llm_timeout_seconds,
                temperature=settings.assist_llm_temperature,
                max_tokens=settings.assist_llm_max_tokens,
                thinking_profile="gemma",
                thinking_mode="off",
            )
        )
    )


@lru_cache
def get_assist_llm_client() -> LLMClient:
    return build_assist_llm_client()
