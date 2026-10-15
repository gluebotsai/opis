#!/usr/bin/env python3
"""Tests for capability-based execution product / engine routing."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from semantic.capabilities import get_metric_capabilities, resolve_execution_product
from semantic.lookup import get_metric_schema
from semantic.query import QueryValidationError, SemanticQuery, validate_and_prepare


class Results:
    def __init__(self) -> None:
        self.ok = 0
        self.fail = 0

    def check(self, name: str, cond: bool) -> None:
        if cond:
            self.ok += 1
            print(f"  OK  {name}")
        else:
            self.fail += 1
            print(f"  FAIL {name}")


def test_webtracking_engine(r: Results) -> None:
    cap = get_metric_capabilities("average_order_value", product="webtracking")
    r.check("web average_order_value engine clickhouse", cap["engine"] == "clickhouse")
    r.check(
        "web average_order_value product webtracking",
        cap["product"] == "webtracking",
    )


def test_ccaas_engine(r: Results) -> None:
    cap = get_metric_capabilities("total_conversations", product="ccaas")
    r.check("ccaas total_conversations engine postgres", cap["engine"] == "postgres")


def test_resolve_execution_product(r: Results) -> None:
    prod, engine = resolve_execution_product(
        ["total_conversations"], "ccaas"
    )
    r.check("ccaas execution product", prod == "contact_centre")
    r.check("ccaas execution engine", engine == "postgres")


def test_duplicate_metric_schema_by_product(r: Results) -> None:
    try:
        ccaas = get_metric_schema("resolution_rate", product="ccaas")
        tick = get_metric_schema("resolution_rate", product="ticketing")
        r.check(
            "resolution_rate ccaas source aiccaas",
            ccaas.get("source") == "aiccaas" or "aiccaas" in (ccaas.get("sources") or {}),
        )
        r.check(
            "resolution_rate ticketing source ticketing",
            tick.get("source") == "ticketing"
            or "ticketing" in (tick.get("sources") or {}),
        )
    except ValueError:
        r.check("resolution_rate in registry", False)


def test_channel_entitlement_clauses(r: Results) -> None:
    from semantic.entitlements import TenantEntitlements
    from semantic.query import _channel_entitlement_clauses

    ent = TenantEntitlements(
        organization_id=2005,
        skus=["contact-center"],
        channels={"ccaas": ["whatsapp", "email"]},
        features={},
        version="test",
    )
    # Patch load for this call path — clauses use load_tenant_entitlements internally.
    import semantic.query as qmod

    original = qmod.load_tenant_entitlements

    def _fake(_org: int) -> TenantEntitlements:
        return ent

    original_resolve = qmod._resolve_dimensions

    def _fake_resolve(*_a, **_k):
        return ["channel"]

    qmod.load_tenant_entitlements = _fake
    qmod._resolve_dimensions = _fake_resolve
    try:
        clauses = _channel_entitlement_clauses(
            ["total_conversations"],
            product="ccaas",
            organization_id=2005,
            metric_names=["total_conversations"],
        )
        r.check("channel clause emitted", len(clauses) >= 1)
        if clauses:
            r.check(
                "channel clause contains entitled channels",
                "whatsapp" in clauses[0] and "email" in clauses[0],
            )
    finally:
        qmod.load_tenant_entitlements = original
        qmod._resolve_dimensions = original_resolve


def test_validate_rejects_product_mismatch(r: Results) -> None:
    os.environ["ENTITLEMENTS_DEV_FALLBACK"] = "1"
    q = SemanticQuery(
        organization_id=1000,
        user_id=1,
        product="ticketing",
        agent="cc.reporting",
        metrics=["total_conversations"],
    )
    try:
        validate_and_prepare(q)
        r.check("ccaas metric on ticketing product rejected", False)
    except QueryValidationError:
        r.check("ccaas metric on ticketing product rejected", True)


def main() -> int:
    print("=== query engine routing ===")
    r = Results()
    test_webtracking_engine(r)
    test_ccaas_engine(r)
    test_resolve_execution_product(r)
    test_duplicate_metric_schema_by_product(r)
    test_channel_entitlement_clauses(r)
    test_validate_rejects_product_mismatch(r)
    print(f"\n{r.ok} passed, {r.fail} failed")
    return 1 if r.fail else 0


if __name__ == "__main__":
    sys.exit(main())
