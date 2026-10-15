"""OpenAI-compatible LLM client for CRM agents (worktual-glm).

Uses ``LLM_BASE_URL`` / ``LLM_MODEL``. Strips ``<think>`` blocks and parses
legacy ``<minimax:tool_call>`` XML when the API does not return native tool_calls.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import time
import uuid
from typing import Any, Optional

from openai import OpenAI

from app.config import get_settings
from app.operations import llm_circuit, metrics

logger = logging.getLogger(__name__)

# Align with Fastify AI_SERVICE_*_TIMEOUT_MS (HTTP ceiling is 240s).
LLM_DEFAULT_TIMEOUT_MS = 90_000
"""Interactive / light completions."""

LLM_JOB_TIMEOUT_MS = 150_000
"""Job agents: allow slow thinking models (>120s) for a single completion."""

LLM_MAX_TIMEOUT_MS = 210_000
"""Hard ceiling for one OpenAI call — leave headroom under Fastify's 240s max."""

THINK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL)
THINK_OPEN_RE = re.compile(r"<think>(.*)", re.DOTALL)
TOOL_RE = re.compile(
    r"<minimax:tool_call>(.*?)</minimax:tool_call>",
    re.DOTALL,
)
INVOKE_RE = re.compile(
    r'<invoke\s+name="([^"]+)">(.*?)</invoke>',
    re.DOTALL,
)
PARAM_RE = re.compile(
    r'<parameter\s+name="([^"]+)">(.*?)</parameter>',
    re.DOTALL,
)
def normalize_tool_turn_content(
    content: str | None,
    tool_calls: list[Any] | None,
) -> str:
    """OpenAI tool-call turns: assistant content must be empty; speech is synthesized after tools run."""
    if tool_calls:
        return ""
    return (content or "").strip()


GLM_TOOL_RE = re.compile(
    r"<\|tool_call\|>\s*call:([A-Za-z0-9_-]+)\s*(\{.*)",
    re.DOTALL,
)

_LENGTH_RETRY_MIN = 2_000
_LENGTH_RETRY_CAP = 8_000
_LENGTH_RETRY_FACTOR = 4
_PROPOSAL_LENGTH_RETRY_CAP = 16_384

_llm_profile: contextvars.ContextVar[str] = contextvars.ContextVar(
    "llm_profile",
    default="default",
)


def is_ai_configured() -> bool:
    s = get_settings()
    return bool(s.llm_base_url.strip() and s.llm_model.strip())


def proposal_llm_configured() -> bool:
    s = get_settings()
    key = (s.proposal_llm_api_key or "").strip()
    model = (s.proposal_llm_model or "").strip()
    base = (s.proposal_llm_base_url or "").strip()
    if not key or key.upper() == "EMPTY":
        return False
    return bool(model and base)


def _active_llm() -> tuple[str, str, str]:
    """Return (api_key, base_url, model) for the current profile."""
    s = get_settings()
    if _llm_profile.get() == "proposal" and proposal_llm_configured():
        return (
            s.proposal_llm_api_key.strip(),
            s.proposal_llm_base_url.strip().rstrip("/"),
            s.proposal_llm_model.strip(),
        )
    return (
        s.llm_api_key.strip() or "EMPTY",
        s.llm_base_url.strip().rstrip("/"),
        s.llm_model.strip(),
    )


def clamp_llm_timeout_ms(timeout_ms: int | float | None) -> int:
    if timeout_ms is None or not isinstance(timeout_ms, (int, float)) or timeout_ms <= 0:
        return LLM_DEFAULT_TIMEOUT_MS
    return min(max(5_000, int(timeout_ms)), LLM_MAX_TIMEOUT_MS)


def _bump_max_tokens(max_tokens: int) -> int:
    cap = (
        _PROPOSAL_LENGTH_RETRY_CAP
        if _llm_profile.get() == "proposal"
        else _LENGTH_RETRY_CAP
    )
    bumped = max(max_tokens * _LENGTH_RETRY_FACTOR, _LENGTH_RETRY_MIN)
    return min(max(bumped, max_tokens + 1), cap)


