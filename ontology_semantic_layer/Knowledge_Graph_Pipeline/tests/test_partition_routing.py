"""Tests for PostgreSQL partition table resolution and Kafka topic routing."""

import pytest
from src.router import PARTITION_SUFFIX_RE, RoutedEvent, Router
from tests.fakes import FakeRegistry, envelope


def test_partition_suffix_regex():
    cases = {
        "orders_2026_07": "orders",
        "orders_2026_08": "orders",
        "orders_default": "orders",
        "orders_2026_09_17": "orders",
        "orders_20260917": "orders",
        "customer_events_2026_07": "customer_events",
        "customer_events_default": "customer_events",
        "customer_interactions_2026_07": "customer_interactions",
        "customer_journey_default": "customer_journey",
        "order_items_2026_07": "order_items",
        "order_items_p1": "order_items",
        "order_items_p2026_07": "order_items",
        "deals": "deals",
        "tickets": "tickets",
        "setup_users": "setup_users",
        "organization_locations": "organization_locations",
    }
    for raw, expected in cases.items():
        stripped = PARTITION_SUFFIX_RE.sub("", raw)
        assert stripped == expected, f"Failed for {raw}: got {stripped}, expected {expected}"


def test_resolve_table_exact_match(router):
    assert router.resolve_table("cdp.orders") == "cdp.orders"
    assert router.resolve_table("crm.deals") == "crm.deals"


def test_resolve_table_suffix_stripping(router):
    assert router.resolve_table("cdp.orders_2026_07") == "cdp.orders"
    assert router.resolve_table("cdp.customer_events_default") == "cdp.customer_events"
    assert router.resolve_table("cdp.customer_events_2026_08") == "cdp.customer_events"
    assert router.resolve_table("cdp.order_items_2026_07") == "cdp.order_items"


def test_resolve_table_from_partition_map(loader, registry):
    custom_map = {
        "cdp.orders_custom_shard_a": "cdp.orders",
        "cdp.legacy_events_backup": "cdp.customer_events",
    }
    r = Router(loader, registry, "cdc", "accounts.organizations", partition_map=custom_map)
    assert r.resolve_table("cdp.orders_custom_shard_a") == "cdp.orders"
    assert r.resolve_table("cdp.legacy_events_backup") == "cdp.customer_events"


def test_table_for_topic_partitioned(router):
    assert router.table_for("cdc.cdp.orders_2026_07") == "cdp.orders"
    assert router.table_for("cdc.cdp.customer_events_default") == "cdp.customer_events"
    assert router.table_for("cdc.crm.deals") == "crm.deals"


def test_route_event_from_partitioned_topic(loader, org_a):
    org = org_a
    org.products = {"crm", "cdp"}
    reg = FakeRegistry([org])
    r = Router(loader, reg, "cdc", "accounts.organizations", tenant_column="organization_id")

    order_payload = {
        "order_id": "ord-123",
        "organization_id": org.organization_id,
        "cdp_id": "cust-456",
        "order_number": "ORD-1001",
        "total_amount": "99.99",
        "currency": "USD",
        "status": "completed",
        "created_at": "2026-07-15T12:00:00Z",
    }

    # Message arriving on partitioned topic cdc.cdp.orders_2026_07
    msg = envelope(after=order_payload)
    routed = r.route("cdc.cdp.orders_2026_07", msg)

    assert isinstance(routed, RoutedEvent), f"Expected RoutedEvent, got {routed}"
    assert routed.table == "cdp.orders"
    assert routed.op == "upsert"
    assert routed.row["key"] == "ord-123"
    assert routed.database == org.database
