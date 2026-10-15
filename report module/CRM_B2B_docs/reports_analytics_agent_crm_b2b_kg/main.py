"""Command Line Interface for CRM B2B Knowledge Graph Agent."""

import argparse
import sys
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from core.models import AgentContext
from core.orchestrator import CRMB2BKGAgent


def main():
    parser = argparse.ArgumentParser(description="CRM B2B Knowledge Graph Analytics Agent")
    parser.add_argument("query", nargs="?", type=str, help="Analytical question to ask the Knowledge Graph")
    parser.add_argument("--role", type=str, default="admin", help="User role (admin, sales_manager, sales_rep, finance, marketing, viewer)")
    parser.add_argument("--org-id", type=int, default=1003, help="Tenant Organization ID (default: 1003)")
    parser.add_argument("--user-id", type=int, default=1000, help="User ID for scoping (default: 1000)")

    args = parser.parse_args()

    if not args.query:
        print("Usage: python main.py \"<your question>\" [--role <role>] [--org-id <org_id>]")
        sys.exit(1)

    ctx = AgentContext(org_id=args.org_id, role=args.role, user_id=args.user_id)
    agent = CRMB2BKGAgent(context=ctx)

    print(f"Executing query as role={args.role}, org_id={args.org_id}: {args.query}\n")
    res = agent.run(args.query)

    print(f"Status: {res.status.upper()}")
    if res.cypher_used:
        print("\n--- Executed Cypher ---")
        for q in res.cypher_used:
            print(q.strip())

    print("\n--- Executive Briefing ---")
    print(res.markdown)


if __name__ == "__main__":
    main()
