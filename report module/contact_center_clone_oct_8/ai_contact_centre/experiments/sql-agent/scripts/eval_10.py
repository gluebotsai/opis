#!/usr/bin/env python3
"""Run 10 questions against MiniMax and check answers against Postgres."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
VENV = ROOT.parents[1] / "apps" / "nlp" / ".venv"
VENV_PYTHON = VENV / "bin" / "python"

QUESTIONS = [
    "average handel time",
    "how many conversations were handled",
    "channel mix",
    "disposition mix",
    "disposition mix by queue",
    "how many agent messages per channel",
    "missed contacts",
    "how many transferred",
    "first response time",
    "response SLA",
]


def _reexec_with_venv() -> None:
    if not VENV_PYTHON.is_file():
        sys.stderr.write(f"NLP venv not found: {VENV_PYTHON}\n")
        sys.exit(1)
    if Path(sys.prefix).resolve() == VENV.resolve():
        return
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(SRC) if not existing else str(SRC) + os.pathsep + existing
    env["SQL_AGENT_LIVE"] = "1"
    os.execve(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]], env)


_reexec_with_venv()
os.environ["SQL_AGENT_LIVE"] = "1"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from sql_agent.cli import html_to_text
from sql_agent.context import QueryContext
from sql_agent.orchestrator import SqlOrchestrator
from sql_agent.planner import SqlPlanner
from sql_agent.tools import SqlAgentTools
from sql_agent.warehouse import get_warehouse_settings


def _tokens_from_preview(preview: list[dict]) -> list[str]:
    tokens: list[str] = []
    for row in preview[:12]:
        for key, value in row.items():
            if value is None or key.startswith("__"):
                continue
            if isinstance(value, bool):
                continue
            if isinstance(value, float):
                tokens.append(str(int(round(value))) if value.is_integer() else f"{value:.1f}")
                tokens.append(str(round(value, 2)))
            elif isinstance(value, int):
                tokens.append(str(value))
            elif isinstance(value, str):
                if value.casefold() in {"n/a", "none", "null"}:
                    continue
                if value.strip():
                    tokens.append(value)
    return tokens


def _token_variants(token: str) -> list[str]:
    variants = [token]
    match = re.fullmatch(r"(\d+)m (\d+)s", token)
    if match:
        minutes, seconds = match.group(1), match.group(2)
        variants.extend(
            [
                f"{minutes} minutes {seconds} seconds",
                f"{minutes} minute {seconds} seconds",
                f"{minutes}m{seconds}s",
            ]
        )
    match = re.fullmatch(r"(\d+)s", token)
    if match:
        variants.append(f"{match.group(1)} seconds")
    return variants


def _says_empty(reply: str) -> bool:
    text = reply.casefold()
    return any(
        token in text
        for token in (
            "no matching",
            "no rows",
            "no agent",
            "not available",
            "n/a",
            "none",
            "zero",
            " 0 ",
            "were 0",
            "is 0",
            "0 conversation",
            "0 transfer",
            "null",
        )
    )


def _coverage(reply: str, tokens: list[str]) -> tuple[int, int]:
    haystack = reply.casefold()
    hits = 0
    seen: set[str] = set()
    for token in tokens:
        if str(token).casefold() in {"n/a", "none", "null"}:
            continue
        folded = token.casefold()
        if folded in seen or len(folded) < 1:
            continue
        seen.add(folded)
        if re.fullmatch(r"-?\d+", folded):
            if re.search(rf"\b{re.escape(folded)}\b", reply):
                hits += 1
            continue
        if any(variant.casefold() in haystack for variant in _token_variants(token)):
            hits += 1
    return hits, len(seen)


def main() -> None:
    settings = get_warehouse_settings()
    if not settings.url:
        sys.stderr.write("DATABASE_URL is not set\n")
        sys.exit(1)
    print(f"org {settings.organization_id}  warehouse postgres  model worktual-minimax")
    print()
    planner = SqlPlanner()
    passed = 0
    for index, question in enumerate(QUESTIONS, start=1):
        ctx = QueryContext.resolve()
        gt_tools = SqlAgentTools(live=True, ctx=ctx)
        orch = SqlOrchestrator(tools=SqlAgentTools(live=True, ctx=ctx))
        print(f"[{index}/10] {question}")
        plan = planner.plan(
            question,
            period_start=ctx.period_start,
            period_end=ctx.period_end,
        )
        execute = plan.get("execute") or {}
        gt_sql = execute.get("execute_sql") or plan.get("sql")
        if gt_sql and execute.get("ok"):
            ground = gt_tools._warehouse_execute(str(execute["execute_sql"]))
        elif gt_sql:
            prepared = gt_tools.prepare_sql(str(gt_sql))
            ground = (
                gt_tools._warehouse_execute(str(prepared["execute_sql"]))
                if prepared.get("ok")
                else {"ok": False, "error": prepared.get("error")}
            )
        else:
            ground = {"ok": False, "error": "no SQL"}
        preview = (ground.get("preview") or [])[:8]
        numeric_preview = [
            row
            for row in preview
            if any(value not in {None, "n/a"} for value in row.values())
        ]
        print(f"  plan  trust={plan.get('trust')} sql={'yes' if plan.get('sql') else 'no'}")
        if not ground.get("ok"):
            print(f"  postgres  FAIL  {ground.get('error')}")
        else:
            print(f"  postgres  {json.dumps(preview, default=str)[:400]}")
        turn = orch.run(
            question,
            period_start=ctx.period_start,
            period_end=ctx.period_end,
        )
        reply = html_to_text(turn.reply)
        tools = []
        if turn.specialist:
            tools = [item["name"] for item in turn.specialist.tool_trace]
        print(f"  agent   routed={turn.routed_to} tools={', '.join(tools) or '(none)'} {turn.elapsed_ms}ms")
        print(f"  answer  {reply.replace(chr(10), ' / ')[:400]}")
        tokens = _tokens_from_preview(numeric_preview)
        hits, total = _coverage(reply, tokens)
        warehouse_ok = bool(ground.get("ok"))
        used_warehouse = "sql_analytics" in tools or "plan_query" in tools
        if warehouse_ok and not numeric_preview:
            grounded = used_warehouse and _says_empty(reply)
        else:
            grounded = warehouse_ok and used_warehouse and total > 0 and hits == total
        if grounded:
            passed += 1
            mark = "PASS"
        else:
            mark = "CHECK"
        print(f"  ground  {mark}  token_hits={hits}/{total}  warehouse_tools={used_warehouse}")
        print()
    print(f"grounded {passed}/10")


if __name__ == "__main__":
    main()
