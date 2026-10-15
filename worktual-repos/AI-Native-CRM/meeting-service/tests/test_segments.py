from app.models import Meeting, TranscriptSegment
from app.services.crypto import redact_meeting_url
from app.services.segments import upsert_segments
from tests.conftest import insert_meeting


def test_redact_zoom_pwd():
    out = redact_meeting_url("https://zoom.us/j/1?pwd=secret&foo=1")
    assert "pwd=" not in out
    assert "foo=1" in out


def test_segment_upsert_unique(client):
    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    meeting = db.get(Meeting, m.id)
    upsert_segments(
        db,
        meeting,
        [
            {"segment_id": "s1", "speaker": "", "text": "hello", "start": 0, "end": 1, "completed": True},
            {"segment_id": "s1", "speaker": "Jane", "text": "hello world", "start": 0, "end": 1, "completed": True},
        ],
    )
    n = db.query(TranscriptSegment).filter_by(meeting_id=m.id).count()
    db.close()
    assert n == 1


def test_segment_upsert_skips_unchanged_publish(client, monkeypatch):
    published: list = []
    monkeypatch.setattr("app.services.segments.live_bus.publish", lambda *a, **k: published.append(a))
    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    meeting = db.get(Meeting, m.id)
    payload = [
        {"segment_id": "s1", "speaker": "Jane", "text": "hello", "start": 0.0, "end": 1.0, "completed": True}
    ]
    upsert_segments(db, meeting, payload)
    meeting = db.get(Meeting, m.id)
    upsert_segments(db, meeting, payload)
    db.close()
    assert len(published) == 1


def test_skip_vexa_ch_segments_when_live_pcm(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "live_pcm_enabled", True)
    published: list = []
    monkeypatch.setattr("app.services.segments.live_bus.publish", lambda *a, **k: published.append(a))
    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    meeting = db.get(Meeting, m.id)
    upsert_segments(
        db,
        meeting,
        [
            {
                "segment_id": "ch-0:1:999",
                "speaker": "Guest",
                "text": "legacy vexa",
                "start": 0.0,
                "end": 1.0,
                "completed": True,
            },
            {
                "segment_id": "pcm-final-1",
                "speaker": "Guest",
                "text": "pcm path",
                "start": 1.0,
                "end": 2.0,
                "completed": True,
                "latency": {"marks": []},
            },
        ],
    )
    n = db.query(TranscriptSegment).filter_by(meeting_id=m.id).count()
    db.close()
    assert n == 1
    assert len(published) == 1
    assert published[0][1]["segment_id"] == "pcm-final-1"


def test_segment_draft_then_final_publishes_twice(client, monkeypatch):
    published: list = []
    monkeypatch.setattr("app.services.segments.live_bus.publish", lambda *a, **k: published.append(a))
    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    meeting = db.get(Meeting, m.id)
    upsert_segments(
        db,
        meeting,
        [{"segment_id": "s1", "speaker": "", "text": "hello", "start": 0.0, "end": 1.0, "completed": False}],
    )
    meeting = db.get(Meeting, m.id)
    upsert_segments(
        db,
        meeting,
        [{"segment_id": "s1", "speaker": "Jane", "text": "hello", "start": 0.0, "end": 1.0, "completed": True}],
    )
    db.close()
    assert len(published) == 2
