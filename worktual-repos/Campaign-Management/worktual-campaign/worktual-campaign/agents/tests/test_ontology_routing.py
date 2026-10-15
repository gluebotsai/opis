"""Unit tests for ontology SSE parsing + tool routing contracts."""

from __future__ import annotations

from app.agents.reports.tools.schemas import ALL_TOOLS
from app.services.ontology_layer import _parse_sse_answer


def test_parse_sse_concatenates_delta_chunks() -> None:
    raw = (
        "event: text_delta\n"
        'data: {"delta":"Hello","content":"Hello"}\n\n'
        "event: text_delta\n"
        'data: {"delta":" world","content":" world"}\n\n'
        "event: done\n"
        'data: {"elapsed_seconds":1.2,"turnId":"abc"}\n\n'
    )
    parsed = _parse_sse_answer(raw)
    assert parsed["answer"] == "Hello world"
    assert parsed["done"]["turnId"] == "abc"
    assert parsed["chunk_count"] == 2


def test_parse_sse_strips_html_wrapper() -> None:
    raw = (
        "event: text_delta\n"
        'data: {"delta":"<html><body><p>No Diwali campaigns</p></body></html>"}\n\n'
        "event: done\n"
        'data: {"elapsed_seconds":1.0}\n\n'
    )
    parsed = _parse_sse_answer(raw)
    assert "No Diwali campaigns" in parsed["answer"]
    assert "<html" not in parsed["answer"].lower()


def test_tool_catalog_has_ontology_and_semantic() -> None:
    names = {t["function"]["name"] for t in ALL_TOOLS}
    assert "ask_ontology" in names
    assert "query_analytics" in names
    assert "ask_semantic_layer" in names
    ont = next(t for t in ALL_TOOLS if t["function"]["name"] == "ask_ontology")
    assert "ontology" in ont["function"]["description"].lower()
    qa = next(t for t in ALL_TOOLS if t["function"]["name"] == "query_analytics")
    assert "semantic" in qa["function"]["description"].lower()
    assert "ask_ontology" in qa["function"]["description"]
