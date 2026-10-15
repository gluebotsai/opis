"""Phase 2–4 domain tools + catalog chat drafts."""

from __future__ import annotations

from unittest.mock import patch

from app.contracts import tool_ok
from app.tools.catalog_tools import (
    create_kb_article,
    create_queue,
    create_widget,
    delete_queue,
    export_analytics,
    get_csat_reports,
    get_metrics,
    list_audit,
    list_customers,
    list_escalation_directory,
    list_integration_keys,
    list_kb,
    list_queues,
    list_widgets,
    mark_all_notifications_read,
    update_org_preferences,
    update_priority,
    update_status,
)
from app.tools.registry import tools_for_agent


def test_registry_phase2_allowlists():
    assert "create_queue" in tools_for_agent("teams")
    assert "list_agents" in tools_for_agent("teams")
    assert "create_kb_article" in tools_for_agent("kb")
    assert "get_kb" in tools_for_agent("kb")
    assert "update_kb_article" in tools_for_agent("kb")
    assert "publish_kb_article" in tools_for_agent("kb")
    assert "list_customers" in tools_for_agent("customers")
    assert "import_customers" in tools_for_agent("customers")
    assert "get_customer_360" in tools_for_agent("customers")
    assert "auto_assign_ticket" in tools_for_agent("tickets")
    assert "get_metrics" in tools_for_agent("general")
    assert "update_org_preferences" in tools_for_agent("general")
    assert "update_macro" in tools_for_agent("macros")
    assert "get_csat_reports" in tools_for_agent("admin")
    assert "list_audit" in tools_for_agent("admin")
    assert "list_escalation_directory" in tools_for_agent("admin")
    assert "list_widgets" in tools_for_agent("admin")
    assert "list_integration_keys" in tools_for_agent("admin")


def test_create_queue_tool_path():
    calls = []

    def fake(method, path, **kwargs):
        calls.append((method, path, kwargs.get("json_body")))
        return tool_ok({"id": "q1", "queueName": "Ops"})

    with patch("app.tools.catalog_tools.express_request", side_effect=fake):
        out = create_queue(name="Ops", description="d")
    assert out["success"]
    assert calls[0][0] == "POST"
    assert calls[0][1] == "/api/queues"
    assert calls[0][2]["queueName"] == "Ops"


def test_create_kb_tool_path():
    calls = []

    def fake(method, path, **kwargs):
        calls.append((method, path, kwargs.get("json_body")))
        return tool_ok({"id": "k1"})

    with patch("app.tools.catalog_tools.express_request", side_effect=fake):
        out = create_kb_article(
            title="Reset password",
            content="Step one then two for reset.",
            category="Accounts",
        )
    assert out["success"]
    assert calls[0][1] == "/api/kb"


def test_catalog_reads_and_prefs_tools():
    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok([]),
    ) as m:
        assert list_queues()["success"]
        assert list_kb()["success"]
        assert list_customers()["success"]
        assert get_metrics()["success"]
        assert m.call_count == 4

    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok({"ok": True}),
    ) as m:
        assert update_org_preferences(display_timezone="UTC")["success"]
        assert mark_all_notifications_read()["success"]
        assert m.call_count == 2


def test_delete_queue_path():
    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok({}),
    ) as m:
        assert delete_queue("1901")["success"]
        assert m.call_args[0][0] == "DELETE"


def test_team_and_kb_draft_chat():
    from app.tasks.chat_commands import resolve_chat_command

    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ):
        start = resolve_chat_command(
            "create team",
            organization_id="org-1",
            user_role="admin",
            workflow_decision={
                "action": "START_CREATE_TEAM",
                "operation": "CREATE_TEAM",
            },
        )
        assert start.get("team_draft") == {"awaiting": "name"}
        assert any(a.get("type") == "create_team" for a in (start.get("actions") or []))

        named = resolve_chat_command(
            "Night Shift",
            organization_id="org-1",
            user_role="admin",
            team_draft={"awaiting": "name"},
        )
        assert named.get("team_draft", {}).get("awaiting") == "description"
        assert named.get("team_draft", {}).get("name") == "Night Shift"

        kb = resolve_chat_command(
            "create kb article",
            organization_id="org-1",
            user_role="admin",
            workflow_decision={
                "action": "START_CREATE_KB",
                "operation": "CREATE_KB",
            },
        )
        assert kb.get("kb_draft") == {"awaiting": "title"}

        secrets = resolve_chat_command(
            "change my password",
            organization_id="org-1",
            user_role="agent",
        )
        assert secrets.get("handled") is True
        assert any(
            a.get("type") == "navigate" and a.get("view") == "settings"
            for a in (secrets.get("actions") or [])
        )


