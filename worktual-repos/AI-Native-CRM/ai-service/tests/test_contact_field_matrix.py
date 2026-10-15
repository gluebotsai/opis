"""Contact create/update field matrix — tool mapping, draft sanitize, chat parsers."""

from __future__ import annotations

import pytest

from app.agents.contact_draft_agent import sanitize
from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.draft_conversation import (
    parse_contact_field_update,
    propose_update_contact_proposal,
)
from app.mcp.catalog import list_tools

CONTACT_ID = "c-matrix-1"

# patch_contact_draft keys (MCP catalog, create surface)
CREATE_DRAFT_FIELDS: list[tuple[str, str]] = [
    ("firstName", "Matrix"),
    ("lastName", "Tester"),
    ("email", "matrix.tester@example.com"),
    ("phone", "+919876543210"),
    ("title", "VP Sales"),
    ("companyName", "Acme Robotics"),
    ("contactType", "lead"),
    ("leadStatus", "new"),
    ("city", "Austin"),
    ("country", "US"),
    ("addressLine", "100 Main St"),
    ("notes", "Met at conference"),
    ("status", "active"),
    ("tags", "vip,enterprise"),
    ("secondaryEmails", "alt@example.com"),
    ("secondaryPhones", "+15551212"),
    ("bantBudget", "true"),
    ("bantAuthority", "yes"),
    ("bantNeed", "false"),
    ("bantTimeline", "true"),
    ("companyDomain", "acme.example"),
    ("companyIndustry", "SaaS"),
]

# propose_update_contact keys (detail surface; ids tested separately)
UPDATE_PROPOSE_FIELDS: list[tuple[str, object]] = [
    ("firstName", "Updated"),
    ("lastName", "Person"),
    ("email", "updated.person@example.com"),
    ("phone", "+919811111111"),
    ("title", "Director"),
    ("notes", "Notes updated"),
    ("city", "Chennai"),
    ("country", "India"),
    ("addressLine", "42 Park Ave"),
    ("status", "active"),
    ("tags", "hot,priority"),
    ("contactType", "lead"),
    ("leadStatus", "qualified"),
    ("leadSource", "referral"),
    ("bantBudget", True),
    ("bantAuthority", False),
    ("bantNeed", True),
    ("bantTimeline", False),
    ("secondaryEmails", "a@b.com,b@c.com"),
    ("secondaryPhones", "+15559999"),
]

# Natural-language update phrases (parse_contact_field_update → propose args)
UPDATE_CHAT_PHRASES: list[tuple[str, str, str]] = [
    ("email to patch@example.com", "email", "patch@example.com"),
    ("phone as +919900000001", "phone", "+919900000001"),
    ("title as Staff Engineer", "title", "Staff Engineer"),
    ("city as Boston", "city", "Boston"),
    ("city as Singapore", "city", "Singapore"),
    ("country as Germany", "country", "Germany"),
    ("address as 9 Elm Street", "addressLine", "9 Elm Street"),
    ("notes as Follow up Q2", "notes", "Follow up Q2"),
    ("first name as Jamie", "firstName", "Jamie"),
    ("last name as Lee", "lastName", "Lee"),
    ("update cuntry as india", "country", "india"),
]


def _catalog_create_patch_keys() -> set[str]:
    for tool in list_tools(module="contact", surface="create"):
        if tool.get("name") == "patch_contact_draft":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return set(props.keys())
    return set()


def _catalog_update_propose_keys() -> set[str]:
    for tool in list_tools(module="contact", surface="detail", entity_id=CONTACT_ID):
        if tool.get("name") == "propose_update_contact":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return {k for k in props if k not in ("label", "confirmed", "auto")}
    return set()


def test_catalog_covers_create_draft_matrix() -> None:
    catalog_keys = _catalog_create_patch_keys()
    matrix_keys = {f for f, _ in CREATE_DRAFT_FIELDS}
    missing = matrix_keys - catalog_keys
    assert not missing, f"CREATE_DRAFT_FIELDS not in MCP catalog: {missing}"


