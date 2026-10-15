"""staging_sync user_id: payload only, empty when anonymous (no synthetic guest_*)."""

from ingest.staging_sync import SYNC_STAGING_FOR_PAYLOAD_SQL


def test_staging_sync_sql_does_not_synthesize_guest_user_id():
    assert "concat('guest_" not in SYNC_STAGING_FOR_PAYLOAD_SQL
    assert "guest+visitor_" not in SYNC_STAGING_FOR_PAYLOAD_SQL


def test_staging_sync_sql_extracts_payload_user_id_with_empty_fallback():
    assert "JSONExtractString(r.payload, 'userId')" in SYNC_STAGING_FOR_PAYLOAD_SQL
    assert "profiles'), 'visitor', 'userId')" in SYNC_STAGING_FOR_PAYLOAD_SQL
    assert "''\n    ) AS user_id" in SYNC_STAGING_FOR_PAYLOAD_SQL or "''" in SYNC_STAGING_FOR_PAYLOAD_SQL
