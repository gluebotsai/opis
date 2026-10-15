"""MAS contact skills — registry, tool boundaries, pause/resume, harness."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.mas.skills import (
    CONTACTS_MODULE,
    SkillStateStore,
    apply_skill_pick,
    get_active_skill_id,
    get_skill_registry,
)
from app.mas.skills.harness import evaluate_skill_outcome


@pytest.fixture(autouse=True)
def _fresh_registry():
    """Each test gets a clean registry with contacts skills registered."""
    import app.mas.skills.registry as reg_mod

    reg_mod._default_registry = None
    yield
    reg_mod._default_registry = None


def _tool_names(tools: list) -> set[str]:
    return {t["function"]["name"] for t in tools}


def test_registry_lists_three_contact_skills():
    registry = get_skill_registry()
    skills = registry.list_module(CONTACTS_MODULE)
    assert {s.skill_id for s in skills} == {
        "contact_creation",
        "contact_update",
        "contact_view",
    }


def test_creation_skill_tools_static_allowlist():
    registry = get_skill_registry()
    names = _tool_names(registry.tools_for_skill(CONTACTS_MODULE, "contact_creation"))
    assert names == {
        "CREATE_BULK_CONTACT",
        "CREATE_SINGLE_CONTACT",
        "GET_CONTACT_DETAIL",
        "SET_DRAFT_FIELDS",
    }
    assert "UPDATE_SINGLE_CONTACT" not in names
    assert "CONTACT_VIEW_AND_DOWNLOAD" not in names


def test_update_skill_tools_exclude_create():
    registry = get_skill_registry()
    names = _tool_names(registry.tools_for_skill(CONTACTS_MODULE, "contact_update"))
    assert names == {
        "GET_CONTACT_DETAIL",
        "SET_DRAFT_FIELDS",
        "UPDATE_BULK_CONTACT",
        "UPDATE_SINGLE_CONTACT",
    }
    assert "CREATE_SINGLE_CONTACT" not in names


def test_view_skill_tools_are_read_only():
    registry = get_skill_registry()
    names = _tool_names(registry.tools_for_skill(CONTACTS_MODULE, "contact_view"))
    assert names == {"VIEW_CONTACT", "QUERY_CONTACTS"}


def test_evaluate_skill_outcome_complete_on_create():
    outcome = evaluate_skill_outcome(
        "contact_creation",
        tool_results=[("CREATE_SINGLE_CONTACT", {"ok": True})],
        user_text="yes create",
        ui_events=[],
    )
    assert outcome["complete"] is True
    assert outcome["needs_input"] is False


def test_evaluate_skill_outcome_needs_input_when_no_tools():
    outcome = evaluate_skill_outcome(
        "contact_creation",
        tool_results=[],
        user_text="pujitha",
        ui_events=[],
    )
    assert outcome["complete"] is False
    assert outcome["needs_input"] is True


def test_pause_and_switch_preserves_snapshot():
    session: dict = {
        "draft_contact": {"first_name": "Ada", "email": "a@b.com"},
        "draft_mode": "create",
    }
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_creation",
        skill_action="new_task",
    )
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_update",
        skill_action="pause_and_switch",
    )
    state = session["module_skills"]["contacts"]
    assert state["active"]["skill_id"] == "contact_update"
    assert len(state["paused"]) == 1
    paused = state["paused"][0]
    assert paused["skill_id"] == "contact_creation"
    assert paused["snapshot"]["draft_contact"]["first_name"] == "Ada"


def test_resume_restores_paused_skill():
    session: dict = {"draft_contact": {"first_name": "Bob"}}
    store = SkillStateStore()
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_creation",
        skill_action="new_task",
    )
    store.pause_active(session, CONTACTS_MODULE, reason="test")
    session["draft_contact"] = {"first_name": "Changed"}
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_creation",
        skill_action="resume",
    )
    assert get_active_skill_id(session, CONTACTS_MODULE) == "contact_creation"
    assert session["draft_contact"]["first_name"] == "Bob"


def test_active_create_when_draft_has_first_name():
    from app.mas.skills.state import is_active_contact_creation

    session = {
        "draft_contact": {"first_name": "Pujitha"},
        "module_skills": {"contacts": {"active": None, "paused": []}},
    }
    assert is_active_contact_creation(session) is True


def test_build_prompt_includes_skill_and_industry():
    from app.agents.contacts.prompts import build_contacts_executor_system_prompt

    session = {
        "session_id": "s1",
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {"first_name": "Pujitha"},
        "campaign_profile": {"mode": "b2b", "industry_type": "saas"},
        "module_skills": {},
    }
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_creation",
        skill_action="new_task",
    )
    prompt = build_contacts_executor_system_prompt(
        session, "contact", skill_id="contact_creation", module_hint="contacts"
    )
    assert "contact_creation" in prompt
    assert "Skill progress" not in prompt
    assert "industry_context" in prompt
    assert "MAS runtime (shared with Super + Domain)" in prompt
    assert "panel sync tool" in prompt.lower() or "Panel behavior" in prompt


def test_sticky_entry_still_runs_domain_llm():
    async def run():
        with patch(
            "app.mas.domains.audience.runner.select_audience_skill",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            from app.mas.skills.selector import SkillPick

            mock_pick.return_value = SkillPick(
                ok=True,
                executor_id="contact",
                skill_id="contact_creation",
                skill_action="continue",
            )
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "Got phone",
                "result": {"tool_results": [], "skill_outcome": {"complete": False}},
            }
            from app.mas.domains.audience.runner import run_audience_domain

            session = {
                "session_id": "s-sticky",
                "module": "contacts",
                "mas_task": {
                    "active_domain": "audience",
                    "active_executor": "contact",
                    "steps": [],
                },
            }
            apply_skill_pick(
                session,
                module=CONTACTS_MODULE,
                executor_id="contact",
                skill_id="contact_creation",
                skill_action="new_task",
            )
            out = await run_audience_domain(
                {
                    "session": session,
                    "entry": "sticky_domain",
                    "query": "555-0100",
                    "task_spec": {"query": "555-0100"},
                    "module_hint": "contacts",
                    "session_id": "s-sticky",
                    "token": "t",
                }
            )
            return out, mock_pick, mock_native

    out, mock_pick, mock_native = asyncio.run(run())
    assert out.get("reply") == "Got phone"
    mock_pick.assert_awaited_once()
    assert mock_native.await_args.args[0]["task_spec"]["skill_id"] == "contact_creation"