def test_catalog_covers_update_propose_matrix() -> None:
    catalog_keys = _catalog_update_propose_keys()
    matrix_keys = {f for f, _ in UPDATE_PROPOSE_FIELDS}
    missing = matrix_keys - catalog_keys
    assert not missing, f"UPDATE_PROPOSE_FIELDS not in MCP catalog: {missing}"


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_patch_contact_draft_maps_each_create_field(field: str, value: str) -> None:
    r = map_tool_calls_to_result(
        None,
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {field: value},
                }
            }
        ],
        mod="contact",
        pathname="/contact?view=create",
        user_text=f"set {field}",
        current_draft={},
    )
    assert r.get("ok") is not False
    patch = r.get("patch") or {}
    assert patch.get(field) == value.strip()[:500] or patch.get(field) == value


SANITIZE_CREATE_FIELDS = [
    (f, v) for f, v in CREATE_DRAFT_FIELDS if f
    in {
        "firstName",
        "lastName",
        "email",
        "phone",
        "title",
        "companyName",
        "notes",
        "city",
        "country",
        "leadStatus",
        "contactType",
    }
]


@pytest.mark.parametrize("field,value", SANITIZE_CREATE_FIELDS)
def test_contact_draft_sanitize_keeps_each_field(field: str, value: str) -> None:
    out = sanitize({field: value}, companies=[])
    assert out and out.get(field)


@pytest.mark.parametrize("field,value", UPDATE_PROPOSE_FIELDS)
def test_propose_update_contact_maps_each_field(field: str, value: object) -> None:
    args: dict[str, object] = {"contactId": CONTACT_ID, field: value}
    r = map_tool_calls_to_result(
        "Updating now.",
        [{"function": {"name": "propose_update_contact", "arguments": args}}],
        mod="contact",
        pathname=f"/contact/{CONTACT_ID}",
        entity_id=CONTACT_ID,
        user_text=f"update {field}",
    )
    props = r.get("toolProposals") or []
    update = next((p for p in props if p.get("name") == "propose_update_contact"), None)
    assert update, f"no propose_update_contact for {field}"
    assert update["args"]["contactId"] == CONTACT_ID
    assert update["args"].get(field) == value


def test_propose_update_contact_proposal_helper() -> None:
    prop = propose_update_contact_proposal(
        contact_id=CONTACT_ID,
        patch={"city": "Paris", "title": "CEO"},
    )
    assert prop["name"] == "propose_update_contact"
    assert prop["args"]["city"] == "Paris"
    assert prop["args"]["contactId"] == CONTACT_ID
    assert prop["args"].get("auto") is True


@pytest.mark.parametrize("phrase,field,expected", UPDATE_CHAT_PHRASES)
def test_parse_contact_field_update_phrases(
    phrase: str, field: str, expected: str
) -> None:
    patch = parse_contact_field_update(phrase)
    assert patch and patch.get(field) == expected


@pytest.mark.parametrize(
    "field",
    [
        "leadSource",
        "leadStatus",
        "contactType",
        "status",
        "ownerUserId",
        "tags",
    ],
)
def test_parse_contact_field_update_gaps_documented(field: str) -> None:
    """Chat shorthand parser is limited — LLM must pass these via propose_update_contact."""
    patch = parse_contact_field_update(f"set {field} to sample-value")
    assert patch is None or field not in (patch or {})


def test_contact_create_sanitizes_lead_source_to_crm() -> None:
    out = sanitize({"firstName": "Ada", "leadSource": "webinar"}, companies=[])
    assert out and out["leadSource"] == "crm"


def test_patch_contact_draft_forces_crm_lead_source() -> None:
    r = map_tool_calls_to_result(
        None,
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"firstName": "Ada", "leadSource": "webinar"},
                }
            }
        ],
        mod="contact",
        pathname="/contact?view=create",
        user_text="Ada",
        current_draft={},
    )
    patch = r.get("patch") or {}
    assert patch.get("firstName") == "Ada"
    assert patch.get("leadSource") == "crm"
