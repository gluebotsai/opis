"""Direct OpenAI-compatible HTTP LLM client (no LangChain)."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.config import get_settings
from app.contracts.errors import LLMEmptyResponse, LLMUnavailable
from app.contracts.messages import ChatMessage, NativeMessage
from app.llm.tool_calls import normalize_tool_calls
from app.llm_log import log_llm


def _llm_log_agent() -> str | None:
    """Label chat hops with the live Super / Domain / Executor when a turn is open."""
    try:
        from app.observability.turn_log import current_attending_agent

        return current_attending_agent() or None
    except Exception:  # noqa: BLE001
        return None


def _turn_llm_start() -> None:
    try:
        from app.observability.turn_log import record_llm_start

        record_llm_start(agent=_llm_log_agent())
    except Exception:  # noqa: BLE001
        return


def _turn_llm_hop(
    ms: float,
    *,
    kind: str = "chat",
    note: str = "",
) -> None:
    try:
        from app.observability.turn_log import record_llm_hop

        record_llm_hop(ms, agent=_llm_log_agent(), kind=kind, note=note)
    except Exception:  # noqa: BLE001
        return


def _extract_reasoning(
    message: dict[str, Any],
    response: dict[str, Any] | None,
) -> str | None:
    """Normalize provider reasoning fields without exposing non-text structures."""
    raw = (
        message.get("reasoning")
        or message.get("reasoning_content")
        or ((response or {}).get("reasoning"))
    )
    if isinstance(raw, str):
        return raw.strip() or None
    if isinstance(raw, list):
        parts: list[str] = []
        for item in raw:
            if isinstance(item, str):
                text = item.strip()
            elif isinstance(item, dict):
                text = str(item.get("text") or item.get("content") or "").strip()
            else:
                text = ""
            if text:
                parts.append(text)
        return "\n".join(parts) or None
    return None


def _message_to_openai(msg: Any) -> dict[str, Any]:
    """Convert dict / ChatMessage / NativeMessage / duck-typed LC message → OpenAI."""
    if isinstance(msg, NativeMessage):
        return msg.to_openai()
    if isinstance(msg, ChatMessage):
        d = msg.to_dict()
        role = d.get("role") or "user"
        out: dict[str, Any] = {"role": role}
        if "content" in d:
            out["content"] = d["content"]
        if d.get("tool_call_id"):
            out["tool_call_id"] = d["tool_call_id"]
        if d.get("name"):
            out["name"] = d["name"]
        if d.get("tool_calls"):
            out["tool_calls"] = _ensure_openai_tool_calls(d["tool_calls"])
        return out
    if isinstance(msg, dict):
        role = str(msg.get("role") or "").strip().lower()
        if not role:
            role = "user"
        # Map common LangChain role aliases if present as dicts
        role = {"human": "user", "ai": "assistant", "system": "system", "tool": "tool"}.get(
            role, role
        )
        out = {"role": role}
        if "content" in msg:
            out["content"] = msg["content"]
        if msg.get("tool_call_id"):
            out["tool_call_id"] = msg["tool_call_id"]
        if msg.get("name"):
            out["name"] = msg["name"]
        if msg.get("tool_calls"):
            out["tool_calls"] = _ensure_openai_tool_calls(msg["tool_calls"])
        return out

    # Duck-type LangChain BaseMessage without importing langchain
    content = getattr(msg, "content", None)
    msg_type = str(getattr(msg, "type", None) or getattr(msg, "role", "") or "").lower()
    role_map = {
        "human": "user",
        "user": "user",
        "ai": "assistant",
        "assistant": "assistant",
        "system": "system",
        "tool": "tool",
        "function": "tool",
    }
    role = role_map.get(msg_type, "user")
    out = {"role": role, "content": content if content is not None else ""}
    tool_call_id = getattr(msg, "tool_call_id", None)
    if tool_call_id:
        out["tool_call_id"] = tool_call_id
    name = getattr(msg, "name", None)
    if name:
        out["name"] = name
    tool_calls = getattr(msg, "tool_calls", None)
    if not tool_calls:
        additional = getattr(msg, "additional_kwargs", None) or {}
        tool_calls = additional.get("tool_calls") if isinstance(additional, dict) else None
    if tool_calls:
        out["tool_calls"] = _ensure_openai_tool_calls(tool_calls)
    return out


def _ensure_openai_tool_calls(raw: Any) -> list[dict[str, Any]]:
    normalized = normalize_tool_calls(raw)
    return [
        {
            "id": c["id"],
            "type": "function",
            "function": {
                "name": c["name"],
                "arguments": json.dumps(c.get("arguments") or {}),
            },
        }
        for c in normalized
    ]


def _tools_to_openai(tools: list[Any] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    out: list[dict[str, Any]] = []
    for tool in tools:
        if isinstance(tool, dict) and tool.get("type") == "function":
            out.append(tool)
            continue
        if isinstance(tool, dict) and "name" in tool:
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description") or "",
                        "parameters": tool.get("parameters")
                        or tool.get("input_schema")
                        or {"type": "object", "properties": {}},
                    },
                }
            )
            continue
        # Duck-type LangChain StructuredTool / ToolDefinition
        to_openai = getattr(tool, "to_openai_tool", None)
        if callable(to_openai):
            out.append(to_openai())
            continue
        name = getattr(tool, "name", None)
        if not name:
            continue
        description = getattr(tool, "description", "") or ""
        schema: dict[str, Any] = {"type": "object", "properties": {}}
        args_schema = getattr(tool, "args_schema", None)
        if args_schema is not None:
            for meth in ("model_json_schema", "schema"):
                fn = getattr(args_schema, meth, None)
                if callable(fn):
                    try:
                        schema = fn()
                        break
                    except Exception:  # noqa: BLE001
                        pass
        elif isinstance(getattr(tool, "args", None), dict):
            schema = {
                "type": "object",
                "properties": getattr(tool, "args"),
            }
        out.append(
            {
                "type": "function",
                "function": {
                    "name": str(name),
                    "description": str(description),
                    "parameters": schema,
                },
            }
        )
    return out or None


class NativeLLM:
    """OpenAI-compatible chat client via httpx."""

    def __init__(
        self,
        *,
        model_url: str | None = None,
        model_name: str | None = None,
        api_key: str | None = None,
        timeout: float | None = None,
        temperature: float | None = None,
    ):
        settings = get_settings()
        self.model_url = (model_url if model_url is not None else settings.model_url).rstrip(
            "/"
        )
        self.model_name = model_name if model_name is not None else settings.model_name
        self.api_key = api_key if api_key is not None else settings.api_key
        self.timeout = (
            timeout if timeout is not None else settings.model_request_timeout
        )
        self.temperature = (
            temperature if temperature is not None else settings.model_temperature
        )
        self._bound_tools: list[Any] | None = None
        self._bind_kwargs: dict[str, Any] = {}

    def bind(self, **kwargs: Any) -> NativeLLM:
        """Compatibility with ChatOpenAI.bind(max_tokens=…)."""
        clone = NativeLLM(
            model_url=self.model_url,
            model_name=self.model_name,
            api_key=self.api_key,
            timeout=self.timeout,
            temperature=self.temperature,
        )
        clone._bound_tools = list(self._bound_tools) if self._bound_tools else None
        clone._bind_kwargs = {**self._bind_kwargs, **kwargs}
        return clone

    def bind_tools(self, tools: list[Any]) -> NativeLLM:
        """Attach tools for subsequent run/invoke calls."""
        clone = self.bind()
        clone._bound_tools = list(tools or [])
        return clone

    def run(
        self,
        messages: list[Any],
        tools: list[Any] | None = None,
        *,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        """Preferred API — returns {content, tool_calls, reasoning}."""
        return self.chat(messages, tools=tools, temperature=temperature)

    def chat(
        self,
        messages: list[Any],
        tools: list[Any] | None = None,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        """
        Call OpenAI chat completions. Returns:
          {content: str|None, tool_calls: list[{id,name,arguments}], reasoning: str|None}
        """
        if not self.model_url:
            raise LLMUnavailable(
                "MODEL_URL is not configured",
                details={"model_url": self.model_url},
            )

        openai_messages = [_message_to_openai(m) for m in messages]
        effective_tools = tools if tools is not None else self._bound_tools
        openai_tools = _tools_to_openai(effective_tools)

        payload: dict[str, Any] = {
            "model": self.model_name,
            "messages": openai_messages,
            "temperature": (
                self.temperature if temperature is None else temperature
            ),
            "reasoning_effort": "low",
        }
        max_tokens = self._bind_kwargs.get("max_tokens")
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if openai_tools:
            payload["tools"] = openai_tools
            payload["tool_choice"] = self._bind_kwargs.get("tool_choice", "auto")

        url = f"{self.model_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key or 'empty'}",
        }

        user_preview = ""
        for msg in reversed(openai_messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                user_preview = str(msg.get("content") or "")[:400]
                break

        t0 = time.perf_counter()
        _turn_llm_start()
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            ms = (time.perf_counter() - t0) * 1000
            _turn_llm_hop(ms, kind="chat_timeout", note="timed out")
            log_llm(
                kind="chat_timeout",
                user_text=user_preview,
                response=f"timed out after {self.timeout}s",
                model=self.model_name,
                agent=_llm_log_agent(),
                error="LLM request timed out",
                ms=ms,
            )
            raise LLMUnavailable(
                "LLM request timed out",
                details={"url": url, "timeout": self.timeout},
            ) from exc
        except httpx.HTTPError as exc:
            ms = (time.perf_counter() - t0) * 1000
            _turn_llm_hop(ms, kind="chat_error", note="request failed")
            log_llm(
                kind="chat_error",
                user_text=user_preview,
                response=str(exc)[:500],
                model=self.model_name,
                agent=_llm_log_agent(),
                error="LLM request failed",
                ms=ms,
            )
            raise LLMUnavailable(
                f"LLM request failed: {exc}",
                details={"url": url},
            ) from exc

        ms = (time.perf_counter() - t0) * 1000
        if resp.status_code >= 400:
            _turn_llm_hop(ms, kind="chat_error", note=f"HTTP {resp.status_code}")
            log_llm(
                kind="chat_error",
                user_text=user_preview,
                response=(resp.text or "")[:500],
                model=self.model_name,
                agent=_llm_log_agent(),
                error=f"LLM HTTP {resp.status_code}",
                ms=ms,
            )
            raise LLMUnavailable(
                f"LLM HTTP {resp.status_code}",
                details={
                    "url": url,
                    "status": resp.status_code,
                    "body": (resp.text or "")[:500],
                },
            )

        try:
            data = resp.json()
        except json.JSONDecodeError as exc:
            _turn_llm_hop(ms, kind="chat_error", note="non-JSON body")
            raise LLMUnavailable(
                "LLM returned non-JSON body",
                details={"preview": (resp.text or "")[:500]},
            ) from exc

        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            _turn_llm_hop(ms, kind="chat_error", note="no choices")
            raise LLMEmptyResponse(
                "LLM returned no choices",
                details={"preview": str(data)[:500]},
            )

        message = choices[0].get("message") if isinstance(choices[0], dict) else {}
        if not isinstance(message, dict):
            message = {}

        content = message.get("content")
        if content is not None and not isinstance(content, str):
            content = str(content)

        reasoning = _extract_reasoning(message, data)

        tool_calls = normalize_tool_calls(message.get("tool_calls"))
        if not tool_calls and content:
            from app.llm.tool_calls import (
                content_looks_like_inline_tool_call,
                inline_tool_calls_from_content,
            )

            if content_looks_like_inline_tool_call(str(content)):
                tool_calls = inline_tool_calls_from_content(str(content))
                if tool_calls:
                    content = None

        if (content is None or not str(content).strip()) and not tool_calls:
            _turn_llm_hop(ms, kind="chat_error", note="empty content")
            raise LLMEmptyResponse(
                "LLM returned empty content and no tool calls",
                details={"finish_reason": choices[0].get("finish_reason")},
            )

        tool_names = [
            str(tc.get("name") or "")
            for tc in tool_calls
            if isinstance(tc, dict) and str(tc.get("name") or "").strip()
        ]
        note = f"tools={tool_names}" if tool_names else "reply"
        _turn_llm_hop(ms, kind="chat", note=note)
        log_llm(
            kind="chat",
            user_text=user_preview,
            response=(
                f"tools={tool_names}"
                if tool_names
                else (str(content or "")[:800] or "(empty)")
            ),
            model=self.model_name,
            agent=_llm_log_agent(),
            ms=ms,
        )

        return {
            "content": content,
            "tool_calls": tool_calls,
            "reasoning": reasoning,
        }

    def invoke(self, messages: list[Any]) -> _CompatAIMessage:
        """LangChain-compatible shim used by proactive / specialist call sites."""
        result = self.chat(messages)
        return _CompatAIMessage(
            content=result.get("content") or "",
            tool_calls=result.get("tool_calls") or [],
            reasoning=result.get("reasoning"),
        )


class _CompatAIMessage:
    """Minimal stand-in for LangChain AIMessage (.content / .tool_calls)."""

    def __init__(
        self,
        *,
        content: str,
        tool_calls: list[dict[str, Any]],
        reasoning: str | None = None,
    ):
        self.content = content
        self.reasoning = reasoning
        # Specialist code expects LangChain-style args key
        self.tool_calls = [
            {
                "id": c.get("id"),
                "name": c.get("name"),
                "args": c.get("arguments") or {},
                "type": "tool_call",
            }
            for c in tool_calls
        ]
        self.additional_kwargs: dict[str, Any] = {}
        if tool_calls:
            self.additional_kwargs["tool_calls"] = _ensure_openai_tool_calls(tool_calls)

    def __str__(self) -> str:
        return self.content or ""


def build_native_llm(*, temperature: float | None = None) -> NativeLLM:
    settings = get_settings()
    return NativeLLM(
        temperature=(
            settings.model_temperature if temperature is None else temperature
        )
    )
