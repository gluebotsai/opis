#!/usr/bin/env python3
"""Tests for metric capability + entitlement context resolver."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from semantic.capabilities import get_metric_capabilities, role_rank
from semantic.context import filter_metrics, resolve_context
from semantic.entitlements import TenantEntitlements, intersect_hub_products


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


def test_role_rank() -> None:
    assert role_rank("agent") < role_rank("supervisor")
    assert role_rank("manager") >= role_rank("supervisor")


def test_channel_clone_capabilities() -> None:
    cap = get_metric_capabilities("instagram_volume")
    assert cap["requires_channels"] == ["instagram"]
    cap2 = get_metric_capabilities("total_conversations")
    assert cap2.get("channel_scoped") is True


def test_filter_metrics_ccaas_two_channels(r: Results) -> None:
    ent = TenantEntitlements(
        organization_id=2005,
        skus=["contact-center"],
        channels={"ccaas": ["whatsapp", "email"]},
        features={"ccaas": ["wfm"]},
        version="test",
    )
    candidates = [
        "total_conversations",
        "whatsapp_volume",
        "email_volume",
        "instagram_volume",
        "human_agent_occupancy_rate_presence",
    ]
    agent_visible = filter_metrics(
        candidates,
        organization_id=2005,
        user_id=None,
        product="ccaas",
        role="agent",
        entitlements=ent,
    )
    r.check("agent gets total_conversations", "total_conversations" in agent_visible)
    r.check("agent gets whatsapp_volume", "whatsapp_volume" in agent_visible)
    r.check("agent gets email_volume", "email_volume" in agent_visible)
    r.check("agent blocked instagram_volume", "instagram_volume" not in agent_visible)
    r.check(
        "agent blocked occupancy",
        "human_agent_occupancy_rate_presence" not in agent_visible,
    )

    supervisor_visible = filter_metrics(
        candidates,
        organization_id=2005,
        user_id=None,
        product="ccaas",
        role="supervisor",
        entitlements=ent,
    )
    r.check(
        "supervisor gets occupancy",
        "human_agent_occupancy_rate_presence" in supervisor_visible,
    )


def test_hub_intersect_no_extra_sku(r: Results) -> None:
    ent = TenantEntitlements(
        organization_id=3000,
        skus=["contact-center"],
        channels={"ccaas": ["whatsapp"]},
        features={},
        version="test",
    )
    from semantic.entitlements import _entitlements_cache

    _entitlements_cache["3000"] = ent
    out = intersect_hub_products(
        3000, ["contact_centre", "ticketing", "crm"]
    )
    r.check("hub only entitled contact_centre", out == ["contact_centre"])
    _entitlements_cache.pop("3000", None)


def test_resolve_context_taxonomy_clip(r: Results) -> None:
    ent = TenantEntitlements(
        organization_id=2005,
        skus=["contact-center"],
        channels={"ccaas": ["whatsapp", "email"]},
        features={},
        version="test",
    )
    from semantic.entitlements import _entitlements_cache

    _entitlements_cache["2005"] = ent
    tax = {
        "channel": {
            "terms": ["voice", "web", "email", "whatsapp", "instagram"],
        }
    }
    ctx = resolve_context(
        organization_id=2005,
        user_id=1000,
        agent="cc.reporting",
        product="ccaas",
        candidate_metric_ids=["total_conversations", "instagram_volume"],
        taxonomy=tax,
    )
    terms = (ctx.taxonomy.get("channel") or {}).get("terms") or []
    r.check("taxonomy clipped to whatsapp", "whatsapp" in terms)
    r.check("taxonomy clipped to email", "email" in terms)
    r.check("taxonomy drops instagram", "instagram" not in terms)
    r.check("instagram not in visible metrics", "instagram_volume" not in ctx.visible_metric_ids)
    _entitlements_cache.pop("2005", None)


def main() -> int:
    r = Results()
    print("=== context resolver ===")
    test_role_rank()
    test_channel_clone_capabilities()
    test_filter_metrics_ccaas_two_channels(r)
    test_hub_intersect_no_extra_sku(r)
    test_resolve_context_taxonomy_clip(r)
    print(f"\n{ r.ok} passed, {r.fail} failed")
    return 0 if r.fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
