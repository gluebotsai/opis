"""One readable TURN block per chat (stdout → Docker logs).

Grep:  TURN   (session id is on the same line)

Printed at the end of the turn:
  ASK          — user message
  TOOLS        — tools that ran and their result
  CHAT TO USER — what the UI shows

No per-request JSON spam. Long strings are clipped.
"""

from __future__ import annotations

import html
import logging
import re
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Awaitable, Callable

_log = logging.getLogger("app.mas.runtime.turn_audit")

AUDIT_MODULES = frozenset(
    {
        "contacts",
        "reports",
        "create_campaign",
        "template_edit",
        "template_create",
    }
)

_CLIP_TEXT = 800
_CLIP_REPLY = 1200
_CLIP_ERROR = 500
_CLIP_TOOL_MSG = 400

_ctx: ContextVar[dict[str, Any] | None] = ContextVar("turn_audit_ctx", default=None)

_TAG_RE = re.compile(r"<[^>]+>")


def is_audited_module(module: str) -> bool:
    return str(module or "").strip().lower() in AUDIT_MODULES


def _clip(value: Any, max_len: int = _CLIP_TEXT) -> str:
    s = str(value or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def _plain_chat(value: Any, max_len: int = _CLIP_REPLY) -> str:
    s = str(value or "")
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p>", "\n", s)
    s = re.sub(r"(?i)</div>", "\n", s)
    s = _TAG_RE.sub("", s)
    s = html.unescape(s)
    lines = [ln.strip() for ln in s.splitlines()]
    s = "\n".join(ln for ln in lines if ln).strip()
    return _clip(s, max_len)


def _log_lines(lines: list[str]) -> None:
    for line in lines:
        _log.info("%s", line)


def _indent(text: str, prefix: str = "  ", max_len: int | None = None) -> list[str]:
    clipped = _clip(text, max_len if max_len is not None else _CLIP_TOOL_MSG)
    if not clipped:
        return []
    return [prefix + ln if ln else prefix for ln in clipped.splitlines()]


def _flush_turn_block(
    ctx: dict[str, Any],
    *,
    reply: str = "",
    error: str = "",
    used_tools: bool | None = None,
    skill_id: str = "",
    intent: str = "",
    mas: bool | None = None,
) -> None:
    t0 = float(ctx.get("t0") or time.perf_counter())
    duration = round(time.perf_counter() - t0, 3)
    session_id = str(ctx.get("session_id") or "").strip()
    module = str(ctx.get("module") or "").strip()
    turn_id = str(ctx.get("turn_id") or "").strip()
    template_id = str(ctx.get("template_id") or "").strip()
    channel = str(ctx.get("channel") or "").strip()
    chat_context = str(ctx.get("chat_context") or "").strip()

    head_bits = [
        f"TURN  session={session_id or '-'}",
        f"module={module or '-'}",
        f"{duration}s",
    ]
    if turn_id:
        head_bits.append(f"id={turn_id}")
    lines = [
        "",
        "========== TURN ==========",
        "  ".join(head_bits),
    ]
    if chat_context:
        lines.append(f"context  {chat_context}")
    if template_id:
        lines.append(f"template {template_id}")
    if channel:
        lines.append(f"channel  {channel}")
    if skill_id:
        lines.append(f"skill    {skill_id}")
    if intent:
        lines.append(f"intent   {intent}")
    if mas is True:
        lines.append("mas      yes")
    if used_tools is True:
        lines.append("used_tools yes")
    elif used_tools is False:
        lines.append("used_tools no")

    ask = _clip(ctx.get("user_text") or "", _CLIP_TEXT)
    lines.append("")
    lines.append("ASK")
    lines.extend(_indent(ask, max_len=_CLIP_TEXT) or ["  (empty)"])

    stages = list(ctx.get("stages") or [])
    if stages:
        lines.append("")
        lines.append("STEPS")
        for st in stages:
            name = str(st.get("stage") or "").strip()
            extra = {
                k: v
                for k, v in st.items()
                if k != "stage" and v not in (None, "", [])
            }
            extra_s = "  ".join(f"{k}={v}" for k, v in extra.items())
            lines.append(f"  {name}" + (f"  {extra_s}" if extra_s else ""))

    tools = list(ctx.get("tools") or [])
    llm_tools = [n for n in (ctx.get("llm_tool_names") or []) if n]
    if tools or llm_tools:
        lines.append("")
        lines.append("TOOLS")
        seen: set[str] = set()
        for row in tools:
            name = str(row.get("tool_name") or "").strip() or "(tool)"
            seen.add(name)
            ok = row.get("ok")
            status = "ok" if ok is True else ("fail" if ok is False else "")
            dur = row.get("duration_s")
            bits = [name]
            if status:
                bits.append(status)
            if dur is not None:
                bits.append(f"{dur}s")
            lines.append("  " + "  ".join(bits))
            err = str(row.get("error") or "").strip()
            msg = str(row.get("message") or "").strip()
            if err:
                lines.extend(_indent(err, "    "))
            elif msg:
                lines.extend(_indent(msg, "    "))
        for name in llm_tools:
            if name not in seen:
                lines.append(f"  {name}  (called, no result logged)")

    failures = list(ctx.get("llm_failures") or [])
    if failures:
        lines.append("")
        lines.append("LLM")
        for reason in failures:
            lines.append(f"  fail  {reason}")

    lines.append("")
    lines.append("CHAT TO USER")
    chat = _plain_chat(reply, _CLIP_REPLY)
    if error:
        lines.extend(_indent(f"ERROR: {error}", "  "))
    if chat:
        lines.extend(_indent(chat, "  ", max_len=_CLIP_REPLY))
    elif not error:
        lines.append("  (empty)")

    lines.append("========== END TURN ==========")
    lines.append("")
    _log_lines(lines)


def _record_tool(
    *,
    tool_name: str,
    ok: bool | None = None,
    error: str = "",
    message: str = "",
    duration_s: float | None = None,
) -> None:
    ctx = _ctx.get()
    if not ctx:
        return
    tools = ctx.setdefault("tools", [])
    tools.append(
        {
            "tool_name": str(tool_name or "").strip() or None,
            "ok": ok,
            "error": _clip(error, _CLIP_ERROR) if error else None,
            "message": _clip(message, _CLIP_TOOL_MSG) if message else None,
            "duration_s": round(duration_s, 3) if duration_s is not None else None,
        }
    )


@contextmanager
def turn_audit_scope(
    *,
    session_id: str,
    module: str,
    user_text: str = "",
    chat_context: str = "create",
    template_id: str = "",
    channel: str = "",
):
    mod = str(module or "").strip().lower()
    if mod not in AUDIT_MODULES:
        yield
        return
    token = _ctx.set(
        {
            "session_id": str(session_id or "").strip(),
            "module": mod,
            "chat_context": str(chat_context or "create").strip(),
            "template_id": str(template_id or "").strip(),
            "channel": str(channel or "").strip().lower(),
            "user_text": str(user_text or ""),
            "turn_id": uuid.uuid4().hex[:10],
            "t0": time.perf_counter(),
            "tools": [],
            "stages": [],
            "llm_tool_names": [],
            "llm_failures": [],
        }
    )
    from app.mas.runtime.llm_io_log import llm_io_set_context

    llm_io_set_context(
        session_id=str(session_id or "").strip(),
        module=mod,
        chat_context=str(chat_context or "create").strip(),
        source="turn_audit",
    )
    try:
        yield
    finally:
        _ctx.reset(token)


def turn_audit_stage(stage: str, **fields: Any) -> None:
    """Mid-turn breadcrumb (skill pick, channel create, image step, persist)."""
    name = str(stage or "").strip()
    if not name:
        return
    ctx = _ctx.get()
    clean = {k: v for k, v in fields.items() if v is not None}
    if ctx:
        ctx.setdefault("stages", []).append({"stage": name, **clean})
        return
    sid = str(clean.pop("session_id", "") or "").strip()
    module = str(clean.pop("module", "") or "template_create").strip()
    extra = "  ".join(f"{k}={v}" for k, v in clean.items() if v not in ("", []))
    parts = [
        "TURN",
        f"session={sid or '-'}",
        f"module={module}",
        f"step={name}",
    ]
    if extra:
        parts.append(extra)
    _log.info("%s", "  ".join(parts))


def turn_audit_llm_response(
    *,
    tool_names: list[str] | None = None,
    content_len: int = 0,
    content_preview: str = "",
    finish_reason: str = "",
) -> None:
    ctx = _ctx.get()
    if not ctx:
        return
    names = [str(n) for n in (tool_names or []) if str(n or "").strip()]
    existing = ctx.setdefault("llm_tool_names", [])
    for n in names:
        if n not in existing:
            existing.append(n)
    _ = content_len, content_preview, finish_reason


def turn_audit_llm_failure(*, reason: str) -> None:
    ctx = _ctx.get()
    if not ctx:
        return
    ctx.setdefault("llm_failures", []).append(_clip(reason, 120))


def turn_audit_tool_result(
    *,
    tool_name: str,
    ok: bool | None = None,
    error: str = "",
    message: str = "",
    duration_s: float | None = None,
) -> None:
    _record_tool(
        tool_name=tool_name,
        ok=ok,
        error=error,
        message=message,
        duration_s=duration_s,
    )


def _collect_mas_tool_rows(node: Any, *, depth: int = 0, seen: set[int] | None = None) -> list[dict[str, Any]]:
    if depth > 10 or not isinstance(node, dict):
        return []
    seen = seen if seen is not None else set()
    oid = id(node)
    if oid in seen:
        return []
    seen.add(oid)
    rows: list[dict[str, Any]] = []
    for item in node.get("tool_results") or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        name = str(item[0] or "").strip()
        tr = item[1] if isinstance(item[1], dict) else {}
        if not name:
            continue
        rows.append(
            {
                "tool_name": name,
                "ok": tr.get("ok"),
                "error": _clip(tr.get("error") or "", _CLIP_ERROR) or None,
                "message": _clip(
                    tr.get("message") or tr.get("user_message") or "",
                    _CLIP_TOOL_MSG,
                )
                or None,
            }
        )
    for key in ("domain_result", "result", "executor_result", "mas_out"):
        nested = node.get(key)
        if isinstance(nested, dict):
            rows.extend(_collect_mas_tool_rows(nested, depth=depth + 1, seen=seen))
    return rows


def turn_audit_mas_summary(result: dict[str, Any]) -> None:
    ctx = _ctx.get()
    if not ctx:
        return
    mas_out = result.get("mas_out")
    if not isinstance(mas_out, dict):
        return
    already = {
        str(t.get("tool_name") or "")
        for t in (ctx.get("tools") or [])
        if t.get("tool_name")
    }
    for row in _collect_mas_tool_rows(mas_out):
        name = str(row.get("tool_name") or "")
        if name and name in already:
            continue
        ctx.setdefault("tools", []).append(row)
        if name:
            already.add(name)


def turn_audit_turn_result(
    *,
    reply: str,
    used_tools: bool | None = None,
    error: str = "",
    mas: bool | None = None,
    skill_id: str = "",
    intent: str = "",
) -> None:
    ctx = _ctx.get()
    if not ctx:
        return
    _flush_turn_block(
        ctx,
        reply=reply,
        error=error,
        used_tools=used_tools,
        skill_id=skill_id,
        intent=intent,
        mas=mas,
    )


def turn_audit_exception(*, error: str) -> None:
    ctx = _ctx.get()
    if not ctx:
        return
    _flush_turn_block(ctx, reply="", error=_clip(error, _CLIP_ERROR))


def log_turn_socket_error(
    *,
    session_id: str,
    module: str,
    error: str,
    chat_context: str = "create",
    template_id: str = "",
    channel: str = "",
) -> None:
    mod = str(module or "").strip().lower()
    if mod not in AUDIT_MODULES:
        return
    lines = [
        "",
        "========== TURN ==========",
        f"TURN  session={str(session_id or '').strip() or '-'}  module={mod}  socket-error",
        f"context  {str(chat_context or 'create')}",
    ]
    tid = str(template_id or "").strip()
    if tid:
        lines.append(f"template {tid}")
    ch = str(channel or "").strip().lower()
    if ch:
        lines.append(f"channel  {ch}")
    lines.append("")
    lines.append("CHAT TO USER")
    lines.extend(_indent(f"ERROR: {_clip(error, _CLIP_ERROR)}", "  "))
    lines.append("========== END TURN ==========")
    lines.append("")
    _log_lines(lines)


async def run_with_turn_audit(
    *,
    module: str,
    session_id: str,
    user_text: str,
    chat_context: str,
    runner: Callable[[], Awaitable[dict[str, Any]]],
    template_id: str = "",
    channel: str = "",
) -> dict[str, Any]:
    """Wrap a module turn: request → (inner LLM/tools) → one readable block."""
    if not is_audited_module(module):
        return await runner()
    with turn_audit_scope(
        session_id=session_id,
        module=module,
        user_text=user_text,
        chat_context=chat_context,
        template_id=template_id,
        channel=channel,
    ):
        try:
            result = await runner()
            if isinstance(result, dict):
                turn_audit_mas_summary(result)
                turn_audit_turn_result(
                    reply=str(result.get("reply") or ""),
                    used_tools=result.get("used_tools"),
                    mas=bool(result.get("mas")),
                    skill_id=str(result.get("skill_id") or ""),
                    intent=str(result.get("intent") or ""),
                )
            else:
                turn_audit_turn_result(reply="", error="non-dict turn result")
            return result
        except Exception as exc:
            turn_audit_exception(error=str(exc))
            raise


__all__ = [
    "AUDIT_MODULES",
    "is_audited_module",
    "log_turn_socket_error",
    "run_with_turn_audit",
    "turn_audit_exception",
    "turn_audit_llm_failure",
    "turn_audit_llm_response",
    "turn_audit_scope",
    "turn_audit_stage",
    "turn_audit_tool_result",
    "turn_audit_turn_result",
]
