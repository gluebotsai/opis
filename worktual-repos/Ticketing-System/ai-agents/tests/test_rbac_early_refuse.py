"""First-turn RBAC: refuse forbidden CRUD before field collection."""

from __future__ import annotations

import pytest

from app.rbac import (
    role_can_perform_operation,
    role_can_perform_skill,
    skill_rbac_refusal,
)
from app.tools.registry import authorize_tool


@pytest.mark.parametrize(
    ("role", "skill", "allowed"),
    [
        ("admin", "team-create", True),
        ("admin", "customer-create", True),
        ("admin", "ticket-create", True),
        ("agent", "ticket-create", True),
        ("agent", "ticket-update", True),
        ("agent", "knowledge-article-create", True),
        ("agent", "macro-create", True),
        ("agent", "team-create", False),
        ("agent", "customer-create", False),
        ("agent", "priority-create", False),
        ("agent", "analytics-query", False),
        ("resolver", "ticket-update", True),
        ("resolver", "ticket-note-add", True),
        ("resolver", "ticket-escalate", True),
        ("resolver", "ticket-create", False),
        ("resolver", "team-create", False),
        ("resolver", "customer-create", False),
        ("resolver", "knowledge-article-create", False),
        ("resolver", "macro-create", False),
        ("resolver", "priority-create", False),
        ("viewer", "analytics-query", True),
        ("viewer", "ticket-create", False),
        ("viewer", "ticket-update", False),
        ("viewer", "customer-create", False),
        ("customer", "ticket-create", True),
        ("customer", "team-create", False),
        ("customer", "customer-create", False),
    ],
)
def test_role_can_perform_skill_matrix(role, skill, allowed):
    assert role_can_perform_skill(role, skill) is allowed


def test_skill_rbac_refusal_is_natural_and_immediate():
    out = skill_rbac_refusal("resolver", "team-create")
    assert out is not None
    assert out["code"] == "forbidden"
    assert "resolver" in out["message"].lower()
    assert "team" in out["message"].lower()
    assert "admin" in out["message"].lower()
    assert skill_rbac_refusal("admin", "team-create") is None


def test_authorize_tool_matches_express_crud():
    authorize_tool(
        agent="tickets",
        tool_name="update_ticket",
        operation="UPDATE_TICKET",
        role="resolver",
    )
    authorize_tool(
        agent="kb",
        tool_name="create_kb_article",
        operation="CREATE_KB",
        role="agent",
        workflow="create_kb",
    )
    with pytest.raises(PermissionError):
        authorize_tool(
            agent="teams",
            tool_name="create_queue",
            operation="CREATE_TEAM",
            role="agent",
            workflow="create_team",
        )
    with pytest.raises(PermissionError):
        authorize_tool(
            agent="tickets",
            tool_name="create_ticket",
            operation="CREATE_TICKET",
            role="resolver",
            workflow="create_ticket",
        )
    assert role_can_perform_operation("viewer", "CREATE_TICKET") is False
    assert role_can_perform_operation("agent", "CREATE_CUSTOMER") is False


