import time

import pytest

from src.router import RoutedEvent
from src.writer import OffsetTracker, Writer
from tests.fakes import FakePool


@pytest.fixture
def writer(loader):
    return Writer(FakePool(), loader, loader.connections)


def ev(key, op="upsert", table="crm.contacts", db="orga1b2c3d4", offset=0,
       partition=0, mode="node", props=None, collapse=None, attr=None):
    row = {"key": key, "props": props or {"email": f"{key}@x.com"}, "ts": 1}
    if op == "delete":
        row = {"key": key, "ts": 1}
    return RoutedEvent(database=db, instance="instance-1", table=table, op=op, mode=mode,
                       row=row, collapse_key=collapse or ("n", key), attr_name=attr,
                       topic=f"cdc.{table}", partition=partition, offset=offset)


# --- collapse (correction #5) ----------------------------------------------

def test_repeated_updates_to_one_key_collapse_to_the_last(writer):
    for i in range(5):
        writer.add(ev(1, offset=i, props={"email": f"v{i}"}))
    written = writer.flush_all()
    assert written == 1
    graph = writer.pool.graph("orga1b2c3d4")
    assert graph.nodes[("Contact", "contact_id", 1)]["props"]["email"] == "v4"


def test_distinct_keys_do_not_collapse(writer):
    for i in range(1, 4):
        writer.add(ev(i, offset=i))
    assert writer.flush_all() == 3


def test_delete_then_reinsert_within_one_window_keeps_the_row(writer):
    """The spec's (database, table, op) buffer key would apply the upsert first
    and the delete second, losing the row. Collapsing across operations fixes it."""
    writer.add(ev(1, op="delete", offset=0))
    writer.add(ev(1, op="upsert", offset=1))
    writer.flush_all()
    assert writer.pool.graph("orga1b2c3d4").find_node("Contact", "contact_id", 1) is not None


def test_insert_then_delete_within_one_window_removes_the_row(writer):
    writer.add(ev(1, op="upsert", offset=0))
    writer.add(ev(1, op="delete", offset=1))
    writer.flush_all()
    assert writer.pool.graph("orga1b2c3d4").find_node("Contact", "contact_id", 1) is None


def test_properties_on_attributes_do_not_collapse_into_each_other(writer):
    """Collapsing by target_key alone would drop every attribute but the last."""
    for attr, val in (("colour", "red"), ("size", "XL"), ("fit", "slim")):
        writer.add(RoutedEvent(
            database="orga1b2c3d4", instance="instance-1",
            table="crm.contact_attributes", op="upsert", mode="properties_on",
            row={"target_key": 1, "props": {f"attr_{attr}": val}},
            collapse_key=("p", 1, attr), attr_name=attr,
            topic="cdc.crm.contact_attributes", partition=0, offset=0))
    assert writer.flush_all() == 3
    props = writer.pool.graph("orga1b2c3d4").nodes[("Contact", "contact_id", 1)]["props"]
    assert props["attr_colour"] == "red"
    assert props["attr_size"] == "XL"
    assert props["attr_fit"] == "slim"


# --- flush ordering --------------------------------------------------------

def test_upserts_are_applied_before_deletes(writer):
    writer.add(ev(1, op="upsert", offset=0))
    writer.add(ev(2, op="delete", offset=1))
    writer.flush_all()
    calls = [c[1] for c in writer.pool.log]
    assert "DETACH DELETE" in calls[-1]
    assert "MERGE" in calls[0]


def test_relationship_rows_run_between_upserts_and_deletes(loader):
    w = Writer(FakePool(), loader, loader.connections)
    w.add(RoutedEvent(database="orga1b2c3d4", instance="instance-1",
                      table="ticketing.ticket_tags", op="upsert", mode="relationship_only",
                      row={"from_key": 1, "to_key": 2}, collapse_key=("r", 1, 2, "TAGGED"),
                      topic="t", partition=0, offset=0))
    w.flush_all()
    assert w.pool.graph("orga1b2c3d4").edge_count("TAGGED") == 1


# --- batching --------------------------------------------------------------

def test_one_transaction_per_buffer_key_not_per_event(writer):
    for i in range(500):
        writer.add(ev(i, offset=i))
    writer.flush_all()
    assert len(writer.pool.log) == 1                     # one tx.run for 500 rows
    assert len(writer.pool.log[0][2]) == 500


def test_relationship_batches_use_the_smaller_limit(writer):
    assert writer._limit_for("orga1b2c3d4", "ticketing.ticket_tags") == 5000
    assert writer._limit_for("orga1b2c3d4", "crm.contacts") == 10000


def test_size_threshold_triggers_a_flush(loader):
    cfg = dict(loader.connections)
    cfg["batching"] = {"node_batch_size": 10, "relationship_batch_size": 5,
                       "flush_interval_seconds": 3600}
    w = Writer(FakePool(), loader, cfg)
    for i in range(10):
        w.add(ev(i, offset=i))
    assert w.due() == [("orga1b2c3d4", "crm.contacts")]


