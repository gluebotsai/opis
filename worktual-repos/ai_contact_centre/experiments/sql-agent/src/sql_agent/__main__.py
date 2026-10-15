"""CLI: python -m sql_agent "average handel time" """

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from sql_agent.llm_context import render_llm_context
from sql_agent.planner import SqlPlanner


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan a DQL analytics query from a question.")
    parser.add_argument("question", nargs="+", help="Natural language question")
    parser.add_argument("--start", dest="period_start", default=None)
    parser.add_argument("--end", dest="period_end", default=None)
    parser.add_argument("--surface", default="dashboard", choices=["dashboard", "performance"])
    parser.add_argument("--json", action="store_true", help="Print the full plan as JSON")
    args = parser.parse_args()
    question = " ".join(args.question)
    plan = SqlPlanner().plan(
        question,
        period_start=args.period_start,
        period_end=args.period_end,
        surface=args.surface,
    )
    if args.json:
        print(json.dumps(plan, indent=2, default=str))
        return
    print(f"trust: {plan['trust']}")
    print(f"reason: {plan['reason']}")
    if plan.get("sql"):
        print("sql:")
        print(plan["sql"])
        execute = plan.get("execute") or {}
        if execute.get("ok"):
            print("\nexecute wrap:")
            print(execute.get("execute_sql"))
    else:
        print("\nLLM context:\n")
        print(render_llm_context(plan))


if __name__ == "__main__":
    main()
