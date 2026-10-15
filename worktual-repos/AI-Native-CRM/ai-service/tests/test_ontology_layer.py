from __future__ import annotations

import pytest

from app.services.ontology_layer import (
    ASK_ONTOLOGY_LAYER_TOOL,
    OntologyAskResult,
    _apply_event,
    _parse_sse_block,
    ask_ontology_layer,
)


def test_tool_schema_matches_gateway_contract():
    fn = ASK_ONTOLOGY_LAYER_TOOL["function"]
    assert fn["name"] == "ask_ontology_layer"
    assert fn["parameters"]["required"] == ["query"]


def test_parse_sse_block_json_payload():
    event, data = _parse_sse_block(
        'event: status\ndata: {"phase":"understanding","label":"Understanding…"}'
    )
    assert event == "status"
    assert data["phase"] == "understanding"


def test_apply_event_accumulates_text_and_progress():
    progress = []
    parts: list[str] = []
    raw: list[dict] = []
    _apply_event(
        "activity",
        {
            "step_id": "understand",
            "status": "running",
            "title": "Understanding your question",
            "description": "Reading…",
        },
        progress=progress,
        answer_parts=parts,
        raw_events=raw,
    )
    _apply_event(
        "activity",
        {
            "step_id": "understand",
            "status": "completed",
            "title": "Understanding your question",
            "description": "Reading…",
        },
        progress=progress,
        answer_parts=parts,
        raw_events=raw,
    )
    _apply_event(
        "text_delta",
        {"delta": "Hello ", "content": "Hello "},
        progress=progress,
        answer_parts=parts,
        raw_events=raw,
    )
    _apply_event(
        "text_delta",
        {"delta": "world", "content": "world"},
        progress=progress,
        answer_parts=parts,
        raw_events=raw,
    )
    elapsed = _apply_event(
        "done",
        {"elapsed_seconds": 1.5},
        progress=progress,
        answer_parts=parts,
        raw_events=raw,
    )
    assert len(progress) == 1
    assert progress[0].status == "completed"
    assert "".join(parts) == "Hello world"
    assert elapsed == 1.5


@pytest.mark.asyncio
async def test_ask_ontology_layer_streams_sse(monkeypatch):
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        async def aiter_text(self):
            payload = (
                'event: status\ndata: {"phase":"writing","label":"Writing…"}\n\n'
                'event: text_delta\ndata: {"delta":"Because pipeline stalled."}\n\n'
                'event: done\ndata: {"elapsed_seconds":0.4}\n\n'
            )
            yield payload

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, **kwargs):
            assert method == "POST"
            assert url.endswith("/chat/stream")
            assert kwargs["json"]["organization_id"] == "1000"
            assert kwargs["json"]["query"] == "why is win rate low"
            assert kwargs["json"]["sessionID"] == "sess-1"
            return FakeResponse()

    monkeypatch.setattr(
        "app.services.ontology_layer.get_settings",
        lambda: type(
            "S",
            (),
            {
                "ontology_gateway_url": "http://example.test:8000",
                "ontology_gateway_timeout_s": 30.0,
            },
        )(),
    )
    monkeypatch.setattr("app.services.ontology_layer.httpx.AsyncClient", FakeClient)

    result = await ask_ontology_layer(
        "why is win rate low",
        "1000",
        session_id="sess-1",
    )
    assert isinstance(result, OntologyAskResult)
    assert result.ok is True
    assert result.answer == "Because pipeline stalled."
    assert result.progress[0].label == "Writing…"
    assert result.elapsed_seconds == 0.4
