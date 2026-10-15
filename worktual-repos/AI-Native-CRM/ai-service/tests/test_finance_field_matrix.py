"""Finance (invoice) create/update field matrix — MCP catalog, tools, parsers."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.draft_conversation import (
    invoice_draft_ready,
    parse_invoice_field_update,
    propose_update_invoice_proposal,
    sanitize_invoice_update_args,
)
from app.agents.misc_draft_agents import sanitize_invoice
from app.mcp.catalog import list_tools

INVOICE_ID = "inv-matrix-1"
DEAL_ID = "deal-matrix-1"

CREATE_DRAFT_FIELDS: list[tuple[str, str]] = [
    ("dealId", DEAL_ID),
    ("currency", "USD"),
    ("notes", "Draft notes"),
    ("paymentTerms", "Net 30"),
    ("issueDate", "2026-10-01"),
    ("dueDate", "2026-11-01"),
    ("billingAddress", "1 Main St"),
    ("leadEmail", "bill@example.com"),
    ("leadPhone", "+1-555-0100"),
    ("taxId", "TAX-1"),
    ("discountPct", "5"),
    ("productId", "prod-1"),
    ("quantity", "2"),
]

UPDATE_PROPOSE_FIELDS: list[tuple[str, object]] = [
    ("notes", "Updated notes"),
    ("paymentTerms", "Due on receipt"),
    ("discountPct", 10),
    ("discountAmount", 25),
]

UPDATE_CHAT_PHRASES: list[tuple[str, str, str]] = [
    ("notes as Due on receipt", "notes", "Due on receipt"),
    ("payment terms as Net 45", "paymentTerms", "Net 45"),
    ("terms as Net 45", "paymentTerms", "Net 45"),
]


def _catalog_create_patch_keys() -> set[str]:
    for tool in list_tools(module="finance", surface="create"):
        if tool.get("name") == "patch_invoice_draft":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return set(props.keys())
    return set()


def _catalog_update_propose_keys() -> set[str]:
    for tool in list_tools(module="finance", surface="detail", entity_id=INVOICE_ID):
        if tool.get("name") == "propose_update_invoice":
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
        assert field in catalog_keys, f"catalog missing propose_update_invoice.{field}"
    assert "lines" in catalog_keys


def test_invoice_draft_ready_requires_deal() -> None:
    assert not invoice_draft_ready({})
    assert invoice_draft_ready({"dealId": DEAL_ID})


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_patch_invoice_draft_maps_each_create_field(field: str, value: str) -> None:
    r = map_tool_calls_to_result(
        None,
        [{"function": {"name": "patch_invoice_draft", "arguments": {field: value}}}],
        mod="finance",
        pathname="/finance/new",
        user_text=f"set {field}",
        current_draft={},
    )
    patch = r.get("patch") or {}
    assert field in patch, patch


@pytest.mark.parametrize("field,value", [("currency", "EUR"), ("notes", "X"), ("paymentTerms", "Net 7")])
def test_sanitize_invoice_keeps_supported_fields(field: str, value: str) -> None:
    deals = [{"id": DEAL_ID, "title": "Deal A"}]
    patch = {field: value}
    if field == "dealId":
        patch = {"dealId": DEAL_ID}
    out = sanitize_invoice(patch, deals)
    assert out and field in out


@pytest.mark.parametrize("field,value", UPDATE_PROPOSE_FIELDS)
def test_propose_update_invoice_maps_each_field(field: str, value: object) -> None:
    args: dict[str, object] = {"invoiceId": INVOICE_ID, "auto": True, field: value}
    r = map_tool_calls_to_result(
        "Updating.",
        [{"function": {"name": "propose_update_invoice", "arguments": args}}],
        mod="finance",
        pathname=f"/finance/{INVOICE_ID}",
        entity_id=INVOICE_ID,
        user_text=f"update {field}",
    )
    props = r.get("toolProposals") or []
    update = next((p for p in props if p.get("name") == "propose_update_invoice"), None)
    assert update, f"no propose_update_invoice for {field}"
    assert update["args"]["invoiceId"] == INVOICE_ID
    if field == "discountPct":
        assert float(update["args"]["discountPct"]) == float(value)
    elif field == "discountAmount":
        assert float(update["args"]["discountAmount"]) == float(value)
    else:
        assert update["args"].get(field) == value


def test_propose_update_invoice_lines() -> None:
    args = {
        "invoiceId": INVOICE_ID,
        "auto": True,
        "lines": [{"productId": "p1", "name": "Widget", "quantity": 3}],
        "discountPct": 0,
    }
    r = map_tool_calls_to_result(
        "Updating lines.",
        [{"function": {"name": "propose_update_invoice", "arguments": args}}],
        mod="finance",
        pathname=f"/finance/{INVOICE_ID}",
        entity_id=INVOICE_ID,
        user_text="update lines",
        context={
            "catalog": {
                "products": [{"id": "p1", "name": "Widget"}],
            },
        },
    )
    props = r.get("toolProposals") or []
    update = next((p for p in props if p.get("name") == "propose_update_invoice"), None)
    assert update and update["args"].get("lines")
    assert update["args"]["lines"][0]["productId"] == "p1"


def test_sanitize_invoice_update_args_helper() -> None:
    clean = sanitize_invoice_update_args(
        {"notes": "Hello", "paymentTerms": "Net 10", "auto": True},
        invoice_id=INVOICE_ID,
    )
    assert clean
    assert clean["invoiceId"] == INVOICE_ID
    assert clean["notes"] == "Hello"
    assert clean["paymentTerms"] == "Net 10"


def test_propose_update_invoice_proposal_helper() -> None:
    prop = propose_update_invoice_proposal(
        invoice_id=INVOICE_ID,
        patch={"notes": "Shipped"},
    )
    assert prop["name"] == "propose_update_invoice"
    assert prop["args"]["invoiceId"] == INVOICE_ID
    assert prop["args"]["notes"] == "Shipped"


@pytest.mark.parametrize("phrase,field,expected", UPDATE_CHAT_PHRASES)
def test_parse_invoice_field_update_phrases(
    phrase: str, field: str, expected: str
) -> None:
    patch = parse_invoice_field_update(phrase)
    assert patch and patch.get(field) == expected, patch
