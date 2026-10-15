"""Comprehensive UI-actions cases across modules / filters / questions."""

from __future__ import annotations

import pytest

from app.tasks.ui_actions import _fallback, _sanitize_actions, resolve_ui_actions

LIST_CLEAR = [
    ("list all", "Customers", "customers"),
    ("show all", "Customers", "customers"),
    ("show everyone", "Customers", "customers"),
    ("clear filter", "Customers", "customers"),
    ("clear filters", "Customers", "customers"),
    ("reset search", "Customers", "customers"),
    ("show all", "Knowledge Base", "kb"),
    ("list all", "Teams", "teams"),
]

QUESTIONS = [
    ("how many customers are there?", "Customers"),
    ("how many tickets do I have?", "Tickets"),
    ("how many teams are there?", "Teams"),
    ("what customers do we have?", "Customers"),
]


@pytest.mark.parametrize("msg,page,mod", LIST_CLEAR)
def test_list_or_clear_empties_query(msg: str, page: str, mod: str):
    out = resolve_ui_actions(msg, page=page)
    assert out["actions"], out
    hit = next(
        (
            a
            for a in out["actions"]
            if (
                a.get("type") == "set_filter"
                and a.get("module") == mod
                and a.get("query") == ""
            )
            or (
                a.get("type") == "clear_filters"
                and a.get("module") in (mod, "all")
            )
        ),
        None,
    )
    assert hit is not None, out


@pytest.mark.parametrize("msg,page", QUESTIONS)
def test_questions_emit_no_filter_actions(msg: str, page: str):
    out = resolve_ui_actions(msg, page=page)
    assert out["actions"] == []


def test_sanitize_never_keeps_list_all_phrase():
    cleaned = _sanitize_actions(
        [
            {"type": "set_filter", "module": "customers", "query": "list all"},
            {"type": "set_filter", "module": "tickets", "query": "show all"},
            {"type": "set_filter", "module": "kb", "query": "clear filter"},
            {"type": "set_filter", "module": "customers", "query": "Acme"},
        ],
        "Customers",
    )
    assert cleaned[0]["query"] == ""
    assert cleaned[1]["query"] == ""
    assert cleaned[2]["query"] == "Acme"


def test_find_customer_does_not_use_full_utterance():
    out = resolve_ui_actions("find customer Acme", page="Customers")
    for a in out.get("actions") or []:
        if a.get("type") == "set_filter":
            q = str(a.get("query") or "")
            assert "find customer" not in q.lower()
            assert q.lower() != "find customer acme"


def test_find_customer_navigates_to_customers_not_inbox():
    out = resolve_ui_actions("find customer Acme", page="Team inbox")
    views = [
        a.get("view")
        for a in (out.get("actions") or [])
        if a.get("type") == "navigate"
    ]
    assert "customers" in views
    assert "team-inbox" not in views
    assert "tickets-list" not in views
    filt = next(
        (
            a
            for a in (out.get("actions") or [])
            if a.get("type") == "set_filter" and a.get("module") == "customers"
        ),
        None,
    )
    assert filt is not None
    assert str(filt.get("query") or "").lower() == "acme"

    bare = resolve_ui_actions("show customers", page="Macros")
    assert any(
        a.get("type") == "navigate" and a.get("view") == "customers"
        for a in (bare.get("actions") or [])
    )


@pytest.mark.parametrize(
    "page,mod",
    [
        ("Team inbox", "tickets"),
        ("team-inbox", "tickets"),
        ("team-queue", "tickets"),
        ("Teams", "teams"),
        ("agent-queues", "teams"),
        ("My Tickets", "tickets"),
        ("Customers", "customers"),
        ("Knowledge Base", "kb"),
    ],
)
def test_module_from_page(page: str, mod: str):
    from app.tasks.ui_actions import _module_from_page

    assert _module_from_page(page) == mod


def test_sanitize_rejects_parallel_ticket_facets():
    cleaned = _sanitize_actions(
        [
            {
                "type": "set_filter",
                "module": "tickets",
                "query": "",
                "status": "open",
                "priority": "urgent",
                "channel": "email",
            }
        ],
        "Tickets",
    )
    assert cleaned == []


def test_created_by_me_has_no_legacy_ui_action():
    out = _fallback("show tickets created by me", "Home")
    assert out["actions"] == []


def test_contextual_list_tickets_preserves_current_filter():
    out = _fallback("list that tickets", "All tickets")
    assert out["actions"] == []


def test_fallback_open_urgent_tickets_is_agent_owned():
    out = resolve_ui_actions("open urgent tickets", page="Dashboard")
    assert out["actions"] == []


