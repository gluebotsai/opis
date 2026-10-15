"""KB create draft — accept freeform / explicit categories (no hardcoded-only loop)."""

from __future__ import annotations

from unittest.mock import patch

from app.contracts import tool_ok
from app.tasks.catalog_commands import (
    _parse_kb_category,
    continue_kb_draft,
)
from app.tasks.chat_commands import resolve_chat_command


def test_parse_kb_category_explicit_and_freeform():
    known = ["General", "Troubleshooting", "Billing"]
    assert _parse_kb_category("Troubleshooting", known) == ("Troubleshooting", "ok")
    assert _parse_kb_category("category is help", known)[0] == "Help"
    assert _parse_kb_category("category is help", known)[1] == "ok"
    assert _parse_kb_category("Help Desk", known) == ("Help Desk", "ok")
    assert _parse_kb_category("other", known) == (None, "ask_custom")
    assert _parse_kb_category("new category", known) == (None, "ask_custom")
    assert _parse_kb_category("add new category", known) == (None, "ask_custom")
    assert _parse_kb_category("add a category", known) == (None, "ask_custom")
    assert _parse_kb_category("create a category", known) == (None, "ask_custom")
    assert _parse_kb_category("show me the available categories", known) == (
        None,
        "list",
    )
    assert _parse_kb_category("list", known) == (None, "list")
    # Bare "help" is a freeform category name (not meta), so the draft can proceed.
    assert _parse_kb_category("help", known) == ("Help", "ok")


def test_kb_manage_categories_add_asks_for_name_not_create_article():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    from app.tasks.catalog_commands import start_or_continue_kb_category_manage

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing"],
    ):
        listed = start_or_continue_kb_category_manage(
            "manage categories",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
        )
        assert listed and listed.get("handled")
        draft = listed.get("kb_draft") or {}
        assert draft.get("flow") == "manage_category"
        assert draft.get("awaiting") == "manage_mode"

        add = start_or_continue_kb_category_manage(
            "add",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft=draft,
            force_start=True,
        )
        assert add and add.get("handled")
        assert (add.get("kb_draft") or {}).get("awaiting") == "category_name"
        assert not any(
            isinstance(a, dict) and a.get("type") == "create_kb"
            for a in (add.get("actions") or [])
        )

        with patch(
            "app.tools.catalog_tools.manage_kb_category",
            return_value={
                "success": True,
                "payload": {"category": "AI Articles", "ui_action": "add_kb_category"},
            },
        ):
            done = start_or_continue_kb_category_manage(
                "AI Articles",
                org="org-1",
                role="admin",
                user_id="u1",
                user_name="Ada",
                page="Knowledge Base",
                kb_draft=add.get("kb_draft"),
                force_start=True,
            )
        assert done and done.get("handled")
        assert done.get("kb_draft") is None
        assert any(
            isinstance(a, dict)
            and a.get("type") == "add_kb_category"
            and a.get("category") == "AI Articles"
            for a in (done.get("actions") or [])
        )


def test_manage_kb_category_add_emits_ui_action():
    from app.tools.catalog_tools import manage_kb_category

    out = manage_kb_category(name="Hardware", mode="add")
    assert out["success"] is True
    assert out["payload"]["category"] == "Hardware"
    assert out["payload"]["ui_action"] == "add_kb_category"


def test_policy_add_category_routes_kb_not_admin():
    from app.agents.policy import apply_policy

    out = apply_policy(
        {
            "intent": "ADMIN",
            "page": "Knowledge Base",
            "user_text": "add new category",
            "messages": [],
        }
    )
    assert out.get("route") == "kb"
    assert out.get("intent") == "KB"

    out2 = apply_policy(
        {
            "intent": "CREATE",
            "page": "Knowledge Base",
            "user_text": "manage categories",
            "messages": [],
        }
    )
    assert out2.get("route") == "kb"


def test_kb_agent_binds_manage_kb_category_tool():
    from app.tools.bound import langchain_tools_for_agent

    names = {t.name for t in langchain_tools_for_agent("kb", module="kb", surface="list")}
    assert "manage_kb_category" in names
    assert "list_kb_categories" in names
    assert "export_kb" in names


def test_export_kb_payload_shape(monkeypatch):
    from app.contracts import tool_ok
    from app.tools import catalog_tools

    monkeypatch.setattr(
        catalog_tools,
        "list_kb",
        lambda **_k: tool_ok(
            {
                "data": [
                    {
                        "id": "1",
                        "title": "T",
                        "content": "C",
                        "category": "Billing",
                        "status": "Published",
                        "views": 3,
                    }
                ]
            }
        ),
    )
    out = catalog_tools.export_kb(fmt="json")
    assert out["success"] is True
    assert out["payload"]["count"] == 1
    assert out["payload"]["ui_action"] == "export_kb"
    assert out["payload"]["articles"][0]["title"] == "T"