def test_harness_refuses_team_create_for_resolver_before_executor(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class FakeLLM:
        def run(self, messages, tools=None, **kwargs):
            names = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            if "route_to_domain" in names:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "name": "route_to_domain",
                            "arguments": {
                                "domain_id": "catalog_administration_domain",
                                "query": "create a team called Billing",
                            },
                        }
                    ],
                }
            return {
                "content": "",
                "tool_calls": [
                    {
                        "name": "delegate_to_executor",
                        "arguments": {
                            "executor_id": "team_queue_crud_executor",
                            "task_id": "team.create",
                            "skill_name": "team-create",
                            "objective": "Create a team called Billing",
                        },
                    }
                ],
            }

    seen = {"executor": False}

    def fake_executor(**kwargs):
        seen["executor"] = True
        return {
            "response_type": "final",
            "assistant_text": "What should I name the team?",
            "agent": "team_queue_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_executor)
    mem = SharedMemory(organization_id="1", user_id="r1", session_id="s")
    req = RunRequest(
        message="create a team called Billing",
        session_id="s",
        actor=ActorContext(user_id="r1", organization_id="1", user_role="resolver"),
        module="assigned",
        surface="staff",
    )
    result = tc._run_harness_supervisor(
        llm=FakeLLM(),
        memory=mem,
        query="create a team called Billing",
        context={"request": req, "module": "assigned", "surface": "staff"},
        actor=ToolActor(user_id="r1", organization_id="1", user_role="resolver"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert seen["executor"] is False
    assert mem.current_task_state() is None
    text = (result.get("assistant_text") or "").lower()
    assert "team" in text
    assert result.get("data", {}).get("refusal", {}).get("code") == "forbidden"


@pytest.mark.parametrize(
    ("role", "skill", "task_id", "executor", "query"),
    [
        ("viewer", "ticket-create", "ticket.create", "ticket_creation_executor", "file a ticket"),
        ("agent", "customer-create", "customer.create", "customer_directory_crud_executor", "add a customer"),
        ("resolver", "macro-create", "macro.create", "macro_crud_executor", "create a macro"),
        ("resolver", "knowledge-article-create", "knowledge.article.create", "kb_quality_crud_executor", "create a kb article"),
        ("agent", "priority-create", "priority.create", "priority_status_crud_executor", "create a priority"),
    ],
)
def test_harness_refuses_forbidden_crud_skills_before_executor(
    monkeypatch, role, skill, task_id, executor, query
):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    domain = (
        "intake_deflection_domain"
        if skill == "ticket-create"
        else "catalog_administration_domain"
    )

    class FakeLLM:
        def run(self, messages, tools=None, **kwargs):
            names = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            if "route_to_domain" in names:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "name": "route_to_domain",
                            "arguments": {"domain_id": domain, "query": query},
                        }
                    ],
                }
            return {
                "content": "",
                "tool_calls": [
                    {
                        "name": "delegate_to_executor",
                        "arguments": {
                            "executor_id": executor,
                            "task_id": task_id,
                            "skill_name": skill,
                            "objective": query,
                        },
                    }
                ],
            }

    monkeypatch.setattr(
        tc,
        "_run_harness_executor",
        lambda **kwargs: pytest.fail("executor must not collect fields"),
    )
    mem = SharedMemory(organization_id="1", user_id="u1", session_id="s")
    req = RunRequest(
        message=query,
        session_id="s",
        actor=ActorContext(user_id="u1", organization_id="1", user_role=role),
        surface="staff",
    )
    result = tc._run_harness_supervisor(
        llm=FakeLLM(),
        memory=mem,
        query=query,
        context={"request": req, "surface": "staff"},
        actor=ToolActor(user_id="u1", organization_id="1", user_role=role),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert mem.current_task_state() is None
    assert result.get("data", {}).get("refusal", {}).get("code") == "forbidden"
    assert result.get("assistant_text")


def test_continue_forbidden_pin_refuses_instead_of_collecting(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {"mode": "continue"},
    )
    monkeypatch.setattr(
        tc,
        "_run_harness_executor",
        lambda **kwargs: pytest.fail("must not continue forbidden collection"),
    )
    mem = SharedMemory(organization_id="1", user_id="r1", session_id="s")
    mem.set_task_state(new_harness_task_state("team.create"))
    req = RunRequest(
        message="Billing",
        session_id="s",
        actor=ActorContext(user_id="r1", organization_id="1", user_role="resolver"),
        surface="staff",
    )
    result = tc._run_harness_supervisor(
        llm=object(),
        memory=mem,
        query="Billing",
        context={"request": req, "surface": "staff"},
        actor=ToolActor(user_id="r1", organization_id="1", user_role="resolver"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert mem.current_task_state() is None
    assert result.get("data", {}).get("refusal", {}).get("code") == "forbidden"


def test_harness_allows_admin_team_create_to_reach_executor(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class FakeLLM:
        def run(self, messages, tools=None, **kwargs):
            names = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            if "route_to_domain" in names:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "name": "route_to_domain",
                            "arguments": {
                                "domain_id": "catalog_administration_domain",
                                "query": "create a team called Billing",
                            },
                        }
                    ],
                }
            return {
                "content": "",
                "tool_calls": [
                    {
                        "name": "delegate_to_executor",
                        "arguments": {
                            "executor_id": "team_queue_crud_executor",
                            "task_id": "team.create",
                            "skill_name": "team-create",
                            "objective": "Create a team called Billing",
                        },
                    }
                ],
            }

    seen: dict = {}

    def fake_executor(**kwargs):
        seen["skill"] = kwargs["instruction"].skill_name
        return {
            "response_type": "final",
            "assistant_text": "What should I name the team?",
            "agent": "team_queue_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_executor)
    mem = SharedMemory(organization_id="1", user_id="a1", session_id="s")
    req = RunRequest(
        message="create a team called Billing",
        session_id="s",
        actor=ActorContext(user_id="a1", organization_id="1", user_role="admin"),
        surface="staff",
    )
    result = tc._run_harness_supervisor(
        llm=FakeLLM(),
        memory=mem,
        query="create a team called Billing",
        context={"request": req, "surface": "staff"},
        actor=ToolActor(user_id="a1", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert seen.get("skill") == "team-create"
    assert result.get("agent") == "team_queue_crud_executor"


def test_start_create_team_flow_admin_only(monkeypatch):
    from app.tasks.chat_commands import start_create_team_flow

    monkeypatch.setattr(
        "app.tasks.chat_commands._llm_phrase",
        lambda **kwargs: str(kwargs.get("fallback") or "ok"),
    )
    denied = start_create_team_flow("create a team", role="agent", page="Teams")
    assert denied.get("team_draft") is None
    assert denied.get("handled") is True
    allowed = start_create_team_flow("create a team", role="admin", page="Teams")
    assert (allowed.get("team_draft") or {}).get("awaiting") == "name"
