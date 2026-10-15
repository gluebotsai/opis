"""Quotes create/update field matrix — MCP catalog, tools, parsers."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.draft_conversation import (
    parse_quote_field_update,
    propose_update_quote_proposal,
    quote_draft_ready,
    sanitize_quote_update_args,
)
from app.mcp.catalog import list_tools

QUOTE_ID = "q-matrix-1"
DEAL_ID = "deal-matrix-1"

CREATE_DRAFT_FIELDS: list[tuple[str, str]] = [
    ("dealId", DEAL_ID),
    ("productId", "prod-1"),
    ("offerId", "offer-1"),
    ("quantity", "2"),
    ("discountPct", "5"),
    ("notes", "Draft notes"),
    ("customerName", "Acme Buyer"),
    ("companyName", "Acme Inc"),
    ("vendorName", "Our Co"),
]

UPDATE_PROPOSE_FIELDS: list[tuple[str, object]] = [
    ("notes", "Updated notes"),
    ("customerName", "New Buyer"),
    ("companyName", "New Co"),
    ("vendorName", "Vendor LLC"),
    ("discountPct", 12),
]

UPDATE_CHAT_PHRASES: list[tuple[str, str, str]] = [
    ("notes as Valid 30 days", "notes", "Valid 30 days"),
    ("customer name as Jane Doe", "customerName", "Jane Doe"),
    ("company name as Globex", "companyName", "Globex"),
    ("vendor name as Worktual", "vendorName", "Worktual"),
]


def _catalog_create_patch_keys() -> set[str]:
    for tool in list_tools(module="quotes", surface="create"):
        if tool.get("name") == "patch_quote_draft":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return set(props.keys())
    return set()


def _catalog_update_propose_keys() -> set[str]:
    for tool in list_tools(module="quotes", surface="detail", entity_id=QUOTE_ID):
        if tool.get("name") == "propose_update_quote":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return {k for k in props if k not in ("label", "confirmed", "auto")}
    return set()


def test_catalog_covers_create_draft_matrix() -> None:
    catalog_keys = _catalog_create_patch_keys()
    matrix_keys = {f for f, _ in CREATE_DRAFT_FIELDS}
    missing = matrix_keys - catalog_keys
    assert not missing, f"CREATE_DRAFT_FIELDS not in MCP catalog: {missing}"


def test_catalog_covers_update_propose_fields() -> None:
    catalog_keys = _catalog_update_propose_keys()
    for field, _ in UPDATE_PROPOSE_FIELDS:
        assert field in catalog_keys, f"catalog missing propose_update_quote.{field}"
    assert "lines" in catalog_keys


def test_quote_draft_ready_requires_deal_product_qty() -> None:
    assert not quote_draft_ready({})
    assert not quote_draft_ready({"dealId": DEAL_ID})
    assert quote_draft_ready({"dealId": DEAL_ID, "productId": "p1", "quantity": "1"})


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_patch_quote_draft_maps_each_create_field(field: str, value: str) -> None:
    r = map_tool_calls_to_result(
        None,
        [{"function": {"name": "patch_quote_draft", "arguments": {field: value}}}],
        mod="quotes",
        pathname="/sales/quotes/new",
        user_text=f"set {field}",
        current_draft={},
    )
    patch = r.get("patch") or {}
    assert field in patch, patch


@pytest.mark.parametrize("field,value", UPDATE_PROPOSE_FIELDS)
def test_propose_update_quote_maps_each_field(field: str, value: object) -> None:
    args: dict[str, object] = {"quoteId": QUOTE_ID, "auto": True, field: value}
    r = map_tool_calls_to_result(
        "Updating.",
        [{"function": {"name": "propose_update_quote", "arguments": args}}],
        mod="quotes",
        pathname=f"/sales/quotes/{QUOTE_ID}",
        entity_id=QUOTE_ID,
        user_text=f"update {field}",
    )
    props = r.get("toolProposals") or []
    update = next((p for p in props if p.get("name") == "propose_update_quote"), None)
    assert update, f"no propose_update_quote for {field}"
    assert update["args"]["quoteId"] == QUOTE_ID
    if field == "discountPct":
        assert float(update["args"]["discountPct"]) == float(value)
    else:
        assert update["args"].get(field) == value


def test_propose_update_quote_lines() -> None:
    args = {
        "quoteId": QUOTE_ID,
        "auto": True,
        "lines": [{"productId": "p1", "name": "Widget", "quantity": 2}],
        "discountPct": 0,
    }
    r = map_tool_calls_to_result(
        "Updating lines.",
        [{"function": {"name": "propose_update_quote", "arguments": args}}],
        mod="quotes",
        pathname=f"/sales/quotes/{QUOTE_ID}",
        entity_id=QUOTE_ID,
        user_text="update lines",
        context={
            "catalog": {
                "products": [{"id": "p1", "name": "Widget"}],
            },
        },
    )
    props = r.get("toolProposals") or []
    update = next((p for p in props if p.get("name") == "propose_update_quote"), None)
    assert update and update["args"].get("lines")
    assert update["args"]["lines"][0]["productId"] == "p1"


def test_sanitize_quote_update_args_helper() -> None:
    clean = sanitize_quote_update_args(
        {"notes": "Hello", "customerName": "Bob", "auto": True},
        quote_id=QUOTE_ID,
    )
    assert clean
    assert clean["quoteId"] == QUOTE_ID
    assert clean["notes"] == "Hello"
    assert clean["customerName"] == "Bob"


def test_propose_update_quote_proposal_helper() -> None:
    prop = propose_update_quote_proposal(
        quote_id=QUOTE_ID,
        patch={"notes": "Ship fast"},
    )
    assert prop["name"] == "propose_update_quote"
    assert prop["args"]["quoteId"] == QUOTE_ID
    assert prop["args"]["notes"] == "Ship fast"


@pytest.mark.parametrize("phrase,field,expected", UPDATE_CHAT_PHRASES)
def test_parse_quote_field_update_phrases(
    phrase: str, field: str, expected: str
) -> None:
    patch = parse_quote_field_update(phrase)
    assert patch and patch.get(field) == expected, patch
