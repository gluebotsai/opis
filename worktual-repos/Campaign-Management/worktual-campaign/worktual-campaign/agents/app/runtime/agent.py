"""Reusable LLM → tools coordinator loop."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    CHAT_MAX_TOKENS,
    CHAT_REASONING_EFFORT,
    LLM_UNAVAILABLE_REPLY,
    OpenAILLM,
)
from app.text_cleanup import strip_markdown_emphasis

ToolDispatch = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]
AfterNoTools = Callable[[int, str], str | None]
SerializeToolResult = Callable[[dict[str, Any]], dict[str, Any]]
FilterToolCalls = Callable[[list], list]
AfterEachTool = Callable[[str, dict[str, Any], list[dict]], Awaitable[None]]
OnRoundStart = Callable[[int], Awaitable[None]]


def parse_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw or "{}")
        except json.JSONDecodeError:
            return {}
    return {}


def default_llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


EMPTY_CONTENT_NUDGE = (
    "Reply to the user now in short HTML (<p>, <b>, <ul>, <li>). "
    "Use tool results and Live session facts. Do not leave the reply blank."
)
POST_TOOL_NUDGE = (
    "The tools already ran successfully. Write a short HTML reply to the user "
    "explaining what changed and the next step. Do not call tools again unless needed."
)
# Prefix so callers can strip nudges before persisting llm_memory.
INTERNAL_NUDGE_PREFIX = "[internal_nudge] "


def is_internal_nudge_message(msg: dict[str, Any] | None) -> bool:
    if not isinstance(msg, dict) or msg.get("role") != "user":
        return False
    if msg.get("_internal_nudge") is True:
        return True
    content = str(msg.get("content") or "")
    if content.startswith(INTERNAL_NUDGE_PREFIX):
        return True
    stripped = content.strip()
    if stripped in (EMPTY_CONTENT_NUDGE, POST_TOOL_NUDGE):
        return True
    # Legacy polluted sessions (nudge saved before marking / truncated).
    return (
        stripped.startswith("The tools already ran successfully.")
        or stripped.startswith("Reply to the user now in short HTML")
        or stripped.startswith("Do not leave the reply blank")
        or "Write a short HTML reply to the user explaining what changed" in stripped
    )


def strip_internal_nudges(messages: list[dict]) -> list[dict]:
    """Drop empty-retry nudges (and text-only assistant stubs before them) from a transcript."""
    out: list[dict] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if is_internal_nudge_message(msg):
            # Drop the premature text-only reply that triggered the nudge retry
            # (empty or not) so llm_memory does not keep a duplicate ask.
            if (
                out
                and out[-1].get("role") == "assistant"
                and not out[-1].get("tool_calls")
            ):
                out.pop()
            continue
        row = dict(msg)
        row.pop("_internal_nudge", None)
        # Gateways often reject assistant content: null — persist/send "".
        if row.get("role") == "assistant" and row.get("content") is None:
            row["content"] = ""
        out.append(row)
    return out


def _nudge_user_message(text: str) -> dict[str, Any]:
    return {
        "role": "user",
        "content": f"{INTERNAL_NUDGE_PREFIX}{text}",
        "_internal_nudge": True,
    }


@dataclass
class ToolLoopResult:
    content: str = ""
    used_tools: bool = False
    timed_out: bool = False
    ui_events: list = field(default_factory=list)
    round_tool_results: list = field(default_factory=list)


async def run_tool_loop(
    llm: OpenAILLM,
    messages: list[dict],
    tools: list,
    *,
    dispatch: ToolDispatch,
    ui_events: list | None = None,
    max_rounds: int = 6,
    reasoning_effort: str = CHAT_REASONING_EFFORT,
    max_tokens: int = CHAT_MAX_TOKENS,
    timeout_s: float = CHAT_LLM_TIMEOUT_S,
    timeout_retries: int = 0,
    empty_content_retries: int = 3,
    unavailable_reply: str = LLM_UNAVAILABLE_REPLY,
    after_no_tools: AfterNoTools | None = None,
    serialize_tool_result: SerializeToolResult | None = None,
    filter_tool_calls: FilterToolCalls | None = None,
    break_after_tools: Callable[[list[tuple[str, dict[str, Any]]], str], str | None]
    | None = None,
    after_each_tool: AfterEachTool | None = None,
    on_round_start: OnRoundStart | None = None,
    require_content_after_tools: bool = False,
    post_tools_nudge: str | None = None,
    disable_thinking: bool | None = None,
    tool_choice: str | dict | None = None,
) -> ToolLoopResult:
    """Run LLM → tool rounds until the model stops calling tools or limits hit.

    Empty content is retried with an ephemeral nudge (not meant for llm_memory).
    After tools succeed, prefer stopping quickly so the caller can fact-reply
    unless require_content_after_tools is set (template edit chat).
    """
    ui_events = list(ui_events or [])
    final_content = ""
    preserved_no_tools_content = ""
    used_tools = False
    timed_out = False
    round_tool_results: list[tuple[str, dict[str, Any]]] = []
    empty_left = max(0, int(empty_content_retries))

    try:
        for round_i in range(max_rounds):
            from app.mas.runtime.llm_io_log import llm_io_set_round

            llm_io_set_round(round_i)
            if on_round_start:
                await on_round_start(round_i)
            result = None
            attempts = 1 + max(0, int(timeout_retries))
            llm_error = False
            for attempt in range(attempts):
                try:
                    result = await asyncio.wait_for(
                        asyncio.to_thread(
                            lambda: llm.run(
                                messages,
                                tools,
                                reasoning_effort,
                                max_tokens,
                                disable_thinking=disable_thinking,
                                tool_choice=tool_choice if tools else None,
                            )
                        ),
                        timeout=timeout_s,
                    )
                    break
                except asyncio.TimeoutError:
                    if attempt + 1 >= attempts:
                        timed_out = True
                        if not used_tools:
                            final_content = unavailable_reply
                        result = None
                except Exception:  # noqa: BLE001 — gateway 400 / network
                    llm_error = True
                    result = None
                    break
            if result is None:
                # Tools already ran — leave content empty for caller fact-reply.
                from app.mas.runtime.turn_audit_log import (
                    turn_audit_llm_failure,
                )

                if llm_error:
                    turn_audit_llm_failure(reason="llm_error")
                elif timed_out:
                    turn_audit_llm_failure(reason="timeout")
                if used_tools or llm_error:
                    break
                break

            tool_calls = result.get("tool_calls") or []
            if filter_tool_calls:
                tool_calls = filter_tool_calls(tool_calls)
            content = strip_markdown_emphasis((result.get("content") or "").strip())
            if content:
                final_content = content

            from app.mas.runtime.turn_audit_log import turn_audit_llm_response

            _audit_tool_names: list[str] = []
            for call in tool_calls:
                fn = call.get("function") or {}
                name = str(fn.get("name") or "").strip()
                if name:
                    _audit_tool_names.append(name)
            turn_audit_llm_response(
                tool_names=_audit_tool_names,
                content_len=len(content or ""),
                content_preview=content or "",
                finish_reason=str(result.get("finish_reason") or ""),
            )

            # Mid-sentence cuts OR reasoning burned the budget (empty + length).
            # Retry once with thinking off and a larger budget.
            finish = str(result.get("finish_reason") or "").strip().lower()
            if (
                finish == "length"
                and not tool_calls
                and int(max_tokens or 0) < 1024
            ):
                from app.mas.runtime.turn_audit_log import turn_audit_stage

                turn_audit_stage(
                    "llm_truncated_retry",
                    content_len=len(content or ""),
                    max_tokens=max_tokens,
                    empty=not bool(content),
                )
                try:
                    result = await asyncio.wait_for(
                        asyncio.to_thread(
                            lambda: llm.run(
                                messages,
                                tools,
                                reasoning_effort,
                                max(1024, int(max_tokens or 0) * 2),
                                disable_thinking=True,
                                tool_choice=tool_choice if tools else None,
                            )
                        ),
                        timeout=timeout_s,
                    )
                    tool_calls = result.get("tool_calls") or []
                    if filter_tool_calls:
                        tool_calls = filter_tool_calls(tool_calls)
                    content = strip_markdown_emphasis(
                        (result.get("content") or "").strip()
                    )
                    if content:
                        final_content = content
                    turn_audit_llm_response(
                        tool_names=[
                            str((c.get("function") or {}).get("name") or "").strip()
                            for c in (tool_calls or [])
                            if str((c.get("function") or {}).get("name") or "").strip()
                        ],
                        content_len=len(content or ""),
                        content_preview=content or "",
                        finish_reason=str(result.get("finish_reason") or ""),
                    )
                except Exception:  # noqa: BLE001
                    pass

            if not tool_calls:
                # After tools: empty content → stop for caller fact-reply,
                # unless this loop needs the model to speak to the user.
                if used_tools and not content and not require_content_after_tools:
                    break
                retries_left = empty_left
                if not content and retries_left > 0:
                    empty_left -= 1
                    messages.append({"role": "assistant", "content": content or ""})
                    nudge = (
                        (post_tools_nudge or POST_TOOL_NUDGE)
                        if used_tools
                        else EMPTY_CONTENT_NUDGE
                    )
                    messages.append(_nudge_user_message(nudge))
                    continue
                if after_no_tools:
                    nudge = after_no_tools(round_i, final_content)
                    if nudge:
                        # Keep the longest mid-turn answer; a later short reply
                        # after the nudge must not silently discard it.
                        cand = (content or final_content or "").strip()
                        if len(cand) > len(preserved_no_tools_content):
                            preserved_no_tools_content = cand
                        messages.append(
                            {"role": "assistant", "content": content or ""}
                        )
                        messages.append(_nudge_user_message(nudge))
                        continue
                break

            used_tools = True
            messages.append(
                {
                    "role": "assistant",
                    "content": content or "",
                    "tool_calls": tool_calls,
                }
            )

            round_calls: list[tuple[str, dict[str, Any]]] = []
            for call in tool_calls:
                fn = call.get("function") or {}
                name = fn.get("name") or ""
                args = parse_tool_args(fn.get("arguments"))
                from app.mas.runtime.llm_io_log import log_tool_call, log_tool_response
                from app.mas.runtime.turn_audit_log import turn_audit_tool_result

                log_tool_call(str(name), args)
                t_tool = time.perf_counter()
                tool_result = await dispatch(name, args)
                log_tool_response(
                    str(name),
                    tool_result
                    if isinstance(tool_result, dict)
                    else {"value": tool_result},
                )
                if isinstance(tool_result, dict):
                    turn_audit_tool_result(
                        tool_name=str(name),
                        ok=tool_result.get("ok"),
                        error=str(
                            tool_result.get("log_error")
                            or tool_result.get("error")
                            or ""
                        ),
                        message=str(
                            tool_result.get("message")
                            or tool_result.get("user_message")
                            or ""
                        ),
                        duration_s=time.perf_counter() - t_tool,
                    )
                round_calls.append((name, tool_result))
                round_tool_results.append((name, tool_result))
                extra_ui = list(tool_result.get("ui_events") or [])
                if tool_result.get("ui_event") and tool_result["ui_event"] not in extra_ui:
                    extra_ui.insert(0, tool_result["ui_event"])
                for ev in extra_ui:
                    if isinstance(ev, dict) and ev.get("type"):
                        ui_events.append(ev)
                payload = (
                    serialize_tool_result(tool_result)
                    if serialize_tool_result
                    else tool_result
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or name,
                        "name": name,
                        "content": json.dumps(payload),
                    }
                )
                if after_each_tool:
                    await after_each_tool(name, tool_result, messages)

            if break_after_tools:
                early = break_after_tools(round_calls, final_content)
                if early:
                    final_content = early
                    break
    except Exception:  # noqa: BLE001
        if not used_tools:
            final_content = unavailable_reply

    if preserved_no_tools_content:
        kept = preserved_no_tools_content.strip()
        cur = (final_content or "").strip()
        if kept and (
            not cur
            or (len(kept) >= 80 and len(cur) < max(80, int(len(kept) * 0.55)))
        ):
            final_content = kept if not cur else f"{kept}\n{cur}"

    return ToolLoopResult(
        content=final_content,
        used_tools=used_tools,
        timed_out=timed_out,
        ui_events=ui_events,
        round_tool_results=round_tool_results,
    )


class CoordinatorGraphRunner:
    """Compatibility shim: `.ainvoke(state)` → coordinator coroutine."""

    def __init__(self, coordinator: Callable[..., Awaitable[dict[str, Any]]]):
        self._coordinator = coordinator

    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        return await self._coordinator(
            session_id=str(state["session_id"]),
            token=str(state["token"]),
            user_text=str(state.get("user_text") or ""),
            ui_events=list(state.get("ui_events") or []),
            event_callback=state.get("event_callback"),
        )
