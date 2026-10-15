"""Shared OpenAI-compatible LLM client for all agents."""

import logging
import time

from openai import OpenAI

_log = logging.getLogger(__name__)

# Chat / tool-routing agents: short, accurate replies (fast when the host is healthy).
CHAT_REASONING_EFFORT = "low"
CHAT_MAX_TOKENS = 384
# Create-campaign tool turns need a bit more room (tool JSON + short HTML).
CREATE_CHAT_MAX_TOKENS = 640
CHAT_TEMPERATURE = 0.35
# Allow the model to finish a short turn; UI waits for a real reply (no fake 5s banner).
CHAT_LLM_TIMEOUT_S = 60.0
# One quick retry when the first chat LLM call times out.
CHAT_LLM_TIMEOUT_RETRIES = 1

# Forms design agent: module-specific override (does not affect create_campaign).
# Prefer UPDATE_FORM_THEME / UPDATE_FORM_FIELDS (small JSON); room for full APPLY too.
FORMS_CHAT_REASONING_EFFORT = "low"
FORMS_CHAT_MAX_TOKENS = 768

# Template generate / edit: allow richer structured JSON.
# Qwen thinking can consume the entire budget (finish_reason=length, content="") —
# disable thinking for gen calls and keep headroom for the JSON body.
GEN_REASONING_EFFORT = "low"
GEN_MAX_TOKENS = 4096

LLM_UNAVAILABLE_REPLY = "Couldn't get a reply right now. Please try again."


class OpenAILLM:
    def __init__(
        self,
        api_key: str = "dummy",
        # Previous: gpt-oss-120b @ http://173.234.75.166:8003/v1
        # Previous: worktual-gemma-cx @ http://81.17.61.149:8060/v1
        model_name: str = "worktual-qwen-27B",
        base_url: str = "http://81.17.61.149:8066/v1",
        *,
        timeout: float | None = None,
    ):
        # Fail when the LLM host is down instead of hanging chat forever.
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=CHAT_LLM_TIMEOUT_S if timeout is None else timeout,
        )
        self.model_name = model_name

    def run(
        self,
        messages,
        tools=None,
        reasoning_effort=None,
        max_tokens=None,
        temperature=None,
        *,
        disable_thinking: bool | None = None,
        tool_choice: str | dict | None = None,
    ):
        if tools is None:
            tools = []
        if reasoning_effort is None:
            reasoning_effort = CHAT_REASONING_EFFORT
        if max_tokens is None:
            max_tokens = CHAT_MAX_TOKENS
        if temperature is None:
            temperature = CHAT_TEMPERATURE
        # Structured JSON generation must not spend the token budget on hidden
        # reasoning — that yields finish_reason=length with empty content.
        if disable_thinking is None:
            disable_thinking = int(max_tokens or 0) >= 1024

        kwargs = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        if tools:
            kwargs["tools"] = tools
            if tool_choice is not None:
                kwargs["tool_choice"] = tool_choice
        if disable_thinking:
            kwargs["extra_body"] = {
                "chat_template_kwargs": {"enable_thinking": False},
                "reasoning_effort": "none",
            }
        elif reasoning_effort:
            # Optional soft hint when thinking stays enabled (chat turns).
            kwargs["extra_body"] = {"reasoning_effort": reasoning_effort}

        from app.mas.runtime.llm_io_log import log_llm_input, log_llm_output

        log_llm_input(
            {
                "model": self.model_name,
                "messages": messages,
                "tools": tools or [],
                "max_tokens": max_tokens,
                "temperature": temperature,
                "tool_choice": tool_choice,
                "disable_thinking": disable_thinking,
                "reasoning_effort": reasoning_effort,
            }
        )

        t0 = time.perf_counter()
        raw = self.client.chat.completions.create(**kwargs)
        result = raw.model_dump()
        elapsed = time.perf_counter() - t0
        choice = (result.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        finish_reason = str(choice.get("finish_reason") or "")
        tool_calls = message.get("tool_calls") or []
        tool_names = []
        for call in tool_calls:
            fn = call.get("function") if isinstance(call, dict) else None
            if isinstance(fn, dict) and fn.get("name"):
                tool_names.append(str(fn["name"]))
        content = message.get("content") or ""
        reasoning = message.get("reasoning")
        kind = "template_gen" if (max_tokens or 0) >= 1024 else "chat"
        _log.info(
            "LLM %s %.2fs max_tokens=%s finish=%s thinking_off=%s "
            "tool_calls=%s tools=%s content_len=%s reasoning_len=%s",
            kind,
            elapsed,
            max_tokens,
            finish_reason or "?",
            bool(disable_thinking),
            len(tool_calls),
            tool_names,
            len(content),
            len(str(reasoning or "")),
        )
        if not str(content).strip() and finish_reason == "length":
            _log.warning(
                "LLM %s empty content with finish=length "
                "(reasoning burned the token budget)",
                kind,
            )
        out = {
            "content": content,
            "reasoning": reasoning,
            "tool_calls": message.get("tool_calls"),
            "finish_reason": finish_reason,
        }
        log_llm_output(
            {
                **out,
                "elapsed_s": round(elapsed, 3),
                "model": self.model_name,
            }
        )
        return out
