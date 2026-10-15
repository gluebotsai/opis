from datetime import datetime, timedelta, timezone

from app.models import Meeting
from app.services.meeting_end import (
    scheduled_slot_ended,
    should_finalize_active_meeting,
    snapshot_host_ended,
    vexa_snapshot_status,
)


def test_vexa_snapshot_status_nested():
    assert vexa_snapshot_status({"status": "completed"}) == "completed"
    assert vexa_snapshot_status({"meeting": {"status": "stopped"}}) == "stopped"


def test_snapshot_host_ended_flags():
    assert snapshot_host_ended({"end_time": "2026-09-16T17:40:00Z"}) is True
    assert snapshot_host_ended({"meeting_ended": True}) is True
    assert snapshot_host_ended({"participants": [{"name": "Worktual Notetaker", "is_bot": True}]}) is True
    assert snapshot_host_ended({"participants": [{"name": "Jane"}]}) is False
    assert snapshot_host_ended(
        {
            "status": "active",
            "data": {"teardown_confirmed": True, "status_transition": {"to": "completed"}},
        }
    ) is True
    assert snapshot_host_ended({"status": "active", "data": {"end_time": "2026-09-16T17:40:00Z"}}) is True


def test_scheduled_slot_ended(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_grace_sec", 60)
    end = datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc)
    m = Meeting(
        id="m1",
        org_id="1",
        entity_type="contact",
        entity_id="c1",
        meeting_url="https://meet.google.com/x",
        platform="google_meet",
        native_meeting_id="x",
        status="active",
        expected_end_at=end,
    )
    assert scheduled_slot_ended(m, now=end + timedelta(seconds=30)) is False
    assert scheduled_slot_ended(m, now=end + timedelta(seconds=120)) is True


def test_should_not_finalize_on_slot_when_disabled(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.finalize_on_scheduled_slot_end", False)
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_grace_sec", 60)
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 0)
    end = datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc)
    m = Meeting(
        id="m2",
        org_id="1",
        entity_type="contact",
        entity_id="c1",
        meeting_url="https://meet.google.com/x",
        platform="google_meet",
        native_meeting_id="x",
        status="active",
        expected_end_at=end,
    )
    ok, _ = should_finalize_active_meeting(m, {"participants": [{"name": "Jane"}]})
    assert ok is False


def test_should_finalize_on_terminal_status():
    m = Meeting(
        id="m1",
        org_id="1",
        entity_type="contact",
        entity_id="c1",
        meeting_url="https://meet.google.com/x",
        platform="google_meet",
        native_meeting_id="x",
        status="active",
    )
    ok, reason = should_finalize_active_meeting(m, {"status": "completed"})
    assert ok is True
    assert "vexa_status" in reason


def _active_meeting(**kwargs) -> Meeting:
    base = dict(
        id="m-silence",
        org_id="1",
        entity_type="contact",
        entity_id="c1",
        meeting_url="https://meet.google.com/x",
        platform="google_meet",
        native_meeting_id="x",
        status="active",
    )
    base.update(kwargs)
    return Meeting(**base)


def test_should_finalize_on_last_speech_silence(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 15)
    monkeypatch.setattr("app.services.meeting_end.settings.finalize_on_scheduled_slot_end", False)
    last = datetime(2026, 9, 16, 18, 45, 59, tzinfo=timezone.utc)
    now = last + timedelta(seconds=16)
    snap = {
        "status": "active",
        "end_time": None,
        "segments": [
            {
                "text": "Thank you",
                "completed": True,
                "absolute_end_time": "2026-09-16T18:45:59.099000Z",
            }
        ],
    }
    ok, reason = should_finalize_active_meeting(_active_meeting(), snap, now=now)
    assert ok is True
    assert reason == "host_ended_silence"
    still_live, _ = should_finalize_active_meeting(
        _active_meeting(), snap, now=last + timedelta(seconds=10)
    )
    assert still_live is False


def test_should_not_finalize_while_segment_in_progress(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 90)
    last = datetime(2026, 9, 16, 18, 45, 59, tzinfo=timezone.utc)
    snap = {
        "status": "active",
        "segments": [
            {
                "text": "Thank you",
                "completed": True,
                "absolute_end_time": "2026-09-16T18:45:59.099000Z",
            },
            {"text": "hold on", "completed": False, "absolute_end_time": "2026-09-16T18:47:40Z"},
        ],
    }
    ok, _ = should_finalize_active_meeting(
        _active_meeting(), snap, now=last + timedelta(seconds=120)
    )
    assert ok is False


def test_should_not_finalize_silence_from_admitted_at_when_no_segments(monkeypatch):
    """Empty first minutes after admit must not eject the notetaker."""
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 15)
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_alone_grace_sec", 90)
    admitted = datetime(2026, 9, 16, 18, 45, 0, tzinfo=timezone.utc)
    m = _active_meeting(admitted_at=admitted)
    ok, reason = should_finalize_active_meeting(
        m, {"status": "active", "segments": []}, now=admitted + timedelta(seconds=16)
    )
    assert ok is False
    assert reason == ""


def test_should_not_finalize_bot_alone_before_grace(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 0)
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_alone_grace_sec", 90)
    monkeypatch.setattr("app.services.meeting_end.settings.finalize_on_bot_alone", True)
    admitted = datetime(2026, 9, 16, 18, 45, 0, tzinfo=timezone.utc)
    m = _active_meeting(admitted_at=admitted)
    alone = {"status": "active", "participants": [{"name": "Worktual Notetaker", "is_bot": True}]}
    early, _ = should_finalize_active_meeting(m, alone, now=admitted + timedelta(seconds=10))
    assert early is False
    late, reason = should_finalize_active_meeting(m, alone, now=admitted + timedelta(seconds=91))
    assert late is True
    assert reason == "snapshot_bot_alone"


def test_bot_alone_finalize_disabled_by_default(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 0)
    monkeypatch.setattr("app.services.meeting_end.settings.finalize_on_bot_alone", False)
    admitted = datetime(2026, 9, 16, 18, 45, 0, tzinfo=timezone.utc)
    m = _active_meeting(admitted_at=admitted)
    alone = {"status": "active", "participants": [{"name": "Worktual Notetaker", "is_bot": True}]}
    ok, reason = should_finalize_active_meeting(m, alone, now=admitted + timedelta(hours=2))
    assert ok is False
    assert reason == ""


def test_should_finalize_when_vexa_bot_gone(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 0)
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_alone_grace_sec", 0)
    m = _active_meeting(
        admitted_at=datetime(2026, 9, 16, 18, 45, 0, tzinfo=timezone.utc),
    )
    ok, reason = should_finalize_active_meeting(
        m,
        {"status": "active", "segments": [{"text": "Hi", "completed": True}]},
        vexa_bot_running=False,
    )
    assert ok is True
    assert reason == "vexa_bot_gone"
    still, _ = should_finalize_active_meeting(
        m,
        {"status": "active", "segments": []},
        vexa_bot_running=True,
    )
    assert still is False


def test_silence_disabled(monkeypatch):
    monkeypatch.setattr("app.services.meeting_end.settings.host_ended_silence_sec", 0)
    last = datetime(2026, 9, 16, 18, 45, 59, tzinfo=timezone.utc)
    snap = {
        "status": "active",
        "segments": [{"completed": True, "absolute_end_time": "2026-09-16T18:45:59Z"}],
    }
    ok, _ = should_finalize_active_meeting(
        _active_meeting(), snap, now=last + timedelta(seconds=600)
    )
    assert ok is False
