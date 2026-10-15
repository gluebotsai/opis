"""next_creation_prompt_field — flow order with skip awareness."""

from __future__ import annotations

from app.agents.contacts.draft_ingest import (
    empty_draft,
    next_creation_prompt_field,
    soft_missing_fields,
)


def test_next_field_after_first_name():
    draft = {**empty_draft(), "first_name": "Ada"}
    assert next_creation_prompt_field(draft) == "last_name"


def test_next_field_after_skip_last_name():
    draft = {
        **empty_draft(),
        "first_name": "Ada",
        "pack_fields_skipped": "last_name",
    }
    assert next_creation_prompt_field(draft) == "email"


def test_next_field_after_email_with_skip():
    draft = {
        **empty_draft(),
        "first_name": "Ada",
        "email": "ada@example.com",
        "pack_fields_skipped": "last_name",
    }
    assert next_creation_prompt_field(draft, campaign_profile={"mode": "b2b"}) == "phone"


def test_next_field_after_both_channels_skipped():
    draft = {
        **empty_draft(),
        "first_name": "Ada",
        "pack_fields_skipped": "last_name,email,phone",
    }
    assert next_creation_prompt_field(draft) is None


def test_soft_missing_excludes_skipped():
    draft = {**empty_draft(), "pack_fields_skipped": "company_name"}
    assert "company_name" not in soft_missing_fields(draft, campaign_profile={"mode": "b2b"})
