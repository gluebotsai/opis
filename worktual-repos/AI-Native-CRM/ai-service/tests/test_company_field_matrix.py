"""Company create/update field matrix — tool mapping and chat parsers."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.draft_conversation import (
    parse_company_field_update,
    propose_update_company_proposal,
)
from app.mcp.catalog import list_tools

COMPANY_ID = "co-matrix-1"

UPDATE_PROPOSE_FIELDS: list[tuple[str, object]] = [
    ("name", "Acme Labs"),
    ("domain", "acme.io"),
    ("industry", "SaaS"),
    ("linkedinUrl", "https://linkedin.com/company/acme"),
    ("employeeCount", "250"),
]

UPDATE_CHAT_PHRASES: list[tuple[str, str, str]] = [
    ("industry SaaS", "industry", "SaaS"),
    ("industry as Aerospace", "industry", "Aerospace"),
    ("domain acme.io", "domain", "acme.io"),
    ("domain as beta.example.com", "domain", "beta.example.com"),
    ("rename company to Red Bull", "name", "Red Bull"),
    ("employee count as 1200", "employeeCount", "1200"),
]


def _catalog_update_propose_keys() -> set[str]:
    for tool in list_tools(module="company", surface="detail", entity_id=COMPANY_ID):
        if tool.get("name") == "propose_update_company":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return {k for k in props if k not in ("label", "confirmed", "auto")}
    return set()


def test_catalog_covers_update_propose_matrix() -> None:
    keys = _catalog_update_propose_keys()
    assert keys
    for field, _ in UPDATE_PROPOSE_FIELDS:
        assert field in keys, f"catalog missing propose_update_company.{field}"


@pytest.mark.parametrize("field,value", UPDATE_PROPOSE_FIELDS)
def test_propose_update_company_maps_each_field(field: str, value: object) -> None:
    args = {"companyId": COMPANY_ID, "auto": True, field: value}
    _, props = map_tool_calls_to_result(
        "company",
        "detail",
        COMPANY_ID,
        [{"function": {"name": "propose_update_company", "arguments": args}}],
        user_text=f"update {field}",
    )
    update = next((p for p in props if p.get("name") == "propose_update_company"), None)
    assert update, f"no propose_update_company for {field}"
    assert update["args"].get(field) == value or str(update["args"].get(field)) == str(
        value
    )


@pytest.mark.parametrize("phrase,field,expected", UPDATE_CHAT_PHRASES)
def test_parse_company_field_update_phrases(
    phrase: str, field: str, expected: str
) -> None:
    patch = parse_company_field_update(phrase)
    assert patch and patch.get(field) == expected, patch


def test_propose_update_company_proposal_helper() -> None:
    prop = propose_update_company_proposal(
        company_id=COMPANY_ID,
        patch={"industry": "Robotics"},
    )
    assert prop["name"] == "propose_update_company"
    assert prop["args"]["companyId"] == COMPANY_ID
    assert prop["args"]["industry"] == "Robotics"
