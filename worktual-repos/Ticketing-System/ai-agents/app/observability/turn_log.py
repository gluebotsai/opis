"""Day-wise staff-chat turn traces: query, routing, tools, final reply.

Writes one readable block per turn to:
  ai-agents/logs/agent-turn-YYYY-MM-DD.log

Also prints the same block to stdout when AGENT_TURN_CONSOLE is enabled
(default on) so the uvicorn / `npm run dev:agents` terminal shows each turn.

Never raises — logging must not change chat behavior.
"""

from __future__ import annotations

import json
import sys
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.observability.logging import redact

LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_LOCK = threading.Lock()
_TRACE: ContextVar["_TurnTrace | None"] = ContextVar("agent_turn_trace", default=None)

_AGENT_LABELS = {
    "ticketing_super_agent": "Super Agent",
    "intake_deflection_domain": "Domain (intake)",
    "triage_routing_domain": "Domain (triage)",
    "resolution_lifecycle_domain": "Domain (resolution)",
    "knowledge_domain": "Domain (knowledge)",
    "catalog_administration_domain": "Domain (catalog)",
}

# Python harness host only — omit from ATTENDING AGENT / display labels.
_HARNESS_ENTRY_AGENTS = frozenset({"ticketing_coworker", "supervisor"})

_MAX_TOOL_CHARS = 6000
_MAX_REPLY_CHARS = 8000


def _is_harness_entry(name: str) -> bool:
    return str(name or "").strip() in _HARNESS_ENTRY_AGENTS


class _TurnTrace:
    def __init__(
        self,
        *,
        user_query: str,
        session_id: str,
        request_id: str,
        organization_id: str,
        user_id: str,
        start_agent: str,
    ) -> None:
        self.started_at = datetime.now(timezone.utc)
        self.user_query = str(user_query or "").strip()
        self.session_id = session_id or "-"
        self.request_id = request_id or "-"
        self.organization_id = organization_id or "-"
        self.user_id = user_id or "-"
        self.attended: list[str] = []
        self.routes: list[dict[str, str]] = []
        self.tools: list[dict[str, Any]] = []
        self.current_agent = ""
        if start_agent:
            self.record_agent(start_agent)

    def record_agent(self, name: str) -> None:
        label = str(name or "").strip()
        if not label or _is_harness_entry(label):
            return
        self.current_agent = label
        if not self.attended or self.attended[-1] != label:
            self.attended.append(label)

    def record_route(self, from_agent: str, to_agent: str, query: str = "") -> None:
        src = str(from_agent or "").strip()
        dst = str(to_agent or "").strip()
        if not dst or _is_harness_entry(dst):
            return
        if _is_harness_entry(src):
            src = ""
        self.routes.append(
            {
                "from": src or (self.attended[-1] if self.attended else "-"),
                "to": dst,
                "query": str(query or "").strip(),
            }
        )
        self.record_agent(dst)

    def record_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None,
        result: Any,
        *,
        agent: str | None = None,
    ) -> None:
        who = str(agent or self.current_agent or "").strip()
        if _is_harness_entry(who):
            who = self.current_agent or "-"
        self.tools.append(
            {
                "agent": who or "-",
                "name": str(name or "").strip() or "-",
                "arguments": redact(arguments if isinstance(arguments, dict) else {}),
                "response": redact(result),
            }
        )


def _log_path(when: datetime | None = None) -> Path:
    day = when or datetime.now(timezone.utc)
    return LOG_DIR / f"agent-turn-{day.strftime('%Y-%m-%d')}.log"


def agent_label(name: str) -> str:
    key = str(name or "").strip()
    if not key or _is_harness_entry(key):
        return "-"
    pretty = _AGENT_LABELS.get(key)
    if pretty and pretty != key:
        return f"{pretty} ({key})"
    return key


def _clip(text: str, limit: int) -> str:
    raw = str(text or "")
    if len(raw) <= limit:
        return raw
    return f"{raw[:limit]}\n… [truncated {len(raw) - limit} chars]"


def _pretty(value: Any) -> str:
    if value is None:
        return "(empty)"
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return "(empty)"
        try:
            return json.dumps(json.loads(text), indent=2, default=str, ensure_ascii=False)
        except (TypeError, ValueError):
            return text
    try:
        return json.dumps(value, indent=2, default=str, ensure_ascii=False)
    except TypeError:
        return str(value)


