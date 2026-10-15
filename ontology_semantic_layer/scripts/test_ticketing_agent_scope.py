#!/usr/bin/env python3
"""Unit tests for ticketing agents.id scope (no accounts.setup_users on ticket filters)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.scope import UserScope, row_scope_filter_clauses
from semantic.ticketing_scope import (
    effective_sql_scope,
    is_ticketing_product,
    job_scope_fields,
    list_scope_fields,
    ticketing_row_scope_clause,
    visible_ids_for_ticketing,
    wants_personal_scope,
)


def test_is_ticketing_product() -> None:
    assert is_ticketing_product("ticketing")
    assert not is_ticketing_product("ccaas")
    assert not is_ticketing_product("crm")


def test_admin_default_org_visible_ids() -> None:
    assert visible_ids_for_ticketing("1005", "admin") == []
    assert not wants_personal_scope("admin", user_id="1005")


def test_admin_mine_personal() -> None:
    assert visible_ids_for_ticketing("1005", "admin", data_scope="mine") == ["1005"]
    assert wants_personal_scope("admin", data_scope="mine", user_id="1005")


def test_agent_default_personal() -> None:
    assert visible_ids_for_ticketing("1004", "agent") == ["1004"]
    assert wants_personal_scope("agent", user_id="1004")


def test_resolver_dual_sql_clause() -> None:
    frag, params = ticketing_row_scope_clause(
        scope_mode="assignee",
        visible_user_ids=["1000"],
        row_scope_column="assignee_id",
        role="resolver",
        dual_assignee_resolver=True,
    )
    assert "resolver_id" in frag
    assert "assignee_id" in frag
    assert params == ["1000", "1000"]


def test_admin_org_metric_no_mf_clause() -> None:
    scope = UserScope(
        user_id="1005",
        organization_id="1000",
        role="admin",
        visible_user_ids=[],
        identity="ticketing_agents",
    )
    clauses = row_scope_filter_clauses(
        scope, metric_id="open_tickets_metric", product="ticketing"
    )
    assert clauses == []


def test_agent_personal_mf_clause() -> None:
    scope = UserScope(
        user_id="1004",
        organization_id="1000",
        role="agent",
        visible_user_ids=["1004"],
        identity="ticketing_agents",
    )
    clauses = row_scope_filter_clauses(
        scope, metric_id="open_tickets_metric", product="ticketing"
    )
    assert len(clauses) == 1
    assert "ticket__assignee" in clauses[0]
    assert "'1004'" in clauses[0]


def test_job_scope_fields_admin_org() -> None:
    scope = UserScope(
        user_id="1005",
        organization_id="1000",
        role="admin",
        visible_user_ids=[],
        identity="ticketing_agents",
    )
    fields = job_scope_fields(scope, "open_tickets_metric", product="ticketing")
    assert fields["scope"] == "org"
    assert fields["visible_user_ids"] == []


def test_job_scope_fields_agent_assignee() -> None:
    scope = UserScope(
        user_id="1004",
        organization_id="1000",
        role="agent",
        visible_user_ids=["1004"],
        identity="ticketing_agents",
    )
    fields = job_scope_fields(scope, "ticket_volume", product="ticketing")
    assert fields["scope"] == "assignee"
    assert fields["visible_user_ids"] == ["1004"]
    assert fields["scope_dual_assignee_resolver"] is False


def test_list_scope_admin_default_org() -> None:
    from sql_agent.scope_resolver import resolve_list_scope

    assert (
        resolve_list_scope(
            product="ticketing",
            table="tickets",
            instruction="list open tickets",
            has_row_scope=True,
            caller_role="admin",
        )
        == "org"
    )


def test_list_scope_admin_mine_via_plan_scope_mode() -> None:
    from sql_agent.scope_resolver import resolve_list_scope

    assert (
        resolve_list_scope(
            product="ticketing",
            table="tickets",
            instruction="show my tickets",
            has_row_scope=True,
            caller_role="admin",
            scope_mode="assignee",
        )
        == "assignee"
    )


def test_created_by_me_metric_ignores_mine_and_filters_creator() -> None:
    scope = UserScope(
        user_id="1004",
        organization_id="1000",
        role="agent",
        visible_user_ids=["1004"],
        identity="ticketing_agents",
    )
    fields = job_scope_fields(
        scope,
        "tickets_created_by_me",
        product="ticketing",
        data_scope="mine",
    )
    assert fields["scope"] == "created_by"
    assert fields["visible_user_ids"] == ["1004"]
    assert fields["scope_dual_assignee_resolver"] is False

    admin = UserScope(
        user_id="1005",
        organization_id="1000",
        role="admin",
        visible_user_ids=[],
        identity="ticketing_agents",
    )
    admin_fields = job_scope_fields(
        admin, "tickets_created_by_me", product="ticketing"
    )
    assert admin_fields["scope"] == "created_by"
    assert admin_fields["visible_user_ids"] == ["1005"]

    mode, dual = effective_sql_scope(
        "admin",
        "tickets_created_by_me",
        product="ticketing",
        data_scope="mine",
        user_id="1005",
    )
    assert mode == "created_by"
    assert dual is False

    frag, params = ticketing_row_scope_clause(
        scope_mode="created_by",
        visible_user_ids=["1005"],
        row_scope_column="assignee_id",
        role="admin",
    )
    assert "created_by_id" in frag
    assert "assignee_id" not in frag
    assert params == ["1005"]

    clauses = row_scope_filter_clauses(
        admin,
        metric_id="tickets_created_by_me",
        product="ticketing",
        data_scope="mine",
    )
    assert len(clauses) == 1
    assert "ticket__created_by" in clauses[0]
    assert "ticket__assignee" not in clauses[0]


def test_ticket_volume_mine_stays_assignee() -> None:
    scope = UserScope(
        user_id="1005",
        organization_id="1000",
        role="admin",
        visible_user_ids=[],
        identity="ticketing_agents",
    )
    fields = job_scope_fields(
        scope, "ticket_volume", product="ticketing", data_scope="mine"
    )
    assert fields["scope"] == "assignee"
    assert fields["visible_user_ids"] == ["1005"]


def test_crm_scope_unchanged_accounts_path() -> None:
    """CRM still uses accounts identity — not ticketing_agents."""
    scope = UserScope(user_id="1001", organization_id="1000", visible_user_ids=["1001"])
    fields = job_scope_fields(scope, "won_deal_rate", product="crm")
    assert fields["scope"] in ("org", "assignee")
    assert fields["visible_user_ids"] == ["1001"]


def main() -> int:
    tests = [
        test_is_ticketing_product,
        test_admin_default_org_visible_ids,
        test_admin_mine_personal,
        test_agent_default_personal,
        test_resolver_dual_sql_clause,
        test_admin_org_metric_no_mf_clause,
        test_agent_personal_mf_clause,
        test_job_scope_fields_admin_org,
        test_job_scope_fields_agent_assignee,
        test_list_scope_admin_default_org,
        test_list_scope_admin_mine_via_plan_scope_mode,
        test_created_by_me_metric_ignores_mine_and_filters_creator,
        test_ticket_volume_mine_stays_assignee,
        test_crm_scope_unchanged_accounts_path,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
