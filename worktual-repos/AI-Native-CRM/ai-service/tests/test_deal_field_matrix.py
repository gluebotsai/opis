"""Deal create/update field matrix — tool mapping and chat parsers."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.deal_coworker_agent import parse_deal_field_update
from app.agents.draft_conversation import propose_update_deal_proposal
from app.mcp.catalog import list_tools

DEAL_ID = "d-matrix-1"

UPDATE_PROPOSE_FIELDS: list[tuple[str, object]] = [
    ("title", "Big Renewal"),
    ("amount", "75000"),
    ("notes", "Follow up next week"),
    ("expectedCloseDate", "2026-12-31"),
]

UPDATE_CHAT_PHRASES: list[tuple[str, str, str]] = [
    ("title as Enterprise Rollout", "title", "Enterprise Rollout"),
    ("amount as 88000", "amount", "88000"),
    ("notes as Call back Friday", "notes", "Call back Friday"),
    ("move stage to negotiate", "stage", "negotiate"),
]


def _catalog_update_propose_keys() -> set[str]:
    for tool in list_tools(module="sales", surface="detail", entity_id=DEAL_ID):
        if tool.get("name") == "propose_update_deal":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return {k for k in props if k not in ("label", "confirmed", "auto", "stage")}
    return set()


def test_catalog_covers_update_propose_matrix() -> None:
    keys = _catalog_update_propose_keys()
    assert keys
    for field, _ in UPDATE_PROPOSE_FIELDS:
        if field == "stage":
            continue
        assert field in keys, f"catalog missing propose_update_deal.{field}"


@pytest.mark.parametrize("field,value", UPDATE_PROPOSE_FIELDS)
def test_propose_update_deal_maps_each_field(field: str, value: object) -> None:
    args = {"dealId": DEAL_ID, "auto": True, field: value}
    _, props = map_tool_calls_to_result(
        "sales",
        "detail",
        DEAL_ID,
        [{"function": {"name": "propose_update_deal", "arguments": args}}],
        user_text=f"update {field}",
    )
    update = next((p for p in props if p.get("name") == "propose_update_deal"), None)
    assert update, f"no propose_update_deal for {field}"
    assert str(update["args"].get(field)) == str(value)


@pytest.mark.parametrize("phrase,field,expected", UPDATE_CHAT_PHRASES)
def test_parse_deal_field_update_phrases(
    phrase: str, field: str, expected: str
) -> None:
    patch = parse_deal_field_update(phrase)
    assert patch and str(patch.get(field)) == expected, patch


def test_propose_update_deal_proposal_helper() -> None:
    prop = propose_update_deal_proposal(
        deal_id=DEAL_ID,
        patch={"amount": "12000"},
    )
    assert prop["name"] == "propose_update_deal"
    assert prop["args"]["dealId"] == DEAL_ID
    assert prop["args"]["amount"] == "12000"
