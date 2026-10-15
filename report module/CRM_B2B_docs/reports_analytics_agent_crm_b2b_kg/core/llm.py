"""LLM Client for CRM B2B KG Agent (connecting to worktual-gemma gateway)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "not-needed")
LLM_MODEL = os.getenv("LLM_MODEL", "worktual-gemma")


def get_openai_client():
    """Lazy initialize OpenAI client."""
    from openai import OpenAI
    return OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, timeout=30.0)


def call_llm(
    messages: list[dict[str, str]],
    model: str = LLM_MODEL,
    temperature: float = 0.1,
    max_tokens: int = 1000,
) -> Optional[str]:
    """Call vLLM endpoint with standardized error handling."""
    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""
    except Exception as exc:
        return None


def extract_json(text: Optional[str]) -> dict[str, Any]:
    """Extract valid JSON from LLM markdown fences or raw strings."""
    if not text:
        return {}

    cleaned = text.strip()
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
