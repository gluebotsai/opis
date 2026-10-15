#!/usr/bin/env python3
"""Parity: MetricFlow vs SQL fallback for ticketing prompt metrics."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

ORG = int(os.environ.get("ORG", "1000"))
AGENT = "tk.reporting"
PRODUCT = "ticketing"
METRICS = [
    "open_tickets_metric",
    "sla_breach_rate",
    "average_resolution_time_hours",
    "reopen_rate",
    "ticket_volume",
    "resolution_rate",
    "sla_at_risk_tickets_metric",
    "unanswered_tickets_metric",
]


def main() -> int:
    from parity_helpers import apply_channel_scope

    from scripts.ticketing_agent_fixtures import load_dotenv, resolve_ticketing_agent_id
    from semantic.query import SemanticQuery, execute
    from semantic.scope import apply_ticketing_visible_ids, lookup_user_scope
    from semantic.sql.job import ExecutorJob
    from semantic.sql.metric_fallback import execute_metric_fallback
    from semantic.ticketing_scope import job_scope_fields

    load_dotenv()
    user_id = resolve_ticketing_agent_id(ORG, role="admin")
    scope = lookup_user_scope(ORG, user_id, product=PRODUCT)
    apply_ticketing_visible_ids(scope)

    failed = 0
    for mid in METRICS:
        scope_fields = job_scope_fields(scope, mid, product=PRODUCT)
        try:
            mf = execute(
                SemanticQuery(
                    organization_id=ORG,
                    user_id=user_id,
                    product=PRODUCT,
                    agent=AGENT,
                    metrics=[mid],
                )
            )
            mf_val = (mf.get("rows") or [{}])[0].get(mid)
        except Exception as exc:
            print(f"  SKIP  {mid}: MF unavailable ({exc})")
            continue
        try:
            job = apply_channel_scope(
                ExecutorJob(
                    job_id="p",
                    mode="metric_fallback",
                    product=PRODUCT,
                    engine="postgres",
                    organization_id=ORG,
                    user_id=user_id,
                    table="mart_tickets",
                    schema="ticketing_marts",
                    select=[],
                    metric_id=mid,
                    scope=scope_fields["scope"],
                    visible_user_ids=list(scope_fields["visible_user_ids"]),
                    caller_role=scope_fields.get("caller_role"),
                    scope_dual_assignee_resolver=bool(
                        scope_fields.get("scope_dual_assignee_resolver")
                    ),
                    row_scope_column="assignee_id",
                ),
                mid,
                PRODUCT,
            )
            fb = execute_metric_fallback(job)
            fb_val = (fb.get("rows") or [{}])[0].get(mid)
        except Exception as exc:
            print(f"  FAIL  {mid}: no fallback template ({exc})")
            failed += 1
            continue
        if mid.endswith("_rate") or "hours" in mid or "csat" in mid:
            ok = mf_val is not None and fb_val is not None and abs(float(mf_val) - float(fb_val)) < 0.01
        else:
            ok = mf_val == fb_val or (mf_val is None and fb_val == 0)
        mark = "PASS" if ok else "FAIL"
        print(f"  {mark}  {mid}: mf={mf_val} fallback={fb_val}")
        if not ok:
            failed += 1
    print(f"\n{len(METRICS) - failed} passed, {failed} failed (user_id={user_id} agents.id)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
