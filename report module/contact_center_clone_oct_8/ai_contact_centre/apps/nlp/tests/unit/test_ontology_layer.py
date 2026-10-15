import json

import pytest

from app.services.ontology_layer import (
    map_ontology_activity,
    map_ontology_status,
    ontology_event_from_sse,
    parse_sse_block,
)


def test_map_ontology_status_uses_label_when_present() -> None:
    phase, label = map_ontology_status("concepts", "Found: Missed Contacts, Abandonment Rate")
    assert phase == "concepts"
    assert "Missed Contacts" in label


def test_map_ontology_status_writing_maps_to_generating_response() -> None:
    phase, label = map_ontology_status("writing", "Writing my reply…")
    assert phase == "writing"
    assert "Generating response" in label


def test_map_ontology_activity_running_step() -> None:
    mapped = map_ontology_activity("Finding relevant metrics", "Searching concepts…")
    assert mapped is not None
    phase, label = mapped
    assert phase == "ontology_layer"
    assert "Finding relevant metrics" in label


def test_ontology_event_from_sse_status() -> None:
    event = ontology_event_from_sse(
        "status",
        {"phase": "planning", "label": "Planning the analysis…"},
    )
    assert event is not None
    assert event.kind == "status"
    assert event.phase == "planning"
    assert event.label == "Planning the analysis…"


def test_ontology_event_from_sse_text_delta() -> None:
    event = ontology_event_from_sse("text_delta", {"delta": "Because staffing was low"})
    assert event is not None
    assert event.kind == "text_delta"
    assert event.delta == "Because staffing was low"


def test_parse_sse_block_round_trip() -> None:
    block = 'event: status\ndata: {"phase":"understanding","label":"Understanding your question…"}'
    event_name, data = parse_sse_block(block)
    assert event_name == "status"
    assert data["phase"] == "understanding"


@pytest.mark.asyncio
async def test_ask_ontology_layer_gateway_collects_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings
    from app.services import ontology_layer as module

    class FakeResponse:
        def __init__(self, chunks: list[str]) -> None:
            self._chunks = chunks

        def raise_for_status(self) -> None:
            return None

        async def aiter_text(self):
            for chunk in self._chunks:
                yield chunk

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class FakeClient:
        def stream(self, *args, **kwargs):
            body = (
                'event: status\ndata: {"phase":"understanding","label":"Understanding…"}\n\n'
                'event: text_delta\ndata: {"delta":"<p>Root cause</p>"}\n\n'
                'event: done\ndata: {"turnId":"abc-123","elapsed_seconds":1.2}\n\n'
            )
            return FakeResponse([body])

        async def aclose(self) -> None:
            return None

    settings = Settings(ontology_layer_url="http://ontology.test")
    result = await module.ask_ontology_layer_gateway(
        "Why did missed contacts spike?",
        organization_id="1000",
        settings=settings,
        client=FakeClient(),  # type: ignore[arg-type]
    )
    assert result["ok"] is True
    assert result["type"] == "explanation"
    assert "Root cause" in result["answer"]
    assert result["turn_id"] == "abc-123"