def test_ground_add_new_category_stays_on_create_kb():
    from app.agents.workflow_nlu import ground_active_collect_decision

    decision = {
        "action": "START_CREATE_PRIORITY",
        "intent": "ADMIN",
        "operation": "CREATE_PRIORITY",
        "agent": "admin",
        "workflow": "create_priority",
    }
    out = ground_active_collect_decision(
        decision,
        workflow="create_kb",
        step="category",
        user_text="add new category",
        roster_members=[],
        draft={"awaiting": "category", "title": "automation"},
    )
    assert out["action"] == "CONTINUE_WORKFLOW"
    assert out["agent"] == "kb"
    assert out["workflow"] == "create_kb"
    assert out.get("operation") in (None, "NONE", "")


def test_ground_manage_category_add_stays_on_manage_not_create_kb():
    from app.agents.workflow_nlu import ground_active_collect_decision

    decision = {
        "action": "START_CREATE_KB",
        "intent": "CREATE",
        "operation": "CREATE_KB",
        "agent": "kb",
        "workflow": "create_kb",
    }
    out = ground_active_collect_decision(
        decision,
        workflow="manage_kb_category",
        step="manage_mode",
        user_text="add",
        roster_members=[],
        draft={"flow": "manage_category", "awaiting": "manage_mode"},
    )
    assert out["action"] == "CONTINUE_WORKFLOW"
    assert out["workflow"] == "manage_kb_category"
    assert out["agent"] == "kb"

    out2 = ground_active_collect_decision(
        {
            "action": "START_CREATE_PRIORITY",
            "intent": "ADMIN",
            "operation": "CREATE_PRIORITY",
            "agent": "admin",
        },
        workflow="create_kb",
        step="category_name",
        user_text="AI Articles",
        roster_members=[],
        draft={"flow": "manage_category", "awaiting": "category_name", "mode": "add"},
    )
    assert out2["action"] == "CONTINUE_WORKFLOW"
    assert out2["workflow"] == "manage_kb_category"


def test_hydrate_manage_category_draft_sets_manage_workflow():
    from app.workflow_state import WF_MANAGE_KB_CATEGORY, hydrate_from_legacy_drafts

    snap = hydrate_from_legacy_drafts(
        escalate_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft={"flow": "manage_category", "awaiting": "manage_mode"},
    )
    assert snap["current_workflow"] == WF_MANAGE_KB_CATEGORY
    assert snap["current_step"] == "manage_mode"


def test_continue_kb_add_new_category_asks_for_name():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing"],
    ):
        out = continue_kb_draft(
            "add new category",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "category", "title": "automation", "body": "x" * 20},
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "agent": "kb",
                "workflow": "create_kb",
            },
        )
    assert out.get("handled") is True
    assert out.get("route") == "kb"
    assert (out.get("kb_draft") or {}).get("awaiting") == "category"
    assert not any(
        isinstance(a, dict) and a.get("view") == "priorities"
        for a in (out.get("actions") or [])
    )


def test_continue_kb_early_body_stays_on_category():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    body = (
        "Key Ticketing Metrics Every Support Leader Should Track. "
        "First Response Time, MTTR, and CSAT transform support data into product insights."
    )
    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing"],
    ):
        out = continue_kb_draft(
            body,
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "category", "title": "Analytics & Reporting"},
            semantic_decision={"action": "CONTINUE_WORKFLOW", "agent": "kb"},
        )
    assert out.get("handled") is True
    assert out.get("route") == "kb"
    draft = out.get("kb_draft") or {}
    assert draft.get("awaiting") == "category"
    assert draft.get("body") == body
    assert any(
        isinstance(a, dict)
        and a.get("type") == "create_kb"
        and a.get("step") == "category"
        and a.get("body")
        for a in (out.get("actions") or [])
    )


def test_continue_kb_other_asks_custom_not_priorities():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing"],
    ):
        out = continue_kb_draft(
            "Other",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={
                "awaiting": "category",
                "title": "Analytics & Reporting",
                "body": "x" * 20,
            },
            semantic_decision={"action": "CONTINUE_WORKFLOW", "agent": "kb"},
        )
    assert out.get("route") == "kb"
    assert (out.get("kb_draft") or {}).get("awaiting") == "category"
    assert not any(
        isinstance(a, dict) and a.get("view") == "priorities"
        for a in (out.get("actions") or [])
    )


def test_kb_draft_list_categories_stays_on_category():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "How-to", "Troubleshooting"],
    ):
        out = continue_kb_draft(
            "show me the available categories",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "category", "title": "AI CHAT"},
        )
    assert out["handled"] is True
    draft = out.get("kb_draft") or {}
    assert draft.get("awaiting") == "category"
    assert draft.get("title") == "AI CHAT"
    assert not draft.get("category")


def test_kb_draft_accepts_category_is_help():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Troubleshooting"],
    ):
        out = continue_kb_draft(
            "category is help",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "category", "title": "add"},
        )
    assert out["handled"] is True
    draft = out.get("kb_draft") or {}
    assert draft.get("awaiting") == "body"
    assert draft.get("category") == "Help"
    assert draft.get("title") == "add"


