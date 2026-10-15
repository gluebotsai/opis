"""Live agent roster and status events for the CLI."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

AGENTS: dict[str, dict[str, str]] = {
    "sql_supervisor": {
        "role": "L1 router",
        "summary": "Receives every query. Hands off with route_to_agent.",
    },
    "sql_developer": {
        "role": "L3 DQL specialist",
        "summary": "Catalog tools, certified KPIs, validated SELECT/WITH.",
    },
}

TOOL_LABELS: dict[str, str] = {
    "route_to_agent": "handing off to specialist",
    "search_catalog": "searching catalog",
    "get_metric": "loading certified KPI",
    "get_table_details": "fetching table cards",
    "get_join_path": "resolving join path",
    "plan_query": "planning query",
    "lock_period": "locking the time window",
    "sql_analytics": "querying postgres",
}

_COLORS = {
    "idle": "\033[2m",
    "thinking": "\033[36m",
    "routing": "\033[35m",
    "tool": "\033[33m",
    "writing": "\033[36m",
    "done": "\033[32m",
    "error": "\033[31m",
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
}


def use_color() -> bool:
    return sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def paint(text: str, key: str) -> str:
    if not use_color():
        return text
    return f"{_COLORS.get(key, '')}{text}{_COLORS['reset']}"


@dataclass
class StatusEvent:
    agent: str
    state: str
    detail: str = ""
    tool: str | None = None
    ok: bool | None = None
    at: str = field(default_factory=lambda: datetime.now().strftime("%H:%M:%S"))

    def as_dict(self) -> dict[str, str | bool | None]:
        return {
            "agent": self.agent,
            "state": self.state,
            "detail": self.detail,
            "tool": self.tool,
            "ok": self.ok,
            "at": self.at,
        }


class StatusBoard:
    def __init__(self) -> None:
        self.states: dict[str, StatusEvent] = {
            name: StatusEvent(agent=name, state="idle", detail="waiting") for name in AGENTS
        }
        self.log: list[StatusEvent] = []

    def reset(self) -> None:
        for name in AGENTS:
            self.states[name] = StatusEvent(agent=name, state="idle", detail="waiting")
        self.log = []

    def apply(self, event: StatusEvent) -> StatusEvent:
        self.states[event.agent] = event
        self.log.append(event)
        return event

    def snapshot(self) -> str:
        lines = [
            paint("  AGENT STATUS", "bold"),
            f"  {'Agent':<18} {'Role':<22} {'State':<12} Detail",
            "  " + "-" * 72,
        ]
        for name, meta in AGENTS.items():
            event = self.states[name]
            state = paint(f"{event.state:<12}", event.state)
            detail = event.detail or TOOL_LABELS.get(event.tool or "", "")
            lines.append(f"  {name:<18} {meta['role']:<22} {state} {detail}")
        return "\n".join(lines)

    def format_event(self, event: StatusEvent) -> str:
        label = TOOL_LABELS.get(event.tool or "", event.tool or "")
        detail = event.detail or label
        mark = {
            "thinking": "...",
            "routing": "->",
            "tool": "*",
            "writing": "~",
            "done": "ok",
            "error": "!!",
            "idle": ".",
        }.get(event.state, ".")
        left = paint(f"{event.at}  {event.agent:<16} {event.state:<10}", event.state)
        return f"  {left} {mark} {detail}".rstrip()


def live_printer(board: StatusBoard) -> Callable[[StatusEvent], None]:
    def on_event(event: StatusEvent) -> None:
        board.apply(event)
        print(board.format_event(event), flush=True)

    return on_event
