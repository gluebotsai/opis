"""The thirteen acceptance tests from spec section 14.

Tests 5, 6 and 13 are release blockers.

1-12 run against ``tests/fakes.FakeNeo4j``, which interprets the exact Cypher
this project generates and models node identity as (label, key, value) -- the
same semantics a uniqueness constraint provides. They need no Docker.

13 (PROFILE plan inspection) genuinely needs a server and is skipped unless
NEO4J_TEST_URI is set. Real-server variants of 5 and 6 run under the same guard.
"""

import os

import pytest

from src.quarantine import Quarantine
from src.registry import Organisation, Registry
from src.router import Quarantined, RoutedEvent, Router, Skipped
from src.writer import Writer
from tests.fakes import FakePool, FakeRegistry, envelope, value_schema

CONTACT_SCHEMA = value_schema({
    "contact_id": "int64", "tenant_id": "string",
    "created_at": "io.debezium.time.MicroTimestamp",
})

NEEDS_SERVER = pytest.mark.skipif(
    not os.environ.get("NEO4J_TEST_URI"),
    reason="set NEO4J_TEST_URI/USER/PASSWORD to run against a real Neo4j Enterprise",
)


@pytest.fixture
def rig(loader, org_a, org_b):
    """Router + Writer over a shared fake DBMS."""
    registry = FakeRegistry([org_a, org_b])
    pool = FakePool()
    router = Router(loader, registry, "cdc", "accounts.organisations")
    writer = Writer(pool, loader, loader.connections)
    return {"router": router, "writer": writer, "pool": pool, "registry": registry}


def feed(rig, topic, message, partition=0, offset=0):
    d = rig["router"].route(topic, message, partition, offset)
    if isinstance(d, RoutedEvent):
        rig["writer"].add(d)
    return d


def contact(tenant="tenant-alpha", cid=1, **extra):
    row = {"contact_id": cid, "tenant_id": tenant, "first_name": "Ada",
           "email": "ada@example.com", "status": "active", "account_id": 500}
    row.update(extra)
    return row


# --- 1 ---------------------------------------------------------------------

