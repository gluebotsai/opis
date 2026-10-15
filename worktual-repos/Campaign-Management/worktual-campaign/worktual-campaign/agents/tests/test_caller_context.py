"""Caller context + data scope for reports/monitoring agents."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.reports.org_context import (
    _caller_context_matches,
    caller_context_prompt_block,
    resolve_session_context,
    scope_note,
)


@pytest.mark.asyncio
async def test_resolve_session_context_admin_from_jwt():
    session: dict = {}
    token = "jwt-token"
    payload = {
        "sub": "user-1",
        "role": "admin",
        "email": "admin@example.com",
        "name": "Admin User",
        "organizationId": "org-1",
        "branchId": "branch-1",
    }
    with patch("app.agents.reports.org_context.decode_token", return_value=payload):
        with patch("app.agents.reports.org_context.user_id_from_token", return_value="user-1"):
            with patch("app.agents.reports.org_context.save_session", new_callable=AsyncMock):
                ctx = await resolve_session_context(session, token, persist=False)

    assert ctx["is_admin"] is True
    assert ctx["data_scope"] == "org"
    assert ctx["scope_label"] == "All branch campaigns"
    assert ctx["organization_id"] == "org-1"


@pytest.mark.asyncio
async def test_resolve_session_context_employee_mine_scope():
    session: dict = {}
    token = "jwt-token"
    payload = {
        "sub": "user-2",
        "role": "user",
        "email": "emp@example.com",
        "name": "Employee",
        "organizationId": "org-1",
        "branchId": "branch-1",
    }
    with patch("app.agents.reports.org_context.decode_token", return_value=payload):
        with patch("app.agents.reports.org_context.user_id_from_token", return_value="user-2"):
            with patch("app.agents.reports.org_context.save_session", new_callable=AsyncMock):
                ctx = await resolve_session_context(session, token, persist=False)

    assert ctx["is_admin"] is False
    assert ctx["data_scope"] == "mine"
    assert ctx["scope_label"] == "Your campaigns"


def test_caller_context_prompt_block_mine():
    block = caller_context_prompt_block(
        {
            "user_id": "u1",
            "name": "Employee",
            "role": "user",
            "data_scope": "mine",
            "scope_label": "Your campaigns",
        }
    )
    assert "your campaigns" in block.lower()
    assert "mine" in block.lower()


def test_caller_context_prompt_block_org():
    block = caller_context_prompt_block(
        {
            "user_id": "u1",
            "name": "Admin",
            "role": "admin",
            "data_scope": "org",
            "scope_label": "All branch campaigns",
        }
    )
    assert "branch-wide" in block.lower()


def test_caller_context_prompt_block_empty_without_user():
    assert caller_context_prompt_block(None) == ""
    assert caller_context_prompt_block({}) == ""


def test_caller_context_prompt_admin_by_me_rule():
    block = caller_context_prompt_block(
        {
            "user_id": "u1",
            "name": "Admin",
            "role": "admin",
            "data_scope": "org",
            "scope_label": "All branch campaigns",
        }
    )
    assert "branch-wide" in block.lower()
    assert "by me" in block.lower()


@pytest.mark.asyncio
async def test_resolve_session_context_refreshes_when_role_changes():
    session = {
        "caller_context": {
            "user_id": "user-1",
            "email": "a@b.com",
            "name": "User",
            "role": "user",
            "data_scope": "mine",
            "scope_label": "Your campaigns",
        }
    }
    payload = {
        "sub": "user-1",
        "role": "admin",
        "email": "a@b.com",
        "name": "User",
        "organizationId": "org-1",
    }
    with patch("app.agents.reports.org_context.decode_token", return_value=payload):
        with patch("app.agents.reports.org_context.user_id_from_token", return_value="user-1"):
            with patch("app.agents.reports.org_context.save_session", new_callable=AsyncMock):
                ctx = await resolve_session_context(session, "token", persist=False)

    assert ctx["role"] == "admin"
    assert ctx["data_scope"] == "org"


def test_caller_context_matches():
    fresh = {
        "user_id": "1",
        "role": "admin",
        "data_scope": "org",
        "email": "a@b.com",
        "scope_label": "All branch campaigns",
    }
    assert _caller_context_matches(fresh, dict(fresh))
    stale = dict(fresh)
    stale["role"] = "user"
    assert not _caller_context_matches(stale, fresh)


def test_scope_note():
    assert "scope_applied=mine" in scope_note({"data_scope": "mine", "scope_label": "Your campaigns"})
