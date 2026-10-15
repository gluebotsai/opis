import pytest

from src.router import ControlEvent, Quarantined, RoutedEvent, Router, Skipped
from tests.fakes import FakeRegistry, envelope, value_schema

CONTACT_SCHEMA = value_schema({
    "contact_id": "int64", "tenant_id": "string", "email": "string",
    "created_at": "io.debezium.time.MicroTimestamp",
    "lifetime_value": "io.debezium.data.VariableScaleDecimal",
})


def contact(tenant="tenant-alpha", cid=1, **extra):
    row = {"contact_id": cid, "tenant_id": tenant, "first_name": "Ada",
           "last_name": "Lovelace", "email": "ada@example.com", "status": "active",
           "account_id": 99}
    row.update(extra)
    return row


# --- topic parsing ---------------------------------------------------------

def test_topic_maps_to_table(router):
    assert router.table_for("cdc.crm.contacts") == "crm.contacts"


def test_control_topic_detected(router):
    assert router.is_control_topic("cdc.accounts.organisations")
    assert not router.is_control_topic("cdc.crm.contacts")


def test_control_topic_returns_a_control_event(router):
    d = router.route("cdc.accounts.organisations",
                     envelope(after={"organization_id": "x", "tenant_id": "t",
                                     "status": "active"}))
    assert isinstance(d, ControlEvent) and d.op == "c"


# --- the happy path --------------------------------------------------------

