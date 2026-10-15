#!/usr/bin/env python3
"""Gate: reporting headline metrics for cc/tk have SQL fallback templates."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.ownership import headline_metrics_for_agent, load_ownership
from semantic.sql.metric_template_registry import get_template


def main() -> int:
    ownership = load_ownership()
    reporting = ownership.get("reporting_agents") or {}
    failed = 0
    checked = 0
    for product, agent_id in reporting.items():
        if product not in ("contact_centre", "ccaas", "ticketing"):
            continue
        tpl_product = "ccaas" if product in ("contact_centre", "ccaas") else "ticketing"
        for mid in headline_metrics_for_agent(agent_id) or []:
            checked += 1
            if not get_template(tpl_product, mid):
                print(f"  FAIL  {agent_id}/{mid}: no SQL template")
                failed += 1
    if not failed:
        print(f"  PASS  all {checked} headline metrics have SQL templates")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
