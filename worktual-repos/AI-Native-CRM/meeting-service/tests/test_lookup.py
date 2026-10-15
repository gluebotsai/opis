from tests.conftest import auth_header, insert_meeting


def test_lookup_inflight(client):
    insert_meeting(client.extra["Session"], native_meeting_id="abc-defg-hij")
    r = client.get(
        "/v1/meetings/lookup",
        params={"meeting_url": "https://meet.google.com/abc-defg-hij"},
        headers=auth_header(),
    )
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    assert r.json()["native_meeting_id"] == "abc-defg-hij"


def test_lookup_org_isolation(client):
    insert_meeting(client.extra["Session"], native_meeting_id="abc-defg-hij")
    r = client.get(
        "/v1/meetings/lookup",
        params={"meeting_url": "https://meet.google.com/abc-defg-hij"},
        headers=auth_header("org-b"),
    )
    assert r.status_code == 404


def test_lookup_completed_404(client):
    insert_meeting(client.extra["Session"], status="completed", native_meeting_id="zzz-yyyy-xxx")
    r = client.get(
        "/v1/meetings/lookup",
        params={"meeting_url": "https://meet.google.com/zzz-yyyy-xxx"},
        headers=auth_header(),
    )
    assert r.status_code == 404


def test_lookup_meet_code_case_insensitive(client):
    insert_meeting(client.extra["Session"], native_meeting_id="abc-defg-hij")
    r = client.get(
        "/v1/meetings/lookup",
        params={"meeting_url": "https://meet.google.com/ABC-DEFG-HIJ"},
        headers=auth_header(),
    )
    assert r.status_code == 200
    assert r.json()["native_meeting_id"] == "abc-defg-hij"


def test_lookup_invalid_url(client):
    r = client.get(
        "/v1/meetings/lookup",
        params={"meeting_url": "https://example.com/nope"},
        headers=auth_header(),
    )
    assert r.status_code == 422
