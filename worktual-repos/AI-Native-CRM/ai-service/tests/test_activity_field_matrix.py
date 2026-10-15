"""Activities create field matrix — MCP catalog, draft patch, parsers."""

from __future__ import annotations

import pytest

from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.draft_conversation import (
    activity_draft_ready,
    apply_activity_slot_answer,
    parse_activity_type,
    propose_create_activity_proposal,
)
from app.agents.misc_draft_agents import sanitize_activity
from app.mcp.catalog import list_tools

CONTACT_ID = "c-matrix-1"

CREATE_DRAFT_FIELDS: list[tuple[str, str]] = [
    ("contactId", CONTACT_ID),
    ("contactName", "Jane Doe"),
    ("subject", "Follow up call"),
    ("type", "call"),
    ("dueAt", "2026-12-01"),
    ("body", "Discuss renewal"),
]

TYPE_PHRASES: list[tuple[str, str]] = [
    ("log a call", "call"),
    ("schedule a meeting", "meeting"),
    ("send an email", "email"),
    ("text message", "sms"),
    ("add a note", "note"),
    ("create a task", "task"),
]

SLOT_ANSWERS: list[tuple[str, str, str]] = [
    ("Follow up tomorrow", "subject", "Follow up tomorrow"),
    ("2026-11-20", "dueAt", "2026-11-20"),
    ("Details in CRM", "body", "Details in CRM"),
]


def _catalog_create_patch_keys() -> set[str]:
    for tool in list_tools(module="activities", surface="create"):
        if tool.get("name") == "patch_activity_draft":
            props = (tool.get("inputSchema") or {}).get("properties") or {}
            return set(props.keys())
    return set()


def test_catalog_covers_create_draft_matrix() -> None:
    catalog_keys = _catalog_create_patch_keys()
    matrix_keys = {f for f, _ in CREATE_DRAFT_FIELDS}
    missing = matrix_keys - catalog_keys
    assert not missing, f"CREATE_DRAFT_FIELDS not in MCP catalog: {missing}"


def test_activity_draft_ready_requires_contact_and_subject() -> None:
    assert not activity_draft_ready({})
    assert not activity_draft_ready({"contactId": CONTACT_ID})
    assert activity_draft_ready({"contactId": CONTACT_ID, "subject": "Hi"})


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_patch_activity_draft_maps_each_create_field(field: str, value: str) -> None:
    r = map_tool_calls_to_result(
        None,
        [{"function": {"name": "patch_activity_draft", "arguments": {field: value}}}],
        mod="activities",
        pathname="/activities/log",
        user_text=f"set {field}",
        current_draft={},
    )
    patch = r.get("patch") or {}
    assert field in patch, patch


def test_sanitize_activity_keeps_trusted_contact_id_outside_catalog_slice():
    patch = {"contactId": "c-trusted", "subject": "Meet"}
    out = sanitize_activity(
        patch,
        [{"id": "c-other", "displayName": "Other"}],
        trusted_contact_ids={"c-trusted"},
    )
    assert out is not None
    assert out.get("contactId") == "c-trusted"
    assert out.get("subject") == "Meet"


@pytest.mark.parametrize("field,value", CREATE_DRAFT_FIELDS)
def test_sanitize_activity_keeps_supported_fields(field: str, value: str) -> None:
    contacts = [{"id": CONTACT_ID, "displayName": "Jane"}]
    patch = {field: value}
    out = sanitize_activity(patch, contacts)
    if field == "contactName":
        assert out is None or field not in out
        return
    if field == "contactId" and value != CONTACT_ID:
        pytest.skip("contact id mismatch")
    assert out and field in out


def test_propose_create_activity_when_draft_ready_and_confirm() -> None:
    draft = {"contactId": CONTACT_ID, "subject": "Log this", "type": "call"}
    assert activity_draft_ready(draft)
    r = map_tool_calls_to_result(
        "Yes save it",
        [],
        mod="activities",
        pathname="/activities/log",
        user_text="yes save it",
        current_draft=draft,
    )
    props = r.get("toolProposals") or []
    create = next((p for p in props if p.get("name") == "propose_create_activity"), None)
    assert create, props


def test_propose_create_activity_proposal_helper() -> None:
    prop = propose_create_activity_proposal()
    assert prop["name"] == "propose_create_activity"
    assert prop["args"].get("auto") is True


@pytest.mark.parametrize("phrase,expected", TYPE_PHRASES)
def test_parse_activity_type_phrases(phrase: str, expected: str) -> None:
    assert parse_activity_type(phrase) == expected


@pytest.mark.parametrize("text,field,expected", SLOT_ANSWERS)
def test_apply_activity_slot_answer(text: str, field: str, expected: str) -> None:
    draft = {"contactId": CONTACT_ID, "type": "call"}
    if field == "subject":
        draft = {"contactId": CONTACT_ID, "type": "call"}
    elif field == "dueAt":
        draft = {"contactId": CONTACT_ID, "type": "task", "subject": "Task"}
    elif field == "body":
        draft = {
            "contactId": CONTACT_ID,
            "type": "call",
            "subject": "Call",
            "dueAt": "2026-01-01",
        }
    patch = apply_activity_slot_answer(
        text,
        draft,
        [{"id": CONTACT_ID, "displayName": "Jane"}],
    )
    assert patch and str(patch.get(field)) == expected, patch
