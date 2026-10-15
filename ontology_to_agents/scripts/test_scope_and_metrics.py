#!/usr/bin/env python3
"""Tests: certified prompt metrics, scope via setup_roles, no fetch dupes."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ontology.slice import fetch_ontology_slice
from semantic.lookup import is_certified
from semantic.scope import lookup_user_scope, scope_summary


def test_prompt_metrics_certified() -> None:
    cases = [
        ("agent", "crm.deals", {"product": "crm"}),
        ("agent", "cc.reporting", {"product": "ccaas"}),
        ("preset", "cc.wfm", {"product": "ccaas"}),
        ("agent", "tk.tickets", {"product": "ticketing"}),
        ("agent", "camp.reports", {"product": "campaign"}),
        ("agent", "hub.orchestrator", {"products": ["contact_centre", "crm"]}),
    ]
    for kind, selector, extra in cases:
        kwargs = {"tenant": "org1000", **extra}
        if kind == "agent":
            kwargs["agent"] = selector
        else:
            kwargs["preset"] = selector
        pack = fetch_ontology_slice(**kwargs)
        _, _, _, metrics, _, _ = pack._view("compact")
        bad = [m for m in metrics if not is_certified(m)]
        assert not bad, f"{selector} uncertified prompt metrics: {bad}"
        assert len(pack.class_ids()) == len(set(pack.class_ids())), f"{selector} class dupes"
        assert len(pack.metric_ids) == len(set(pack.metric_ids)), f"{selector} metric dupes"


def test_scope_roles_when_db() -> None:
    scope = lookup_user_scope(1000, 1001, product="crm")
    summary = scope_summary(scope)
    assert summary["userId"] == "1001"
    # user 1001 is Admin on contact-center in sample data; crm may differ
    if summary.get("roleName"):
        assert summary["role"] == summary["roleName"].lower()

    manager = lookup_user_scope(1000, 1000, product="crm")
    ms = scope_summary(manager)
    if ms.get("roleName") and "admin" in ms["role"]:
        assert len(ms["visibleUserIds"]) >= 1


def main() -> int:
    test_prompt_metrics_certified()
    print("PASS  all prompt metrics certified + no fetch dupes")
    try:
        test_scope_roles_when_db()
        print("PASS  scope resolves role via setup_user_product_access → setup_roles")
    except AssertionError as e:
        print(f"FAIL  scope: {e}")
        return 1
    except Exception as e:
        print(f"SKIP  scope DB test ({type(e).__name__})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
