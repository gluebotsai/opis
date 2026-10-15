"""B2B sales proposal detail tools — field mapping (no LLM create E2E)."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.mcp.catalog import list_tools

PROPOSAL_ID = "prop-matrix-1"

PATCH_SECTION_FIELDS: list[tuple[str, object]] = [
    ("sectionKey", "introduction"),
    ("title", "Introduction"),
    ("body", "Updated intro body"),
]

DOCUMENT_TEXT_ARGS = {
    "proposalId": PROPOSAL_ID,
    "auto": True,
    "textReplacements": [{"find": "Old date", "replace": "1 Jan 2027"}],
}


def _catalog_propose_patch_section_keys() -> set[str]:
    for tool in list_tools(module="sales", surface="detail", entity_id=PROPOSAL_ID):
        if tool.get("name") == "propose_patch_proposal_section":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return {k for k in props if k not in ("label", "confirmed", "auto")}
    return set()


def test_catalog_covers_proposal_section_fields() -> None:
    keys = _catalog_propose_patch_section_keys()
    assert "sectionKey" in keys
    assert "title" in keys
    assert "body" in keys


@pytest.mark.parametrize("field,value", PATCH_SECTION_FIELDS)
def test_propose_patch_proposal_section_maps_fields(
    field: str, value: object
) -> None:
    args: dict[str, object] = {
        "proposalId": PROPOSAL_ID,
        "auto": True,
        "sectionKey": "introduction",
        field: value,
    }
    if field == "sectionKey":
        args = {"proposalId": PROPOSAL_ID, "auto": True, "sectionKey": value, "body": "x"}
    r = map_tool_calls_to_result(
        "Patch section.",
        [
            {
                "function": {
                    "name": "propose_patch_proposal_section",
                    "arguments": args,
                }
            }
        ],
        mod="sales",
        pathname=f"/sales/proposals/{PROPOSAL_ID}",
        entity_id=PROPOSAL_ID,
        user_text="update section",
    )
    props = r.get("toolProposals") or []
    hit = next(
        (p for p in props if p.get("name") == "propose_patch_proposal_section"),
        None,
    )
    assert hit, f"no propose_patch_proposal_section for {field}"
    assert hit["args"]["proposalId"] == PROPOSAL_ID
    if field != "sectionKey":
        assert str(hit["args"].get(field)) == str(value)


def test_propose_patch_proposal_document_text() -> None:
    r = map_tool_calls_to_result(
        "Replace date.",
        [
            {
                "function": {
                    "name": "propose_patch_proposal_document_text",
                    "arguments": DOCUMENT_TEXT_ARGS,
                }
            }
        ],
        mod="sales",
        pathname=f"/sales/proposals/{PROPOSAL_ID}",
        entity_id=PROPOSAL_ID,
        user_text="change date",
    )
    props = r.get("toolProposals") or []
    hit = next(
        (p for p in props if p.get("name") == "propose_patch_proposal_document_text"),
        None,
    )
    assert hit
    reps = hit["args"].get("textReplacements")
    assert isinstance(reps, list) and reps[0].get("find") == "Old date"