def test_time_threshold_triggers_a_flush_for_low_traffic_tenants(loader):
    cfg = dict(loader.connections)
    cfg["batching"] = {"node_batch_size": 10000, "relationship_batch_size": 5000,
                       "flush_interval_seconds": 0}
    w = Writer(FakePool(), loader, cfg)
    w.add(ev(1, offset=0))
    time.sleep(0.01)
    assert w.due(), "a low-traffic tenant must not sit unwritten indefinitely"


# --- cypher caching --------------------------------------------------------

def test_cypher_is_generated_once_and_cached(writer):
    a = writer._cypher("orga1b2c3d4", "crm.contacts", "upsert")
    b = writer._cypher("orga1b2c3d4", "crm.contacts", "upsert")
    assert a is b
    assert len(writer._query_cache) == 1


def test_warm_cache_covers_every_table(writer):
    n = writer.warm_cache("orga1b2c3d4")
    assert n >= len(writer.loader.effective("orga1b2c3d4").tables)


# --- offset watermark (correction #4) --------------------------------------

def test_watermark_holds_at_the_lowest_unwritten_offset():
    t = OffsetTracker()
    for o in range(5):
        t.observe("topic", 0, o)
    t.hold("topic", 0, 2)
    t.hold("topic", 0, 4)
    # Offsets 0,1,3 are done; 2 is still buffered, so nothing past 2 may commit.
    assert t.commit_points()[("topic", 0)] == 2


def test_watermark_advances_past_the_high_water_mark_when_nothing_pends():
    t = OffsetTracker()
    for o in range(5):
        t.observe("topic", 0, o)
    assert t.commit_points()[("topic", 0)] == 5      # next offset to consume


def test_release_advances_the_watermark():
    t = OffsetTracker()
    for o in range(3):
        t.observe("topic", 0, o)
    t.hold("topic", 0, 1)
    assert t.commit_points()[("topic", 0)] == 1
    t.release([("topic", 0, 1)])
    assert t.commit_points()[("topic", 0)] == 3


def test_partitions_are_tracked_independently():
    t = OffsetTracker()
    t.observe("topic", 0, 10)
    t.observe("topic", 1, 20)
    t.hold("topic", 1, 20)
    points = t.commit_points()
    assert points[("topic", 0)] == 11
    assert points[("topic", 1)] == 20


def test_skipped_events_do_not_hold_the_watermark():
    """Quarantined and skipped events are durable immediately (or discarded), so
    they must never stall a partition."""
    t = OffsetTracker()
    t.observe("topic", 0, 0)      # skipped
    t.observe("topic", 0, 1)      # quarantined
    t.observe("topic", 0, 2)
    assert t.commit_points()[("topic", 0)] == 3


def test_flush_releases_the_offsets(writer):
    writer.add(ev(1, offset=0))
    writer.add(ev(2, offset=1))
    assert writer.offsets.pending_count() == 2
    writer.flush_all()
    assert writer.offsets.pending_count() == 0


def test_collapsed_events_still_release_every_offset(writer):
    """Five events collapse to one write, but all five offsets must be released
    or the watermark would stall forever behind a superseded event."""
    for i in range(5):
        writer.add(ev(1, offset=i))
    assert writer.offsets.pending_count() == 5
    writer.flush_all()
    assert writer.offsets.pending_count() == 0


def test_failed_flush_keeps_offsets_held(loader, monkeypatch):
    w = Writer(FakePool(), loader, loader.connections)
    w.add(ev(1, offset=0))
    monkeypatch.setattr(w, "_run", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("neo4j down")))
    with pytest.raises(RuntimeError):
        w.flush_all()
    assert w.offsets.pending_count() == 1
    assert w.offsets.commit_points()[("cdc.crm.contacts", 0)] == 0


# --- deadlock retry --------------------------------------------------------

def test_deadlock_is_retried_then_succeeds(loader):
    from neo4j.exceptions import TransientError

    class FlakySession:
        def __init__(self):
            self.attempts = 0

        def execute_write(self, fn):
            self.attempts += 1
            if self.attempts < 3:
                raise TransientError("deadlock detected")
            return None

    w = Writer(FakePool(), loader, loader.connections)
    w.backoff_base_ms = 0
    s = FlakySession()
    w._execute_with_retry(s, "UNWIND $batch AS e RETURN e", [{}], "orga1b2c3d4")
    assert s.attempts == 3


def test_deadlock_gives_up_after_max_attempts(loader):
    from neo4j.exceptions import TransientError

    class AlwaysDeadlocks:
        def execute_write(self, fn):
            raise TransientError("deadlock detected")

    w = Writer(FakePool(), loader, loader.connections)
    w.backoff_base_ms = 0
    w.max_attempts = 3
    with pytest.raises(TransientError):
        w._execute_with_retry(AlwaysDeadlocks(), "q", [{}], "orga1b2c3d4")
