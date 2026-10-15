"""LLM adapter — wraps existing GPTLLM without modifying llm.py."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from llm import GPTLLM

from config import get_settings

logger = logging.getLogger(__name__)


class LLMServiceError(Exception):
    """User-safe LLM failure."""


class LLMService:
    def __init__(self) -> None:
        self._client: GPTLLM | None = None

    def _get_client(self) -> GPTLLM:
        if self._client is None:
            settings = get_settings()
            self._client = GPTLLM(
                api_key=settings.llm_api_key or "not-needed",
                model_name=settings.llm_model_name,
                base_url=settings.llm_base_url,
            )
        return self._client

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 29000,
        temperature: float = 0.7,
    ) -> str:
        try:
            result = await asyncio.to_thread(
                self._get_client().run,
                messages,
                None,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:
            logger.exception("LLM request failed")
            raise LLMServiceError(
                "I wasn't able to finish that just now. Please try again in a moment."
            ) from exc

        content = (result.get("content") or "").strip()
        if content:
            return content

        raise LLMServiceError(
            "I couldn't quite put an answer together for that. Would you mind rephrasing your question?"
        )

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 29000,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        raw = await self.complete(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return _parse_json(raw)


def _parse_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        text = brace.group(0)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON: %s", raw[:200])
        return {"answer": raw}


llm_service = LLMService()