def format_turn(
    trace: _TurnTrace,
    *,
    final_response: str = "",
    final_agent: str | None = None,
    error: str | None = None,
) -> str:
    ts = trace.started_at.strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "",
        "=" * 88,
        f"AGENT TURN  {ts} UTC",
        (
            f"request_id={trace.request_id}  session={trace.session_id}  "
            f"org={trace.organization_id}  user={trace.user_id}"
        ),
        "-" * 88,
        "USER QUERY",
        f"  {trace.user_query or '(empty)'}",
        "",
        "ATTENDING AGENT",
    ]
    if trace.attended:
        for i, name in enumerate(trace.attended, start=1):
            lines.append(f"  {i}. {agent_label(name)}")
    else:
        lines.append("  (none)")

    lines.extend(["", "ROUTED TO"])
    if trace.routes:
        for hop in trace.routes:
            extra = f"  query={hop['query']}" if hop.get("query") else ""
            lines.append(
                f"  {agent_label(hop['from'])} → {agent_label(hop['to'])}{extra}"
            )
    else:
        who = agent_label(trace.attended[0]) if trace.attended else "—"
        lines.append(f"  (none — {who} answered)")

    lines.extend(["", "TOOLS"])
    if not trace.tools:
        lines.append("  (none)")
    else:
        for i, call in enumerate(trace.tools, start=1):
            lines.append(f"  [{i}] TOOL CALLED")
            lines.append(f"      agent: {agent_label(str(call.get('agent') or ''))}")
            lines.append(f"      tool:  {call.get('name') or '-'}")
            lines.append("      args:")
            for row in _pretty(call.get("arguments")).splitlines() or ["(empty)"]:
                lines.append(f"        {row}")
            lines.append("      TOOL RESPONSE")
            body = _clip(_pretty(call.get("response")), _MAX_TOOL_CHARS)
            for row in body.splitlines() or ["(empty)"]:
                lines.append(f"        {row}")

    closer = agent_label(str(final_agent or (trace.attended[-1] if trace.attended else "")))
    lines.extend(
        [
            "",
            f"FINAL RESPONSE  (agent: {closer})",
            _clip((final_response or "").strip() or "(empty)", _MAX_REPLY_CHARS),
        ]
    )
    if error:
        lines.extend(["", f"ERROR: {error}"])
    lines.extend(["=" * 88, ""])
    return "\n".join(lines)


def begin_turn(
    *,
    user_query: str,
    session_id: str = "",
    request_id: str = "",
    organization_id: str = "",
    user_id: str = "",
    start_agent: str = "",
) -> None:
    _TRACE.set(
        _TurnTrace(
            user_query=user_query,
            session_id=session_id,
            request_id=request_id,
            organization_id=organization_id,
            user_id=user_id,
            start_agent=start_agent,
        )
    )


def current_trace() -> _TurnTrace | None:
    return _TRACE.get()


def current_attending_agent() -> str:
    """Harness agent currently on the LLM hop (Super / Domain / Executor)."""
    trace = _TRACE.get()
    if trace is None:
        return ""
    return str(trace.current_agent or "").strip()


def record_attending_agent(name: str) -> None:
    trace = _TRACE.get()
    if trace is not None:
        trace.record_agent(name)


def record_route(from_agent: str, to_agent: str, query: str = "") -> None:
    trace = _TRACE.get()
    if trace is not None:
        trace.record_route(from_agent, to_agent, query)


def record_tool(
    name: str,
    arguments: dict[str, Any] | None,
    result: Any,
    *,
    agent: str | None = None,
) -> None:
    trace = _TRACE.get()
    if trace is not None:
        trace.record_tool(name, arguments, result, agent=agent)


def _console_echo_enabled() -> bool:
    try:
        from app.config import get_settings

        return bool(get_settings().agent_turn_console)
    except Exception:  # noqa: BLE001
        return True


def finish_turn(
    *,
    final_response: str = "",
    final_agent: str | None = None,
    error: str | None = None,
) -> str | None:
    """Write the turn block (and echo to terminal) then clear context."""
    trace = _TRACE.get()
    _TRACE.set(None)
    if trace is None:
        return None
    try:
        payload = format_turn(
            trace,
            final_response=final_response,
            final_agent=final_agent,
            error=error,
        )
        path = _log_path(trace.started_at)
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(payload)
            if _console_echo_enabled():
                # Flush so uvicorn --reload terminals show the block immediately.
                print(payload, end="", file=sys.stdout, flush=True)
        return payload
    except Exception:  # noqa: BLE001
        return None


