"""Bounded LLM ↔ tool loop (infrastructure only — no intent decisions)."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from app.contracts.errors import LLMEmptyResponse, LLMUnavailable, NativeAIError, ToolLoopExhausted
from app.contracts.tool_results import tool_err, write_failure_retryable
from app.contracts.tools import ToolDefinition
from app.llm.client import NativeLLM
from app.llm.tool_calls import arguments_as_json_string
from app.memory.session import SharedMemory
from app.runtime.budgets import BudgetTracker, tool_call_signature


ToolExecutor = Callable[[str, dict[str, Any]], dict[str, Any]]
ShouldForceArmedWrite = Callable[[], bool]

_CONFIRM_RETRY_SUFFIX = (
    "\n\nCONFIRM STEP retry: re-check the draft against the tool schema, "
    "then this turn's meaning. Consent is your semantic judgment from "
    "conversation context — never keyword/regex lists. If every required "
    "field is present and they mean to proceed, call the write tool now "
    "with confirmed=true. Do not re-ask a field already in the draft. Skip "
    "only if a required field is missing, they refused, asked a question, "
    "asked to change a collected field, or started a different guided "
    "create. Never print call:tool{…} text — invoke the tool."
)

_CONFIRMED_WRITE_DONE_HINT = (
    "\n\nCONFIRMED WRITE terminal: a confirm-required write already ran "
    "this turn. Do not call that write tool again. Use the tool result "
    "to explain success or the failure to the user. For non-retryable "
    "errors (duplicate name, validation), ask what to change instead of "
    "retrying the same create/delete."
)

_MUTATION_SKILL_MUST_TOOL_HINT = (
    "\n\nTOOL REQUIRED: this Skill mutates catalog or ticket data. You must "
    "call a tool this turn (list, patch, write, or return_to_super). Never "
    "claim a row was created, updated, renamed, or deleted in prose without "
    "a successful structured tool result."
)

# Safety gate only (not intent routing): ghost "I've updated…" prose.
_UNVERIFIED_WRITE_CLAIM = re.compile(
    r"(?is)"
    r"(?:\b(?:i(?:['’]ve| have)|we(?:['’]ve| have)|successfully|just|already|"
    r"has been|have been|is now)\b.{0,120}\b"
    r"(?:updat(?:ed|ing)|creat(?:ed|ing)|delet(?:ed|ing)|renam(?:ed|ing)|"
    r"sav(?:ed|ing)|chang(?:ed|ing))\b)"
    r"|"
    r"(?:\b(?:updated|created|deleted|renamed|changed|saved)\b.{0,80}\b(?:to|from)\b)"
)


def looks_like_unverified_write_claim(text: str | None) -> bool:
    """True when prose claims a write completed. Trailing “what next?” is not a skip."""
    raw = str(text or "").strip()
    if not raw:
        return False
    return bool(_UNVERIFIED_WRITE_CLAIM.search(raw))


def _tool_requires_confirm(name: str) -> bool:
    try:
        from app.tools.registry import TOOL_META

        return bool((TOOL_META.get(str(name or "").strip().lower()) or {}).get("confirm"))
    except Exception:  # noqa: BLE001
        return False


def _gate_blocked_result(result: dict[str, Any] | None) -> bool:
    """True when the write never executed (confirm gate / allowlist)."""
    if not isinstance(result, dict):
        return True
    code = str(result.get("error_code") or "").strip().upper()
    kind = str(result.get("kind") or "").strip().lower()
    if kind == "needs_confirm":
        return True
    return code in {
        "CONFIRMATION_REQUIRED",
        "TOOL_NOT_ALLOWED",
        "TOOL_NOT_REGISTERED",
        # Pre-Express schema: the write never ran. Same-turn retry after
        # list/get is allowed (e.g. label used as queue_id, then numeric id).
        "MISSING_CATALOG_ID",
    }


def _already_attempted_result(name: str) -> dict[str, Any]:
    out = tool_err(
        "CONFLICT",
        (
            f"{name} was already attempted this turn after confirmation. "
            "Do not call it again. Explain the previous result and ask what "
            "to change if it failed."
        ),
        payload={"tool": name},
        retryable=False,
    )
    out["kind"] = "confirmed_write_already_attempted"
    return out


def _truncate_result(tool_result: dict[str, Any], max_bytes: int) -> str:
    payload_text = json.dumps(tool_result, default=str)
    if len(payload_text.encode("utf-8")) <= max_bytes:
        return payload_text
    return json.dumps(
        {
            "success": tool_result.get("success", False),
            "error_code": "RESULT_TOO_LARGE",
            "message": "Tool result truncated by budget",
            "retryable": False,
        }
    )


def _openai_tools_excluding(
    tools: list[ToolDefinition],
    exclude: set[str],
) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    if not exclude:
        return [t.to_openai_tool() for t in tools] or None
    kept = [
        t
        for t in tools
        if str(getattr(t, "name", "") or "").strip().lower() not in exclude
    ]
    return [t.to_openai_tool() for t in kept] or None


def run_tool_loop(
    *,
    llm: NativeLLM,
    system_prompt: str,
    memory: SharedMemory,
    tools: list[ToolDefinition],
    execute_tool: ToolExecutor,
    budgets: BudgetTracker,
    user_message: str | None = None,
    armed_write_tools: frozenset[str] | None = None,
    should_force_armed_write: ShouldForceArmedWrite | None = None,
    empty_tools_retry_hint: str | None = None,
) -> str:
    """
    Call LLM → execute tool_calls → append results → repeat until final text.

    Confirmed writes (TOOL_META confirm=True) are single-attempt per tool name
    once they pass the confirmation gate. Failures return structured results;
    identical re-invokes are blocked without re-executing Express.

    Returns non-empty assistant text or raises a structured NativeAIError.
    """
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for msg in memory.messages:
        messages.append(dict(msg))
    if user_message is not None:
        messages.append({"role": "user", "content": user_message})
        memory.add_message("user", user_message)

    openai_tools = [t.to_openai_tool() for t in tools] or None
    base_system = system_prompt
    confirm_retried = False
    empty_tools_retried = False
    forced_armed = False
    # Policy-driven: any TOOL_META confirm tool that executed past the gate.
    confirmed_writes_done: set[str] = set()
    terminal_hint_injected = False
    # Identical confirm-write signatures (incl. gate-blocked) — break before ×3 raise.
    confirm_sig_counts: dict[str, int] = {}

    def _inject_terminal_hint() -> None:
        nonlocal terminal_hint_injected
        if terminal_hint_injected:
            return
        terminal_hint_injected = True
        messages[0] = {
            "role": "system",
            "content": base_system + _CONFIRMED_WRITE_DONE_HINT,
        }

    def _drop_done_write_tools() -> None:
        nonlocal openai_tools
        if not confirmed_writes_done:
            return
        openai_tools = _openai_tools_excluding(tools, confirmed_writes_done)

    def _cycle_break_result(name: str) -> dict[str, Any]:
        key = str(name or "").strip().lower()
        if key == "verify_ticket_customer":
            message = (
                "verify_ticket_customer already failed this turn with the same "
                "arguments. Do not call it again and do not ask for the issue yet. "
                "Tell the user directory verification is temporarily unavailable "
                "and they can retry shortly — keep contact as already collected."
            )
        else:
            message = (
                f"{name} was already attempted with the same arguments this turn. "
                "Do not call it again. Reply from the prior tool result."
            )
        out = tool_err(
            "CONFLICT",
            message,
            payload={"tool": name},
            retryable=False,
        )
        out["kind"] = "confirmed_write_cycle_break"
        return out

    def _run_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        key = str(name or "").strip().lower()
        if _tool_requires_confirm(key) and key in confirmed_writes_done:
            return _already_attempted_result(key)

        tool_result = execute_tool(name, arguments)
        if not isinstance(tool_result, dict):
            tool_result = {
                "success": False,
                "error_code": "RETRYABLE",
                "message": "Tool returned a non-object result",
                "retryable": True,
            }
        elif tool_result.get("success") is False and "retryable" not in tool_result:
            tool_result = {
                **tool_result,
                "retryable": write_failure_retryable(tool_result),
            }

        if _tool_requires_confirm(key) and not _gate_blocked_result(tool_result):
            confirmed_writes_done.add(key)
            # Success or failure past the gate: stop re-calling this write.
            _inject_terminal_hint()
            _drop_done_write_tools()
        return tool_result

    while True:
        budgets.begin_round()
        try:
            result = llm.run(messages, tools=openai_tools)
        except LLMUnavailable:
            raise
        except NativeAIError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise LLMUnavailable(str(exc)) from exc

        content = (result.get("content") or "").strip() if result.get("content") else ""
        tool_calls = result.get("tool_calls") or []

        if not tool_calls:
            if (
                armed_write_tools
                and should_force_armed_write
                and should_force_armed_write()
                and not forced_armed
            ):
                forced_armed = True
                bound_names = {
                    str(getattr(t, "name", "") or "").strip()
                    for t in (tools or [])
                    if str(getattr(t, "name", "") or "").strip()
                }
                scoped = (
                    frozenset(n for n in armed_write_tools if n in bound_names)
                    if bound_names
                    else armed_write_tools
                )
                if not scoped:
                    scoped = armed_write_tools
                # Prefer draft-key / current_workflow order — never alpha
                # (create_priority sorts before create_queue).
                try:
                    from app.workflow_schemas import preferred_armed_write_tool

                    armed_name = preferred_armed_write_tool(
                        getattr(memory, "durable", None), scoped
                    ) or next(iter(sorted(scoped)))
                except Exception:  # noqa: BLE001
                    armed_name = next(iter(sorted(scoped)))
                call_id = "call_armed"
                # Affirmation → gate confirmed; hydrate fills draft fields in execute.
                armed_args: dict[str, Any] = {"confirmed": True}
                budgets.record_tool_call(armed_name, armed_args)
                tool_result = _run_tool(armed_name, armed_args)
                memory.record_tool(
                    name=armed_name, arguments=armed_args, result=tool_result
                )
                payload_text = _truncate_result(
                    tool_result, budgets.budgets.max_result_bytes
                )
                messages.append(
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": armed_name,
                                    "arguments": '{"confirmed": true}',
                                },
                            }
                        ],
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": armed_name,
                        "content": payload_text,
                    }
                )
                continue

            if armed_write_tools and not confirm_retried:
                # One discard/retry round for armed confirms (even after a forced
                # write) so intermediate "On it." text is not the final reply.
                confirm_retried = True
                hint = (
                    _CONFIRMED_WRITE_DONE_HINT
                    if confirmed_writes_done
                    else _CONFIRM_RETRY_SUFFIX
                )
                messages[0] = {
                    "role": "system",
                    "content": base_system + hint,
                }
                if confirmed_writes_done:
                    terminal_hint_injected = True
                    _drop_done_write_tools()
                continue

            if (
                empty_tools_retry_hint
                and not empty_tools_retried
                and not confirmed_writes_done
                and looks_like_unverified_write_claim(content)
            ):
                empty_tools_retried = True
                messages[0] = {
                    "role": "system",
                    "content": base_system + empty_tools_retry_hint,
                }
                continue

            if not content:
                raise LLMEmptyResponse("LLM returned empty content with no tool calls")
            from app.tasks.phrase import strip_llm_thought_preamble

            content = strip_llm_thought_preamble(content)
            if not content:
                raise LLMEmptyResponse("LLM returned empty content with no tool calls")
            memory.add_message("assistant", content)
            return content

        # Persist assistant tool-call turn
        messages.append(
            {
                "role": "assistant",
                "content": content or None,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": arguments_as_json_string(tc["arguments"]),
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )

        for tc in tool_calls:
            name = tc["name"]
            arguments = tc.get("arguments") or {}
            if not isinstance(arguments, dict):
                arguments = {}
            key = str(name or "").strip().lower()
            soft_repeat = _tool_requires_confirm(key) and key in confirmed_writes_done
            cycle_break = False
            sig = tool_call_signature(name, arguments)
            prior = sum(1 for s in budgets.call_signatures if s == sig)
            streak = prior + 1
            if _tool_requires_confirm(key):
                # Count prior forced/armed + LLM calls with this exact signature.
                confirm_sig_counts[sig] = streak
                # 3rd identical confirm-write (often still CONFIRMATION_REQUIRED after
                # a forced {confirmed:true}): stop cleanly — never raise to the UI.
                if soft_repeat or streak >= 3:
                    cycle_break = True
                    confirmed_writes_done.add(key)
                    _inject_terminal_hint()
                    _drop_done_write_tools()
            elif key == "verify_ticket_customer" and streak >= 2:
                # Identical directory verify retries must not trip TOOL_LOOP_EXHAUSTED
                # with an empty chat reply — return a soft break and ask the model to speak.
                cycle_break = True
                _inject_terminal_hint()
            # Soft-blocked / cycle-break re-invokes still count toward max_tool_calls,
            # but must not trip "identical signature ×3".
            budgets.record_tool_call(
                name,
                arguments,
                count_toward_cycle=not (soft_repeat or cycle_break),
            )
            if cycle_break:
                tool_result = (
                    _already_attempted_result(key)
                    if soft_repeat
                    else _cycle_break_result(key)
                )
            else:
                try:
                    tool_result = _run_tool(name, arguments)
                except ToolLoopExhausted:
                    # Safety: never surface cycle exhaustion mid-confirm write / verify.
                    tool_result = _cycle_break_result(key)
                    if _tool_requires_confirm(key):
                        confirmed_writes_done.add(key)
                        _inject_terminal_hint()
                        _drop_done_write_tools()
                    else:
                        _inject_terminal_hint()
            memory.record_tool(name=name, arguments=arguments, result=tool_result)
            payload_text = _truncate_result(
                tool_result, budgets.budgets.max_result_bytes
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": name,
                    "content": payload_text,
                }
            )
