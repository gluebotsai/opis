"""Worktual MiniMax sql_developer loop.

CLI:
  python -m sql_agent.agent ping
  python -m sql_agent.agent ask "average handel time"
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from sql_agent.context import QueryContext
from sql_agent.grounding import ground_reply
from sql_agent.history import history_messages
from sql_agent.minimax import MiniMaxClient
from sql_agent.prompt import build_system_prompt
from sql_agent.settings import get_minimax_settings
from sql_agent.status import StatusEvent, TOOL_LABELS
from sql_agent.tools import OPENAI_TOOLS, SqlAgentTools, parse_tool_arguments

MAX_ROUNDS = 8
TOOL_RESULT_CHARS = 12000


class Completer(Protocol):
    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]: ...


@dataclass
class AgentTurn:
    reply: str
    model: str
    tool_trace: list[dict[str, Any]] = field(default_factory=list)
    rounds: int = 0
    elapsed_ms: int = 0
    host: str = ""


class SqlDeveloperAgent:
    def __init__(
        self,
        *,
        tools: SqlAgentTools | None = None,
        client: Completer | None = None,
        max_rounds: int = MAX_ROUNDS,
    ) -> None:
        self.tools = tools or SqlAgentTools()
        self.client = client or MiniMaxClient()
        self.max_rounds = max_rounds
        self.system_prompt = build_system_prompt("sql_developer")

    def ask(
        self,
        question: str,
        *,
        period_start: str | None = None,
        period_end: str | None = None,
        history: list[dict[str, Any]] | None = None,
        on_event: Callable[[StatusEvent], None] | None = None,
    ) -> AgentTurn:
        started = time.perf_counter()

        def emit(state: str, detail: str = "", **kwargs: Any) -> None:
            if on_event is None:
                return
            on_event(StatusEvent(agent="sql_developer", state=state, detail=detail, **kwargs))

        ctx = QueryContext.resolve(period_start, period_end)
        self.tools.bind(ctx)
        user = (
            f"{question.strip()}\n\n"
            f"UI default period: {ctx.period_start} to {ctx.period_end}. "
            f"Organization {ctx.organization_id}. "
            "If the user named yesterday, today, this week, last 7 days, or last month, "
            "call lock_period before plan_query. Then name the locked window in the answer."
        )
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.system_prompt}]
        messages.extend(history_messages(history))
        messages.append({"role": "user", "content": user})
        trace: list[dict[str, Any]] = []
        model = ""
        reply = ""
        rounds = 0
        emit("thinking", "reading catalog tools")
        for rounds in range(1, self.max_rounds + 1):
            result = self.client.complete(messages, tools=OPENAI_TOOLS)
            model = str(result.get("model") or model)
            tool_calls = result.get("tool_calls") or []
            content = str(result.get("content") or "")
            if not tool_calls:
                emit("writing", "composing the answer")
                reply = content
                emit("done", f"{rounds} round(s), {len(trace)} tool call(s)")
                break
            messages.append(
                {"role": "assistant", "content": content, "tool_calls": tool_calls}
            )
            for call in tool_calls:
                function = call.get("function") or {}
                name = str(function.get("name") or "")
                arguments = parse_tool_arguments(str(function.get("arguments") or "{}"))
                label = TOOL_LABELS.get(name, name)
                extra = ""
                if name == "get_metric" and arguments.get("metric_id"):
                    extra = f" ({arguments['metric_id']})"
                elif name == "lock_period":
                    extra = f" ({arguments.get('window') or ''})"
                elif name in {"search_catalog", "plan_query"}:
                    extra = f" ({arguments.get('query') or arguments.get('question') or ''})"
                emit("tool", f"{label}{extra}", tool=name)
                payload = self.tools.dispatch(name, arguments)
                serialized = json.dumps(payload, default=str)
                if len(serialized) > TOOL_RESULT_CHARS:
                    serialized = json.dumps(
                        {"truncated": True, "preview": serialized[:TOOL_RESULT_CHARS]},
                        default=str,
                    )
                traced_args = {key: value for key, value in arguments.items() if key != "sql"}
                if "sql" in arguments:
                    traced_args["sql"] = _preview_sql(arguments.get("sql"))
                trace.append(
                    {
                        "name": name,
                        "arguments": traced_args,
                        "ok": payload.get("error") is None and payload.get("ok") is not False,
                        "trust": payload.get("trust"),
                        "dry_run": payload.get("dry_run"),
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(call.get("id") or name),
                        "content": serialized,
                    }
                )
        else:
            reply = reply or (
                "<p>I reached the tool-round limit before a final answer. Ask again with a narrower question.</p>"
            )
            emit("error", "tool-round limit")
        reply = ground_reply(reply, self.tools.last_result, self.tools.ctx)
        host = ""
        settings = getattr(self.client, "settings", None)
        if settings is not None:
            host = getattr(settings, "host", "")
            model = model or getattr(settings, "model", "")
        return AgentTurn(
            reply=reply,
            model=model,
            tool_trace=trace,
            rounds=rounds,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            host=host,
        )


def _preview_sql(sql: Any) -> str:
    text = str(sql or "").strip()
    if len(text) <= 160:
        return text
    return text[:157] + "..."


def ping_minimax() -> dict[str, Any]:
    settings = get_minimax_settings()
    client = MiniMaxClient(settings)
    started = time.perf_counter()
    result = client.complete(
        [
            {
                "role": "system",
                "content": "Reply with the single word pong. No other text.",
            },
            {"role": "user", "content": "ping"},
        ]
    )
    content = str(result.get("content") or "")
    return {
        "ok": "pong" in content.casefold(),
        "model": result.get("model") or settings.model,
        "host": settings.host,
        "reply": content[:200],
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Worktual MiniMax sql_developer experiment.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("ping", help="Check worktual-minimax without tools")
    ask = sub.add_parser("ask", help="Ask the sql_developer agent")
    ask.add_argument("question", nargs="+")
    ask.add_argument("--start", dest="period_start", default=None)
    ask.add_argument("--end", dest="period_end", default=None)
    ask.add_argument("--trace", action="store_true", help="Print tool names used")
    args = parser.parse_args()
    if args.command == "ping":
        result = ping_minimax()
        print(f"ok: {result['ok']}")
        print(f"model: {result['model']}")
        print(f"host: {result['host']}")
        print(f"elapsed_ms: {result['elapsed_ms']}")
        print(f"reply: {result['reply']}")
        if not result["ok"]:
            sys.exit(1)
        return
    question = " ".join(args.question)
    turn = SqlDeveloperAgent().ask(
        question,
        period_start=args.period_start,
        period_end=args.period_end,
    )
    print(f"model: {turn.model}")
    print(f"host: {turn.host}")
    print(f"rounds: {turn.rounds}")
    print(f"elapsed_ms: {turn.elapsed_ms}")
    print(f"tools: {', '.join(item['name'] for item in turn.tool_trace) or '(none)'}")
    if args.trace:
        print("trace:")
        print(json.dumps(turn.tool_trace, indent=2, default=str))
    print()
    print(turn.reply)


if __name__ == "__main__":
    main()
