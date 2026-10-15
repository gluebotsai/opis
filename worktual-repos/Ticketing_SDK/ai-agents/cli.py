#!/usr/bin/env python3
"""
Simple terminal chat against the LangGraph multi-agent workflow.

Usage (from coworker-agents/ with venv active):
  python cli.py
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

load_dotenv()

from app.graph import run_chat  # noqa: E402


def main() -> None:
    print("Worktual co-worker (multi-agent). Type 'quit' to exit.\n")
    page = "CLI"
    while True:
        try:
            user = input("You> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            return

        if not user:
            continue
        if user.lower() in {"quit", "exit", "q"}:
            print("Bye.")
            return

        try:
            result = run_chat(user, page=page)
            print(f"[{result['agent']}] {result['reply']}\n")
        except Exception as exc:  # noqa: BLE001
            print(f"Error: {exc}\n", file=sys.stderr)


if __name__ == "__main__":
    main()
