import hashlib
import hmac
import json
import time

from app.models import Job
from tests.conftest import WEBHOOK, auth_header, insert_meeting


def _sign(body: bytes) -> dict[str, str]:
    ts = str(int(time.time()))
    sig = hmac.new(WEBHOOK.encode(), ("." + body.decode("utf-8")).encode(), hashlib.sha256).hexdigest()
    return {"X-Webhook-Signature": f"sha256={sig}", "X-Webhook-Timestamp": ts}


def test_webhook_replay_does_not_duplicate_extract(client):
    m = insert_meeting(client.extra["Session"], entity_type="deal", entity_id="D-1")
    payload = {
        "event": "meeting.completed",
        "event_id": "evt-dup",
        "data": {"metadata": {"meeting_id": m.id}, "status": "completed"},
    }
    raw = json.dumps(payload).encode()
    headers = _sign(raw)
    r1 = client.post("/internal/vexa/webhook", content=raw, headers=headers)
    r2 = client.post("/internal/vexa/webhook", content=raw, headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r2.json().get("duplicate") is True
    db = client.extra["Session"]()
    n = db.query(Job).filter(Job.meeting_id == m.id, Job.kind == "extract").count()
    db.close()
    assert n == 1


def test_webhook_invalid_signature(client):
    raw = b'{"event":"meeting.completed"}'
    r = client.post(
        "/internal/vexa/webhook",
        content=raw,
        headers={"X-Webhook-Signature": "sha256=deadbeef", "X-Webhook-Timestamp": str(int(time.time()))},
    )
    assert r.status_code == 401


def test_webhook_awaiting_admission(client):
    m = insert_meeting(client.extra["Session"], status="joining", native_meeting_id="zzz-yyyy-xxx")
    payload = {
        "event": "meeting.status_change",
        "event_id": "evt-lobby",
        "data": {"metadata": {"meeting_id": m.id}, "status": "awaiting_admission"},
    }
    raw = json.dumps(payload).encode()
    r = client.post("/internal/vexa/webhook", content=raw, headers=_sign(raw))
    assert r.status_code == 200
    got = client.get(f"/v1/meetings/{m.id}", headers=auth_header())
    assert got.json()["status"] == "awaiting_admission"


def test_webhook_completed_from_joining(client):
    m = insert_meeting(client.extra["Session"], status="joining", native_meeting_id="skip-ahead-1")
    payload = {
        "event": "meeting.completed",
        "event_id": "evt-skip-completed",
        "data": {"metadata": {"meeting_id": m.id}, "status": "completed"},
    }
    raw = json.dumps(payload).encode()
    r = client.post("/internal/vexa/webhook", content=raw, headers=_sign(raw))
    assert r.status_code == 200
    got = client.get(f"/v1/meetings/{m.id}", headers=auth_header())
    assert got.json()["status"] == "processing"
