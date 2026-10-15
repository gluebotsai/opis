"""Live source-of-truth check for this copy pack (catalog + Postgres + Domain turn).

Run from anywhere:

    python3 tests/live_copy_turn_sot.py
"""

from __future__ import annotations

import json
import re
import sys
from decimal import Decimal
from pathlib import Path

PACK = Path(__file__).resolve().parents[1]
if str(PACK) not in sys.path:
    sys.path.insert(0, str(PACK))

from core.loader import PRODUCT_DIR, load_kpis  # noqa: E402
from core.run_kpi import run_kpi  # noqa: E402
from core.turn import run_turn  # noqa: E402

ORG, USER, ROLE = 1003, 1017, "admin"


def _num(val):
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, bool) or val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    return None


def _first_metric(rows: list) -> float | None:
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        for key, val in row.items():
            n = _num(val)
            if n is not None:
                return n
    return None


def catalog_truth(kpi_id: str, **kwargs) -> dict:
    res = run_kpi(
        kpi_id,
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
        **kwargs,
    )
    return {
        "kpi_id": kpi_id,
        "status": res.get("status"),
        "error": res.get("error") or res.get("error_type"),
        "n_rows": len(res.get("rows") or []),
        "metric": _first_metric(res.get("rows") or []),
        "rows": res.get("rows"),
    }


def main() -> int:
    fails: list[str] = []
    kpis = load_kpis()
    print(f"PACK={PACK}")
    print(f"PRODUCT_DIR={PRODUCT_DIR}")
    if PRODUCT_DIR != PACK / "product":
        fails.append(f"loader PRODUCT_DIR is not this copy: {PRODUCT_DIR}")
    if "lead_count" not in kpis or "total_opportunities" not in kpis:
        fails.append("kpis.yml missing lead_count or total_opportunities")

    truth = {
        "lead_count": catalog_truth("lead_count"),
        "active_opportunities": catalog_truth("active_opportunities"),
        "lost_deal_count": catalog_truth("lost_deal_count"),
    }
    print("\n=== certified KPI truth (copy catalog + Postgres) ===")
    print(json.dumps(truth, default=str, indent=2)[:4000])

    cases = [
        {
            "q": "how many leads are there?",
            "expect_kpi": "lead_count",
            "expect_exec": {"sql"},
            "truth_key": "lead_count",
            "need_kg": False,
        },
        {
            "q": "how many open deals do we have?",
            "expect_kpi": "active_opportunities",
            "expect_exec": {"sql"},
            "truth_key": "active_opportunities",
            "need_kg": False,
        },
        {
            "q": "why did we lose deals?",
            "expect_kpi": "lost_deal_count",
            "expect_exec": {"sql", "kg"},
            "truth_key": "lost_deal_count",
            "need_kg": True,
        },
        {
            "q": "360 on Orange",
            "expect_kpi": None,
            "expect_exec": {"kg"},
            "truth_key": None,
            "need_kg": True,
        },
    ]

    print("\n=== Domain turn (copy prompts + copy run_turn) ===")
    for case in cases:
        out = run_turn(case["q"], organization_id=ORG, user_id=USER, role=ROLE)
        trace = out.get("trace") or {}
        plan = trace.get("plan") or {}
        understanding = plan.get("understanding") or trace.get("understanding") or {}
        tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else []
        execs = {str(t.get("executor") or "sql").lower() for t in tasks if isinstance(t, dict)}
        kpis_used = [t.get("kpi") for t in tasks if isinstance(t, dict) and t.get("kpi")]
        kg_notes = "\n".join(
            str(t.get("kg_notes") or "")
            for t in (trace.get("tasks") or [])
            if isinstance(t, dict)
        )
        answer = out.get("answer") or ""
        print("\n---", case["q"])
        print("understanding:", json.dumps(understanding, default=str)[:500])
        print("plan tasks:", json.dumps(
            [{"executor": t.get("executor"), "kpi": t.get("kpi"), "goal": t.get("goal")} for t in tasks if isinstance(t, dict)],
            default=str,
        )[:800])
        print("goal_review:", json.dumps(trace.get("goal_review"), default=str)[:400])
        print("answer:", answer[:600])

        if not isinstance(understanding, dict) or not (
            understanding.get("end_goal") or understanding.get("said")
        ):
            fails.append(f"{case['q']}: missing understanding/end_goal")
        if not case["expect_exec"].issubset(execs):
            fails.append(f"{case['q']}: expected executors {case['expect_exec']} got {execs}")
        if case["expect_kpi"] and case["expect_kpi"] not in kpis_used:
            # SQL executor may correct Domain's id; also check executed kpi
            ran = [
                (t.get("requested_kpi") or t.get("kpi_id") or (t.get("task") or {}).get("kpi"))
                for t in (trace.get("tasks") or [])
                if isinstance(t, dict)
            ]
            if case["expect_kpi"] not in ran and case["expect_kpi"] not in kpis_used:
                fails.append(f"{case['q']}: expected kpi {case['expect_kpi']} got plan={kpis_used} ran={ran}")
        if case["truth_key"]:
            metric = truth[case["truth_key"]].get("metric")
            if metric is None:
                fails.append(f"{case['q']}: catalog truth {case['truth_key']} has no metric")
            else:
                # Ground the briefing against the certified figure (same as Domain grounding intent).
                text = f"{answer} {json.dumps(out.get('rows'), default=str)}"
                whole = str(int(metric)) if float(metric).is_integer() else str(metric)
                compact = whole.replace(",", "")
                if compact not in text.replace(",", "") and whole not in text:
                    fails.append(
                        f"{case['q']}: answer/rows missing catalog {case['truth_key']}={metric}"
                    )
        if case["need_kg"]:
            for heading in ("### Descriptive", "### Predictive", "### Recommended"):
                if heading not in kg_notes:
                    fails.append(f"{case['q']}: kg_notes missing {heading}")

    print("\n=== RESULT ===")
    if fails:
        print("FAIL")
        for f in fails:
            print("-", f)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
