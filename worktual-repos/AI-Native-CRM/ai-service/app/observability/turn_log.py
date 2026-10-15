"""Agent turn log (``agent-turn-YYYY-MM-DD.log``) — portable observability format."""

from __future__ import annotations

import os
import time
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from app.observability.file_sink import append_text, log_dir, utc_live_ts, utc_now_header
from app.observability.redact import (
    _MAX_REPLY_CHARS,
    _MAX_TOOL_CHARS,
    clip_text,
    indent_block,
    pretty_payload,
)

SEP_WIDTH = 88
_TURN_PREFIX = "agent-turn"
_SKIP_STEP_AGENTS = frozenset(
    {
        "native-coworker",
        "crm-agent",
        "supervisor",
        "ticketing_coworker",
    }
)

_AGENT_LABELS: dict[str, str] = {
    "contact-agent": "Contact (contact-agent)",
    "company-agent": "Company (company-agent)",
    "deal-agent": "Sales / Deals (deal-agent)",
    "proposal-agent": "Proposal (proposal-agent)",
    "product-agent": "Product (product-agent)",
    "finance-agent": "Finance (finance-agent)",
    "quotes-agent": "Quotes (quotes-agent)",
    "reports-analytics-agent": "Reports Analytics (reports-analytics-agent)",
    "seo-content-generator": "SEO Content (seo-content-generator)",
    "link-agent": "Link (link-agent)",
}


@dataclass
class _TurnState:
    request_id: str
    session_id: str
    organization_id: str
    user_id: str
    started: float
    tool_index: int = 0
    step_index: int = 0
    current_agent: str | None = None
    llm_ms_by_agent: dict[str, float] = field(default_factory=dict)
    llm_calls_by_agent: dict[str, int] = field(default_factory=dict)
    llm_pending_agent: str | None = None


_TURN: ContextVar[_TurnState | None] = ContextVar("agent_turn_log", default=None)


def agent_turn_log_path(day: date | None = None) -> Path:
    stamp = (day or date.today()).isoformat()
    return log_dir() / f"{_TURN_PREFIX}-{stamp}.log"


def turn_active() -> bool:
    return _TURN.get() is not None


def current_turn_agent() -> str | None:
    state = _TURN.get()
    return state.current_agent if state else None


def agent_turn_console_enabled() -> bool:
    raw = os.environ.get("AGENT_TURN_CONSOLE")
    if raw is None:
        raw = os.environ.get("COWORKER_CONSOLE_LOG")
    if raw is None:
        return "PYTEST_CURRENT_TEST" not in os.environ
    return raw.strip().lower() not in {"0", "false", "off", "no", ""}


def agent_label(agent_id: str | None) -> str:
    name = (agent_id or "").strip()
    if not name:
        return "-"
    if name in _AGENT_LABELS:
        return _AGENT_LABELS[name]
    readable = name.replace("-", " ").replace("_", " ").title()
    return f"{readable} ({name})"


def _fmt_duration(seconds: float) -> str:
    if seconds < 10:
        return f"{seconds:.2f}s"
    return f"{int(round(seconds))}s"


def _emit_live(line: str) -> None:
    body = f"  [{utc_live_ts()}] {line}\n"
    append_text(prefix=_TURN_PREFIX, text=body)
    if agent_turn_console_enabled():
        try:
            print(body.rstrip(), flush=True)
        except Exception:  # noqa: BLE001
            pass


def begin_turn(
    *,
    user_query: str,
    session_id: str | None = None,
    request_id: str | None = None,
    organization_id: str | None = None,
    user_id: str | None = None,
    start_agent: str | None = None,
) -> None:
    rid = (request_id or "").strip() or f"req_{uuid.uuid4().hex[:12]}"
    sid = (session_id or "").strip() or "-"
    org = (organization_id or "").strip() or "-"
    uid = (user_id or "").strip() or "-"
    state = _TurnState(
        request_id=rid,
        session_id=sid,
        organization_id=org,
        user_id=uid,
        started=time.perf_counter(),
    )
    _TURN.set(state)
    sep = "=" * SEP_WIDTH
    dash = "-" * SEP_WIDTH
    query_lines = (user_query or "").strip() or "(empty)"
    indented_query = indent_block(query_lines, 2)
    header = (
        f"{sep}\n"
        f"AGENT TURN  {utc_now_header()} UTC\n"
        f"request_id={rid}  session={sid}  org={org}  user={uid}\n"
        f"{dash}\n"
        f"USER QUERY\n"
        f"{indented_query}\n\n"
        f"LIVE\n"
    )
    append_text(prefix=_TURN_PREFIX, text=header)
    if agent_turn_console_enabled():
        try:
            print(header, end="", flush=True)
        except Exception:  # noqa: BLE001
            pass
    if start_agent:
        record_attending_agent(start_agent)


def record_attending_agent(name: str | None) -> None:
    state = _TURN.get()
    if not state or not name or name in _SKIP_STEP_AGENTS:
        return
    state.step_index += 1
    state.current_agent = name
    label = agent_label(name)
    _emit_live(f"STEP  {state.step_index}. {label}")


def record_route(
    from_agent: str | None,
    to_agent: str,
    *,
    query: str | None = None,
) -> None:
    state = _TURN.get()
    if not state or not to_agent:
        return
    src = agent_label(from_agent) if from_agent else "Router"
    dst = agent_label(to_agent)
    line = f"ROUTE {src} → {dst}"
    if query and query.strip():
        line += f"  query={clip_text(query.strip(), limit=240)}"
    _emit_live(line)
    record_attending_agent(to_agent)