def test_delete_team_chat_asks_confirm_for_admin():
    from app.tasks.catalog_commands import start_or_continue_delete_team

    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    queues = {
        "success": True,
        "payload": {"data": [{"id": "q-nlp", "queueName": "nlp", "name": "nlp"}]},
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=queues
    ):
        out = start_or_continue_delete_team(
            "delete team nlp",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            semantic_decision={"operation": "DELETE_TEAM", "entity_name": "nlp"},
        )
    assert out and out.get("handled") is True
    assert out.get("team_draft", {}).get("awaiting") == "delete_confirm"
    assert out.get("team_draft", {}).get("name") == "nlp"
    assert any(
        a.get("type") == "delete_team"
        for a in (out.get("actions") or [])
        if isinstance(a, dict)
    )
    assert any(
        a.get("type") == "delete_team" and a.get("step") == "confirm"
        for a in (out.get("actions") or [])
        if isinstance(a, dict)
    )


def test_delete_macro_tool_path():
    """Macros delete tool + chat confirm path both hit Express DELETE."""
    from app.tools.macro_write import delete_macro, update_macro

    with patch(
        "app.tools.macro_write.express_request",
        return_value=tool_ok({}),
    ) as m:
        out = delete_macro("1903")
    assert out["success"] is True
    assert m.call_args[0][0] == "DELETE"

    with patch(
        "app.tools.macro_write.express_request",
        return_value=tool_ok({"id": "1903"}),
    ) as m:
        patched = update_macro("1903", body="Updated body")
    assert patched["success"] is True
    assert m.call_args[0][0] == "PATCH"
    assert m.call_args[0][1].endswith("/api/macros/1903")


def test_admin_report_and_catalog_tool_paths():
    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok({"avgScore": None, "ratings": 0}),
    ) as m:
        assert get_csat_reports(chart_range="30days")["success"]
        assert m.call_args[0][1] == "/api/csat-reports"
        assert (m.call_args.kwargs.get("params") or {}).get("range") == "30days"

    exported = export_analytics(chart_range="7days")
    assert exported["success"] is True
    assert exported["payload"]["href"].startswith("/api/analytics/export")

    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok([]),
    ) as m:
        assert list_audit(limit=20, actor="Mohamed", ticket="13189")["success"]
        assert m.call_args[0][1] == "/api/audit"
        params = m.call_args.kwargs.get("params") or {}
        assert params.get("actor") == "Mohamed"
        assert params.get("ticket") == "13189"
        assert list_escalation_directory(skill="frontend")["success"]
        assert m.call_args[0][1] == "/api/escalation-directory"

    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok({"id": "p1"}),
    ) as m:
        assert update_priority("1901", resolution_hours=6)["success"]
        assert m.call_args[0][0] == "PATCH"
        assert update_status("1902", active=False)["success"]
        assert m.call_args[0][0] == "PATCH"

    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok({"widgets": [], "keys": [{"keyPrefix": "wt_live_abcdef1234567890"}]}),
    ):
        assert list_widgets()["success"]
        assert create_widget(name="Website Help")["success"]
        keys = list_integration_keys()
        assert keys["success"] is True
        prefix = keys["payload"]["keys"][0]["keyPrefix"]
        assert "…" in prefix or len(prefix) <= 16

    with patch(
        "app.tools.catalog_tools.express_request",
        return_value=tool_ok({"ok": True}),
    ) as m:
        assert update_org_preferences(
            ticket_prefix="TKT",
            display_timezone="Asia/Kolkata",
            portal_auth_mode="otp",
            business_type="b2b",
        )["success"]
        body = m.call_args.kwargs.get("json_body") or {}
        assert body["ticketPrefix"] == "TKT"
        assert body["displayTimezone"] == "Asia/Kolkata"
        assert body["portalAuthMode"] == "otp"
        assert body["businessType"] == "b2b"


def test_remove_members_chat_admin():
    from app.tasks.catalog_commands import start_or_continue_remove_team_members

    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    queues = {
        "success": True,
        "payload": {
            "data": [
                {
                    "id": "q-nlp",
                    "queueName": "nlp",
                    "name": "nlp",
                    "members": ["Deva", "Fazil", "Raghu"],
                }
            ]
        },
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=queues
    ), patch(
        "app.tools.catalog_tools.update_queue",
        return_value=tool_ok({"id": "q-nlp"}),
    ) as upd:
        out = start_or_continue_remove_team_members(
            "remove Deva from team nlp",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
            resolved_team_name="nlp",
            resolved_member_names=["Deva"],
        )
    assert out and out.get("handled") is True
    assert out.get("team_draft") is None
    upd.assert_called_once()
    kwargs = upd.call_args.kwargs
    assert kwargs.get("add_members") is False
    assert "Deva" not in (kwargs.get("members") or [])
    assert "Fazil" in (kwargs.get("members") or [])
