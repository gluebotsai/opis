"""Unit tests for Contact Center Knowledge Graph (KG) integration."""

from __future__ import annotations

from pathlib import Path
import pytest
import yaml

from reports_analytics_agent_contact_center.kg_executor.core.cypher_guard import (
    CypherGuardError,
    guard_cypher,
)
from reports_analytics_agent_contact_center.kg_executor.core.cypher_validate import (
    load_product_edges,
    load_schema,
)
from reports_analytics_agent_contact_center.kg_executor.core.run_cypher import run_cypher


def test_schema_loading():
    labels, rels, props = load_schema()
    assert "Conversation" in labels
    assert "ContactCentreQueue" in labels
    assert "ContactCentreAgent" in labels
    assert "MissedContact" in labels
    assert "BusinessHours" in labels
    assert "Shift" in labels
    assert "HolidayCalendar" in labels

    assert "ROUTED_TO" in rels
    assert "HANDLED_BY" in rels
    assert "HAS" in rels
    assert "CONTINUES" in rels
    assert "HAS_SHIFT" in rels
    assert "HAS_HOLIDAY" in rels

    assert "resolution_code" in props
    assert "disposition_code" in props
    assert "end_actor" in props
    assert "end_reason" in props
    assert "handoff_reason" in props
    assert "queued_at" in props
    assert "first_response_at" in props


def test_product_edges_loading():
    spec = load_product_edges()
    assert spec["product"] == "contact_center"
    assert "Conversation" in spec["start_labels"]
    assert "Ticket" in spec["forbidden_labels"]
    assert ("Conversation", "ROUTED_TO", "ContactCentreQueue") in spec["pairs"]
    assert ("Conversation", "HANDLED_BY", "ContactCentreAgent") in spec["pairs"]
    assert ("BusinessHours", "HAS_SHIFT", "Shift") in spec["pairs"]


def test_valid_cypher_guarding():
    cypher = """
    MATCH (c:Conversation)
    WHERE c.created_at IS NOT NULL AND c.ended_at IS NOT NULL
    RETURN coalesce(c.channel, 'all') AS channel, count(c) AS total
    LIMIT 10
    """
    guarded = guard_cypher(cypher, role="admin", user_id=10, queue_ids=[1, 2])
    assert guarded.params["user_id"] == 10
    assert guarded.params["queue_ids"] == [1, 2]
    assert "LIMIT 10" in guarded.cypher


def test_mutation_forbidden():
    mutations = [
        "MATCH (c:Conversation) DELETE c",
        "MATCH (c:Conversation) DETACH DELETE c",
        "MATCH (c:Conversation) SET c.status = 'closed'",
        "CREATE (c:Conversation {id: 1})",
        "MERGE (c:Conversation {id: 1})",
        "DROP INDEX ON :Conversation(id)",
    ]
    for m in mutations:
        with pytest.raises(CypherGuardError):
            guard_cypher(m, role="admin", user_id=10)


def test_forbidden_ticketing_entities_blocked():
    queries = [
        "MATCH (t:Ticket) RETURN t",
        "MATCH (t:TicketSLA) RETURN t",
        "MATCH (c:Conversation)-[:HAS_TICKET]->(t:Ticket) RETURN c, t",
    ]
    for q in queries:
        with pytest.raises(CypherGuardError):
            guard_cypher(q, role="admin", user_id=10)


def test_run_cypher_compilation():
    cypher = """
    MATCH (c:Conversation)
    RETURN count(c) AS total
    LIMIT 5
    """
    result = run_cypher(cypher, organization_id=1000, user_id=10, role="admin", execute=False)
    assert result["status"] == "compiled"
    assert result["store"] == "kg"
    assert "LIMIT 5" in result["cypher"]


def test_kg_executor_is_canonical():
    from reports_analytics_agent_contact_center.kg_executor import run_cypher as pkg_run
    from reports_analytics_agent_contact_center.kg_executor.core import run_cypher as kg_run

    assert pkg_run is kg_run


def test_canonical_few_shots_all_valid():
    examples_path = Path(__file__).resolve().parent.parent / "product" / "kg" / "examples" / "cypher.yml"
    assert examples_path.exists()
    data = yaml.safe_load(examples_path.read_text())
    examples = data.get("examples", [])
    assert len(examples) >= 15
    for ex in examples:
        guarded = guard_cypher(ex["cypher"], role="admin", user_id=10)
        assert guarded.cypher