def test_insert_routes_to_the_right_database(router):
    d = router.route("cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    assert isinstance(d, RoutedEvent)
    assert d.database == "orga1b2c3d4"
    assert d.op == "upsert"
    assert d.row["key"] == 1
    assert d.row["props"]["email"] == "ada@example.com"
    assert d.row["rel_account_id"] == 99


def test_delete_uses_the_before_image(router):
    d = router.route("cdc.crm.contacts",
                     envelope(before=contact(cid=7), op="d", schema=CONTACT_SCHEMA))
    assert isinstance(d, RoutedEvent) and d.op == "delete" and d.row["key"] == 7


def test_snapshot_read_is_an_upsert(router):
    d = router.route("cdc.crm.contacts", envelope(after=contact(), op="r",
                                                       schema=CONTACT_SCHEMA))
    assert isinstance(d, RoutedEvent) and d.op == "upsert"


# --- ACCEPTANCE TEST 6: cross-tenant isolation -----------------------------

def test_an_event_for_org_a_never_targets_org_b(router):
    """The critical test. A misroute writes one organisation's data into
    another's graph -- the exact failure this architecture exists to prevent."""
    a = router.route("cdc.crm.contacts",
                     envelope(after=contact("tenant-alpha", 1), schema=CONTACT_SCHEMA))
    b = router.route("cdc.crm.contacts",
                     envelope(after=contact("tenant-beta", 1), schema=CONTACT_SCHEMA))
    assert a.database == "orga1b2c3d4"
    assert b.database == "orgb5e6f7a8"
    assert a.database != b.database
    # Identical business keys, different databases -- physical isolation, not a WHERE.
    assert a.row["key"] == b.row["key"]


# --- fail-closed (spec 8.3) ------------------------------------------------

def test_unknown_tenant_is_quarantined_never_guessed(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact("tenant-nobody"), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "unknown_tenant"


def test_missing_tenant_id_is_quarantined(router):
    row = contact()
    del row["tenant_id"]
    d = router.route("cdc.crm.contacts", envelope(after=row, schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "missing_tenant_id"


def test_inactive_organisation_is_quarantined(loader, org_a):
    org_a._active = False
    r = Router(loader, FakeRegistry([org_a]), "cdc", "accounts.organisations")
    d = r.route("cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "organisation_inactive"


def test_unprovisioned_organisation_is_quarantined_and_replayable(loader, org_a):
    org_a.provisioned = False
    r = Router(loader, FakeRegistry([org_a]), "cdc", "accounts.organisations")
    d = r.route("cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "organisation_not_provisioned"


def test_unknown_table_is_quarantined(router):
    d = router.route("cdc.webtrack.pageviews",
                     envelope(after={"tenant_id": "tenant-alpha", "id": 1}))
    assert isinstance(d, Quarantined) and d.reason == "unknown_table"


def test_delete_without_a_before_image_names_replica_identity(router):
    """Under REPLICA IDENTITY DEFAULT the before-image is PK-only, so tenant_id is
    absent and every delete would be quarantined. The message has to say so."""
    d = router.route("cdc.crm.contacts", envelope(before=None, op="d"))
    assert isinstance(d, Quarantined)
    assert "REPLICA IDENTITY" in d.detail


def test_pk_only_before_image_is_quarantined_with_a_useful_message(router):
    d = router.route("cdc.crm.contacts", envelope(before={"contact_id": 5}, op="d"))
    assert isinstance(d, Quarantined) and d.reason == "missing_tenant_id"
    assert "REPLICA IDENTITY" in d.detail


def test_null_business_key_is_quarantined(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact(cid=None), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "missing_key"


def test_unknown_operation_is_quarantined(router):
    d = router.route("cdc.crm.contacts", envelope(after=contact(), op="?"))
    assert isinstance(d, Quarantined) and d.reason == "unknown_operation"


def test_bad_money_precision_quarantines_the_event_not_the_process(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact(lifetime_value="10.005"), schema=CONTACT_SCHEMA))
    assert isinstance(d, Quarantined) and d.reason == "coercion_failed"


# --- ACCEPTANCE TEST 8: product entitlement --------------------------------

def test_unpurchased_product_is_skipped_not_quarantined(router):
    """org_a has not bought ccaas. This is a business rule, not an error."""
    d = router.route("cdc.ccaas.calls",
                     envelope(after={"call_id": 1, "tenant_id": "tenant-alpha",
                                     "direction": "in"}))
    assert isinstance(d, Skipped) and d.reason == "product_not_entitled"


def test_purchased_product_is_routed(router):
    d = router.route("cdc.ccaas.calls",
                     envelope(after={"call_id": 1, "tenant_id": "tenant-beta",
                                     "direction": "in"}))
    assert isinstance(d, RoutedEvent) and d.database == "orgb5e6f7a8"


# --- payload assembly ------------------------------------------------------

def test_money_emits_minor_units_scale_and_currency(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact(lifetime_value="1234.56",
                                            lifetime_value_currency="INR"),
                              schema=CONTACT_SCHEMA))
    p = d.row["props"]
    assert p["lifetime_value"] == 123456
    assert p["lifetime_value_scale"] == 2
    assert p["lifetime_value_currency"] == "INR"


def test_custom_jsonb_properties_are_prefixed_and_cast(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact(custom_data={"risk_score": "720",
                                                         "policy_number": "P-1"}),
                              schema=CONTACT_SCHEMA))
    p = d.row["props"]
    assert p["custom_risk_score"] == 720
    assert p["custom_policy_number"] == "P-1"


def test_nulls_are_stripped_from_props(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact(email=None), schema=CONTACT_SCHEMA))
    assert "email" not in d.row["props"]


def test_null_foreign_key_still_produces_the_payload_slot(router):
    d = router.route("cdc.crm.contacts",
                     envelope(after=contact(account_id=None), schema=CONTACT_SCHEMA))
    assert d.row["rel_account_id"] is None      # the Cypher null-guard handles it


# --- collapse keys (correction #5) -----------------------------------------

def test_node_collapse_key_is_the_business_key(router):
    d = router.route("cdc.crm.contacts", envelope(after=contact(cid=5),
                                                       schema=CONTACT_SCHEMA))
    assert d.collapse_key == ("n", 5)


def test_relationship_collapse_key_includes_both_endpoints_and_type(router):
    d = router.route("cdc.ticketing.ticket_tags",
                     envelope(after={"ticket_id": 1, "tag_id": 2,
                                     "tenant_id": "tenant-alpha"}))
    assert d.collapse_key == ("r", 1, 2, "TAGGED")


def test_properties_on_collapse_key_includes_the_attribute_name(router):
    """Collapsing properties_on by target_key alone would silently drop every
    attribute except the last one in the flush window."""
    d1 = router.route("cdc.crm.contact_attributes",
                      envelope(after={"contact_id": 1, "attr_name": "colour",
                                      "attr_value": "red", "tenant_id": "tenant-alpha"}))
    d2 = router.route("cdc.crm.contact_attributes",
                      envelope(after={"contact_id": 1, "attr_name": "size",
                                      "attr_value": "XL", "tenant_id": "tenant-alpha"}))
    assert d1.collapse_key != d2.collapse_key
    # The key holds the PREFIXED, SANITISED property name -- the same string the
    # REMOVE clause embeds. Two attr_names that sanitise alike ('a-b', 'a.b') are
    # one Neo4j property and must therefore share one collapse key.
    assert d1.collapse_key == ("p", 1, "attr_colour")


def test_properties_on_value_going_null_becomes_a_removal(router):
    """SET n += {} is a no-op, so a nulled attribute must become REMOVE or the
    stale property lives forever."""
    d = router.route("cdc.crm.contact_attributes",
                     envelope(after={"contact_id": 1, "attr_name": "colour",
                                     "attr_value": None, "tenant_id": "tenant-alpha"}))
    assert d.op == "delete" and d.attr_name == "colour"


def test_relationship_only_missing_endpoint_is_quarantined(router):
    d = router.route("cdc.ticketing.ticket_tags",
                     envelope(after={"ticket_id": 1, "tag_id": None,
                                     "tenant_id": "tenant-alpha"}))
    assert isinstance(d, Quarantined) and d.reason == "missing_relationship_endpoint"


# --- buffer key ------------------------------------------------------------

def test_buffer_key_excludes_operation_so_ordering_survives(router):
    ins = router.route("cdc.crm.contacts",
                       envelope(after=contact(cid=1), schema=CONTACT_SCHEMA))
    dele = router.route("cdc.crm.contacts",
                        envelope(before=contact(cid=1), op="d", schema=CONTACT_SCHEMA))
    assert ins.buffer_key == dele.buffer_key == ("orga1b2c3d4", "crm.contacts")


# --- schema drift ----------------------------------------------------------

def test_unmapped_column_warns_once_and_counts(loader, registry):
    from src.metrics import Metrics
    m = Metrics()
    r = Router(loader, registry, "cdc", "accounts.organisations", m)
    for _ in range(3):
        r.route("cdc.crm.contacts",
                envelope(after=contact(newly_added_column="x"), schema=CONTACT_SCHEMA))
    counters = m.snapshot()["counters"]
    hits = [v for k, v in counters.items() if "unmapped_columns_total" in k]
    assert hits == [1.0]        # warned once per (table, column), not per event


# --- configurable tenant discriminator --------------------------------------

def test_organization_id_can_be_the_discriminator(loader, org_a):
    """Many schemas have no separate tenant_id and discriminate on
    organization_id, collapsing tenant and organisation into one identifier.
    The spec hardcoded 'tenant_id'; the column is now configurable."""
    org_a.tenant_id = "a1b2c3d4"            # registry keyed by the org id itself
    r = Router(loader, FakeRegistry([org_a]), "cdc", "accounts.organizations",
               tenant_column="organization_id")
    row = {"contact_id": 1, "organization_id": "a1b2c3d4", "email": "x@y.z",
           "account_id": None}
    d = r.route("cdc.crm.contacts", envelope(after=row))
    assert isinstance(d, RoutedEvent)
    assert d.database == "orga1b2c3d4"


def test_wrong_discriminator_column_quarantines_with_the_column_name(loader, org_a):
    r = Router(loader, FakeRegistry([org_a]), "cdc", "accounts.organizations",
               tenant_column="organization_id")
    d = r.route("cdc.crm.contacts",
                envelope(after={"contact_id": 1, "tenant_id": "tenant-alpha"}))
    assert isinstance(d, Quarantined) and d.reason == "missing_tenant_id"
    assert "organization_id" in d.detail      # names the column actually looked for
