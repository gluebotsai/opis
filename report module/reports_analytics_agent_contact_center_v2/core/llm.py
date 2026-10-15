"""Optional OpenAI-compatible client. Domain may pass its own call_llm instead."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path


def _load_env() -> None:
    env = Path("/home/vectone/Uday/report module/.env")
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env()


def call_llm(messages: list[dict[str, str]], temperature: float = 0.0, max_tokens: int = 800) -> str:
    base = (os.environ.get("SQL_AGENT_LLM_URL") or os.environ.get("LLM_BASE_URL") or "").rstrip("/")
    model = os.environ.get("SQL_AGENT_LLM_MODEL") or os.environ.get("LLM_MODEL_NAME") or "worktual-gemma"
    timeout = float(os.environ.get("SQL_AGENT_LLM_TIMEOUT") or 90)
    if not base:
        raise RuntimeError("SQL_AGENT_LLM_URL is not set")
    payload = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8")[:400]
        except Exception:
            body = str(exc)
        raise RuntimeError(f"LLM request failed: HTTP {exc.code} {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"LLM request failed: {exc}") from exc
    choices = data.get("choices") or []
    if not choices:
        return ""
    return str((choices[0].get("message") or {}).get("content") or "")
