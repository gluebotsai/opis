from tests.conftest import auth_header, insert_meeting


def test_org_isolation(client):
    m = insert_meeting(client.extra["Session"])
    r = client.get(f"/v1/meetings/{m.id}", headers=auth_header("org-b"))
    assert r.status_code == 404
    r = client.get(f"/v1/meetings/{m.id}", headers=auth_header("org-a"))
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    assert "error_code" in r.json()
    r = client.get(f"/v1/meetings/{m.id}/transcript", headers=auth_header("org-b"))
    assert r.status_code == 404


def test_org_from_token_not_body(client):
    body = {
        "organization_id": "wrong",
        "entity_type": "contact",
        "entity_id": "C-4412",
        "meeting_url": "https://meet.google.com/abc-defg-hij",
        "consent_captured": True,
    }
    r = client.post("/v1/meetings", json=body, headers=auth_header("org-a"))
    assert r.status_code == 201
    assert r.json()["organization_id"] == "org-a"


def test_idempotency_same_key_one_bot(client):
    body = {
        "organization_id": "org-a",
        "entity_type": "deal",
        "entity_id": "D-8891",
        "meeting_url": "https://meet.google.com/abc-defg-hij",
        "consent_captured": True,
    }
    headers = {**auth_header("org-a"), "Idempotency-Key": "act-1"}
    r1 = client.post("/v1/meetings", json=body, headers=headers)
    r2 = client.post("/v1/meetings", json=body, headers=headers)
    assert r1.status_code in (200, 201)
    assert r2.json()["id"] == r1.json()["id"]


def test_inflight_native_id_lock(client):
    body = {
        "entity_type": "team",
        "entity_id": "T-12",
        "meeting_url": "https://meet.google.com/aaa-bbbb-ccc",
        "consent_captured": True,
    }
    r1 = client.post("/v1/meetings", json=body, headers={**auth_header("org-a"), "Idempotency-Key": "k1"})
    r2 = client.post("/v1/meetings", json=body, headers={**auth_header("org-a"), "Idempotency-Key": "k2"})
    assert r1.json()["id"] == r2.json()["id"]


def test_consent_required(client):
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://meet.google.com/abc-defg-hij",
            "consent_captured": False,
        },
        headers=auth_header(),
    )
    assert r.status_code == 422


def test_invalid_url_422(client):
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://example.com/nope",
            "consent_captured": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 422


def test_capacity_429(client):
    from app.config import settings

    settings.max_queued_meetings = 0
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://meet.google.com/abc-defg-hij",
            "consent_captured": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_bot_cap_queues_instead_of_429(client):
    from app.config import settings

    insert_meeting(
        client.extra["Session"],
        status="active",
        native_meeting_id="live-xxxx-yyy",
    )
    settings.max_concurrent_meetings = 1
    settings.max_concurrent_per_org = 1
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-2",
            "meeting_url": "https://meet.google.com/zzz-zzzz-zzz",
            "consent_captured": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 201
    assert r.json()["status"] == "requested"


def test_spawn_due_starts_queued(client):
    from app.models import Meeting
    from app.worker import spawn_due

    m = insert_meeting(
        client.extra["Session"],
        status="requested",
        native_meeting_id="q-xxxx-yyy",
    )
    db = client.extra["Session"]()
    spawn_due(db)
    row = db.get(Meeting, m.id)
    db.close()
    assert row is not None
    assert row.status == "joining"


def test_capacity_snapshot(client):
    r = client.get("/v1/meetings/capacity", headers=auth_header())
    assert r.status_code == 200
    body = r.json()
    assert "bots_live" in body
    assert "bots_max" in body
    assert "queued" in body


def test_processing_does_not_consume_bot_slot(client):
    from app.config import settings

    insert_meeting(
        client.extra["Session"],
        status="processing",
        native_meeting_id="old-xxxx-yyy",
    )
    settings.max_concurrent_meetings = 1
    settings.max_concurrent_per_org = 1
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://meet.google.com/zzz-zzzz-zzz",
            "consent_captured": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 201


def test_missing_write_scope(client):
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://meet.google.com/abc-defg-hij",
            "consent_captured": True,
        },
        headers=auth_header(scopes=[]),
    )
    assert r.status_code == 403


def test_zoom_passcode_redacted_on_get(client):
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://zoom.us/j/81234567890?pwd=secret",
            "consent_captured": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 201
    assert "pwd=" not in r.json()["meeting_url"]


