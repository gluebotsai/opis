import pytest

from src.config_loader import PropertySpec, RelationshipSpec, TableMapping
from src.cypher_builder import (build_all, build_constraint, build_node_delete,
                                build_node_upsert, build_properties_on_remove,
                                build_properties_on_upsert,
                                build_relationship_delete,
                                build_relationship_upsert)
from src.errors import MappingError


def node_mapping(**over):
    m = TableMapping(table="crm.contacts", mode="node", label="Contact", key="contact_id",
                     key_column="contact_id")
    m.properties = [PropertySpec("email")]
    for k, v in over.items():
        setattr(m, k, v)
    return m


# --- spec 7.1 invariants ---------------------------------------------------

def test_merge_uses_core_label_only_never_extra_labels():
    """MERGE (n:Contact:Customer) would match only nodes bearing BOTH labels,
    miss the node core created, try to create a duplicate, and violate the
    uniqueness constraint. Extra labels go on with SET after the merge."""
    m = node_mapping(extra_labels=["Customer", "Policyholder"])
    q = build_node_upsert(m)
    assert "MERGE (n:Contact {contact_id: e.key})" in q
    assert "MERGE (n:Contact:Customer" not in q
    assert "SET n:Customer:Policyholder" in q
    assert q.index("MERGE (n:Contact") < q.index("SET n:Customer")


def test_relationship_target_is_merged_not_matched():
    """MERGE creates a stub if the target row has not arrived yet; a later event
    for that entity fills the same node in. This is what makes arrival order
    irrelevant. A MATCH here would silently drop edges."""
    m = node_mapping(relationships=[
        RelationshipSpec("BELONGS_TO", "out", "Account", "account_id", "account_id")])
    q = build_node_upsert(m)
    assert "MERGE (t0:Account {account_id: e.rel_account_id})" in q
    assert "MATCH (t0:Account" not in q


def test_every_relationship_is_null_guarded():
    m = node_mapping(relationships=[
        RelationshipSpec("BELONGS_TO", "out", "Account", "account_id", "account_id")])
    assert "WHERE e.rel_account_id IS NOT NULL" in build_node_upsert(m)


def test_incoming_direction_reverses_the_arrow():
    m = node_mapping(relationships=[
        RelationshipSpec("OWNED_BY", "in", "Account", "account_id", "account_id")])
    assert "MERGE (n)<-[:OWNED_BY]-(t0)" in build_node_upsert(m)


def test_multiple_relationships_get_distinct_variables():
    m = node_mapping(relationships=[
        RelationshipSpec("BELONGS_TO", "out", "Account", "account_id", "account_id"),
        RelationshipSpec("HOLDS", "out", "Policy", "policy_id", "policy_id")])
    q = build_node_upsert(m)
    assert "(t0:Account" in q and "(t1:Policy" in q


def test_scoped_subquery_syntax():
    m = node_mapping(relationships=[
        RelationshipSpec("BELONGS_TO", "out", "Account", "account_id", "account_id")])
    legacy, scoped = build_node_upsert(m, "legacy"), build_node_upsert(m, "scoped")
    assert "CALL {" in legacy and "CALL (n, e) {" in scoped
    assert "CALL {" not in scoped


def test_no_relationships_means_no_with_clause():
    assert "WITH n, e" not in build_node_upsert(node_mapping())


# --- deletes ---------------------------------------------------------------

def test_hard_delete():
    q = build_node_delete(node_mapping())
    assert "DETACH DELETE n" in q and "MATCH (n:Contact" in q


def test_soft_delete_is_configurable_per_mapping():
    q = build_node_delete(node_mapping(on_delete="soft"))
    assert "SET n.deleted_at = e.ts" in q and "DELETE" not in q


# --- relationship_only -----------------------------------------------------

def rel_mapping():
    return TableMapping(
        table="ticketing.ticket_tags", mode="relationship_only",
        from_label="Ticket", from_key="ticket_id", from_column="ticket_id",
        to_label="Tag", to_key="tag_id", to_column="tag_id", type="TAGGED")


def test_relationship_only_upsert_matches_spec():
    assert build_relationship_upsert(rel_mapping()) == (
        "UNWIND $batch AS e\n"
        "MERGE (a:Ticket {ticket_id: e.from_key})\n"
        "MERGE (b:Tag {tag_id: e.to_key})\n"
        "MERGE (a)-[:TAGGED]->(b)")


def test_relationship_only_delete_removes_edge_not_nodes():
    q = build_relationship_delete(rel_mapping())
    assert q.endswith("DELETE r")
    assert "DETACH" not in q


# --- properties_on ---------------------------------------------------------

def props_mapping():
    return TableMapping(
        table="crm.contact_attributes", mode="properties_on", target_label="Contact",
        target_key="contact_id", target_key_column="contact_id",
        attr_key_column="attr_name", attr_value_column="attr_value", prefix="attr_")


def test_properties_on_uses_plus_equals_to_preserve_other_properties():
    q = build_properties_on_upsert(props_mapping())
    assert "SET n += e.props" in q
    assert "SET n = e.props" not in q          # would wipe the rest of the node


def test_properties_on_remove_sanitises_and_backticks_the_property():
    q = build_properties_on_remove(props_mapping(), "risk`score")
    assert "REMOVE n.`attr_risk_score`" in q


# --- guards ----------------------------------------------------------------

def test_label_from_config_must_be_a_bare_identifier():
    with pytest.raises(MappingError, match="bare identifier"):
        build_node_upsert(node_mapping(label="Contact) DETACH DELETE (n"))


def test_wrong_mode_raises():
    with pytest.raises(MappingError):
        build_relationship_upsert(node_mapping())


def test_build_all_covers_every_mode():
    for m in (node_mapping(), rel_mapping(), props_mapping()):
        assert set(build_all(m)) == {"upsert", "delete"}


def test_raw_cypher_bypasses_generation():
    m = node_mapping(raw_cypher="UNWIND $batch AS e RETURN e")
    assert build_all(m) == {"raw": "UNWIND $batch AS e RETURN e"}


def test_constraint_ddl():
    assert build_constraint("Contact", "contact_id", "contact_contact_id") == (
        "CREATE CONSTRAINT contact_contact_id IF NOT EXISTS "
        "FOR (n:Contact) REQUIRE n.contact_id IS UNIQUE")


# --- generated against the real config -------------------------------------

def test_real_config_generates_for_every_table(loader):
    for db in ("orga1b2c3d4", "orgb5e6f7a8"):
        eff = loader.effective(db)
        for table, m in eff.tables.items():
            queries = build_all(m)
            assert queries, table
            for q in queries.values():
                assert "$batch" in q, f"{table}: query does not batch"
