#!/usr/bin/env python3
"""Parity: MetricFlow vs SQL metric_fallback templates (requires DB + MF)."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

ORG = int(os.environ.get("ORG", "1000"))
PRODUCT = "contact_centre"
CAP_PRODUCT = "ccaas"
METRICS = ["open_conversations", "ai_containment_rate"]


def main() -> int:
    from parity_helpers import apply_channel_scope

    from semantic.query import SemanticQuery, execute
    from semantic.sql.job import ExecutorJob
    from semantic.sql.metric_fallback import execute_metric_fallback
    from semantic.scope import lookup_user_scope

    failed = 0
    for mid in METRICS:
        mf = execute(
            SemanticQuery(
                organization_id=ORG,
                user_id=1001,
                product=PRODUCT,
                agent="cc.reporting",
                metrics=[mid],
            )
        )
        mf_val = (mf.get("rows") or [{}])[0].get(mid)
        scope = lookup_user_scope(ORG, 1001, product=PRODUCT)
        job = apply_channel_scope(
            ExecutorJob(
                job_id="p",
                mode="metric_fallback",
                product=CAP_PRODUCT,
                engine="postgres",
                organization_id=ORG,
                user_id=1001,
                table="mart_conversations",
                schema="ccass_marts_aiccaas",
                select=[],
                metric_id=mid,
                scope="org",
                visible_user_ids=list(scope.visible_user_ids),
            ),
            mid,
            PRODUCT,
        )
        fb = execute_metric_fallback(job)
        fb_val = (fb.get("rows") or [{}])[0].get(mid)
        if mid.endswith("_rate"):
            ok = mf_val is not None and fb_val is not None and abs(float(mf_val) - float(fb_val)) < 0.0001
        else:
            ok = mf_val == fb_val or (mf_val is None and fb_val == 0)
        mark = "PASS" if ok else "FAIL"
        print(f"  {mark}  {mid}: mf={mf_val} fallback={fb_val}")
        if not ok:
            failed += 1
    print(f"\n{len(METRICS) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
