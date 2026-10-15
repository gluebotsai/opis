"""
LLM client package.

LangChain / LangGraph are being removed from the AI service. Prefer
``NativeLLM.run(messages, tools=None)`` / ``chat(...)``.

``build_llm`` / ``get_llm`` remain as thin compatibility shims with
``.invoke(messages)`` and ``.bind_tools(tools)`` for legacy call sites
(proactive agents, specialists) during migration.
"""

from __future__ import annotations

from functools import lru_cache

from app.llm.client import NativeLLM, build_native_llm
from app.llm.structured_output import (
    extract_json,
    repair_json_once,
    validate_json_object,
)
from app.llm.tool_calls import normalize_tool_calls

__all__ = [
    "NativeLLM",
    "build_llm",
    "build_native_llm",
    "extract_json",
    "get_llm",
    "normalize_tool_calls",
    "repair_json_once",
    "validate_json_object",
]


def build_llm(*, temperature: float | None = None) -> NativeLLM:
    """
    Build the native OpenAI-compatible client.

    Previously returned langchain_openai.ChatOpenAI — that path is retired.
    The returned NativeLLM still exposes .invoke / .bind_tools / .bind for
    migration compatibility.
    """
    return build_native_llm(temperature=temperature)


@lru_cache
def get_llm() -> NativeLLM:
    """Cached default-temperature LLM client."""
    return build_llm()
