"""Continuous question loop: run the script, keep asking.

  python -m sql_agent.cli
  ./scripts/ask.py
"""

from __future__ import annotations

import argparse
import html as html_lib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from sql_agent.agent import ping_minimax
from sql_agent.orchestrator import OrchestratorTurn, SqlOrchestrator
from sql_agent.settings import get_minimax_settings
from sql_agent.status import StatusBoard, live_printer, paint
from sql_agent.warehouse import get_warehouse_settings, live_enabled

_TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(raw: str) -> str:
    text = raw or ""
    text = re.sub(r"(?i)</p>", "\n\n", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</li>", "\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "  - ", text)
    text = re.sub(r"(?i)</h[1-6]>", "\n", text)
    text = _TAG_RE.sub("", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.rstrip() for line in text.splitlines()]
    return "\n".join(lines).strip()


def print_banner() -> None:
    settings = get_minimax_settings()
    warehouse = get_warehouse_settings()
    mode = f"live postgres org {warehouse.organization_id}" if live_enabled() and warehouse.url else "catalog only"
    print(paint("SQL agent", "bold") + f"  {settings.model}  {mode}")
    print("  Type a question. Ctrl+C or quit to stop.")
    print()


def print_answer(turn: OrchestratorTurn) -> None:
    print()
    print(paint("  ANSWER", "bold"))
    print("  " + "-" * 56)
    body = html_to_text(turn.reply) or turn.reply
    for line in body.splitlines() or [""]:
        print(f"  {line}")
    print()


def run_question(orch: SqlOrchestrator, board: StatusBoard, question: str) -> OrchestratorTurn:
    board.reset()
    print()
    print(board.snapshot())
    turn = orch.run(question, on_event=live_printer(board))
    print()
    print(board.snapshot())
    print_answer(turn)
    return turn


def is_stop(line: str) -> bool:
    return line.casefold() in {"quit", "exit", "q"}


def repl(orch: SqlOrchestrator, first: str = "") -> None:
    print_banner()
    board = StatusBoard()
    if first:
        run_question(orch, board, first)
    while True:
        try:
            raw = input("you> ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        line = raw.strip()
        if not line:
            continue
        if is_stop(line):
            break
        run_question(orch, board, line)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ask the SQL agent. Keeps prompting until you quit.")
    parser.add_argument("question", nargs="*", help="Optional first question, then keeps asking")
    parser.add_argument("--ping", action="store_true", help="Check worktual-minimax and exit")
    args = parser.parse_args()
    if args.ping:
        result = ping_minimax()
        print(f"ok: {result['ok']}")
        print(f"model: {result['model']}")
        print(f"host: {result['host']}")
        print(f"elapsed_ms: {result['elapsed_ms']}")
        print(f"reply: {result['reply']}")
        if not result["ok"]:
            sys.exit(1)
        return
    first = " ".join(args.question).strip()
    if not first and not sys.stdin.isatty():
        piped = sys.stdin.read().strip()
        if piped:
            run_question(SqlOrchestrator(), StatusBoard(), piped)
        return
    repl(SqlOrchestrator(), first=first)


if __name__ == "__main__":
    main()