def test_recent_activity_navigates_dashboard_not_audit():
    out = resolve_ui_actions("show recent activity", page="Home")
    assert out["actions"] == [{"type": "navigate", "view": "dashboard"}]
    audit = resolve_ui_actions("open audit log", page="Home")
    assert audit["actions"][0]["view"] == "audit"


def test_priority_wise_tickets_is_agent_owned():
    out = resolve_ui_actions("show priority wise tickets", page="Home")
    assert out["actions"] == []


def test_fallback_active_customers():
    out = resolve_ui_actions("show active customers", page="Customers")
    filt = next(a for a in out["actions"] if a.get("type") == "set_filter")
    assert filt["module"] == "customers"
    assert filt.get("status") == "Active"
    assert filt.get("query") == ""


def test_question_open_tickets_no_filter():
    out = resolve_ui_actions("how many open tickets are there?", page="Tickets")
    assert out["actions"] == []


FACET_CASES = [
    ("show inactive customers", "Customers", "Inactive", None, None),
    ("show active customers", "Customers", "Active", None, None),
]


@pytest.mark.parametrize("msg,page,status,priority,channel", FACET_CASES)
def test_facet_fallbacks(msg, page, status, priority, channel):
    out = resolve_ui_actions(msg, page=page)
    filt = next(
        (a for a in out["actions"] if a.get("type") == "set_filter"),
        None,
    )
    assert filt is not None, out
    if status:
        assert filt.get("status") == status, filt
    if priority:
        assert filt.get("priority") == priority, filt
    if channel:
        assert filt.get("channel") == channel, filt
    assert filt.get("module") == "customers"


def test_sanitize_drops_bogus_facets():
    cleaned = _sanitize_actions(
        [
            {
                "type": "set_filter",
                "module": "tickets",
                "query": "Acme",
                "status": "not-a-status",
                "priority": "banana",
                "channel": "fax",
            }
        ],
        "Tickets",
    )
    assert cleaned == []


def test_sanitize_maps_known_ticket_status():
    cleaned = _sanitize_actions(
        [
            {
                "type": "set_filter",
                "module": "tickets",
                "query": "",
                "status": "in progress",
            }
        ],
        "Tickets",
    )
    assert cleaned == []


def test_sanitize_customer_status():
    cleaned = _sanitize_actions(
        [
            {
                "type": "set_filter",
                "module": "customers",
                "query": "",
                "status": "inactive",
            }
        ],
        "Customers",
    )
    assert cleaned[0]["status"] == "Inactive"


def test_sanitize_keeps_admin_module_filters():
    cleaned = _sanitize_actions(
        [
            {"type": "set_filter", "module": "macros", "query": "password"},
            {"type": "set_filter", "module": "analytics", "query": "", "range": "7days"},
            {"type": "set_filter", "module": "csat", "query": "", "range": "30days"},
            {"type": "set_filter", "module": "audit", "query": "13189", "range": "yesterday"},
            {"type": "set_filter", "module": "directory", "query": "frontend"},
        ],
        "Analytics",
    )
    by_mod = {
        a.get("module"): a
        for a in cleaned
        if isinstance(a, dict) and a.get("type") == "set_filter"
    }
    assert set(by_mod) >= {"macros", "analytics", "csat", "audit", "directory"}
    assert by_mod["macros"]["query"] == "password"
    assert by_mod["analytics"]["range"] == "7days"
    assert by_mod["csat"]["range"] == "30days"
    assert by_mod["audit"]["query"] == "13189"
    assert by_mod["directory"]["query"] == "frontend"


def test_sanitize_keeps_admin_refresh_and_download():
    cleaned = _sanitize_actions(
        [
            {"type": "refresh_analytics"},
            {"type": "refresh_csat"},
            {"type": "refresh_audit"},
            {"type": "refresh_priorities"},
            {"type": "refresh_org_preferences"},
            {"type": "refresh_macros"},
            {"type": "download", "href": "/api/analytics/export?range=7days", "filename": "a.csv"},
            {"type": "download", "href": "https://evil.example/steal.csv"},
        ],
        "Analytics",
    )
    types = [a.get("type") for a in cleaned]
    assert "refresh_analytics" in types
    assert "refresh_macros" in types
    assert any(a.get("type") == "download" and a.get("href", "").startswith("/api/") for a in cleaned)
    assert not any(
        a.get("type") == "download" and str(a.get("href") or "").startswith("https://")
        for a in cleaned
    )


def test_admin_metric_questions_emit_no_filters():
    for msg, page in (
        ("how many macros are there?", "Macros"),
        ("what is the CSAT average?", "CSAT reports"),
        ("how many audit logs yesterday?", "Audit"),
    ):
        out = resolve_ui_actions(msg, page=page)
        assert out["actions"] == []
