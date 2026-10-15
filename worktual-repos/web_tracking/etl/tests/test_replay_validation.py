import pytest

from ingest.schemas import ReplayChunkRequest
from ingest.validation import PayloadValidationError, validate_replay_chunk_body

REPLAY_PAYLOAD = {
    "type": "replay_chunk_v1",
    "websiteId": 12345,
    "websiteUrl": "https://beta.worktual.co.uk",
    "organizationId": 1,
    "visitorId": "visitor_1pl0cz3bomswwghag",
    "sessionId": "session_ozjdqalbtmt114z3a",
    "pageViewId": "pg_bl87mp6h5mt1a1viu",
    "chunkIndex": 21,
    "chunkId": "01c06976-3b92-4d66-ba6e-ec77c29e4fc3",
    "encoding": "gzip_b64",
    "eventsData": "H4sIAAAAAAAAAyXIOwrAIBAFwLu8egs/qGGvElJItLCQSNxARLx7ikw5+4SMlsGWkKJE8ES/nvv8qySwJrxgRRhga4JeBCk1d4m1gXXYgtHOexOUW8cHPsTycVAAAAA=",
    "eventCount": 1,
    "payloadId": "8f8e55ce-464e-4140-b189-577fbf1577e6",
    "source": "rrweb",
}


def test_replay_chunk_v1_validates():
    sanitized = validate_replay_chunk_body(REPLAY_PAYLOAD)
    assert sanitized["type"] == "replay_chunk_v1"
    assert sanitized["chunkIndex"] == 21

    model = ReplayChunkRequest.from_validated_body(REPLAY_PAYLOAD)
    assert model.page_view_id == "pg_bl87mp6h5mt1a1viu"
    assert model.event_count == 1


def test_replay_chunk_rejects_events_type():
    with pytest.raises(PayloadValidationError, match="replay_chunk_v1"):
        validate_replay_chunk_body({"type": "events_v3", "websiteId": 1})
