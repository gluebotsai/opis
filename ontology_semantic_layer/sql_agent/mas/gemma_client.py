"""Worktual-Gemma OpenAI-compatible client for SQL Super (JSON plans/jobs only)."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

DEFAULT_LLM_URL = "http://173.234.75.166:8011/v1"
DEFAULT_TIMEOUT_S = 2.0
DEFAULT_MODEL = "worktual-gemma"


class GemmaError(Exception):
    """Base error for SQL-agent Gemma calls."""


class GemmaTimeoutError(GemmaError):
    """Gemma call exceeded SQL_AGENT_LLM_TIMEOUT."""


class GemmaUnavailableError(GemmaError):
    """Gemma endpoint unreachable or returned 5xx."""


class GemmaParseError(GemmaError):
    """Gemma returned non-JSON or empty structured payload."""


def llm_base_url() -> str:
    return (os.environ.get("SQL_AGENT_LLM_URL") or DEFAULT_LLM_URL).strip()


def llm_timeout_s() -> float:
    return float(os.environ.get("SQL_AGENT_LLM_TIMEOUT", str(DEFAULT_TIMEOUT_S)))


def llm_model() -> str:
    return (os.environ.get("SQL_AGENT_LLM_MODEL") or DEFAULT_MODEL).strip()


def completions_url(base: str | None = None) -> str:
    root = (base or llm_base_url()).rstrip("/")
    if root.endswith("/chat/completions"):
        return root
    if root.endswith("/v1"):
        return f"{root}/chat/completions"
    return f"{root}/v1/chat/completions"


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise GemmaParseError("Empty LLM response")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        parsed = json.loads(fence.group(1))
        if isinstance(parsed, dict):
            return parsed
    brace = re.search(r"\{.*\}", text, re.S)
    if brace:
        parsed = json.loads(brace.group(0))
        if isinstance(parsed, dict):
            return parsed
    raise GemmaParseError("Could not parse JSON object from LLM response")


def chat_json(
    *,
    system: str,
    user: str,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Call Gemma chat/completions; response must be a JSON object."""
    url = completions_url()
    timeout = llm_timeout_s() if timeout is None else timeout
    payload = {
        "model": llm_model(),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
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
        if exc.code >= 500:
            raise GemmaUnavailableError(
                f"Gemma HTTP {exc.code}: {exc.reason}"
            ) from exc
        detail = exc.read().decode("utf-8", errors="replace")
        raise GemmaParseError(f"Gemma HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if "timed out" in str(reason).lower():
            raise GemmaTimeoutError(
                f"Gemma timed out after {timeout}s"
            ) from exc
        raise GemmaUnavailableError(str(reason)) from exc
    except TimeoutError as exc:
        raise GemmaTimeoutError(f"Gemma timed out after {timeout}s") from exc

    choices = raw.get("choices") or []
    if not choices:
        raise GemmaParseError("Gemma returned no choices")
    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    return _extract_json(content)
