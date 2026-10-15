from datetime import timedelta

from app.constants import utcnow
from app.models import Meeting, TranscriptSegment
from app.services.live_bus import poll_local, publish
from app.services.status import lobby_timed_out
from app.worker import sweep_lobby
from tests.conftest import auth_header, insert_meeting, token_str


def test_live_bus_memory_fanout():
    publish("m1", {"type": "segment", "text": "hi", "completed": True})
    items, cursor = poll_local("m1", 0)
    assert items[0]["type"] == "segment"
    assert cursor >= 1


def test_live_ws_snapshot_org_scoped(client):
    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    db.add(
        TranscriptSegment(
            meeting_id=m.id,
            segment_id="s1",
            speaker="Jane Liu",
            text="Let's lock pricing by July 1.",
            t0=12.4,
            t1=15.1,
            completed=1,
            raw_json={},
        )
    )
    db.commit()
    db.close()
    with client.websocket_connect(f"/v1/meetings/{m.id}/live?token={token_str('org-a')}") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert snap["segments"][0]["speaker"] == "Jane Liu"
        assert snap["segments"][0]["completed"] is True


def test_live_ws_wrong_org(client):
    m = insert_meeting(client.extra["Session"])
    try:
        with client.websocket_connect(f"/v1/meetings/{m.id}/live?token={token_str('org-b')}") as ws:
            ws.receive_json()
            raise AssertionError("expected close")
    except Exception:
        pass


def test_lobby_timeout_not_admitted(client, monkeypatch):
    past = utcnow() - timedelta(seconds=200)
    m = insert_meeting(
        client.extra["Session"],
        status="awaiting_admission",
        native_meeting_id="lobby-xxxx-yyy",
        created_at=past,
        updated_at=past,
    )
    assert lobby_timed_out(m, 180, utcnow()) is True
    stopped: list[bool] = []
    monkeypatch.setattr("app.worker.vexa.stop_bot", lambda *a, **k: stopped.append(True))
    db = client.extra["Session"]()
    sweep_lobby(db)
    row = db.get(Meeting, m.id)
    db.close()
    got = client.get(f"/v1/meetings/{m.id}", headers=auth_header())
    assert got.json()["error_code"] == "not_admitted"
    assert got.json()["status"] == "failed"
    assert stopped
    assert row is not None


def test_lobby_waits_until_expected_end(client):
    now = utcnow()
    past = now - timedelta(seconds=200)
    future_end = now + timedelta(minutes=20)
    m = insert_meeting(
        client.extra["Session"],
        status="awaiting_admission",
        native_meeting_id="lobby-slot-zzzz-yyyy",
        created_at=past,
        updated_at=past,
        expected_end_at=future_end,
    )
    assert lobby_timed_out(m, 180, now) is False
    assert lobby_timed_out(m, 180, future_end + timedelta(seconds=1)) is True