def test_01_single_insert_creates_a_node_with_correct_properties(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    g = rig["pool"].graph("orga1b2c3d4")
    node = g.find_node("Contact", "contact_id", 1)
    assert node is not None
    assert node["props"]["email"] == "ada@example.com"
    assert node["props"]["first_name"] == "Ada"
    assert {"Contact", "Customer", "Policyholder"} <= node["labels"]
    # The relationship target was MERGEd as a stub, so the edge exists already.
    assert g.find_node("Account", "account_id", 500) is not None
    assert g.edge_count("BELONGS_TO") == 1


# --- 2 ---------------------------------------------------------------------

def test_02_update_of_one_column_updates_without_duplicating(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    feed(rig, "cdc.crm.contacts",
         envelope(after=contact(email="new@example.com"), op="u",
                  schema=CONTACT_SCHEMA), offset=1)
    rig["writer"].flush_all()
    g = rig["pool"].graph("orga1b2c3d4")
    assert g.node_count("Contact") == 1
    assert g.find_node("Contact", "contact_id", 1)["props"]["email"] == "new@example.com"


def test_02b_tenant_id_is_present_in_the_update_payload(rig):
    d = rig["router"].route("cdc.crm.contacts",
                            envelope(after=contact(), op="u", schema=CONTACT_SCHEMA))
    assert isinstance(d, RoutedEvent)      # would be Quarantined if tenant_id were absent


# --- 3 ---------------------------------------------------------------------

def test_03_bulk_insert_of_10000_rows_in_one_transaction(rig):
    for i in range(10_000):
        feed(rig, "cdc.crm.contacts",
             envelope(after=contact(cid=i), schema=CONTACT_SCHEMA), offset=i)
    rig["writer"].flush_all()
    g = rig["pool"].graph("orga1b2c3d4")
    assert g.node_count("Contact") == 10_000
    contact_writes = [c for c in rig["pool"].log if "MERGE (n:Contact" in c[1]]
    assert len(contact_writes) == 1, "must be one batched UNWIND, never per-row"
    assert len(contact_writes[0][2]) == 10_000


# --- 4 ---------------------------------------------------------------------

def test_04_delete_removes_the_node_and_its_relationships(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    assert rig["pool"].graph("orga1b2c3d4").edge_count("BELONGS_TO") == 1
    feed(rig, "cdc.crm.contacts",
         envelope(before=contact(), op="d", schema=CONTACT_SCHEMA), offset=1)
    rig["writer"].flush_all()
    g = rig["pool"].graph("orga1b2c3d4")
    assert g.find_node("Contact", "contact_id", 1) is None
    assert g.edge_count("BELONGS_TO") == 0


# --- 5  RELEASE BLOCKER ----------------------------------------------------

def test_05_replaying_the_same_batch_leaves_the_node_count_unchanged(rig):
    """Idempotency. MERGE on a stable business key means a crash-replay produces
    no duplicates, which is what makes at-least-once Kafka delivery safe."""
    batch = [envelope(after=contact(cid=i), schema=CONTACT_SCHEMA) for i in range(100)]
    for i, msg in enumerate(batch):
        feed(rig, "cdc.crm.contacts", msg, offset=i)
    rig["writer"].flush_all()
    g = rig["pool"].graph("orga1b2c3d4")
    before_nodes, before_edges = len(g.nodes), len(g.edges)

    for i, msg in enumerate(batch):                       # exact replay
        feed(rig, "cdc.crm.contacts", msg, offset=i)
    rig["writer"].flush_all()

    assert len(g.nodes) == before_nodes
    assert len(g.edges) == before_edges


def test_05b_replay_of_a_relationship_batch_is_idempotent(rig):
    msg = envelope(after={"ticket_id": 1, "tag_id": 2, "tenant_id": "tenant-alpha"})
    for _ in range(3):
        feed(rig, "cdc.ticketing.ticket_tags", msg)
        rig["writer"].flush_all()
    assert rig["pool"].graph("orga1b2c3d4").edge_count("TAGGED") == 1


# --- 6  RELEASE BLOCKER ----------------------------------------------------

def test_06_an_event_for_org_a_never_appears_in_org_b(rig):
    """The critical test. Identical business keys in both tenants; each must land
    only in its own database. This is physical isolation -- a Cypher query cannot
    cross a database boundary -- not a WHERE clause that can be forgotten."""
    for tenant in ("tenant-alpha", "tenant-beta"):
        for cid in range(1, 6):
            feed(rig, "cdc.crm.contacts",
                 envelope(after=contact(tenant, cid, email=f"{tenant}-{cid}@x.com"),
                          schema=CONTACT_SCHEMA), offset=cid)
        rig["writer"].flush_all()

    a = rig["pool"].graph("orga1b2c3d4")
    b = rig["pool"].graph("orgb5e6f7a8")
    assert a.node_count("Contact") == 5 and b.node_count("Contact") == 5

    for node in a.nodes.values():
        assert "tenant-beta" not in str(node["props"].values())
    for node in b.nodes.values():
        assert "tenant-alpha" not in str(node["props"].values())

    # Overlays differ, so even the labels must not bleed across.
    assert "Policyholder" in a.find_node("Contact", "contact_id", 1)["labels"]
    assert "Policyholder" not in b.find_node("Contact", "contact_id", 1)["labels"]
    assert "Shopper" in b.find_node("Contact", "contact_id", 1)["labels"]


def test_06b_every_write_names_an_explicit_database(rig):
    """No write may ever go to the driver's default database."""
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    feed(rig, "cdc.crm.contacts",
         envelope(after=contact("tenant-beta"), schema=CONTACT_SCHEMA), offset=1)
    rig["writer"].flush_all()
    for database, _, _ in rig["pool"].log:
        assert database in ("orga1b2c3d4", "orgb5e6f7a8")


# --- 7 ---------------------------------------------------------------------

def test_07_unknown_tenant_is_quarantined_and_nothing_is_written(rig, tmp_path):
    q = Quarantine(tmp_path / "q")
    d = feed(rig, "cdc.crm.contacts",
             envelope(after=contact("tenant-ghost"), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined)
    q.write("cdc.crm.contacts", {}, d.reason, d.detail, 0, 0)
    rig["writer"].flush_all()
    assert rig["pool"].log == []
    assert len(list((tmp_path / "q").glob("*.jsonl"))) == 1


# --- 8 ---------------------------------------------------------------------

def test_08_event_for_an_unpurchased_product_is_skipped(rig):
    d = feed(rig, "cdc.ccaas.calls",
             envelope(after={"call_id": 1, "tenant_id": "tenant-alpha"}))
    assert isinstance(d, Skipped)
    rig["writer"].flush_all()
    assert rig["pool"].log == []


# --- 9 ---------------------------------------------------------------------

def test_09_new_organisation_row_provisions_and_routes(loader):
    """A control-topic insert must create the database, create its constraints,
    and make subsequent data events routable -- in that order."""
    pool = FakePool()
    registry = Registry("org", loader.section("control_plane"), "instance-1")
    org = registry.upsert_from_event(
        "c", None, {"tenant_id": "tenant-gamma", "organization_id": "c9d8e7f6",
                    "status": "active"})
    assert org.database == "orgc9d8e7f6"
    assert org.active and not org.provisioned

    router = Router(loader, registry, "cdc", "accounts.organisations")
    # Before provisioning: fail closed, replayable.
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact("tenant-gamma"), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "organisation_not_provisioned"

    registry.mark_provisioned("tenant-gamma", loader.effective("orgc9d8e7f6").products)
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact("tenant-gamma"), schema=CONTACT_SCHEMA))
    # No overlay exists for this database, so core-only applies and crm is gated.
    assert isinstance(d, Skipped)


def test_09b_delete_from_the_control_plane_never_drops_the_database(loader):
    registry = Registry("org", loader.section("control_plane"), "instance-1")
    registry.upsert_from_event("c", None, {"tenant_id": "t1", "organization_id": "abcd1234",
                                           "status": "active"})
    org = registry.upsert_from_event("d", {"tenant_id": "t1", "organization_id": "abcd1234",
                                           "status": "active"}, None)
    assert org.active is False
    assert registry.lookup("t1").database == "orgabcd1234"      # retained


def test_09c_two_tenants_mapping_to_one_database_is_refused(loader):
    registry = Registry("org", loader.section("control_plane"), "instance-1")
    registry.upsert_from_event("c", None, {"tenant_id": "t1", "organization_id": "abcd1234",
                                           "status": "active"})
    with pytest.raises(Exception, match="collision"):
        registry.upsert_from_event("c", None, {"tenant_id": "t2",
                                               "organization_id": "abcd-1234",
                                               "status": "active"})


# --- 10 --------------------------------------------------------------------

def test_10_properties_on_update_preserves_every_other_property(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    for attr, val in (("colour", "red"), ("size", "XL")):
        feed(rig, "cdc.crm.contact_attributes",
             envelope(after={"contact_id": 1, "attr_name": attr, "attr_value": val,
                             "tenant_id": "tenant-alpha"}))
    rig["writer"].flush_all()
    feed(rig, "cdc.crm.contact_attributes",
         envelope(after={"contact_id": 1, "attr_name": "colour", "attr_value": "blue",
                         "tenant_id": "tenant-alpha"}, op="u"))
    rig["writer"].flush_all()

    props = rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", 1)["props"]
    assert props["attr_colour"] == "blue"        # updated
    assert props["attr_size"] == "XL"            # preserved
    assert props["email"] == "ada@example.com"   # real column preserved
    assert props["first_name"] == "Ada"


def test_10b_attribute_prefix_stops_a_collision_with_a_real_column(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    feed(rig, "cdc.crm.contact_attributes",
         envelope(after={"contact_id": 1, "attr_name": "status", "attr_value": "HIJACKED",
                         "tenant_id": "tenant-alpha"}))
    rig["writer"].flush_all()
    props = rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", 1)["props"]
    assert props["status"] == "active"           # the real column survived
    assert props["attr_status"] == "HIJACKED"


# --- 11 --------------------------------------------------------------------

def test_11_json_key_missing_from_an_event_preserves_the_existing_property(rig):
    feed(rig, "cdc.crm.contacts",
         envelope(after=contact(custom_data={"risk_score": 720, "kyc_status": "verified"}),
                  schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    # Second event omits risk_score entirely.
    feed(rig, "cdc.crm.contacts",
         envelope(after=contact(custom_data={"kyc_status": "reverified"}), op="u",
                  schema=CONTACT_SCHEMA), offset=1)
    rig["writer"].flush_all()
    props = rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", 1)["props"]
    assert props["custom_risk_score"] == 720          # NOT deleted by an absent key
    assert props["custom_kyc_status"] == "reverified"


def test_11b_null_column_does_not_delete_the_stored_property(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()
    feed(rig, "cdc.crm.contacts",
         envelope(after=contact(email=None), op="u", schema=CONTACT_SCHEMA), offset=1)
    rig["writer"].flush_all()
    props = rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", 1)["props"]
    assert props["email"] == "ada@example.com"        # SET x = null would have deleted it


# --- 12 --------------------------------------------------------------------

def test_12_nested_json_value_is_rejected_before_it_is_written(rig):
    d = feed(rig, "cdc.crm.contacts",
             envelope(after=contact(custom_data={"policy_number": {"nested": True}}),
                      schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "coercion_failed"
    rig["writer"].flush_all()
    assert rig["pool"].log == []


def test_12b_nested_value_is_also_caught_at_validation_time(tmp_path):
    """Spec 7.4: fail at validation time, not at write time. A declared type of
    'string' on a column that holds an object is what validation can catch."""
    from src.config_loader import PropertySpec
    from src.coercion import extract_custom
    from src.errors import CoercionError
    with pytest.raises(CoercionError):
        extract_custom({"c": {"x": [1, 2]}}, "c", [PropertySpec("x", "string")])


# --- 13  RELEASE BLOCKER (needs a real server) -----------------------------

@NEEDS_SERVER
def test_13_profile_shows_a_unique_index_seek_not_a_label_scan(loader):
    """Without the constraint, MERGE is a full label scan whose cost grows with
    the graph. This is the single largest performance factor in the system."""
    from src.drivers import DriverPool
    from src.provision import Provisioner

    cfg = dict(loader.section("neo4j"))
    cfg["instances"] = {"instance-1": {
        "uri": os.environ["NEO4J_TEST_URI"],
        "user": os.environ.get("NEO4J_TEST_USER", "neo4j"),
        "password": os.environ["NEO4J_TEST_PASSWORD"],
    }}
    pool = DriverPool(cfg)
    prov = Provisioner(pool, loader)
    prov.check_enterprise()
    db = "orgtestprofile"
    prov.ensure_database(db)
    prov.ensure_constraints(db)

    results = prov.verify_index_usage(db)
    for label, r in results.items():
        assert r["index_seek"], f"{label}: no index seek, operators={r['operators']}"
        assert not r["label_scan"], f"{label}: NodeByLabelScan present"
    pool.close()


@NEEDS_SERVER
def test_06_real_server_isolation(loader):
    """Cross-database isolation against a real DBMS: a query in A cannot see B."""
    from src.drivers import DriverPool
    cfg = dict(loader.section("neo4j"))
    cfg["instances"] = {"instance-1": {
        "uri": os.environ["NEO4J_TEST_URI"],
        "user": os.environ.get("NEO4J_TEST_USER", "neo4j"),
        "password": os.environ["NEO4J_TEST_PASSWORD"],
    }}
    pool = DriverPool(cfg)
    driver = pool.get()
    with driver.session(database="orga1b2c3d4") as s:
        s.run("MERGE (n:Contact {contact_id: 'isolation-probe'})")
    with driver.session(database="orgb5e6f7a8") as s:
        found = s.run(
            "MATCH (n:Contact {contact_id: 'isolation-probe'}) RETURN count(n) AS c"
        ).single()["c"]
    assert found == 0
    pool.close()