def _json_object_from(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    for i, ch in enumerate(raw[start:], start):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                blob = raw[start : i + 1]
                try:
                    parsed = json.loads(blob)
                except json.JSONDecodeError:
                    cleaned = blob.replace("<|\"|>", '"')
                    try:
                        parsed = json.loads(cleaned)
                    except json.JSONDecodeError:
                        return None
                return parsed if isinstance(parsed, dict) else None
    return None


def parse_tool_calls(text: str) -> list[dict[str, Any]]:
    """Parse Minimax XML and GLM <|tool_call|> dumps into OpenAI-shaped dicts."""
    calls: list[dict[str, Any]] = []
    for block in TOOL_RE.findall(text or ""):
        for name, body in INVOKE_RE.findall(block):
            args: dict[str, Any] = {}
            for pname, pval in PARAM_RE.findall(body):
                pval = pval.strip()
                try:
                    args[pname] = json.loads(pval)
                except Exception:  # noqa: BLE001
                    args[pname] = pval
            calls.append(
                {
                    "id": f"call_{uuid.uuid4().hex[:24]}",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": args,
                    },
                }
            )
    if calls:
        return calls
    for name, rest in GLM_TOOL_RE.findall(text or ""):
        args = _json_object_from(rest) or {}
        calls.append(
            {
                "id": f"call_{uuid.uuid4().hex[:24]}",
                "type": "function",
                "function": {"name": name, "arguments": args},
            }
        )
    return calls


def _normalize_native_tool_calls(raw_calls: Any) -> list[dict[str, Any]]:
    tool_calls: list[dict[str, Any]] = []
    if not isinstance(raw_calls, list):
        return tool_calls
    for i, call in enumerate(raw_calls):
        if hasattr(call, "model_dump"):
            call = call.model_dump(mode="json")
        if not isinstance(call, dict):
            continue
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = fn.get("name") if isinstance(fn, dict) else None
        if not isinstance(name, str) or not name.strip():
            continue
        args_raw = fn.get("arguments") if isinstance(fn, dict) else "{}"
        args: dict[str, Any] = {}
        if isinstance(args_raw, dict):
            args = args_raw
        elif isinstance(args_raw, str) and args_raw.strip():
            try:
                parsed = json.loads(args_raw)
                if isinstance(parsed, dict):
                    args = parsed
            except json.JSONDecodeError:
                args = {}
        tool_calls.append(
            {
                "id": str(call.get("id") or f"call_{i}"),
                "type": "function",
                "function": {"name": name.strip(), "arguments": args},
            }
        )
    return tool_calls


def strip_think_and_tools(raw: str) -> tuple[Optional[str], Optional[str]]:
    """Return (content, reasoning) with think/tool XML removed from content."""
    text = raw or ""
    reasoning: Optional[str] = None
    m = THINK_RE.search(text)
    if m:
        reasoning = m.group(1).strip()
        text = THINK_RE.sub("", text)
    else:
        m = THINK_OPEN_RE.search(text)
        if m:
            reasoning = m.group(1).strip()
            text = ""
    text = TOOL_RE.sub("", text)
    text = re.sub(r"<\|tool_call\|>.*", "", text, flags=re.DOTALL)
    content = text.strip() or None
    return content, reasoning


def _openai_client(*, timeout_ms: int) -> OpenAI:
    timeout_s = clamp_llm_timeout_ms(timeout_ms) / 1000.0
    api_key, base, _model = _active_llm()
    return OpenAI(
        api_key=api_key or "EMPTY",
        base_url=base,
        timeout=timeout_s,
    )


