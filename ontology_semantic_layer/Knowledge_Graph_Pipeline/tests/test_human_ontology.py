"""Tests for human-readable ontology (no wt:*, Contact-only tickets)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KG = ROOT / "Knowledge_Graph_Pipeline"
sys.path.insert(0, str(KG))
sys.path.insert(0, str(ROOT))

from src.config_loader import ConfigLoader, parse_core
from src.derived_lookup import DerivedLookupCache, LookupSpec, parse_lookup_spec
from ontology_steward.tools.registry_io import (
    ENTITIES_PATH,
    entity_for_table,
    in_graph_labels,
    load_entities_definitions,
)


def test_entities_yaml_exists_and_ticket_status_not_in_graph():
    assert ENTITIES_PATH.exists()
    defs = load_entities_definitions()
    status = defs["entities"]["TicketStatus"]
    assert status["in_graph"] is False
    assert status["taxonomy_axis"] == "ticket.status"
    assert "Ticket" in defs["entities"]
    assert "ContactAccount" in defs["entities"]
    assert "Note" in defs["entities"]


def test_contact_profile_excluded_from_graph():
    spec = entity_for_table("ticketing.contact_profile")
    assert spec is not None
    assert spec.get("in_graph") is False


def test_core_ticketing_labels():
    loader = ConfigLoader(config_dir=str(KG / "config"))
    tables = loader.core_tables
    tickets = tables["ticketing.tickets"]
    assert tickets.label == "Ticket"
    rel = tickets.relationships[0]
    assert rel.target_label == "Contact"
    assert rel.from_column == "customer_cdp_id"
    assert "ticketing.ticket_statuses" not in tables
    bridge = tables["ticketing.contact_profile"]
    assert bridge.mode == "lookup_source"


def test_derived_customer_cdp_id_lookup():
    doc = loader_derived()
    spec = parse_lookup_spec(doc["ticketing.tickets.customer_cdp_id"])
    assert spec is not None
    cache = DerivedLookupCache()
    cache.ingest(
        "ticketing.contact_profile",
        {"id": 42, "cdp_id": "cdp-99"},
        LookupSpec("ticketing.contact_profile", "customer_id", "id", "cdp_id"),
    )
    resolved = cache.resolve(spec, 42)
    assert resolved == "cdp-99"


def loader_derived():
    loader = ConfigLoader(config_dir=str(KG / "config"))
    return loader.core_meta["derived"]


def test_no_support_profile_in_node_ownership():
    loader = ConfigLoader(config_dir=str(KG / "config"))
    owners = loader.core_meta["graph_integrity"]["node_ownership"]
    assert "SupportProfile" not in owners
    assert "Ticket" in owners
    assert "ContactAccount" in owners


def test_ontology_slice_no_wt_prefix():
    from ontology.slice import fetch_ontology_slice

    pack = fetch_ontology_slice(preset="tk.super")
    for cid in pack.class_ids():
        assert not str(cid).startswith("wt:"), f"class id still wt:*: {cid}"
    for aid in pack.action_ids():
        assert not str(aid).startswith("wt:"), f"action id still wt:*: {aid}"


def test_in_graph_labels_include_ticket_not_status():
    labels = in_graph_labels()
    assert "Ticket" in labels
    assert "TicketStatus" not in labels


def test_graph_nodes_human_labels():
    from ontology.graph_nodes import GraphIndex

    gi = GraphIndex.get()
    assert gi.node_for_label("Ticket") is not None
    assert gi.node_for_label("SupportCase") is None
    assert gi.node_for_label("SupportProfile") is None
    assert gi.label_for_class("Ticket") == "Ticket"


def test_setup_users_label_is_user():
    loader = ConfigLoader(config_dir=str(KG / "config"))
    users = loader.core_tables["accounts.setup_users"]
    assert users.label == "User"


def test_employee_in_taxonomy_only():
    from ontology.definitions.loader import load_definitions

    defs = load_definitions()
    assert "User" in defs["entities"]
    assert "Employee" not in defs["entities"]
    user_kind = (defs.get("taxonomies") or {}).get("user.kind") or {}
    assert user_kind.get("terms") == ["employee"]
    staff = (defs.get("taxonomies") or {}).get("staff.role") or {}
    assert staff.get("terms") == ["admin", "agent", "resolver"]
    labels = in_graph_labels()
    assert "User" in labels
    assert "Employee" not in labels


def test_staff_role_in_ticketing_slice():
    from ontology.slice import clear_ontology_cache, fetch_ontology_slice

    clear_ontology_cache()
    pack = fetch_ontology_slice(preset="tk.super")
    prompt = pack.as_prompt(mode="compact")
    assert "Agent" in prompt
    assert "staff.role" in prompt
    assert "ticket.assignee_role" in prompt
    assert "Employee" not in prompt
    assert "  User:" not in prompt
    assert "  Party:" not in prompt
    assert "  WorkItem:" not in prompt


def test_assigned_to_resolved_by_verbs():
    from pathlib import Path

    root = ROOT / "ontology"
    bad = ("ASSIGNED_L1", "RESOLVER_L2", "FOR_CUSTOMER")
    for rel_path in list((root / "modules").glob("*.yml")) + list(
        (root / "slices").glob("*.yml")
    ):
        text = rel_path.read_text(encoding="utf-8")
        for token in bad:
            assert token not in text, f"{rel_path.name} still has {token}"


if __name__ == "__main__":
    tests = [
        test_entities_yaml_exists_and_ticket_status_not_in_graph,
        test_contact_profile_excluded_from_graph,
        test_core_ticketing_labels,
        test_derived_customer_cdp_id_lookup,
        test_no_support_profile_in_node_ownership,
        test_ontology_slice_no_wt_prefix,
        test_in_graph_labels_include_ticket_not_status,
        test_graph_nodes_human_labels,
        test_setup_users_label_is_user,
        test_employee_in_taxonomy_only,
        test_staff_role_in_ticketing_slice,
        test_assigned_to_resolved_by_verbs,
    ]
    for fn in tests:
        fn()
        print(f"OK {fn.__name__}")