def test_kb_draft_new_category_asks_for_name_not_loop():
    def _fake_phrase(**kwargs):
        ctx = kwargs.get("context") or {}
        return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General"],
    ):
        out = continue_kb_draft(
            "new category",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "category", "title": "add"},
        )
    assert out["handled"] is True
    assert (out.get("kb_draft") or {}).get("awaiting") == "category"
    assert "Billing, Troubleshooting, Accounts, or Other" not in (out.get("reply") or "")
    # Phrase stub returns nextStep hint — not a painted static chat bubble.
    reply = out.get("reply") or ""
    assert "category" in reply.lower() and "name" in reply.lower()


def test_kb_draft_via_resolve_chat_command():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ), patch(
        "app.tasks.catalog_commands.list_kb",
        create=True,
    ), patch(
        "app.tools.catalog_tools.list_kb",
        return_value=tool_ok(
            {
                "data": [
                    {"title": "A", "category": "General"},
                    {"title": "B", "category": "Troubleshooting"},
                ]
            }
        ),
    ):
        out = resolve_chat_command(
            "category is help",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            kb_draft={"awaiting": "category", "title": "Password tips"},
        )
    assert out.get("handled") is True
    assert (out.get("kb_draft") or {}).get("category") == "Help"
    assert (out.get("kb_draft") or {}).get("awaiting") == "body"


def test_kb_title_ai_is_accepted():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General"],
    ):
        out = continue_kb_draft(
            "AI",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "title"},
        )
    assert out["handled"] is True
    draft = out.get("kb_draft") or {}
    assert draft.get("title") == "AI"
    assert draft.get("awaiting") == "category"


def test_kb_confirm_publish_does_not_drop_category():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tools.catalog_tools.create_kb_article",
        return_value={"success": True, "payload": {"id": "kb-1", "title": "AI"}},
    ) as created:
        out = continue_kb_draft(
            "yes",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={
                "awaiting": "confirm",
                "title": "AI",
                "category": "General",
                "body": "Artificial Intelligence is the simulation of human intelligence.",
            },
            semantic_decision={
                "action": "CONFIRM_WORKFLOW",
                "operation": "PUBLISH_KB",
                "proposed_tool": "publish_kb_article",
            },
        )
    created.assert_not_called()
    assert out.get("handled") is False
    assert (out.get("kb_draft") or {}).get("category") == "General"
    assert (out.get("kb_draft") or {}).get("awaiting") == "confirm"


def test_kb_confirm_proceed_publishes_existing_fields():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    body = "Artificial Intelligence is the simulation of human intelligence."
    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tools.catalog_tools.create_kb_article",
        return_value={"success": True, "payload": {"id": "kb-1", "title": "AI Help"}},
    ) as created:
        out = continue_kb_draft(
            "yeah you can proceed",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={
                "awaiting": "confirm",
                "title": "AI Help",
                "category": "General",
                "body": body,
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "operation": "CREATE_KB",
                "fields": {},
            },
        )
    created.assert_not_called()
    assert out.get("handled") is False
    assert (out.get("kb_draft") or {}).get("title") == "AI Help"
    assert (out.get("kb_draft") or {}).get("awaiting") == "confirm"


def test_create_article_command_is_not_a_title():
    from app.workflow_schemas import (
        bind_awaiting_value,
        looks_like_create_kb_command,
        title_from_create_kb_utterance,
        usable_kb_title,
    )

    assert looks_like_create_kb_command("create article")
    assert looks_like_create_kb_command("create kb article")
    assert not looks_like_create_kb_command("create article titled Login issues")
    assert title_from_create_kb_utterance("create article") is None
    assert title_from_create_kb_utterance("create article titled Login issues") is None
    assert usable_kb_title("New Article") == ""
    assert bind_awaiting_value("create_kb", "title", "create article") == {}
    assert bind_awaiting_value("create_kb", "title", "New Article") == {}
    assert bind_awaiting_value(
        "create_kb", "title", "create article titled Reset VPN"
    ) == {}


def test_continue_kb_create_article_asks_title_first():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing", "Accounts"],
    ):
        start = continue_kb_draft(
            "create article",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "title"},
        )
    assert start["handled"] is True
    draft = start.get("kb_draft") or {}
    assert draft.get("awaiting") == "title"
    assert not draft.get("title")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing", "Accounts"],
    ):
        titled = continue_kb_draft(
            "create article titled Login issues",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "title"},
        )
    assert not (titled.get("kb_draft") or {}).get("title")
    assert (titled.get("kb_draft") or {}).get("awaiting") == "title"


def test_continue_kb_rejects_invented_new_article_title():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.catalog_commands._phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Billing"],
    ):
        out = continue_kb_draft(
            "create article",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Ada",
            page="Knowledge Base",
            kb_draft={"awaiting": "title", "title": "New Article"},
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {"title": "New Article"},
            },
        )
    draft = out.get("kb_draft") or {}
    assert not draft.get("title")
    assert draft.get("awaiting") == "title"
