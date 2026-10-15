from app.config import settings
from app.services import vexa


def test_create_bot_is_transcript_only(monkeypatch):
    captured: dict = {}

    class FakeResp:
        status_code = 201

        def json(self):
            return {"id": "vexa-1"}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return None

        def post(self, path, json=None):
            captured["path"] = path
            captured["json"] = json
            return FakeResp()

    monkeypatch.setattr(vexa, "_client", lambda: FakeClient())
    settings.vexa_recording_enabled = False
    out = vexa.create_bot(
        meeting_url="https://meet.google.com/abc-defg-hij",
        bot_name="Worktual Notetaker",
        platform="google_meet",
        native_meeting_id="abc-defg-hij",
        passcode=None,
        metadata={"meeting_id": "m1"},
    )
    assert out["id"] == "vexa-1"
    assert captured["json"]["transcribe_enabled"] is False
    assert captured["json"]["recording_enabled"] is False
    # Hours, not a short quiet-window — silence must not eject the notetaker.
    assert captured["json"]["automatic_leave"]["max_time_left_alone"] >= 60 * 60 * 1000


def test_create_bot_requires_live_pcm():
    settings.live_pcm_enabled = False
    try:
        try:
            vexa.create_bot(
                meeting_url="https://meet.google.com/abc-defg-hij",
                bot_name="Worktual Notetaker",
                platform="google_meet",
                native_meeting_id="abc-defg-hij",
                passcode=None,
                metadata={},
            )
            raise AssertionError("expected VexaError")
        except vexa.VexaError as exc:
            assert exc.error_code == "live_pcm_disabled"
    finally:
        settings.live_pcm_enabled = True


def test_create_bot_recording_opt_in(monkeypatch):
    captured: dict = {}

    class FakeResp:
        status_code = 201

        def json(self):
            return {"id": "vexa-1"}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return None

        def post(self, path, json=None):
            captured["json"] = json
            return FakeResp()

    monkeypatch.setattr(vexa, "_client", lambda: FakeClient())
    vexa.create_bot(
        meeting_url="https://meet.google.com/abc-defg-hij",
        bot_name="Worktual Notetaker",
        platform="google_meet",
        native_meeting_id="abc-defg-hij",
        passcode=None,
        metadata={"meeting_id": "m1"},
        recording_enabled=True,
    )
    assert captured["json"]["recording_enabled"] is True


def test_create_bot_409_already_active(monkeypatch):
    class FakeResp:
        status_code = 409
        text = "bot already active"

        def json(self):
            return {}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return None

        def post(self, path, json=None):
            return FakeResp()

    monkeypatch.setattr(vexa, "_client", lambda: FakeClient())
    try:
        vexa.create_bot(
            meeting_url="https://meet.google.com/abc-defg-hij",
            bot_name="Worktual Notetaker",
            platform="google_meet",
            native_meeting_id="abc-defg-hij",
            passcode=None,
            metadata={"meeting_id": "m1"},
        )
        assert False, "expected VexaError"
    except vexa.VexaError as exc:
        assert exc.status_code == 409
        assert "already active" in str(exc).lower()
