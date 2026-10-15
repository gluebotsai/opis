#!/usr/bin/env python3
"""Cross-validate reports-analytics-agent scenarios against certified run_kpi ground truth."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai-service"))

for env_path in (ROOT / ".env", ROOT / "ai-service" / ".env"):
    if not env_path.exists():
        continue
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val

ORG = int(os.getenv("REPORTS_VALIDATION_ORG_ID", "1003"))
USER = int(os.getenv("REPORTS_VALIDATION_USER_ID", "1017"))

SCENARIOS = [
    {"name": "active_deals_admin", "object": "deals", "kpi": "active_opportunities", "role": "admin", "question": "How many open deals?"},
    {"name": "total_pipeline_admin", "object": "deals", "kpi": "total_pipeline", "role": "admin", "question": "What is total pipeline?"},
    {"name": "lead_count_admin", "object": "contacts", "kpi": "lead_count", "role": "admin", "question": "How many leads?"},
    {"name": "won_revenue_finance", "object": "deals", "kpi": "won_revenue", "role": "finance", "question": "What is won revenue?"},
    {"name": "active_deals_sales_rep", "object": "deals", "kpi": "active_opportunities", "role": "sales_rep", "question": "How many open deals do I have?"},
]


def _scalar_from_rows(rows: list[dict]) -> float | int | None:
    from decimal import Decimal

    if not rows or not isinstance(rows[0], dict):
        return None
    row = rows[0]

    def _num(v: object) -> float | int | None:
        if isinstance(v, bool):
            return None
        if isinstance(v, Decimal):
            return float(v)
        if isinstance(v, (int, float)):
            return v
        return None

    if len(row) == 1:
        n = _num(next(iter(row.values())))
        if n is not None:
            return n
    for key in row:
        n = _num(row[key])
        if n is not None:
            return n
    return None


def _numbers_in_text(text: str) -> set[float]:
    out: set[float] = set()
    for m in re.finditer(r"(?<![\w.])(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.?\d*)(?![\w.])", text):
        raw = m.group(1).replace(",", "")
        try:
            out.add(float(raw))
        except ValueError:
            pass
    return out


def _plan_json(kpi: str, question: str, role: str, object_name: str) -> str:
    return json.dumps(
        {
            "kind": "plan",
            "object": object_name,
            "depth": "quick",
            "tasks": [
                {
                    "id": "t1",
                    "executor": "sql",
                    "kpi": kpi,
                    "goal": question,
                    "time": "all time",
                    "scope": "org" if role in {"admin", "finance", "sales_manager"} else "own",
                    "depends_on": [],
                    "answer_type": "scalar",
                }
            ],
        }
    )


async def _turn_with_fixed_plan(
    question: str, kpi: str, role: str, object_name: str
) -> dict:
    from unittest.mock import AsyncMock, patch

    from app.agents.reports_analytics_agent import AnalyticsScope
    from app.agents.reports_analytics_turn import run_turn

    plan_json = _plan_json(kpi, question, role, object_name)

    async def fake_llm(
        *, system: str, user: str, max_tokens: int = 1200, phase: str = "llm"
    ):
        del system, max_tokens, phase
        if "RESULT" in user or "Original question" in user:
            m = re.search(r"RESULT:\s*(\S+)", user)
            if m:
                return f"The certified value is {m.group(1)}."
            m2 = re.search(r"(\d+(?:\.\d+)?)", user)
            return f"Answer: {m2.group(1) if m2 else 'see table'}."
        return plan_json

    scope = AnalyticsScope(
        organization_id=str(ORG),
        actor_id=str(USER),
        role=role,
        business_type="b2b",
    )
    with patch("app.agents.reports_analytics_turn._llm_text", new=AsyncMock(side_effect=fake_llm)):
        return await run_turn(question=question, scope=scope)


async def main() -> int:
    from app.agents.reports_b2b.core.run_kpi import run_kpi
    from app.llm import is_ai_configured

    print(f"=== Reports agent scenario validation (org={ORG}, user={USER}) ===\n")
    if not is_ai_configured():
        print("WARN: LLM not configured — turn tests use mocked planner/briefer only.")

    failures = 0
    for sc in SCENARIOS:
        name = sc["name"]
        kpi = sc["kpi"]
        role = sc["role"]
        question = sc["question"]
        object_name = sc["object"]

        truth = run_kpi(kpi, organization_id=ORG, user_id=USER, role=role)
        if truth.get("status") != "ok":
            print(f"FAIL {name}: run_kpi error — {truth.get('error')}")
            failures += 1
            continue

        expected = _scalar_from_rows(truth.get("rows") or [])
        if expected is None:
            print(f"SKIP {name}: no scalar in rows {truth.get('rows')}")
            continue

        turn_out = await _turn_with_fixed_plan(
            question, kpi, role, object_name
        )
        turn_rows = turn_out.get("rows") or []
        turn_scalar = _scalar_from_rows(turn_rows)
        answer = str(turn_out.get("assistantText") or "")

        row_ok = turn_scalar is not None and abs(float(turn_scalar) - float(expected)) < 0.01
        nums = _numbers_in_text(answer)
        text_ok = any(abs(n - float(expected)) < 0.01 for n in nums) if nums else row_ok

        status = "OK" if row_ok and text_ok else "MISMATCH"
        if status != "OK":
            failures += 1
        print(
            f"{status} {name}: kpi={kpi} role={role} expected={expected} "
            f"turn_rows={turn_scalar} answer_snip={answer[:80]!r}"
        )

    print("\n--- Greeting / non-analytics path ---")
    from app.agents.reports_analytics_agent import run as run_reports

    greet = await run_reports(
        question="hello",
        organization_id=str(ORG),
        actor_id=str(USER),
        role="admin",
        business_type="b2b",
    )
    greet_ok = greet.get("analytics") is None and bool(greet.get("assistantText"))
    print(f"{'OK' if greet_ok else 'FAIL'} greeting: analytics=None, has text={greet_ok}")
    if not greet_ok:
        failures += 1

    print("\n--- Live E2E matrix (real LLM plan through MCP) — optional ---")
    if os.getenv("REPORTS_LIVE_LLM_VALIDATE", "").lower() in {"1", "true", "yes"}:
        from app.mcp.server import call_coworker_tool

        live_cases = [
            ("open_deals", "How many open deals?", "active_opportunities", "deals"),
            ("pipeline", "What is our total pipeline?", "total_pipeline", "deals"),
            ("leads", "How many leads?", "lead_count", "contacts"),
            ("rep_revenue", "Sales agents performance by won revenue", "won_revenue", "deals"),
        ]
        for name, live_q, expected_kpi, expected_object in live_cases:
            truth = run_kpi(
                expected_kpi,
                organization_id=ORG,
                user_id=USER,
                role="admin",
            )
            expected = _scalar_from_rows(truth.get("rows") or [])
            tool = await call_coworker_tool(
                "query_analytics",
                {"question": live_q},
                context={
                    "agentName": "crm-agent",
                    "executionMode": "native",
                    "actingUserId": str(USER),
                    "organizationId": str(ORG),
                    "role": "admin",
                    "businessType": "b2b",
                    "module": "dashboard",
                    "surface": "list",
                },
            )
            data = tool.get("data") if isinstance(tool.get("data"), dict) else {}
            analytics = data.get("analytics") if isinstance(data.get("analytics"), dict) else {}
            plan = analytics.get("plan") if isinstance(analytics.get("plan"), dict) else {}
            tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else []
            planned_kpis = {
                str(task.get("kpi"))
                for task in tasks
                if isinstance(task, dict) and task.get("kpi")
            }
            live_ok = (
                tool.get("ok") is True
                and expected_kpi in planned_kpis
                and plan.get("object") == expected_object
                and expected is not None
            )
            print(
                f"{'OK' if live_ok else 'FAIL'} {name}: "
                f"kpis={sorted(planned_kpis)} object={plan.get('object')} "
                f"expected={expected} text={str(tool.get('assistantText') or '')[:160]!r}"
            )
            if not live_ok:
                failures += 1

        why = await call_coworker_tool(
            "query_analytics",
            {"question": "Why are deals getting blocked?"},
            context={
                "agentName": "crm-agent",
                "executionMode": "native",
                "actingUserId": str(USER),
                "organizationId": str(ORG),
                "role": "admin",
                "businessType": "b2b",
                "module": "dashboard",
                "surface": "list",
            },
        )
        why_data = why.get("data") if isinstance(why.get("data"), dict) else {}
        why_analytics = (
            why_data.get("analytics")
            if isinstance(why_data.get("analytics"), dict)
            else {}
        )
        why_audit = (
            why_analytics.get("audit")
            if isinstance(why_analytics.get("audit"), dict)
            else {}
        )
        why_progress = (
            why_audit.get("progress")
            if isinstance(why_audit.get("progress"), list)
            else []
        )
        why_ok = (
            why.get("ok") is True
            and why_audit.get("source") == "reports_b2b_kg"
            and any(
                isinstance(item, dict)
                and item.get("phase") == "kg"
                and item.get("status") == "done"
                for item in why_progress
            )
        )
        print(f"{'OK' if why_ok else 'FAIL'} why_deals_uses_kg")
        if not why_ok:
            failures += 1
    else:
        print("Set REPORTS_LIVE_LLM_VALIDATE=1 to run one full LLM end-to-end check.")

    neo = os.getenv("REPORTS_NEO4J_URI", "")
    if not neo:
        print("\nNOTE: REPORTS_NEO4J_URI not set — KG / why-questions not validated in this run.")

    print(f"\n=== Done: {failures} failure(s) ===")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