def record_llm_start(agent: str | None = None) -> None:
    state = _TURN.get()
    if not state:
        return
    aid = (agent or state.current_agent or "llm").strip()
    state.llm_pending_agent = aid
    _emit_live(f"LLM   {agent_label(aid)}  waiting")


def record_llm_hop(
    ms: float,
    *,
    agent: str | None = None,
    kind: str = "chat",
    note: str | None = None,
) -> None:
    state = _TURN.get()
    if not state:
        return
    aid = (agent or state.llm_pending_agent or state.current_agent or "llm").strip()
    state.llm_pending_agent = None
    seconds = max(0.0, ms) / 1000.0
    state.llm_ms_by_agent[aid] = state.llm_ms_by_agent.get(aid, 0.0) + seconds
    state.llm_calls_by_agent[aid] = state.llm_calls_by_agent.get(aid, 0) + 1
    line = f"LLM   {agent_label(aid)}  {_fmt_duration(seconds)}  {kind}"
    if note:
        line += f"  {note}"
    _emit_live(line)


def record_tool(
    name: str,
    arguments: Any,
    result: Any,
    *,
    agent: str | None = None,
) -> None:
    state = _TURN.get()
    if not state or not name:
        return
    state.tool_index += 1
    label = agent_label(agent or state.current_agent)
    args_text = pretty_payload(arguments, indent=2)
    res_text = pretty_payload(result, indent=2)
    block = (
        f"TOOL  [{state.tool_index}] {label}  {name}\n"
        f"      args:\n"
        f"{indent_block(args_text, 8)}\n"
        f"      TOOL RESPONSE\n"
        f"{indent_block(res_text, 8)}"
    )
    append_text(prefix=_TURN_PREFIX, text=f"  [{utc_live_ts()}] {block}\n")
    if agent_turn_console_enabled():
        try:
            print(f"  [{utc_live_ts()}] {block}", flush=True)
        except Exception:  # noqa: BLE001
            pass


def record_context_layer(
    endpoint: str,
    url: str,
    payload: Any,
    *,
    status: int | None = None,
    response: Any = None,
    error: str | None = None,
    phase: str | None = None,
) -> None:
    """Ontology slice: log status only on ``received`` (no response body)."""
    ep = (endpoint or "context").strip()
    if phase == "calling":
        body = (
            f"CONTEXT LAYER  {ep}  calling\n"
            f"      url: {url}\n"
            f"      payload:\n"
            f"{indent_block(pretty_payload(payload), 8)}"
        )
        append_text(prefix=_TURN_PREFIX, text=f"  [{utc_live_ts()}] {body}\n")
        return
    if ep == "ontology_slice" and phase == "received":
        if error:
            _emit_live(f"CONTEXT LAYER  {ep}  received  error: {clip_text(error, limit=400)}")
        else:
            _emit_live(f"CONTEXT LAYER  {ep}  received  status={status or '-'}")
        return
    if error:
        body = (
            f"CONTEXT LAYER  {ep}\n"
            f"      url: {url}\n"
            f"      payload:\n"
            f"{indent_block(pretty_payload(payload), 8)}\n"
            f"      error: {clip_text(error, limit=_MAX_TOOL_CHARS)}"
        )
    else:
        body = (
            f"CONTEXT LAYER  {ep}\n"
            f"      url: {url}\n"
            f"      payload:\n"
            f"{indent_block(pretty_payload(payload), 8)}\n"
            f"      response  status={status if status is not None else '-'}\n"
            f"{indent_block(pretty_payload(response), 8)}"
        )
    append_text(prefix=_TURN_PREFIX, text=f"  [{utc_live_ts()}] {body}\n")


def finish_turn(
    final_response: str,
    *,
    final_agent: str | None = None,
    error: str | None = None,
) -> str | None:
    state = _TURN.get()
    if not state:
        return None
    wall = time.perf_counter() - state.started
    llm_total = sum(state.llm_ms_by_agent.values())
    llm_calls = sum(state.llm_calls_by_agent.values())
    agent_name = final_agent or state.current_agent
    label = agent_label(agent_name)
    reply = clip_text((final_response or "").strip(), limit=_MAX_REPLY_CHARS)
    sep = "=" * SEP_WIDTH
    lines = [
        f"FINAL RESPONSE  (agent: {label})",
        reply,
        "",
    ]
    if error:
        lines.extend([f"ERROR: {clip_text(error, limit=800)}", ""])
    lines.append(
        f"TOTAL  wall={_fmt_duration(wall)}  llm={_fmt_duration(llm_total)}  calls={llm_calls}"
    )
    for aid, seconds in state.llm_ms_by_agent.items():
        calls = state.llm_calls_by_agent.get(aid, 0)
        call_word = "call" if calls == 1 else "calls"
        lines.append(
            f"  {agent_label(aid)}  {_fmt_duration(seconds)}  ({calls} {call_word})"
        )
    lines.extend([sep, ""])
    closer = "\n".join(lines)
    append_text(prefix=_TURN_PREFIX, text=closer)
    if agent_turn_console_enabled():
        try:
            print(closer, flush=True)
        except Exception:  # noqa: BLE001
            pass
    _TURN.set(None)
    return closer


def on_llm_call_complete(
    *,
    ms: float,
    kind: str = "chat",
    note: str | None = None,
    agent: str | None = None,
) -> None:
    """Hook from ``app.llm`` when a turn is active."""
    if not turn_active():
        return
    record_llm_hop(ms, agent=agent, kind=kind, note=note)


def on_llm_call_start(*, agent: str | None = None) -> None:
    if not turn_active():
        return
    record_llm_start(agent)
