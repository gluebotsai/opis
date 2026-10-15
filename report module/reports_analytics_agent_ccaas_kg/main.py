"""Command-line entrypoint for CCaaS Knowledge Graph Agent."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from core.models import AgentContext
from core.orchestrator import CCaaSKGAgent


def main():
    parser = argparse.ArgumentParser(description="CCaaS Contact Center Knowledge Graph Agent CLI")
    parser.add_argument("query", nargs="?", help="Contact center analytics question to answer using the graph")
    parser.add_argument("--role", default="admin", choices=["admin", "team_lead", "agent"], help="Security role")
    parser.add_argument("--org-id", default="1012", help="Tenant organization ID (maps to database org<id>)")
    parser.add_argument("--user-id", default="staff_01", help="User / Agent ID")

    args = parser.parse_args()

    context = AgentContext(
        org_id=args.org_id,
        user_id=args.user_id,
        role=args.role,
    )
    agent = CCaaSKGAgent(context=context)

    if args.query:
        print(f"\n[Question]: {args.query}")
        print(f"[Context]: role={args.role}, org_id={args.org_id}\n")
        output = agent.run(args.query)
        print("=" * 60)
        print(output.markdown)
        print("=" * 60)
        return

    # Interactive REPL mode
    print("=" * 60)
    print(f"CCaaS Knowledge Graph Agent (role: {args.role}, org: {args.org_id})")
    print("Type your questions below. Enter 'exit' or 'quit' to stop.")
    print("=" * 60)

    while True:
        try:
            user_input = input("\nCCaaS-KG> ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("exit", "quit", "q"):
                print("Exiting.")
                break

            output = agent.run(user_input)
            print("\n" + output.markdown)
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break


if __name__ == "__main__":
    main()