def test_list_by_entity(client):
    insert_meeting(client.extra["Session"], entity_type="contact", entity_id="C-4412", native_meeting_id="xxx-yyyy-zzz")
    rows = client.get("/v1/meetings?entity_type=contact&entity_id=C-4412", headers=auth_header())
    assert rows.status_code == 200
    assert any(x["entity_id"] == "C-4412" for x in rows.json())


def test_healthz(client):
    assert client.get("/healthz").status_code == 200


def test_recording_disabled_by_default(client, monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(
        "app.services.vexa.create_bot",
        lambda **kwargs: seen.update(kwargs) or {"id": "vexa-1"},
    )
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://meet.google.com/aaa-bbbb-ccc",
            "consent_captured": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 201
    assert r.json()["recording_enabled"] is False
    assert seen["recording_enabled"] is False


def test_recording_enabled_opt_in(client, monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(
        "app.services.vexa.create_bot",
        lambda **kwargs: seen.update(kwargs) or {"id": "vexa-1"},
    )
    r = client.post(
        "/v1/meetings",
        json={
            "entity_type": "contact",
            "entity_id": "C-1",
            "meeting_url": "https://meet.google.com/rec-ordi-nga",
            "consent_captured": True,
            "recording_enabled": True,
        },
        headers=auth_header(),
    )
    assert r.status_code == 201
    assert r.json()["recording_enabled"] is True
    assert seen["recording_enabled"] is True


def test_spawn_reuses_vexa_409(client, monkeypatch):
    from app.api.meetings import spawn_bot
    from app.models import Meeting
    from app.services import vexa as vexa_mod

    body = {
        "entity_type": "contact",
        "entity_id": "C-1",
        "meeting_url": "https://meet.google.com/dup-meet-code",
        "consent_captured": True,
    }
    r1 = client.post("/v1/meetings", json=body, headers={**auth_header(), "Idempotency-Key": "a"})
    assert r1.status_code == 201
    assert r1.json()["status"] != "failed"

    # Same native id already inflight → returns existing (no second spawn).
    r2 = client.post("/v1/meetings", json=body, headers={**auth_header(), "Idempotency-Key": "b"})
    assert r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"]
    assert r2.json()["status"] != "failed"

    # Concurrent create_bot 409 must reuse, not mark failed.
    Session = client.extra["Session"]
    db = Session()
    m = db.get(Meeting, r1.json()["id"])
    assert m is not None
    m.status = "requested"
    m.error_code = None
    m.error_message = None
    db.commit()

    monkeypatch.setattr(
        "app.services.vexa.create_bot",
        lambda **kwargs: (_ for _ in ()).throw(
            vexa_mod.VexaError("capacity", "bot already active on this meeting", 409)
        ),
    )
    monkeypatch.setattr("app.services.vexa.running_keys", lambda: set())
    spawn_bot(db, m)
    db.refresh(m)
    assert m.status == "joining"
    assert m.error_code is None
    db.close()


def test_transcript_include_partial(client):
    from app.models import TranscriptSegment

    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    db.add(
        TranscriptSegment(
            meeting_id=m.id,
            segment_id="draft-1",
            speaker="Customer",
            text="what about",
            t0=0,
            t1=1,
            completed=0,
            raw_json={},
        )
    )
    db.commit()
    db.close()
    final = client.get(
        f"/v1/meetings/{m.id}/transcript",
        headers=auth_header(),
    )
    assert final.status_code == 200
    assert final.json() == []
    partial = client.get(
        f"/v1/meetings/{m.id}/transcript?include_partial=true",
        headers=auth_header(),
    )
    assert partial.status_code == 200
    rows = partial.json()
    assert len(rows) == 1
    assert rows[0]["completed"] is False
    assert rows[0]["text"] == "what about"


def test_transcript_includes_speaker_key(client):
    from app.models import TranscriptSegment

    m = insert_meeting(client.extra["Session"])
    db = client.extra["Session"]()
    db.add(
        TranscriptSegment(
            meeting_id=m.id,
            segment_id="pcm-ch-1-final-1",
            speaker="Lucifer S",
            text="What products do you offer?",
            t0=0,
            t1=2,
            completed=1,
            raw_json={"speaker_key": "ch-1:1"},
        )
    )
    db.commit()
    db.close()
    res = client.get(f"/v1/meetings/{m.id}/transcript", headers=auth_header())
    assert res.status_code == 200
    rows = res.json()
    assert rows[0]["speaker_key"] == "ch-1:1"
    assert rows[0]["speaker"] == "Lucifer S"