def log_proactive_executor_run(
    *,
    title: str,
    ticket_number: str = "",
    organization_id: str = "",
    event_type: str = "",
    domain_id: str = "",
    executor_id: str = "",
    skill_name: str = "",
    task_id: str = "",
    agent_id: str = "",
    status: str = "",
    via: str = "",
    detail: str = "",
) -> str | None:
    """Visible harness block for a single post-insert Executor (e.g. TSAA)."""
    try:
        now = datetime.now(timezone.utc)
        lines = [
            "",
            "=" * 88,
            f"{title}",
            f"  time:     {now.isoformat()}",
            f"  event:    {event_type or '-'}",
            f"  org:      {organization_id or '-'}",
            f"  ticket:   {ticket_number or '-'}",
            f"  domain:   {agent_label(domain_id) if domain_id else '-'}",
            "",
            "ATTENDING AGENT",
            f"  1. {agent_label(domain_id) if domain_id else '-'}",
            f"  2. {executor_id or '-'}",
            "",
            "ROUTED TO",
            (
                f"  {agent_label(domain_id) if domain_id else '-'} → {executor_id or '-'}  "
                f"skill={skill_name or '-'} task={task_id or '-'} via={via or '-'}"
            ),
            f"      proactive_agent={agent_id or '-'} status={status or '-'}",
        ]
        if detail:
            lines.append(f"      detail={detail[:240]}")
        lines.extend(["=" * 88, ""])
        payload = "\n".join(lines)
        path = _log_path(now)
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(payload)
            if _console_echo_enabled():
                print(payload, end="", file=sys.stdout, flush=True)
        return payload
    except Exception:  # noqa: BLE001
        return None


def log_proactive_domain_triage(
    *,
    ticket_number: str = "",
    organization_id: str = "",
    event_type: str = "ticket.created",
    domain_id: str = "triage_routing_domain",
    steps: list[dict[str, Any]] | None = None,
    title: str | None = None,
) -> str | None:
    """Print/write a readable block for post-insert Domain → Executor planning.

    Proactive runs on a separate HTTP request from staff chat, so it never
    appears in ATTENDING AGENT for the create_ticket turn. This block is the
    visible harness trace for that path (triage or create-time resolution).
    """
    try:
        now = datetime.now(timezone.utc)
        rows = [s for s in (steps or []) if isinstance(s, dict)]
        banner = (title or "").strip() or (
            "PROACTIVE DOMAIN TRIAGE  (post-insert — Super Agent not involved)"
        )
        lines = [
            "",
            "=" * 88,
            banner,
            f"  time:     {now.isoformat()}",
            f"  event:    {event_type}",
            f"  org:      {organization_id or '-'}",
            f"  ticket:   {ticket_number or '-'}",
            f"  domain:   {agent_label(domain_id)}",
            "",
            "ATTENDING AGENT",
        ]
        lines.append(f"  1. {agent_label(domain_id)}")
        seen_exec: list[str] = []
        for step in rows:
            ex = str(step.get("executor_id") or "").strip()
            if ex and ex not in seen_exec:
                seen_exec.append(ex)
                lines.append(f"  {len(seen_exec) + 1}. {ex}")
        lines.extend(["", "ROUTED TO"])
        if not rows:
            lines.append("  (no steps)")
        else:
            for step in rows:
                via = str(step.get("via") or "domain-delegate")
                ex = str(step.get("executor_id") or "-")
                skill = str(step.get("skill_name") or "-")
                task = str(step.get("task_id") or "-")
                agent = str(step.get("agent_id") or "-")
                status = str(step.get("status") or "-")
                lines.append(
                    f"  {agent_label(domain_id)} → {ex}  "
                    f"skill={skill} task={task} via={via}"
                )
                lines.append(f"      proactive_agent={agent} status={status}")
        lines.extend(["=" * 88, ""])
        payload = "\n".join(lines)
        path = _log_path(now)
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(payload)
            if _console_echo_enabled():
                print(payload, end="", file=sys.stdout, flush=True)
        return payload
    except Exception:  # noqa: BLE001
        return None
