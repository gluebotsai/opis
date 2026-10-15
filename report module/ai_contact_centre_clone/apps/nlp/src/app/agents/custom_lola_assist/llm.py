"""Worktual Gemma client for Lola Assist."""

from __future__ import annotations

from functools import lru_cache

from app.agents.custom_booxoo_bot.llm import BooxooLLM
from app.config import get_settings


@lru_cache
def get_lola_assist_llm() -> BooxooLLM:
    settings = get_settings()
    return BooxooLLM(
        api_key=settings.assist_llm_api_key or "DUMMY",
        model_name=settings.assist_llm_model,
        base_url=settings.assist_llm_base_url,
        max_tokens=settings.assist_llm_max_tokens,
        extra_body={
            "enable_thinking": False,
            "chat_template_kwargs": {"enable_thinking": False},
        },
    )
