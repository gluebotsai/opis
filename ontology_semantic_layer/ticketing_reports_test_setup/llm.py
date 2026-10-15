"""Gemma wrapper. Messages are [{role, content}, ...] including system."""

from __future__ import annotations

import json
import os
from typing import Any

from sql_agent.mas.gemma_client import (
    DEFAULT_LLM_URL,
    DEFAULT_MODEL,
    GemmaError,
    GemmaParseError,
    GemmaTimeoutError,
    GemmaUnavailableError,
    _extract_json,
    completions_url,
    llm_model,
)

import urllib.error
import urllib.request


def apply_llm_runtime(base_url: str | None, model: str | None, timeout_s: float) -> None:
    if base_url:
        os.environ["SQL_AGENT_LLM_URL"] = base_url.strip()
    if model:
        os.environ["SQL_AGENT_LLM_MODEL"] = model.strip()
    os.environ["SQL_AGENT_LLM_TIMEOUT"] = str(timeout_s)


def _post(messages: list[dict[str, str]], *, timeout: float, json_object: bool) -> str:
    url = completions_url()
    payload: dict[str, Any] = {
        "model": llm_model() or DEFAULT_MODEL,
        "messages": messages,
        "temperature": 0,
    }
    if json_object:
        payload["response_format"] = {"type": "json_object"}
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if json_object and exc.code in {400, 422}:
            return _post(messages, timeout=timeout, json_object=False)
        if exc.code >= 500:
            raise GemmaUnavailableError(f"Gemma HTTP {exc.code}: {detail}") from exc
        raise GemmaParseError(f"Gemma HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if "timed out" in str(reason).lower():
            raise GemmaTimeoutError(f"Gemma timed out after {timeout}s") from exc
        raise GemmaUnavailableError(str(reason)) from exc
    except TimeoutError as exc:
        raise GemmaTimeoutError(f"Gemma timed out after {timeout}s") from exc
    choices = raw.get("choices") or []
    if not choices:
        raise GemmaParseError("Gemma returned no choices")
    message = choices[0].get("message") or {}
    return str(message.get("content") or "").strip()


def complete_json(*, messages: list[dict[str, str]], timeout: float = 90.0) -> dict[str, Any]:
    return _extract_json(_post(messages, timeout=timeout, json_object=True))


def complete_text(*, messages: list[dict[str, str]], timeout: float = 90.0) -> str:
    return _post(messages, timeout=timeout, json_object=False)


def default_llm_url() -> str:
    return (os.environ.get("SQL_AGENT_LLM_URL") or DEFAULT_LLM_URL).strip()


__all__ = [
    "GemmaError",
    "GemmaParseError",
    "GemmaTimeoutError",
    "GemmaUnavailableError",
    "apply_llm_runtime",
    "complete_json",
    "complete_text",
    "default_llm_url",
]
