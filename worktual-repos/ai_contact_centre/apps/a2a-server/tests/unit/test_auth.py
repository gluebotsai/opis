"""Auth helper tests."""

import pytest

from cc_a2a.auth import (
    AuthError,
    CallerContext,
    HUB_ALL_TENANTS_ID,
    assert_tenant_access,
    authenticate_request,
    has_scope,
    resolve_caller_organization_id,
)
from cc_a2a.config import A2ASettings


def test_dev_auth() -> None:
    settings = A2ASettings(
        A2A_ALLOW_DEV_AUTH=True,
        A2A_ENABLED=True,
    )
    caller = authenticate_request(
        settings,
        authorization="Bearer dev",
        tenant_header="99",
        client_header="hub-qa",
    )
    assert caller.client_id == "hub-qa"
    assert "99" in caller.organization_ids
    assert caller.execution_profile == "hub-delegated"


def test_tenant_mismatch() -> None:
    caller = CallerContext(
        subject="hub:x",
        client_id="x",
        organization_ids=frozenset({"1"}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    with pytest.raises(AuthError):
        assert_tenant_access(caller, "2")


def test_all_tenant_access() -> None:
    caller = CallerContext(
        subject="hub:x",
        client_id="x",
        organization_ids=frozenset({HUB_ALL_TENANTS_ID}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    assert_tenant_access(caller, "1000")
    assert_tenant_access(caller, "1003")


def test_resolve_caller_organization_id() -> None:
    single_tenant = CallerContext(
        subject="hub:x",
        client_id="x",
        organization_ids=frozenset({"1003"}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    assert resolve_caller_organization_id(single_tenant) == "1003"

    wildcard = CallerContext(
        subject="hub:x",
        client_id="x",
        organization_ids=frozenset({HUB_ALL_TENANTS_ID}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    assert resolve_caller_organization_id(wildcard) == ""
    assert (
        resolve_caller_organization_id(
            wildcard,
            organization_id="1003",
        )
        == "1003"
    )


def test_scope_wildcard() -> None:
    caller = CallerContext(
        subject="hub:x",
        client_id="x",
        organization_ids=frozenset({"1"}),
        scopes=frozenset({"cc.contact.*"}),
        execution_profile="hub-delegated",
    )
    assert has_scope(caller, "cc.contact.read")
    assert not has_scope(caller, "cc.queue.write")
