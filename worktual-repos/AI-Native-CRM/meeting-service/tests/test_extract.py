import uuid

from app.config import settings
from app.models import Meeting, TranscriptSegment
from app.services.jobs import enqueue
from app.services.llm import LlmError
from app.worker import handle_extract
from tests.conftest import insert_meeting


def test_llm_invalid_keeps_transcript(client, monkeypatch):
    settings.extract_max_attempts = 1
    session = client.extra["Session"]()
    m = insert_meeting(
        client.extra["Session"],
        entity_type="team",
        entity_id="T-12",
        native_meeting_id="zzz-yyyy-xxx",
        status="processing",
    )
    session.add(
        TranscriptSegment(
            meeting_id=m.id,
            segment_id="s1",
            speaker="Jane",
            text="Let's lock pricing",
            t0=1.0,
            t1=2.0,
            completed=1,
            raw_json={},
        )
    )
    session.commit()
    job = enqueue(session, "extract", m.id)
    job.attempts = 1
    session.commit()
    monkeypatch.setattr(
        "app.worker.extract_meeting",
        lambda *a, **k: (_ for _ in ()).throw(LlmError("bad json")),
    )
    handle_extract(session, job)
    updated = session.get(Meeting, m.id)
    segs = session.query(TranscriptSegment).filter_by(meeting_id=m.id).count()
    session.close()
    assert updated is not None
    assert updated.status == "completed_partial"
    assert updated.error_code == "llm_failed"
    assert segs == 1


def test_empty_transcript_completed_partial(client):
    session = client.extra["Session"]()
    m = insert_meeting(
        client.extra["Session"],
        native_meeting_id=str(uuid.uuid4())[:12],
        status="processing",
    )
    job = enqueue(session, "extract", m.id)
    session.commit()
    handle_extract(session, job)
    updated = session.get(Meeting, m.id)
    session.close()
    assert updated is not None
    assert updated.status == "completed_partial"
    assert updated.error_code == "no_audio"
