"""Product create/update field matrix — tool mapping, sanitize, chat parsers."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.draft_conversation import (
    parse_product_field_update,
    propose_update_product_proposal,
)
from app.agents.misc_draft_agents import sanitize_product
from app.mcp.catalog import list_tools

PRODUCT_ID = "p-matrix-1"

# patch_product_draft keys (MCP catalog, create surface)
CREATE_DRAFT_FIELDS: list[tuple[str, str]] = [
    ("name", "Matrix Widget"),
    ("sku", "MW-001"),
    ("price", "99.00"),
    ("currency", "USD"),
    ("description", "Full description"),
    ("brand", "MatrixBrand"),
    ("category", "Software"),
    ("subcategory", "CRM"),
    ("stockOnHand", "25"),
    ("productUrl", "https://example.com/pdp"),
    ("billingType", "one_time"),
    ("billingFrequency", "monthly"),
    ("maxDiscountPercent", "20"),
    ("tags", "matrix,e2e"),
    ("imageUrl", "https://example.com/img.png"),
    ("galleryUrls", "https://a.example/x.png,https://b.example/y.png"),
    ("productType", "fixed"),
    ("status", "draft"),
]

UPDATE_PROPOSE_SCALAR: list[tuple[str, object]] = [
    ("name", "Renamed Widget"),
    ("sku", "MW-002"),
    ("price", "149"),
    ("maxDiscountPercent", "10"),
    ("currency", "EUR"),
    ("description", "Updated desc"),
    ("brand", "NewBrand"),
    ("category", "Hardware"),
    ("subcategory", "Devices"),
    ("stockOnHand", "5"),
    ("productUrl", "https://example.com/new"),
    ("status", "active"),
    ("productType", "fixed"),
    ("billingType", "one_time"),
    ("tags", "hot"),
    ("imageUrl", "https://example.com/new.png"),
    ("galleryUrls", "https://example.com/g1.png"),
]

UPDATE_CHAT_PHRASES: list[tuple[str, str, str]] = [
    ("price as 129", "price", "129"),
    ("price to 99", "price", "99"),
    ("sku as PRO-9", "sku", "PRO-9"),
    ("category as SaaS", "category", "SaaS"),
    ("description as Long form copy", "description", "Long form copy"),
]


def _catalog_create_patch_keys() -> set[str]:
    for tool in list_tools(module="product", surface="create"):
        if tool.get("name") == "patch_product_draft":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return set(props.keys())
    return set()


def _catalog_update_propose_keys() -> set[str]:
    for tool in list_tools(module="product", surface="detail", entity_id=PRODUCT_ID):
        if tool.get("name") == "propose_update_product":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return {k for k in props if k not in ("label", "confirmed", "auto")}
    return set()


def test_catalog_covers_create_draft_matrix() -> None:
    catalog_keys = _catalog_create_patch_keys()
    matrix_keys = {f for f, _ in CREATE_DRAFT_FIELDS}
    missing = matrix_keys - catalog_keys
    assert not missing, f"CREATE_DRAFT_FIELDS not in MCP catalog: {missing}"


def test_catalog_covers_update_propose_scalars() -> None:
    catalog_keys = _catalog_update_propose_keys()
    matrix_keys = {f for f, _ in UPDATE_PROPOSE_SCALAR}
    missing = matrix_keys - catalog_keys
    assert not missing, f"UPDATE_PROPOSE_SCALAR not in MCP catalog: {missing}"


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_patch_product_draft_maps_each_create_field(field: str, value: str) -> None:
    r = map_tool_calls_to_result(
        None,
        [{"function": {"name": "patch_product_draft", "arguments": {field: value}}}],
        mod="product",
        pathname="/product/new",
        user_text=f"set {field}",
        current_draft={},
    )
    patch = r.get("patch") or {}
    assert patch.get(field) == value.strip()[:500] or patch.get(field) == value


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_sanitize_product_keeps_each_create_field(field: str, value: str) -> None:
    out = sanitize_product({field: value})
    assert out and field in out


@pytest.mark.parametrize("field,value", UPDATE_PROPOSE_SCALAR)
def test_propose_update_product_maps_each_field(field: str, value: object) -> None:
    args: dict[str, object] = {"productId": PRODUCT_ID, field: value}
    r = map_tool_calls_to_result(
        "Updating.",
        [{"function": {"name": "propose_update_product", "arguments": args}}],
        mod="product",
        pathname=f"/product/{PRODUCT_ID}",
        entity_id=PRODUCT_ID,
        user_text=f"update {field}",
    )
    props = r.get("toolProposals") or []
    update = next((p for p in props if p.get("name") == "propose_update_product"), None)
    assert update, f"no propose_update_product for {field}"
    assert update["args"]["productId"] == PRODUCT_ID
    assert str(update["args"].get(field)) == str(value)


def test_propose_update_product_proposal_helper() -> None:
    prop = propose_update_product_proposal(
        product_id=PRODUCT_ID,
        patch={"price": "42", "sku": "X-1"},
    )
    assert prop["name"] == "propose_update_product"
    assert prop["args"]["price"] == "42"
    assert prop["args"]["productId"] == PRODUCT_ID


@pytest.mark.parametrize("phrase,field,expected", UPDATE_CHAT_PHRASES)
def test_parse_product_field_update_phrases(
    phrase: str, field: str, expected: str
) -> None:
    patch = parse_product_field_update(phrase)
    assert patch and patch.get(field) == expected, patch
