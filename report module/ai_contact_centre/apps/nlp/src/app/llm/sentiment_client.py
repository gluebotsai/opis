"""Dedicated LLM client for sentiment classification (worktual-gemma)."""

from functools import lru_cache

from app.config import Settings, get_settings
from app.llm.client import LLMClient
from app.llm.providers import OpenAICompatibleProvider, ProviderConfig


def build_sentiment_llm_client(settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    return LLMClient(
        OpenAICompatibleProvider(
            ProviderConfig(
                name="sentiment-gemma",
                api_key=settings.sentiment_llm_api_key,
                base_url=settings.sentiment_llm_base_url,
                model=settings.sentiment_llm_model,
                timeout_seconds=settings.sentiment_llm_timeout_seconds,
                temperature=settings.sentiment_llm_temperature,
                max_tokens=settings.sentiment_llm_max_tokens,
                thinking_profile="gemma",
                thinking_mode="off",
            )
        )
    )


@lru_cache
def get_sentiment_llm_client() -> LLMClient:
    return build_sentiment_llm_client()
