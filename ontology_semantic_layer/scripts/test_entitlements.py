#!/usr/bin/env python3
"""Unit tests for entitlement loaders (no live DB required)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.context import filter_metrics
from semantic.entitlements import (
    TenantEntitlements,
    bucket_channels_by_product,
    capability_channel,
)

PASS = 0
FAIL = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"PASS  {name}")


def fail(name: str, detail: str) -> None:
    global FAIL
    FAIL += 1
    print(f"FAIL  {name} — {detail}")


def test_capability_channel_mapping() -> None:
    cases = [
        (("email", None), "email"),
        (("web_chat", None), "webchat"),
        (("voice", None), "call"),
        (("social", "whatsapp"), "whatsapp"),
        (("social", "facebook"), "facebook"),
        (("social", "instagram"), "instagram"),
        (("unknown", None), None),
    ]
    for (ct, prov), expected in cases:
        got = capability_channel(ct, prov)
        if got != expected:
            fail("capability_channel", f"{ct}/{prov} -> {got}, want {expected}")
            return
    ok("capability_channel mapping")


def test_bucket_channels_by_product() -> None:
    rows = [
        ("email", ["contact-center"], None),
        ("social", ["contact-center"], "whatsapp"),
        ("social", ["contact-center"], "instagram"),
        ("email", ["crm"], None),
        ("web_chat", ["contact-center"], None),
    ]
    buckets = bucket_channels_by_product(rows)
    if buckets.get("ccaas") != ["email", "instagram", "webchat", "whatsapp"]:
        fail("bucket_ccaas", str(buckets.get("ccaas")))
        return
    if buckets.get("crm") != ["email"]:
        fail("bucket_crm", str(buckets.get("crm")))
        return
    ok("bucket_channels_by_product")


def test_cdp_product_requires_spine_sku() -> None:
    ent = TenantEntitlements(
        organization_id=1000,
        skus=["campaign", "crm"],
        channels={},
    )
    visible = filter_metrics(
        ["open_rate", "contact_volume"],
        organization_id=1000,
        user_id=None,
        product="cdp",
        role="agent",
        entitlements=ent,
    )
    if visible:
        fail("cdp_spine_gate", f"expected no metrics without cdp SKU, got {visible}")
        return
    ent_with_cdp = TenantEntitlements(
        organization_id=1000,
        skus=["cdp", "campaign", "crm"],
        channels={},
    )
    visible2 = filter_metrics(
        ["open_rate"],
        organization_id=1000,
        user_id=None,
        product="cdp",
        role="agent",
        entitlements=ent_with_cdp,
    )
    if "open_rate" not in visible2:
        fail("cdp_engine_sku", f"open_rate should pass with cdp+campaign, got {visible2}")
        return
    ok("cdp product spine + engine SKU gate")


def main() -> int:
    print("=== entitlements unit tests ===")
    test_capability_channel_mapping()
    test_bucket_channels_by_product()
    test_cdp_product_requires_spine_sku()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
