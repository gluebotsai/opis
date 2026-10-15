"""Regression tests for two properties_on bugs found by independent audit.

Both were invisible to the original suite because every fixture used a clean
attribute name ('colour', 'size', 'status'). Real attribute names contain
dashes, dots and spaces constantly, so these paths run in production on day one.
"""

from tests.test_integration import (  # noqa: F401
    rig, feed, envelope, contact, CONTACT_SCHEMA,
)

DIRTY = ["risk-score", "kyc.status", "policy number", "a/b", "ratio%"]


def _attrs(rig, cid=1):
    node = rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", cid)
    return {k: v for k, v in node["props"].items() if k.startswith("attr_")}


def _seed_contact(rig):
    feed(rig, "cdc.crm.contacts", envelope(after=contact(), schema=CONTACT_SCHEMA))
    rig["writer"].flush_all()


def _attr_event(name, value, op="c", **kw):
    row = {"contact_id": 1, "attr_name": name, "attr_value": value,
           "tenant_id": "tenant-alpha"}
    if op == "d":
        return envelope(before=row, op="d", **kw)
    return envelope(after=row, op=op, **kw)


# --- bug 1: upsert wrote the name raw, delete sanitised it -------------------

def test_dirty_attr_name_delete_removes_the_property_it_wrote(rig):
    """The upsert and delete paths must agree on the property name.

    Upsert passes the key as a $batch parameter (any string is legal); delete
    must embed it literally because Cypher cannot parameterise a property key,
    so it is sanitised. If only one side sanitises, 'risk-score' is written as
    attr_risk-score and deleted as attr_risk_score -- the delete matches nothing
    and the value survives in the graph forever, silently.
    """
    for name in DIRTY:
        _seed_contact(rig)
        feed(rig, "cdc.crm.contact_attributes", _attr_event(name, "720"))
        rig["writer"].flush_all()
        assert _attrs(rig), f"nothing written for {name!r}"

        feed(rig, "cdc.crm.contact_attributes", _attr_event(name, "720", op="d"))
        rig["writer"].flush_all()
        assert _attrs(rig) == {}, (
            f"stale property survived delete for attr_name={name!r}: {_attrs(rig)}"
        )


def test_dirty_attr_name_round_trips_to_a_legal_property_key(rig):
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes", _attr_event("risk-score", "720"))
    rig["writer"].flush_all()
    assert "attr_risk_score" in _attrs(rig)
    assert "attr_risk-score" not in _attrs(rig)


def test_names_that_sanitise_alike_collapse_deterministically(rig):
    """'a-b' and 'a.b' are the same Neo4j property, so they must share a
    collapse key -- otherwise two buffer entries race for one property and the
    winner is non-deterministic."""
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes", _attr_event("a-b", "first"))
    feed(rig, "cdc.crm.contact_attributes", _attr_event("a.b", "second"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_a_b": "second"}       # last write wins, in Kafka order

    feed(rig, "cdc.crm.contact_attributes", _attr_event("a-b", "first", op="d"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {}


# --- bug 2: renaming attr_name orphaned the old property ---------------------

def test_attr_rename_removes_the_old_property(rig):
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes", _attr_event("colour", "red"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_colour": "red"}

    feed(rig, "cdc.crm.contact_attributes",
         envelope(before={"contact_id": 1, "attr_name": "colour",
                          "attr_value": "red", "tenant_id": "tenant-alpha"},
                  after={"contact_id": 1, "attr_name": "shade",
                         "attr_value": "red", "tenant_id": "tenant-alpha"}, op="u"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_shade": "red"}, (
        f"rename orphaned the old property: {_attrs(rig)}"
    )


def test_attr_rename_within_one_flush_window(rig):
    """Rename with no flush between: the removal and the upsert have different
    collapse keys, so both must survive collapse."""
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes", _attr_event("colour", "red"))
    feed(rig, "cdc.crm.contact_attributes",
         envelope(before={"contact_id": 1, "attr_name": "colour",
                          "attr_value": "red", "tenant_id": "tenant-alpha"},
                  after={"contact_id": 1, "attr_name": "shade",
                         "attr_value": "blue", "tenant_id": "tenant-alpha"}, op="u"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_shade": "blue"}


def test_value_only_update_emits_no_companion(rig):
    """attr_name unchanged -> nothing to remove. A spurious companion would
    delete the property the same flush just wrote."""
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes", _attr_event("colour", "red"))
    rig["writer"].flush_all()
    feed(rig, "cdc.crm.contact_attributes",
         envelope(before={"contact_id": 1, "attr_name": "colour",
                          "attr_value": "red", "tenant_id": "tenant-alpha"},
                  after={"contact_id": 1, "attr_name": "colour",
                         "attr_value": "blue", "tenant_id": "tenant-alpha"}, op="u"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_colour": "blue"}


def test_rename_that_sanitises_to_the_same_key_emits_no_companion(rig):
    """'a-b' -> 'a.b' is the same property. Removing the old name would delete
    the value the upsert just wrote."""
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes", _attr_event("a-b", "red"))
    rig["writer"].flush_all()
    feed(rig, "cdc.crm.contact_attributes",
         envelope(before={"contact_id": 1, "attr_name": "a-b",
                          "attr_value": "red", "tenant_id": "tenant-alpha"},
                  after={"contact_id": 1, "attr_name": "a.b",
                         "attr_value": "blue", "tenant_id": "tenant-alpha"}, op="u"))
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_a_b": "blue"}


def test_rename_does_not_double_release_the_offset(rig):
    """The companion carries offset=None. If it claimed the same offset, the
    buffer would release it twice and the watermark could pass an unflushed
    event."""
    _seed_contact(rig)
    feed(rig, "cdc.crm.contact_attributes",
         envelope(before={"contact_id": 1, "attr_name": "colour",
                          "attr_value": "red", "tenant_id": "tenant-alpha"},
                  after={"contact_id": 1, "attr_name": "shade",
                         "attr_value": "red", "tenant_id": "tenant-alpha"}, op="u"),
         partition=0, offset=41)
    rig["writer"].flush_all()
    assert _attrs(rig) == {"attr_shade": "red"}