def _messages_for_chat_api(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """OpenAI-compatible gateways require tool-call arguments as JSON strings."""

    prepared: list[dict[str, Any]] = []
    for message in messages:
        copied = dict(message)
        calls = copied.get("tool_calls")
        if not isinstance(calls, list):
            prepared.append(copied)
            continue
        normalized: list[dict[str, Any]] = []
        for call in calls:
            if not isinstance(call, dict):
                continue
            item = dict(call)
            fn = item.get("function")
            fn = dict(fn) if isinstance(fn, dict) else {}
            args = fn.get("arguments")
            if isinstance(args, dict):
                fn["arguments"] = json.dumps(args, default=str)
            elif args is None:
                fn["arguments"] = "{}"
            elif not isinstance(args, str):
                fn["arguments"] = json.dumps(args, default=str)
            item["function"] = fn
            normalized.append(item)
        copied["tool_calls"] = normalized
        if normalized:
            copied["content"] = None
        prepared.append(copied)
    return prepared


def _is_gemma_model(model: str) -> bool:
    return "gemma" in (model or "").strip().lower()


def _is_glm_model(model: str) -> bool:
    name = (model or "").strip().lower()
    return "glm" in name or name.endswith("-glm") or name == "worktual-glm"


def _is_gemini_model(model: str) -> bool:
    return "gemini" in (model or "").strip().lower()


def _is_minimax_model(model: str) -> bool:
    name = (model or "").strip().lower()
    return "minimax" in name or "minmax" in name


def _is_qwen_model(model: str) -> bool:
    return "qwen" in (model or "").strip().lower()


def llm_source_tag() -> str:
    """Short label for agent result metadata (gemma, glm, minimax, gemini, llm)."""
    _key, _base, model = _active_llm()
    name = model.strip().lower()
    if _is_gemini_model(name):
        return "gemini"
    if _is_gemma_model(name):
        return "gemma"
    if _is_glm_model(name):
        return "glm"
    if "minimax" in name or "minmax" in name:
        return "minimax"
    return "llm"


def proposal_llm_source_tag() -> str:
    if proposal_llm_configured():
        model = get_settings().proposal_llm_model.strip().lower()
        if _is_gemini_model(model):
            return "gemini"
        return "proposal_llm"
    return llm_source_tag()


def llm_design_source_tag() -> str:
    return f"{proposal_llm_source_tag()}_design"


def _chat_completions_sync(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    max_tokens: int,
    temperature: float,
    timeout_ms: int = LLM_DEFAULT_TIMEOUT_MS,
    enable_thinking: bool = False,
    tool_choice: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    s = get_settings()
    api_key, base, model = _active_llm()
    if not base or not model:
        return None
    failure_threshold = getattr(s, "dependency_circuit_failures", 5)
    recovery_seconds = getattr(s, "dependency_circuit_recovery_seconds", 30)
    llm_circuit.failure_threshold = max(
        1, failure_threshold if isinstance(failure_threshold, int) else 5
    )
    llm_circuit.recovery_seconds = max(
        1, recovery_seconds if isinstance(recovery_seconds, int) else 30
    )
    if not llm_circuit.allow():
        metrics.increment("llm_circuit_rejected_total", model=model)
        return None

    bounded = clamp_llm_timeout_ms(timeout_ms)
    gemma = _is_gemma_model(model)
    glm = _is_glm_model(model)
    gemini = _is_gemini_model(model)
    minimax = _is_minimax_model(model)
    qwen = _is_qwen_model(model)

    extra_body: dict[str, Any] = {}
    presence_penalty: float | None = 0.0
    if gemini:
        effective_temperature = min(temperature, 0.4)
        presence_penalty = None
    elif gemma:
        extra_body = {
            "top_k": 60,
            "repetition_penalty": 1.0,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        presence_penalty = 0.0
        effective_temperature = 0.35
    elif glm:
        # Thinking plus high reasoning effort makes a short coworker reply
        # overrun the 120s turn deadline. Callers opt in when they need it.
        template: dict[str, Any] = {"enable_thinking": bool(enable_thinking)}
        if enable_thinking:
            template["reasoning_effort"] = "high"
        extra_body = {
            "top_p": 0.95,
            "top_k": 60,
            "repetition_penalty": 1.0,
            "chat_template_kwargs": template,
        }
        presence_penalty = 0.1
        effective_temperature = temperature if temperature is not None else 1.0
    elif minimax:
        # Same request shape as the probe that returned text. Qwen penalties
        # (top_k, repetition_penalty, presence_penalty) make this server
        # answer with an empty completion.
        extra_body = {"chat_template_kwargs": {"enable_thinking": False}}
        presence_penalty = None
        effective_temperature = 0
    elif qwen:
        extra_body = {
            "top_p": 0.94,
            "top_k": 64,
            "repetition_penalty": 1.0,
            "chat_template_kwargs": {
                "enable_thinking": False,
                "preserve_thinking": False,
            },
        }
        presence_penalty = 0.5
        effective_temperature = temperature
    else:
        extra_body = {
            "top_p": 0.94,
            "top_k": 64,
            "repetition_penalty": 1.0,
            "chat_template_kwargs": {
                "enable_thinking": enable_thinking,
                "preserve_thinking": False,
            },
        }
        presence_penalty = 0.5
        effective_temperature = temperature

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": _messages_for_chat_api(messages),
        "temperature": effective_temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "timeout": bounded / 1000.0,
    }
    if presence_penalty is not None:
        kwargs["presence_penalty"] = presence_penalty
    if extra_body:
        kwargs["extra_body"] = extra_body
    if tools:
        kwargs["tools"] = tools
    if tool_choice is not None and tools:
        kwargs["tool_choice"] = tool_choice

    started = time.monotonic()
    try:
        client = _openai_client(timeout_ms=bounded)
        response = client.chat.completions.create(**kwargs)
        elapsed_ms = (time.monotonic() - started) * 1000
        message = response.choices[0].message
        raw = message.content or ""
        finish_reason = response.choices[0].finish_reason

        tool_calls = _normalize_native_tool_calls(message.tool_calls)
        if not tool_calls:
            tool_calls = parse_tool_calls(raw)

        content, reasoning = strip_think_and_tools(raw)
        # Qwen/GLM often leave message.content empty and put the answer in
        # reasoning_content, including fields the OpenAI SDK does not map.
        if not reasoning:
            extra = message.model_dump() if hasattr(message, "model_dump") else {}
            reasoning = (
                getattr(message, "reasoning", None)
                or getattr(message, "reasoning_content", None)
                or (extra.get("reasoning_content") if isinstance(extra, dict) else None)
                or (extra.get("reasoning") if isinstance(extra, dict) else None)
            )
            if isinstance(reasoning, str):
                reasoning = reasoning.strip() or None
            else:
                reasoning = None
        if not content and reasoning:
            content = reasoning

        logger.debug(
            "LLM finish=%s content_len=%s tools=%s reasoning=%s ms=%.0f",
            finish_reason,
            len(content or ""),
            len(tool_calls),
            bool(reasoning),
            elapsed_ms,
        )

        llm_circuit.success()
        metrics.increment("llm_requests_total", outcome="ok", model=model)
        metrics.gauge(
            "llm_latency_ms",
            (time.monotonic() - started) * 1000,
            model=model,
        )
        usage = getattr(response, "usage", None)
        if usage is not None:
            metrics.increment(
                "llm_tokens_total",
                float(getattr(usage, "total_tokens", 0) or 0),
                model=model,
            )
        return {
            "content": normalize_tool_turn_content(content, tool_calls),
            "reasoning_content": reasoning,
            "tool_calls": tool_calls,
            "finish_reason": finish_reason,
        }
    except Exception as exc:  # noqa: BLE001
        llm_circuit.failure()
        metrics.increment("llm_requests_total", outcome="error", model=model)
        logger.warning("LLM chat.completions failed: %s", exc)
        try:
            from app.agent_log import log_llm_error

            log_llm_error(exc)
        except Exception:  # noqa: BLE001
            pass
        return None


async def generate_ai_text(
    *,
    system: str,
    user: str,
    max_tokens: int = 500,
    timeout_ms: int = LLM_DEFAULT_TIMEOUT_MS,
    enable_thinking: bool = False,
) -> Optional[str]:
    result = await chat_with_tools(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        tools=None,
        max_tokens=max_tokens,
        timeout_ms=timeout_ms,
        temperature=0.3,
        enable_thinking=enable_thinking,
    )
    if not result:
        return None
    content = (result.get("content") or "").strip()
    if not content:
        try:
            from app.agent_log import current_logger, fmt

            current_logger().error(
                fmt(agent="llm", step="text", ok=False, reason="empty")
            )
        except Exception:  # noqa: BLE001
            pass
        return None
    return content


async def generate_proposal_ai_text(
    *,
    system: str,
    user: str,
    max_tokens: int = 500,
    timeout_ms: int = LLM_DEFAULT_TIMEOUT_MS,
) -> Optional[str]:
    """Proposal learn + generate — Gemini when PROPOSAL_LLM_* is set."""
    token = _llm_profile.set("proposal")
    try:
        return await generate_ai_text(
            system=system,
            user=user,
            max_tokens=max_tokens,
            timeout_ms=timeout_ms,
        )
    finally:
        _llm_profile.reset(token)


async def chat_with_tools(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    max_tokens: int = 2048,
    timeout_ms: int = LLM_DEFAULT_TIMEOUT_MS,
    temperature: float = 1.0,
    enable_thinking: bool = False,
    tool_choice: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    OpenAI-compatible chat.completions (worktual-glm by default).
    Returns { content, tool_calls, reasoning_content?, finish_reason? } or None.
    tool_calls: { id, type, function: { name, arguments } } (arguments as dict).
    """
    bounded_timeout_ms = clamp_llm_timeout_ms(timeout_ms)

    def _summarize_messages() -> str:
        parts: list[str] = []
        for message in messages[-6:]:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role") or "")
            text = str(message.get("content") or "").strip()
            if role and text:
                parts.append(f"{role}: {text[:1200]}")
        return "\n".join(parts) if parts else "(messages omitted)"

    def _log_chat(
        *,
        ok: bool,
        ms: float,
        finish: Any = None,
        tool_calls: list | None = None,
        content: str | None = None,
        retried: bool = False,
        reason: str | None = None,
    ) -> None:
        names: list[str] = []
        for call in tool_calls or []:
            if not isinstance(call, dict):
                continue
            fn = call.get("function") if isinstance(call.get("function"), dict) else {}
            name = str((fn or {}).get("name") or call.get("name") or "").strip()
            if name:
                names.append(name)
        note = "reply" if content and not names else None
        if names:
            note = f"tools={','.join(names[:8])}"
        try:
            from app.observability.llm_log import log_llm
            from app.observability.turn_log import current_turn_agent, on_llm_call_complete

            _key, _base, model = _active_llm()
            response_text = (content or "").strip()
            if not response_text and names:
                response_text = f"[tool_calls: {', '.join(names)}]"
            if not ok:
                response_text = response_text or f"(failed: {reason or 'empty'})"
            turn_agent = current_turn_agent()
            on_llm_call_complete(
                ms=ms,
                kind="chat",
                note=note,
                agent=turn_agent,
            )
            log_llm(
                "chat",
                response_text,
                user_text=_summarize_messages(),
                agent=turn_agent,
                model=model,
                error=None if ok else (reason or "empty"),
                ms=ms,
            )
        except Exception:  # noqa: BLE001
            pass
        try:
            from app.agent_log import current_logger, fmt

            msg = fmt(
                agent="llm",
                step="chat",
                ok=ok,
                ms=ms,
                finish=finish,
                tools=names,
                contentLen=len(content or ""),
                retried=retried or None,
                reason=reason,
            )
            dest = current_logger()
            if ok:
                dest.info(msg)
            else:
                dest.error(msg)
        except Exception:  # noqa: BLE001
            pass

    def _usable(result: dict[str, Any] | None) -> tuple[str | None, list, str | None]:
        if not result:
            return None, [], None
        content = (result.get("content") or "").strip() if result.get("content") else None
        tool_calls = result.get("tool_calls") or []
        finish = result.get("finish_reason")
        return content, tool_calls, finish

    # Callers on a hard latency budget (e.g. live meeting-assist coaching) may
    # opt out of "thinking" on the fast first attempt — retries after a
    # finish_reason="length" truncation still re-enable/disable per the
    # existing bumped-token ladder below, independent of this flag.
    attempts: list[tuple[int, bool]] = [(max_tokens, enable_thinking)]
    bumped = _bump_max_tokens(max_tokens)
    if bumped > max_tokens:
        attempts.append((bumped, False))
        bumped2 = _bump_max_tokens(bumped)
        if bumped2 > bumped:
            attempts.append((bumped2, False))

    total_started = time.perf_counter()
    last_result: dict[str, Any] | None = None
    last_content: str | None = None
    last_tools: list = []
    last_finish: str | None = None

    for attempt_idx, (token_budget, thinking) in enumerate(attempts):
        try:
            from app.observability.turn_log import current_turn_agent, on_llm_call_start

            on_llm_call_start(agent=current_turn_agent())
        except Exception:  # noqa: BLE001
            pass
        attempt_started = time.perf_counter()
        result = await asyncio.to_thread(
            _chat_completions_sync,
            messages=messages,
            tools=tools,
            max_tokens=token_budget,
            temperature=temperature,
            timeout_ms=bounded_timeout_ms,
            enable_thinking=thinking,
            tool_choice=tool_choice,
        )
        attempt_ms = (time.perf_counter() - attempt_started) * 1000
        content, tool_calls, finish = _usable(result)
        if not content and result:
            recovered = result.get("reasoning_content")
            if isinstance(recovered, str) and recovered.strip():
                content = recovered.strip()
        last_result = result
        last_content = content
        last_tools = tool_calls
        last_finish = finish

        truncated = (
            finish == "length"
            and not tool_calls
            and attempt_idx < len(attempts) - 1
        )
        if (content or tool_calls) and not truncated:
            _log_chat(
                ok=True,
                ms=attempt_ms,
                finish=finish,
                tool_calls=tool_calls,
                content=content,
                retried=attempt_idx > 0,
            )
            return {
                "content": content,
                "tool_calls": tool_calls,
                "reasoning_content": (result or {}).get("reasoning_content"),
                "finish_reason": finish,
            }

        if finish != "length" or attempt_idx >= len(attempts) - 1:
            break

        next_tokens, next_thinking = attempts[attempt_idx + 1]
        logger.info(
            "LLM finish=length; retrying max_tokens %s → %s thinking=%s",
            token_budget,
            next_tokens,
            next_thinking,
        )
        try:
            from app.agent_log import current_logger, fmt

            current_logger().warning(
                fmt(
                    agent="llm",
                    step="chat_retry",
                    finish="length",
                    fromTokens=token_budget,
                    toTokens=next_tokens,
                    thinking=next_thinking,
                )
            )
        except Exception:  # noqa: BLE001
            pass

    total_ms = (time.perf_counter() - total_started) * 1000
    if last_content or last_tools:
        _log_chat(
            ok=True,
            ms=total_ms,
            finish=last_finish,
            tool_calls=last_tools,
            content=last_content,
            retried=len(attempts) > 1,
        )
        return {
            "content": last_content,
            "tool_calls": last_tools,
            "reasoning_content": (last_result or {}).get("reasoning_content"),
            "finish_reason": last_finish,
        }

    _log_chat(
        ok=False,
        ms=total_ms,
        finish=last_finish,
        reason="empty_after_retry",
        retried=len(attempts) > 1,
    )
    return None
