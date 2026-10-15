"""Consumer loop tests.

Covers the two behaviours that only exist at this layer: control-topic messages
are handled before data messages in the same poll batch, and offsets are never
committed past data that Neo4j has not accepted.
"""

import json

import pytest

from src.consumer import Consumer
from src.metrics import Metrics
from src.quarantine import Quarantine
from src.registry import Registry
from src.router import Router
from src.writer import Writer
from tests.fakes import FakePool, envelope, value_schema

SCHEMA = value_schema({"contact_id": "int64", "tenant_id": "string"})


class FakeMessage:
    def __init__(self, topic, value, partition=0, offset=0):
        self._t, self._v, self._p, self._o = topic, json.dumps(value), partition, offset

    def topic(self):
        return self._t

    def value(self):
        return self._v.encode()

    def partition(self):
        return self._p

    def offset(self):
        return self._o

    def error(self):
        return None


class FakeKafka:
    def __init__(self):
        self.committed = []

    def commit(self, offsets=None, asynchronous=False):
        self.committed.append([(t.topic, t.partition, t.offset) for t in offsets])

    def assignment(self):
        return []

    def close(self):
        pass


class RecordingProvisioner:
    def __init__(self, loader):
        self.loader = loader
        self.provisioned = []

    def ensure_database(self, name, instance=None):
        self.provisioned.append(name)

    def ensure_constraints(self, database, instance=None):
        return []


@pytest.fixture
def rig(loader):
    registry = Registry("org", loader.section("control_plane"), "instance-1")
    pool = FakePool()
    metrics = Metrics()
    router = Router(loader, registry, "cdc",
                    loader.section("control_plane")["organisations_table"], metrics)
    writer = Writer(pool, loader, loader.connections, metrics)
    prov = RecordingProvisioner(loader)
    c = Consumer(loader, registry, router, writer, prov, Quarantine("/tmp/qtest"),
                 metrics, pg_conn_factory=None)
    c._consumer = FakeKafka()
    return {"consumer": c, "registry": registry, "writer": writer, "pool": pool,
            "prov": prov, "metrics": metrics}


def contact(tenant="tenant-alpha", cid=1):
    return {"contact_id": cid, "tenant_id": tenant, "email": "a@b.c", "status": "x",
            "account_id": None}


def org_row(org_id="a1b2c3d4", tenant="tenant-alpha", status="active"):
    return {"organization_id": org_id, "tenant_id": tenant, "status": status}


# --- control-first ordering ------------------------------------------------

def test_control_message_is_handled_before_data_in_the_same_batch(rig):
    """A brand-new organisation and its first data event can arrive in one poll.
    If data were handled first it would be quarantined as unprovisioned."""
    batch = [
        FakeMessage("cdc.crm.contacts", envelope(after=contact(), schema=SCHEMA),
                    offset=1),
        FakeMessage("cdc.accounts.organisations", envelope(after=org_row()), offset=0),
    ]
    rig["consumer"]._handle_batch(batch)          # data listed FIRST on purpose
    rig["writer"].flush_all()
    assert rig["prov"].provisioned == ["orga1b2c3d4"]
    assert rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", 1)


def test_data_before_provisioning_is_quarantined_not_written(rig, tmp_path):
    rig["consumer"].quarantine = Quarantine(tmp_path)
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.crm.contacts", envelope(after=contact(), schema=SCHEMA))])
    rig["writer"].flush_all()
    assert rig["pool"].log == []
    assert len(rig["consumer"].quarantine.read_date(
        sorted(p.stem for p in tmp_path.glob("*.jsonl"))[0])) == 1


def test_inactive_status_change_stops_writes(rig):
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.accounts.organisations", envelope(after=org_row()))])
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.accounts.organisations",
                    envelope(before=org_row(), after=org_row(status="suspended"), op="u"))])
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.crm.contacts", envelope(after=contact(), schema=SCHEMA))])
    rig["writer"].flush_all()
    assert rig["pool"].log == []


# --- offsets ---------------------------------------------------------------

def test_offsets_are_not_committed_past_unflushed_data(rig):
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.accounts.organisations", envelope(after=org_row()), offset=0)])
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.crm.contacts", envelope(after=contact(cid=i), schema=SCHEMA),
                    offset=i) for i in range(1, 4)])
    rig["consumer"]._commit()                     # nothing flushed yet
    committed = dict(((t, p), o) for t, p, o in rig["consumer"]._consumer.committed[-1])
    assert committed[("cdc.crm.contacts", 0)] == 1     # held at the lowest unwritten

    rig["writer"].flush_all()
    rig["consumer"]._commit()
    committed = dict(((t, p), o) for t, p, o in rig["consumer"]._consumer.committed[-1])
    assert committed[("cdc.crm.contacts", 0)] == 4     # next offset to consume


def test_quarantined_events_do_not_stall_the_commit(rig, tmp_path):
    rig["consumer"].quarantine = Quarantine(tmp_path)
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.crm.contacts",
                    envelope(after=contact("tenant-ghost"), schema=SCHEMA), offset=o)
        for o in range(3)])
    rig["consumer"]._commit()
    committed = dict(((t, p), o) for t, p, o in rig["consumer"]._consumer.committed[-1])
    assert committed[("cdc.crm.contacts", 0)] == 3


def test_undecodable_message_is_quarantined_not_fatal(rig, tmp_path):
    rig["consumer"].quarantine = Quarantine(tmp_path)

    class Broken(FakeMessage):
        def value(self):
            return b"{not json"

    rig["consumer"]._handle_message(Broken("cdc.crm.contacts", {}))
    counters = rig["metrics"].snapshot()["counters"]
    assert any("undecodable_message" in k for k in counters)


def test_tombstone_is_ignored(rig):
    class Tombstone(FakeMessage):
        def value(self):
            return None

    rig["consumer"]._handle_message(Tombstone("cdc.crm.contacts", {}))
    assert rig["pool"].log == []


# --- shutdown --------------------------------------------------------------

def test_shutdown_drains_the_buffer_before_closing(rig):
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.accounts.organisations", envelope(after=org_row()), offset=0)])
    rig["consumer"]._handle_batch([
        FakeMessage("cdc.crm.contacts", envelope(after=contact(), schema=SCHEMA),
                    offset=1)])
    rig["consumer"].shutdown()
    assert rig["pool"].graph("orga1b2c3d4").find_node("Contact", "contact_id", 1)
    assert rig["writer"].offsets.pending_count() == 0


def test_subscribed_topics_include_control_and_every_mapped_table(rig, loader):
    tables = rig["consumer"]._subscribed_tables()
    assert "accounts.organisations" in tables
    assert "crm.contacts" in tables
    assert "ticketing.ticket_tags" in tables
