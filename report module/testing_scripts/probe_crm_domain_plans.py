"""Probe Domain plans for mixed NL (no expected-KPI table)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "test_streamlit" / "crm_b2b"))

from turn import call_llm, extract_json  # noqa: E402

from reports_analytics_agent_CRM_B2B.core.prompt_load import load_agent_prompt  # noqa: E402

PACK = ROOT / "reports_analytics_agent_CRM_B2B"
PROMPT = load_agent_prompt(PACK / "domain" / "agent.md")

QUESTIONS = [
    ("admin", "how many leads are there?"),
    ("admin", "how many contacted leads does yaswanth have compared to other agents?"),
    ("admin", "list unassigned leads"),
    ("sales_manager", "how many open deals do we have?"),
    ("sales_rep", "what is our revenue"),
    ("finance", "what is our revenue"),
    ("admin", "what is our revenue"),
    ("admin", "what is raghuram total pipeline value"),
    ("admin", "who has the highest win rate"),
    ("admin", "show me quotes that are still open"),
    ("admin", "how much is outstanding on invoices"),
    ("admin", "how many calls and meetings were logged this month"),
    ("admin", "why did we lose deals last month"),
    ("admin", "360 on Orange"),
    ("admin", "average discount on quotes"),
    ("admin", "how many tasks are still open"),
]


def plan_one(role: str, question: str) -> dict:
    raw = call_llm(
        [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": f"Identity: role={role}, org_id=1003, user_id=1017\nQuestion: {question}",
            },
        ]
    )
    plan = extract_json(raw)
    tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else []
    slim = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        slim.append(
            {
                "executor": t.get("executor"),
                "kpi": t.get("kpi"),
                "dimension": t.get("dimension"),
                "status_filter": t.get("status_filter") or t.get("lead_status"),
                "goal": (str(t.get("goal") or ""))[:120],
            }
        )
    return {"role": role, "q": question, "tasks": slim, "raw_ok": bool(tasks)}


def main() -> None:
    rows = []
    for role, q in QUESTIONS:
        try:
            row = plan_one(role, q)
        except Exception as exc:
            row = {"role": role, "q": q, "error": str(exc), "tasks": []}
        rows.append(row)
        print(json.dumps(row, default=str))
        print("---")
    out = ROOT / "testing_scripts" / "probe_crm_domain_plans.json"
    out.write_text(json.dumps(rows, indent=2, default=str))
    print("wrote", out)


if __name__ == "__main__":
    main()
