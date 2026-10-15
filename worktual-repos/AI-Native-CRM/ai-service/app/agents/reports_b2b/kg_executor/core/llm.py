"""LLM bridge — uses ai-service configured LLM (sync wrapper for kg package code)."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Optional

from app.agents.llm_result import extract_json as _extract_json_shared


def extract_json(text: Optional[str]) -> dict[str, Any]:
    if not text:
        return {}
    try:
        parsed = _extract_json_shared(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    cleaned = (text or "").strip()
    code_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if code_match:
        cleaned = code_match.group(1).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except Exception:
                pass
    return {}


def call_llm(
    messages: list[dict[str, str]],
    model: str = "",
    temperature: float = 0.1,
    max_tokens: int = 1000,
) -> Optional[str]:
    from app.llm import chat_with_tools, is_ai_configured

    if not is_ai_configured():
        return None

    async def _run() -> str:
        result = await chat_with_tools(
            messages=messages,
            tools=None,
            max_tokens=max_tokens,
            temperature=temperature,
            enable_thinking=False,
        )
        return str((result or {}).get("content") or "").strip()

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(_run())

    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(_run())).result()
