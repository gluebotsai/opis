"""Bounded tool-loop mechanics."""

from __future__ import annotations

from typing import Any

import pytest

from app.contracts.errors import LLMEmptyResponse, ToolLoopExhausted
from app.contracts.execution import RunBudgets
from app.contracts.tools import ToolDefinition
from app.memory.session import SharedMemory
from app.runtime.budgets import BudgetTracker
from app.runtime.tool_loop import run_tool_loop


class _FakeLLM:
    def __init__(self, script: list[dict]):
        self.script = list(script)
        self.i = 0

    def run(self, messages, tools=None, **kwargs):
        names = set()
        for tool in tools or []:
            if not isinstance(tool, dict):
                continue
            fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
            names.add(str(fn.get("name") or tool.get("name") or "").strip())
        # Live-pin Super exposes continue_active_task; keep scripted executor
        # turns intact unless a test stubs _super_live_pin_decision.
        if "continue_active_task" in names:
            return {
                "content": "",
                "tool_calls": [{"name": "continue_active_task", "arguments": {}}],
            }
        if self.i >= len(self.script):
            return {"content": "done", "tool_calls": []}
        item = self.script[self.i]
        self.i += 1
        return item


@pytest.fixture(autouse=True)
def _offline_mcp_discovery(monkeypatch):
    """Exercise the real claim/scope catalog logic without a live MCP process."""
    from app.mcp.authorization import authorized_tool_names, verify_mcp_token
    from app.mcp.catalog import list_catalog_public

    def discover(*, token, agent=None, module=None, surface=None):
        claims = verify_mcp_token(token)
        allowed = authorized_tool_names(
            agent=agent or str(claims.get("agent_id") or "general"),
            module=module,
            surface=surface,
            token_claims=claims,
        )
        return list_catalog_public(allowed_names=allowed)

    monkeypatch.setattr("app.mcp.client.list_mcp_tools", discover)
    monkeypatch.setattr(
        "app.mcp.client.call_mcp_tool",
        lambda name, arguments, **kwargs: {
            "success": True,
            "payload": {"tool": name, "arguments": arguments},
        },
    )


def test_tool_loop_returns_final_text():
    mem = SharedMemory(
        organization_id="1",
        user_id="u",
        session_id="s",
    )
    llm = _FakeLLM([{"content": "Hello there", "tool_calls": []}])
    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[],
        execute_tool=lambda n, a: {"success": True},
        budgets=BudgetTracker(RunBudgets(max_rounds=3)),
        user_message="hi",
    )
    assert text == "Hello there"


def test_tool_loop_executes_tool_then_finishes():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "list_tickets",
                        "arguments": {"limit": 1},
                    }
                ],
            },
            {"content": "Found 1 ticket", "tool_calls": []},
        ]
    )
    called = {}

    def execute(name, args):
        called["name"] = name
        called["args"] = args
        return {"success": True, "payload": {"count": 1}}

    tools = [
        ToolDefinition(
            name="list_tickets",
            description="list",
            input_schema={"type": "object", "properties": {}},
        )
    ]
    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=tools,
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=5)),
        user_message="show tickets",
    )
    assert text == "Found 1 ticket"


def test_tool_loop_retries_once_on_empty_tools_hint():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {"content": "I've updated Immediate to Fast.", "tool_calls": []},
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "list_priorities",
                        "arguments": {"include_inactive": False},
                    }
                ],
            },
            {"content": "Which priority should I change?", "tool_calls": []},
        ]
    )
    called: list[str] = []

    def execute(name, args):
        called.append(name)
        return {"success": True, "payload": {"data": []}}

    tools = [
        ToolDefinition(
            name="list_priorities",
            description="list",
            input_schema={"type": "object", "properties": {}},
        )
    ]
    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=tools,
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
        user_message="change Immediate to Fast",
        empty_tools_retry_hint="\n\nTOOL REQUIRED: call a tool this turn.",
    )
    assert called == ["list_priorities"]
    assert "Which priority" in text
    assert llm.i == 3


def test_tool_loop_retries_ghost_update_even_with_next_question():
    """A success claim plus 'what next?' must still force a tool, not skip the gate."""
    from app.runtime.tool_loop import looks_like_unverified_write_claim

    ghost = (
        "I've updated the priority label from **Immediate** to **Fast**.\n\n"
        "What would you like to do next?"
    )
    assert looks_like_unverified_write_claim(ghost)
    assert not looks_like_unverified_write_claim(
        "Which existing priority should I rename?"
    )

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {"content": ghost, "tool_calls": []},
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "list_priorities",
                        "arguments": {"include_inactive": False},
                    }
                ],
            },
            {"content": "Which priority should I change?", "tool_calls": []},
        ]
    )
    called: list[str] = []

    def execute(name, args):
        called.append(name)
        return {"success": True, "payload": {"data": []}}

    tools = [
        ToolDefinition(
            name="list_priorities",
            description="list",
            input_schema={"type": "object", "properties": {}},
        )
    ]
    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=tools,
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
        user_message="chenge Immediate to Fast",
        empty_tools_retry_hint="\n\nTOOL REQUIRED: call a tool this turn.",
    )
    assert called == ["list_priorities"]
    assert "Which priority" in text


def test_confirmed_write_conflict_is_single_attempt():
    """Confirm tools: one Express attempt; identical retry is blocked (all modules)."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "create_queue",
                        "arguments": {
                            "name": "ccaas",
                            "description": "CCaaS",
                            "confirmed": True,
                        },
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "2",
                        "name": "create_queue",
                        "arguments": {
                            "name": "ccaas",
                            "description": "CCaaS",
                            "confirmed": True,
                        },
                    }
                ],
            },
            {
                "content": "A team named ccaas already exists. Pick a different name?",
                "tool_calls": [],
            },
        ]
    )
    calls: list[dict[str, Any]] = []

    def execute(name, args):
        calls.append({"name": name, "args": dict(args)})
        return {
            "success": False,
            "error_code": "CONFLICT",
            "message": 'A team named "ccaas" already exists.',
            "retryable": False,
            "http_status": 409,
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="create_queue",
                description="create team",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="yeahhh proceed",
    )
    assert len(calls) == 1
    assert calls[0]["name"] == "create_queue"
    assert "already exists" in text.lower() or "ccaas" in text.lower()
    last = mem.durable.get("last_tool_outcome") or {}
    # Second call short-circuits; outcome may be already_attempted or first CONFLICT.
    assert last.get("success") is False
    assert last.get("retryable") is False


def test_confirmed_write_gate_block_allows_retry():
    """CONFIRMATION_REQUIRED does not consume the single-attempt budget."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "create_ticket",
                        "arguments": {"issue": "wifi"},
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "2",
                        "name": "create_ticket",
                        "arguments": {
                            "issue": "wifi",
                            "customerName": "Ada",
                            "confirmed": True,
                        },
                    }
                ],
            },
            {"content": "Ticket created.", "tool_calls": []},
        ]
    )
    calls: list[dict[str, Any]] = []

    def execute(name, args):
        calls.append({"name": name, "args": dict(args)})
        if not args.get("confirmed"):
            return {
                "success": False,
                "error_code": "CONFIRMATION_REQUIRED",
                "kind": "needs_confirm",
                "message": "Confirm before create",
                "retryable": False,
            }
        return {"success": True, "payload": {"id": "t1"}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="create_ticket",
                description="create",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="yes",
    )
    assert len(calls) == 2
    assert calls[1]["args"].get("confirmed") is True
    assert text == "Ticket created."


def test_non_confirm_tools_may_repeat():
    """Reads are not single-attempt; only TOOL_META confirm writes are."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "1", "name": "list_queues", "arguments": {}},
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {"id": "2", "name": "list_queues", "arguments": {}},
                ],
            },
            {"content": "Listed twice.", "tool_calls": []},
        ]
    )
    n = {"count": 0}

    def execute(name, args):
        n["count"] += 1
        return {"success": True, "payload": {"n": n["count"]}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="list_queues",
                description="list",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6, max_tool_calls=6)),
        user_message="list teams",
    )
    assert n["count"] == 2
    assert text == "Listed twice."


def test_tool_loop_empty_response_errors():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM([{"content": "", "tool_calls": []}])
    with pytest.raises(LLMEmptyResponse):
        run_tool_loop(
            llm=llm,  # type: ignore[arg-type]
            system_prompt="sys",
            memory=mem,
            tools=[],
            execute_tool=lambda n, a: {"success": True},
            budgets=BudgetTracker(RunBudgets()),
            user_message="hi",
        )


def test_tool_loop_confirm_retry_then_forces_armed_write():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {"content": "On it.", "tool_calls": []},
            {"content": "Proceeding.", "tool_calls": []},
            {"content": "Priority removed.", "tool_calls": []},
        ]
    )
    called: dict[str, Any] = {}

    def execute(name, args):
        called["name"] = name
        called["args"] = args
        return {"success": True, "payload": {"id": "p1"}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="delete_priority",
                description="delete",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
        user_message="yesh",
        armed_write_tools=frozenset({"delete_priority"}),
        should_force_armed_write=lambda: True,
    )
    assert text == "Priority removed."
    assert called["name"] == "delete_priority"
    assert called["args"] == {"confirmed": True}


def test_native_delete_priority_yesh_confirms_via_pinned_executor_mcp(monkeypatch):
    """Trusted structured task plus semantic confirmation calls MCP once."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "delete-1",
                        "name": "delete_priority",
                        "arguments": {"confirmed": True},
                    }
                ],
            },
            {"content": "Deleting.", "tool_calls": []},
            {"content": "Removed priority High.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    deleted: dict[str, Any] = {}

    def _dispatch(name, args, **kwargs):
        deleted["name"] = name
        deleted["args"] = dict(args)
        return {"success": True, "payload": {"id": "2001"}}

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.durable["priority_draft"] = {
        "awaiting": "delete_confirm",
        "kind": "priority",
        "id": "2001",
        "displayName": "High",
    }
    memory.durable["current_workflow"] = "create_priority"
    memory.durable["pending_ask"] = "delete_confirm"
    request = RunRequest(
        message="yesh",
        session_id="s1",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="admin",
        surface="priorities",
        session_memory={"trustedStructured": True},
    )
    out = tc.run_coworker_agent(
        agent_name="admin",
        memory=memory,
        query="yesh",
        context={
            "request": request,
            "module": "admin",
            "surface": "priorities",
            "page": "Priorities",
        },
    )
    assert deleted.get("name") == "delete_priority"
    assert deleted.get("args", {}).get("confirmed") is True
    assert deleted.get("args", {}).get("priority_id") == "2001"
    assert out.get("assistant_text") == "Removed priority High."
    assert memory.durable.get("priority_draft") is None


def test_native_create_team_yesss_confirms_pinned_executor_mcp(monkeypatch):
    """Semantic confirmation executes the pinned team-create Skill through MCP."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "team-1",
                        "name": "create_queue",
                        "arguments": {"confirmed": True},
                    }
                ],
            },
            {"content": "", "tool_calls": []},
            {"content": "Created team ccaas.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    created: dict[str, Any] = {}

    def _dispatch(name, args, **kwargs):
        created["name"] = name
        created["args"] = dict(args)
        return {"success": True, "payload": {"data": {"id": "q-ccaas", "name": "ccaas"}}}

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "CCaaS support",
        "members": ["Yaswanth MG", "Raghuram M", "Sri Annamalai"],
    }
    memory.durable["current_workflow"] = "create_team"
    memory.durable["pending_ask"] = "confirm"
    request = RunRequest(
        message="yesss",
        session_id="s1",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="admin",
        surface="agent-queues",
        session_memory={"trustedStructured": True},
    )
    out = tc.run_coworker_agent(
        agent_name="teams",
        memory=memory,
        query="yesss",
        context={
            "request": request,
            "module": "admin",
            "surface": "agent-queues",
            "page": "Teams",
        },
    )
    assert created.get("name") == "create_queue"
    assert created.get("args", {}).get("confirmed") is True
    assert created.get("args", {}).get("name") == "ccaas"
    assert created.get("args", {}).get("members") == [
        "Yaswanth MG",
        "Raghuram M",
        "Sri Annamalai",
    ]
    assert memory.durable.get("team_draft") is None
    assert str(out.get("assistant_text") or "").strip()


def test_native_force_armed_write_requires_nlu_confirm():
    """Empty NLU must not force write; CONFIRM_WORKFLOW may."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest

    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "CCaaS support",
        "members": ["Yaswanth MG"],
    }
    request = RunRequest(
        message="yesss",
        session_id="s1",
        actor=ActorContext(user_id="u1", organization_id="org-1", user_role="admin"),
        module="admin",
        surface="agent-queues",
    )
    context = {
        "request": request,
        "module": "admin",
        "surface": "agent-queues",
        "page": "Teams",
    }
    assert not tc._should_force_native_armed_write(
        memory,
        "yesss",
        context,
        workflow_decision={},
    )
    assert tc._should_force_native_armed_write(
        memory,
        "yesss",
        context,
        workflow_decision={"action": "CONFIRM_WORKFLOW"},
    )
    assert tc._should_force_native_armed_write(
        memory,
        "yesh proceedd",
        context,
        workflow_decision={"action": "RESUME_WORKFLOW"},
    )
    assert not tc._should_force_native_armed_write(
        memory,
        "create prioriy",
        context,
        workflow_decision={"action": "NEW_TASK"},
    )
    memory.durable["force_armed_write"] = True
    assert tc._should_force_native_armed_write(
        memory,
        "yesh proceedd",
        context,
        workflow_decision={},
    )


def test_create_queue_accepts_confirmed_flag(monkeypatch):
    """Confirm gate passes confirmed=true; bound create_queue must not TypeError."""
    from app.tools import bound as bound_mod

    seen: dict[str, Any] = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return {"success": True, "payload": {"data": {"id": "q1", "name": kwargs.get("name")}}}

    monkeypatch.setattr(
        "app.tools.catalog_tools.create_queue",
        fake_create,
    )
    out = bound_mod._create_queue(
        name="ccaas",
        description="support",
        members=["Yaswanth MG"],
        confirmed=True,
    )
    assert out.get("success") is True
    assert seen.get("name") == "ccaas"
    assert seen.get("members") == ["Yaswanth MG"]
    assert "confirmed" not in seen

    # execute_tool_call path also strips before invoke
    captured: dict[str, Any] = {}

    class _Tool:
        def invoke(self, args):
            captured.update(args)
            return {"success": True, "payload": {}}

    monkeypatch.setattr(
        bound_mod,
        "validate_specialist_tool",
        lambda **kwargs: {"success": True},
    )
    monkeypatch.setattr(
        bound_mod,
        "_TOOL_BUILDERS",
        {"create_queue": lambda: _Tool()},
    )
    raw = bound_mod.execute_tool_call(
        "admin",
        "create_queue",
        {
            "name": "ccaas",
            "members": ["Yaswanth MG"],
            "confirmed": True,
        },
        role="admin",
        draft={
            "awaiting": "confirm",
            "name": "ccaas",
            "description": "x",
            "members": ["Yaswanth MG"],
        },
        workflow_id="create_team",
        draft_key="team_draft",
    )
    assert '"success": true' in raw.lower() or '"success":true' in raw.lower().replace(" ", "")
    assert "confirmed" not in captured
    assert captured.get("name") == "ccaas"


def test_create_customer_accepts_idempotency_key(monkeypatch):
    """Harness mutations inject _idempotency_key; create_customer must still run."""
    import json

    from app.tools import bound as bound_mod
    from app.tools.express_client import ToolActor, tool_actor_scope

    seen: dict[str, Any] = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return {
            "success": True,
            "payload": {"customer": {"id": "1", "name": kwargs.get("name")}},
        }

    monkeypatch.setattr("app.tools.catalog_tools.create_customer", fake_create)
    actor = ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    with tool_actor_scope(actor):
        raw = bound_mod.execute_tool_call(
            "ticket_creation_executor",
            "create_customer",
            {
                "name": "Arun",
                "email": "arun@gmail.com",
                "phone": "8787665644",
                "confirmed": True,
                "_idempotency_key": "task-abc-123",
            },
            last_query={"pending_update": {"approval_mode": "trusted_structured"}},
        )
    out = json.loads(raw)
    assert out.get("success") is True
    assert seen.get("name") == "Arun"
    assert seen.get("email") == "arun@gmail.com"
    assert seen.get("phone") == "8787665644"
    assert seen.get("_idempotency_key") == "task-abc-123"


def test_create_customer_under_ticket_create_skips_harness_ticket_confirm(monkeypatch):
    """CDP-miss create_customer parks ticket.create and runs catalog customer.create."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.workflow_schemas import is_primary_task_mutation, new_harness_task_state

    assert is_primary_task_mutation("ticket.create", "create_ticket") is True
    assert is_primary_task_mutation("ticket.create", "create_customer") is False
    assert is_primary_task_mutation("customer.create", "create_customer") is True

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "name": "create_customer",
                        "arguments": {
                            "name": "Arun",
                            "email": "arun@gmail.com",
                        },
                    }
                ],
            },
            {
                "content": (
                    "Customer Arun is saved. Should I continue filing the ticket?"
                ),
                "tool_calls": [],
            },
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    created: dict[str, Any] = {}

    def _dispatch(name, args, **kwargs):
        created["name"] = name
        created["args"] = dict(args)
        created["agent"] = kwargs.get("agent")
        return {
            "success": True,
            "payload": {
                "customer": {
                    "id": "88",
                    "name": "Arun",
                    "email": "arun@gmail.com",
                }
            },
        }

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s-nested")
    memory.durable["current_workflow"] = "create_ticket"
    memory.durable["ticket_draft"] = {
        "awaiting": "contact",
        "customerName": "Arun",
        "customerEmail": "arun@gmail.com",
        "customer_not_found": True,
    }
    memory.set_task_state(
        new_harness_task_state(
            "ticket.create",
            channel="staff_chat",
            collected={"customerName": "Arun", "customer_not_found": True},
            idempotency_key="ticket-task-1",
        )
    )
    request = RunRequest(
        message="add Arun with arun@gmail.com",
        session_id="s-nested",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="tickets",
        surface="create",
    )
    out = tc.run_coworker_agent(
        agent_name="tickets",
        memory=memory,
        query="yes add them",
        context={
            "request": request,
            "module": "tickets",
            "surface": "create",
            "page": "Create Ticket",
        },
    )
    assert created.get("name") == "create_customer", out
    assert created.get("args", {}).get("name") == "Arun"
    assert created.get("args", {}).get("confirmed") is True
    assert created.get("agent") == "customer_directory_crud_executor"
    state = memory.current_task_state()
    assert state is not None
    # After save, intake ticket.create is restored for continue.
    assert state.task_id == "ticket.create"
    assert memory.durable.get("active_domain") == "intake_deflection_domain"
    # Offer-continue is one-shot: set on resume, consumed when the ticket
    # executor prompt asks "continue?", so it must not sticky-pin the next turn.
    assert not memory.durable.get("offer_continue_ticket_after_customer")
    ticket = memory.durable.get("ticket_draft") or {}
    assert str(ticket.get("customerId") or "") == "88"
    assert out.get("response_type") == "final"


def test_create_customer_write_ready_no_phone_and_harness_context():
    """Nested CDP: name+email is write-ready; harness context exposes drafts."""
    from app.agents.ticketing_coworker import _customer_draft_from_ticket
    from app.memory.session import SharedMemory
    from app.tools.registry import confirmation_satisfied, validate_specialist_tool
    from app.workflow_schemas import customer_write_ready

    assert customer_write_ready({"name": "arun", "email": "arun@gmail.com"})
    seeded = _customer_draft_from_ticket(
        {"customerName": "arun", "customerEmail": "arun@gmail.com"}
    )
    assert seeded.get("awaiting") == "confirm"
    assert seeded.get("name") == "arun"
    assert "phone" not in (seeded.get("awaiting") or "")

    # Incomplete guided schema (missing phone) must not block confirmed write
    draft = {"name": "arun", "email": "arun@gmail.com", "awaiting": "phone"}
    assert confirmation_satisfied(
        workflow_id="create_customer",
        draft_key="customer_draft",
        draft=draft,
        args={"name": "arun", "email": "arun@gmail.com", "confirmed": True},
    )
    ok = validate_specialist_tool(
        agent="ticket_creation_executor",
        tool_name="create_customer",
        draft=draft,
        workflow_id="create_customer",
        draft_key="customer_draft",
        args={"name": "arun", "email": "arun@gmail.com", "confirmed": True},
    )
    assert ok["success"] is True, ok

    # Without confirmed: tell LLM to retry with confirmed=true — not ask phone
    blocked = validate_specialist_tool(
        agent="ticket_creation_executor",
        tool_name="create_customer",
        draft=draft,
        workflow_id="create_customer",
        draft_key="customer_draft",
        args={"name": "arun", "email": "arun@gmail.com"},
    )
    assert blocked["success"] is False
    assert blocked["error_code"] == "CONFIRMATION_REQUIRED"
    msg = str(blocked.get("message") or "").lower()
    assert "draft is incomplete" not in msg
    assert "missing fields" not in msg
    assert "confirmed=true" in msg

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "arun",
        "customerEmail": "arun@gmail.com",
    }
    mem.durable["customer_draft"] = draft
    mem.durable["last_tool_outcome"] = {
        "tool": "create_customer",
        "success": False,
        "error_code": "CONFIRMATION_REQUIRED",
    }
    ctx = mem.harness_prompt_context()
    assert ctx["working"]["guided_drafts"]["ticket_draft"]["customerName"] == "arun"
    assert ctx["working"]["guided_drafts"]["customer_draft"]["email"] == "arun@gmail.com"
    assert ctx["working"]["last_tool_outcome"]["tool"] == "create_customer"
    # Compatibility mirrors still present for older readers.
    assert ctx.get("ticket_draft", {}).get("customerName") == "arun"
    assert ctx.get("customer_draft", {}).get("email") == "arun@gmail.com"
    assert ctx.get("last_tool_outcome", {}).get("tool") == "create_customer"


def test_catalog_create_queue_conflict_surfaces_already_exists(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "awaiting": "name",
        "name": "ccaas",
        "conflict_name": "ccaas",
        "description": "support",
        "members": ["Yaswanth MG"],
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "create_queue",
        "success": False,
        "error": 'A team named "ccaas" already exists. Choose a different name.',
        "error_code": "CONFLICT",
        "message": 'A team named "ccaas" already exists. Choose a different name.',
    }

    def boom(**kwargs):
        raise AssertionError("phrase_reply must not rewrite CONFLICT")

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", boom)
    text = tc._catalog_create_reply_text(mem, "")
    assert text
    assert "already exists" in text.lower()
    assert "ccaas" in text.lower()
    assert "technical error" not in text.lower()
    assert mem.durable.get("last_tool_outcome") is None


def test_catalog_create_queue_failure_does_not_say_priority(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "support",
        "members": ["Yaswanth MG"],
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "create_queue",
        "success": False,
        "error": "queue create failed",
        "error_code": "UPSTREAM",
    }

    def fake_phrase(*, module, kind, fallback, context=None, **kwargs):
        assert module == "team"
        assert "priority" not in fallback.lower()
        return f"TEAM_FAIL:{fallback}"

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", fake_phrase)
    text = tc._catalog_create_reply_text(mem, "")
    assert text and "TEAM_FAIL" in text
    assert "priority" not in text.lower()


def test_sanitize_team_confirm_strips_priority_hallucination(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "support",
        "members": ["Yaswanth MG"],
    }
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Should I create team ccaas now?",
    )
    out = tc._sanitize_team_confirm_reply(
        mem,
        "I am unable to save the new priority at this moment.",
    )
    assert out
    assert "priority" not in out.lower()
    assert "ccaas" in out.lower() or "team" in out.lower()


def test_merge_client_draft_does_not_demote_team_confirm():
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import _merge_client_draft_into_durable

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "CCaaS support",
        "members": ["Yaswanth MG", "Raghuram M", "Sri Annamalai"],
    }
    _merge_client_draft_into_durable(
        mem,
        "team_draft",
        {"awaiting": "create_members", "name": "ccaas", "description": "CCaaS support"},
    )
    draft = mem.durable["team_draft"]
    assert draft["awaiting"] == "confirm"
    assert draft["members"] == ["Yaswanth MG", "Raghuram M", "Sri Annamalai"]


def test_preferred_armed_write_prefers_team_over_priority():
    from app.workflow_schemas import preferred_armed_write_tool

    state = {
        "current_workflow": "create_team",
        "team_draft": {
            "awaiting": "confirm",
            "name": "ccaas",
            "description": "CCaaS support",
            "members": ["Yaswanth MG"],
        },
        "priority_draft": {
            "awaiting": "confirm",
            "displayName": "High",
            "resolutionHours": 4,
        },
    }
    assert preferred_armed_write_tool(state) == "create_queue"
    assert (
        preferred_armed_write_tool(
            state, frozenset({"create_priority", "create_queue"})
        )
        == "create_queue"
    )


def test_tool_loop_force_skips_stale_priority_when_teams_tools_bound():
    """Regression: alpha sort picked create_priority before create_queue."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "CCaaS support",
        "members": ["Yaswanth MG"],
    }
    mem.durable["priority_draft"] = {
        "awaiting": "confirm",
        "displayName": "High",
        "resolutionHours": 4,
    }
    llm = _FakeLLM(
        [
            {"content": "", "tool_calls": []},
            {"content": "", "tool_calls": []},
            {"content": "Created team ccaas.", "tool_calls": []},
        ]
    )
    called: dict[str, Any] = {}

    def execute(name, args):
        called["name"] = name
        return {"success": True, "payload": {"id": "q1", "name": "ccaas"}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="create_queue",
                description="create team",
                input_schema={"type": "object", "properties": {}},
            ),
            ToolDefinition(
                name="create_priority",
                description="create priority",
                input_schema={"type": "object", "properties": {}},
            ),
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
        user_message="yeahhh proceed",
        armed_write_tools=frozenset({"create_priority", "create_queue"}),
        should_force_armed_write=lambda: True,
    )
    assert called.get("name") == "create_queue"
    assert "ccaas" in text


def test_native_yeahhh_proceed_ignores_stale_priority_draft(monkeypatch):
    """User confirming a team must not force create_priority (priority error reply)."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "team-1",
                        "name": "create_queue",
                        "arguments": {"confirmed": True},
                    }
                ],
            },
            {"content": "", "tool_calls": []},
            {"content": "Created team ccaas.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    created: dict[str, Any] = {}

    def _dispatch(name, args, **kwargs):
        created["name"] = name
        created["args"] = dict(args)
        return {"success": True, "payload": {"data": {"id": "q-ccaas", "name": "ccaas"}}}

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "ccaas",
        "description": "CCaaS support",
        "members": ["Yaswanth MG", "Sri Annamalai", "Raghuram M"],
    }
    memory.durable["priority_draft"] = {
        "awaiting": "confirm",
        "displayName": "High",
        "resolutionHours": 4,
    }
    memory.durable["current_workflow"] = "create_team"
    memory.durable["pending_ask"] = "confirm"
    request = RunRequest(
        message="yeahhh proceed",
        session_id="s1",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="admin",
        surface="agent-queues",
        session_memory={"trustedStructured": True},
    )
    out = tc.run_coworker_agent(
        agent_name="teams",
        memory=memory,
        query="yeahhh proceed",
        context={
            "request": request,
            "module": "admin",
            "surface": "agent-queues",
            "page": "Teams",
        },
    )
    assert created.get("name") == "create_queue"
    assert "priority" not in str(out.get("assistant_text") or "").lower()


def test_orchestrator_hydrates_armed_team_into_pinned_executor(monkeypatch):
    """An armed UI draft becomes TaskState; Super CONTINUE keeps the Executor."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.runtime.orchestrator import run_native_turn

    agents_seen: list[str] = []

    class ContinueLLM:
        def run(self, *args, **kwargs):
            return {
                "content": "",
                "tool_calls": [
                    {"name": "continue_active_task", "arguments": {}},
                ],
            }

    real_run = tc.run_coworker_agent
    executor_calls: list[tuple[str, str]] = []

    def fake_run(**kwargs):
        agents_seen.append(str(kwargs.get("agent_name") or ""))
        return real_run(**kwargs)

    def fake_executor(**kwargs):
        executor_calls.append(
            (kwargs["harness_executor"], kwargs["harness_skill"])
        )
        return {
            "response_type": "final",
            "assistant_text": "The team draft is ready for confirmation.",
            "data": {},
        }

    db_context = {
        "team_draft": {
            "awaiting": "confirm",
            "name": "ccaas",
            "description": "CCaaS support",
            "members": ["Yaswanth MG", "Raghuram M", "Sri Annamalai"],
        },
        "current_workflow": "create_team",
    }

    monkeypatch.setattr(
        "app.memory.session.load_conversation_context",
        lambda org, user, sid: (dict(db_context), 1),
    )
    monkeypatch.setattr(
        "app.memory.session.save_conversation_context",
        lambda *a, **k: 2,
    )
    monkeypatch.setattr(tc, "get_llm", lambda: ContinueLLM())
    monkeypatch.setattr(tc, "run_coworker_agent", fake_run)
    monkeypatch.setattr(tc, "_run_executor_loop", fake_executor)

    req = RunRequest(
        message="yesss",
        session_id="sess-team-confirm",
        actor=ActorContext(user_id="u1", organization_id="42", user_role="admin"),
        module="admin",
        surface="agent-queues",
        page="Teams",
        session_memory={"start_agent": "ticketing_coworker"},
    )
    result = run_native_turn(req)
    assert agents_seen == ["ticketing_coworker"]
    assert executor_calls == [("team_queue_crud_executor", "team-create")]
    assert result.agent == "team_queue_crud_executor"
    state = result.durable_memory.get("task_state")
    assert state and state["task_id"] == "team.create"
    assert state["collected"]["name"] == "ccaas"
    assert str(result.assistant_text or "").strip()


def test_staff_idle_always_starts_supervisor(monkeypatch):
    """Customers page must not pin customers specialist — Super Agent first."""
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import _resolve_native_start_agent

    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    memory.durable["active_agent"] = "customers"
    req = RunRequest(
        message="add priority Urgent",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="customers",
        surface="list",
        page="Customers",
    )
    assert _resolve_native_start_agent(req, memory) == "ticketing_coworker"

    armed = SharedMemory(organization_id="1", user_id="u", session_id="s2")
    armed.durable["team_draft"] = {
        "awaiting": "confirm",
        "name": "t",
        "description": "d",
        "members": ["A"],
    }
    armed.durable["current_workflow"] = "create_team"
    req2 = RunRequest(
        message="yesss",
        session_id="s2",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="admin",
        surface="agent-queues",
    )
    assert _resolve_native_start_agent(req2, armed) == "ticketing_coworker"

    skill = RunRequest(
        message="list tickets",
        session_id="s3",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
        session_memory={"start_agent": "tickets", "source": "hub"},
    )
    assert _resolve_native_start_agent(skill, memory) == "ticketing_coworker"


@pytest.mark.parametrize(
    ("message", "domain", "executor", "task_id", "skill_name"),
    [
        (
            "add priority Urgent",
            "catalog_administration_domain",
            "priority_status_crud_executor",
            "priority.create",
            "priority-create",
        ),
        (
            "add customer Deva",
            "catalog_administration_domain",
            "customer_directory_crud_executor",
            "customer.create",
            "customer-create",
        ),
        (
            "create a ticket",
            "intake_deflection_domain",
            "ticket_creation_executor",
            "ticket.create",
            "ticket-create",
        ),
        (
            "create a new team called Bug Solvers",
            "catalog_administration_domain",
            "team_queue_crud_executor",
            "team.create",
            "team-create",
        ),
        (
            "create a macro for password reset",
            "catalog_administration_domain",
            "macro_crud_executor",
            "macro.create",
            "macro-create",
        ),
        (
            "create a knowledge base article about VPN",
            "catalog_administration_domain",
            "kb_quality_crud_executor",
            "knowledge.article.create",
            "knowledge-article-create",
        ),
        (
            "add a new status Waiting on Customer",
            "catalog_administration_domain",
            "priority_status_crud_executor",
            "status.create",
            "status-create",
        ),
        (
            "make ticket #123 high priority",
            "resolution_lifecycle_domain",
            "ticket_lifecycle_executor",
            "ticket.update",
            "ticket-update",
        ),
        (
            "escalate ticket #123 to resolver",
            "resolution_lifecycle_domain",
            "ticket_lifecycle_executor",
            "ticket.escalate",
            "ticket-escalate",
        ),
        (
            "add Deva to Bug Solvers",
            "catalog_administration_domain",
            "team_queue_crud_executor",
            "team.members.update",
            "team-members-update",
        ),
        (
            "reassign the agent on this ticket",
            "resolution_lifecycle_domain",
            "ticket_lifecycle_executor",
            "ticket.reassign",
            "ticket-reassign",
        ),
        (
            "how many open tickets do we have",
            "catalog_administration_domain",
            "analytics_audit_query_executor",
            "analytics.query",
            "analytics-query",
        ),
        (
            "why are tickets not resolving",
            "catalog_administration_domain",
            "analytics_audit_query_executor",
            "analytics.root.cause",
            "analytics-root-cause",
        ),
        (
            "show my notifications",
            "catalog_administration_domain",
            "notification_inbox_executor",
            "notification.inbox.read",
            "notification-inbox-read",
        ),
        (
            "recommend a knowledge article for this ticket",
            "knowledge_domain",
            "resolution_knowledge_executor",
            "knowledge.recommend.resolution",
            "knowledge-recommend-resolution",
        ),
        (
            "assign this ticket to the best agent",
            "triage_routing_domain",
            "intelligent_assignment_executor",
            "ticket.assign.best",
            "ticket-assign-best",
        ),
    ],
)
def test_supervisor_routes_by_capability_intent(
    monkeypatch, message, domain, executor, task_id, skill_name
):
    """Super routes to a Domain, which delegates one registered Executor Skill."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest

    class RouteLLM:
        calls = 0

        def run(self, messages, tools=None, **kwargs):
            self.calls += 1
            call = (
                {
                    "id": "r1",
                    "name": "route_to_domain",
                    "arguments": {"domain_id": domain, "query": message},
                }
                if self.calls == 1
                else {
                    "id": "d1",
                    "name": "delegate_to_executor",
                    "arguments": {
                        "executor_id": executor,
                        "task_id": task_id,
                        "skill_name": skill_name,
                        "objective": message,
                    },
                }
            )
            return {
                "content": "",
                "tool_calls": [call],
            }

    fake = RouteLLM()
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    executed: list[tuple[str, str]] = []

    def fake_executor(**kwargs):
        executed.append((kwargs["harness_executor"], kwargs["harness_skill"]))
        return {
            "response_type": "final",
            "assistant_text": "Handled by the selected capability.",
            "data": {},
        }

    monkeypatch.setattr(tc, "_run_executor_loop", fake_executor)
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    request = RunRequest(
        message=message,
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="customers",
        surface="list",
        page="Customers",
    )
    out = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=memory,
        query=message,
        context={
            "request": request,
            "module": "customers",
            "surface": "list",
            "page": "Customers",
        },
    )
    assert fake.calls == 2
    assert executed == [(executor, skill_name)]
    assert out.get("agent") == executor
    assert (out.get("data") or {}).get("harness", {}).get("task_id") == task_id
    state = memory.current_task_state()
    assert state and state.domain == domain
    assert state.executor == executor
    assert state.skill_name == skill_name


def test_supervisor_prompt_is_capability_first():
    from app.prompts.builder import build_supervisor_prompt

    prompt = build_supervisor_prompt(
        module="customers",
        surface="list",
        memory_snapshot={
            "durable": {
                "current_workflow": "create_customer",
                "customer_draft": {
                    "awaiting": "confirm",
                    "name": "Deva",
                    "email": "d@x.com",
                    "phone": "1",
                },
                "ticket_draft": {
                    "awaiting": "confirm",
                    "customerName": "X",
                    "customer_not_found": True,
                },
            }
        },
        actor_role="admin",
        page="Customers",
    )
    assert "capability" in prompt.lower() or "Capability" in prompt
    assert "Never route by verb alone" in prompt
    assert "ask_semantic_layer" in prompt
    assert "ask_ontology" in prompt
    assert "customer_not_found=true" in prompt
    assert "draft_customer_draft" in prompt
    assert "→ START_" not in prompt
    assert "CONFIRM_WORKFLOW" not in prompt


def test_budget_cycle_detection():
    tracker = BudgetTracker(RunBudgets(max_tool_calls=10))
    tracker.record_tool_call("list_tickets", {"limit": 1})
    tracker.record_tool_call("list_tickets", {"limit": 1})
    with pytest.raises(ToolLoopExhausted):
        tracker.record_tool_call("list_tickets", {"limit": 1})


def test_budget_soft_repeat_skips_cycle():
    tracker = BudgetTracker(RunBudgets(max_tool_calls=10))
    tracker.record_tool_call("create_macro", {"confirmed": True})
    tracker.record_tool_call(
        "create_macro", {"confirmed": True}, count_toward_cycle=False
    )
    tracker.record_tool_call(
        "create_macro", {"confirmed": True}, count_toward_cycle=False
    )
    assert tracker.tool_calls == 3


def test_confirmed_write_success_then_identical_retries_do_not_cycle():
    """Force/LLM may re-issue create_macro {confirmed:true}; soft-block must not 502."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    same_call = {
        "content": "",
        "tool_calls": [
            {
                "id": "m1",
                "name": "create_macro",
                "arguments": {"confirmed": True},
            }
        ],
    }
    llm = _FakeLLM(
        [
            same_call,
            {**same_call, "tool_calls": [{**same_call["tool_calls"][0], "id": "m2"}]},
            {**same_call, "tool_calls": [{**same_call["tool_calls"][0], "id": "m3"}]},
            {"content": "Macro Knowledge Deflection is saved.", "tool_calls": []},
        ]
    )
    calls: list[dict[str, Any]] = []

    def execute(name, args):
        calls.append({"name": name, "args": dict(args)})
        return {
            "success": True,
            "payload": {"id": "macro-1", "title": "Knowledge Deflection"},
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="create_macro",
                description="save macro",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="yes",
    )
    assert len(calls) == 1
    assert "Knowledge Deflection" in text or "saved" in text.lower()
    last = mem.durable.get("last_tool_outcome") or {}
    assert last.get("tool") == "create_macro"


def test_confirm_gate_blocked_identical_calls_do_not_raise_cycle():
    """needs_confirm ×3 must not paint 'Repeated tool-call cycle detected'."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    same = {
        "content": "",
        "tool_calls": [
            {
                "id": "k1",
                "name": "create_kb_article",
                "arguments": {"confirmed": True, "title": "Billing & Payments"},
            }
        ],
    }
    llm = _FakeLLM(
        [
            same,
            {**same, "tool_calls": [{**same["tool_calls"][0], "id": "k2"}]},
            {**same, "tool_calls": [{**same["tool_calls"][0], "id": "k3"}]},
            {"content": "I still need the article body before publishing.", "tool_calls": []},
        ]
    )
    calls = []

    def execute(name, args):
        calls.append(name)
        return {
            "success": False,
            "error_code": "CONFIRMATION_REQUIRED",
            "kind": "needs_confirm",
            "message": "Call again with confirmed=true and complete draft.",
            "retryable": False,
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="create_kb_article",
                description="publish",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="yehh proceed",
    )
    assert "Repeated tool-call cycle" not in text
    assert "body" in text.lower() or "publish" in text.lower() or "article" in text.lower()
    assert len(calls) == 2  # third identical soft-breaks without Express


def test_kb_draft_content_counts_as_body_for_complete():
    from app.workflow_schemas import draft_complete, missing_fields

    draft = {
        "title": "Billing & Payments",
        "category": "General",
        "content": "How to pay invoices and update cards.",
        "awaiting": "confirm",
    }
    assert "body" not in missing_fields("create_kb", draft)
    assert draft_complete("create_kb", draft)


@pytest.mark.parametrize(
    ("query", "task_id", "llm_tools", "expected_tools"),
    [
        (
            "how many open tickets are there?",
            "analytics.query",
            ["ask_semantic_layer"],
            ["ask_semantic_layer"],
        ),
        (
            "why are agents not resolving tickets?",
            "analytics.root.cause",
            ["ask_ontology"],
            ["ask_ontology"],
        ),
        (
            "how many open tickets and why",
            "analytics.root.cause",
            ["ask_semantic_layer", "ask_ontology"],
            ["ask_semantic_layer", "ask_ontology"],
        ),
    ],
)
def test_native_specialist_llm_chooses_insights_tools(
    monkeypatch, query, task_id, llm_tools, expected_tools
):
    """The pinned analytics Skill scopes which MCP insight tools the Executor sees."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.workflow_schemas import new_harness_task_state

    tool_calls = [
        {"id": f"i{i}", "name": name, "arguments": {"query": query}}
        for i, name in enumerate(llm_tools)
    ]
    fake = _FakeLLM(
        [
            {"content": "", "tool_calls": tool_calls},
            {"content": "Answer from tool results.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    called: list[str] = []

    def _dispatch(name, args, **kwargs):
        called.append(name)
        assert "classify_insights_question" not in name
        return {
            "success": True,
            "payload": {"answer": "gateway result", "organization_id": args.get("organization_id")},
        }

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.set_task_state(new_harness_task_state(task_id))
    request = RunRequest(
        message=query,
        session_id="s1",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-42",
            user_role="admin",
        ),
        module="tickets",
        surface="list",
    )

    out = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=memory,
        query=query,
        context={
            "request": request,
            "module": "tickets",
            "surface": "list",
            "page": "Tickets",
        },
    )

    assert out["assistant_text"] == "Answer from tool results."
    assert called == expected_tools


def test_native_path_does_not_call_classify_intent(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest

    calls: list[str] = []

    class SpyLLM:
        def run(self, messages, tools=None, **kwargs):
            sys = ""
            if messages:
                sys = str(messages[0].get("content") or "")
            assert "Classify the latest Worktual" not in sys
            return {"content": "Hello", "tool_calls": []}

    import app.agents.intent as intent_mod

    real_classify = getattr(intent_mod, "classify_intent", None)

    def spy_classify(*a, **k):
        calls.append("classify_intent")
        if real_classify:
            return real_classify(*a, **k)
        return {"intent": "CHAT"}

    if real_classify:
        monkeypatch.setattr(intent_mod, "classify_intent", spy_classify)
    monkeypatch.setattr(tc, "get_llm", lambda: SpyLLM())
    monkeypatch.setattr(tc, "tools_for_specialist", lambda *a, **k: [])
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    request = RunRequest(
        message="hi",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
    )
    out = tc.run_coworker_agent(
        agent_name="general",
        memory=memory,
        query="hi",
        context={"request": request, "module": "tickets", "surface": "list"},
    )
    assert out.get("assistant_text")
    assert "classify_intent" not in calls


def test_specialist_create_ticket_patches_draft_one_field(monkeypatch):
    """A pinned ticket-create Skill exposes only its declared local controls."""
    from app.agent_turn import chat_result_to_agent_turn
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.workflow_schemas import new_harness_task_state

    script = [
        {
            "content": "",
            "tool_calls": [
                {
                    "id": "n1",
                    "name": "navigate",
                    "arguments": {"view": "create-ticket"},
                },
                {
                    "id": "p1",
                    "name": "patch_ticket_draft",
                    "arguments": {"awaiting": "name"},
                },
            ],
        },
        {
            "content": "What is the customer's full name?",
            "tool_calls": [],
        },
    ]
    fake = _FakeLLM(script)
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    memory.set_task_state(new_harness_task_state("ticket.create"))
    request = RunRequest(
        message="create ticket",
        session_id="s",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="agent",
            user_name="Test",
        ),
        module="tickets",
        surface="list",
    )
    out = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=memory,
        query="create ticket",
        context={"request": request, "module": "tickets", "surface": "list", "page": None},
    )
    assert "full name" in (out.get("assistant_text") or "").lower()
    draft = (out.get("data") or {}).get("ticket_draft") or {}
    assert draft.get("awaiting") == "name"
    assert any(a.get("type") == "navigate" for a in (out.get("ui_actions") or []))

    envelope = chat_result_to_agent_turn(
        {
            "reply": out["assistant_text"],
            "agent": "tickets",
            "actions": out.get("ui_actions") or [],
            "data": out.get("data") or {},
        },
        module="tickets",
        page_surface="list",
    )
    names = [p.get("name") for p in envelope["toolProposals"]]
    assert "patch_ticket_draft" in names
    assert envelope.get("patch", {}).get("awaiting") == "name"
    # Must not dump multiple fields in the ask
    text = (envelope.get("assistantText") or "").lower()
    assert "subject" not in text
    assert "queue" not in text
    assert "description" not in text


def test_guided_prompt_includes_ticket_enrich_rules():
    from app.prompts.builder import SPECIALIST_PROMPT_BUILDERS, build_tickets_prompt

    prompt = build_tickets_prompt(
        module="tickets",
        surface="create",
        memory_snapshot={"durable": {}},
        actor_role="agent",
    )
    for heading in (
        "## Role",
        "## Goal",
        "## Instructions",
        "## Context",
        "## Output",
        "## Guardrails",
    ):
        assert heading in prompt
    assert "enrich_ticket" in prompt
    assert "patch_ticket_draft" in prompt
    assert "confirmed=true" in prompt
    assert "ONE" in prompt or "one" in prompt.lower()
    assert "subject" in prompt.lower()
    assert set(SPECIALIST_PROMPT_BUILDERS) >= {
        "tickets",
        "teams",
        "customers",
        "kb",
        "macros",
        "admin",
        "general",
    }


def test_change_the_name_is_not_a_person_name():
    from app.workflow_schemas import looks_like_person_name

    assert looks_like_person_name("maha") is True
    assert looks_like_person_name("change the name") is False
    assert looks_like_person_name("update email") is False
    assert looks_like_person_name("Priya Sharma") is True


def test_patch_rejects_instruction_as_customer_name():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list = []
    _execute_local_ui_tool(
        "patch_ticket_draft",
        {"customerName": "maha", "awaiting": "contact"},
        memory=mem,
        ui_actions=ui,
    )
    bad = _execute_local_ui_tool(
        "patch_ticket_draft",
        {"customerName": "change the name"},
        memory=mem,
        ui_actions=ui,
    )
    assert bad["success"] is False
    assert bad["error_code"] == "INVALID_FIELD_VALUE"
    assert mem.durable["ticket_draft"]["customerName"] == "maha"

    ok = _execute_local_ui_tool(
        "patch_ticket_draft",
        {"awaiting": "name"},
        memory=mem,
        ui_actions=ui,
    )
    assert ok["success"] is True
    assert ok["payload"]["awaiting"] == "name"
    assert mem.durable["ticket_draft"]["customerName"] == "maha"


def test_another_name_is_not_a_person_name():
    from app.workflow_schemas import looks_like_person_name

    assert looks_like_person_name("another name") is False
    assert looks_like_person_name("different email") is False


def test_merge_enrich_into_draft_sets_confirm(monkeypatch):
    from app.agents.ticketing_coworker import _merge_enrich_into_draft
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Anto",
        "customerEmail": "anto@gmail.com",
        "issue": "crm not working",
        "awaiting": "issue",
    }
    ui: list = []
    _merge_enrich_into_draft(
        mem,
        {
            "success": True,
            "payload": {
                "subject": "CRM outage",
                "priority": "high",
                "queue": "Support",
                "assignee": "Fazil",
                "resolver": "Ashika",
                "enrichedByAi": True,
            },
        },
        ui,
    )
    draft = mem.durable["ticket_draft"]
    assert draft["awaiting"] == "confirm"
    assert draft["subject"] == "CRM outage"
    assert draft["priority"] == "high"
    assert draft["enriched"] is True
    assert any(a.get("type") == "create_ticket" and a.get("awaiting") == "confirm" for a in ui)


def test_create_ticket_armed_when_draft_awaiting_confirm():
    from app.tools.registry import confirmation_satisfied, validate_specialist_tool

    draft = {
        "customerName": "Anto",
        "customerEmail": "anto@gmail.com",
        "issue": "Voice bot not responding",
        "subject": "Voice bot not responding",
        "awaiting": "confirm",
        "enriched": True,
    }
    # Legacy awaiting=confirm still arms without confirmed arg
    assert confirmation_satisfied(
        draft=draft, workflow_id="create_ticket", draft_key="ticket_draft"
    )
    # CRM path: complete draft + confirmed=true (no awaiting required)
    draft_no_await = {
        "customerName": "Anto",
        "customerEmail": "anto@gmail.com",
        "issue": "Voice bot not responding",
    }
    assert confirmation_satisfied(
        draft=draft_no_await,
        workflow_id="create_ticket",
        draft_key="ticket_draft",
        args={"confirmed": True},
    )
    # Without draft — blocked
    blocked = validate_specialist_tool(
        agent="tickets",
        tool_name="create_ticket",
    )
    assert blocked["success"] is False
    assert blocked["error_code"] == "CONFIRMATION_REQUIRED"
    assert "awaiting" not in blocked["message"].lower()
    # Complete draft + confirmed — allowed without awaiting=confirm
    ok = validate_specialist_tool(
        agent="tickets",
        tool_name="create_ticket",
        draft=draft_no_await,
        workflow_id="create_ticket",
        draft_key="ticket_draft",
        args={"confirmed": True},
    )
    assert ok["success"] is True

    # Nested CDP miss: confirmed + name/email args, no customer_draft
    assert confirmation_satisfied(
        workflow_id="create_customer",
        draft_key="customer_draft",
        draft=None,
        args={
            "name": "Arun",
            "email": "arun@gmail.com",
            "confirmed": True,
        },
    )
    # Phone-only contact also satisfies create_customer confirm gate
    assert confirmation_satisfied(
        workflow_id="create_customer",
        draft_key="customer_draft",
        draft={"name": "Arun", "phone": "+15551234567"},
        args={"confirmed": True},
    )
    cust_ok = validate_specialist_tool(
        agent="tickets",
        tool_name="create_customer",
        draft=None,
        workflow_id="create_customer",
        draft_key="customer_draft",
        args={
            "name": "Arun",
            "email": "arun@gmail.com",
            "confirmed": True,
        },
    )
    assert cust_ok["success"] is True, cust_ok
    cust_blocked = validate_specialist_tool(
        agent="tickets",
        tool_name="create_customer",
        draft=None,
        workflow_id="create_customer",
        draft_key="customer_draft",
        args={"name": "Arun", "email": "arun@gmail.com"},
    )
    assert cust_blocked["success"] is False
    assert cust_blocked["error_code"] == "CONFIRMATION_REQUIRED"
    # Write-ready (name+email) must NOT tell the LLM draft is incomplete for phone
    msg = str(cust_blocked.get("message") or "").lower()
    assert "draft is incomplete" not in msg
    assert "missing fields" not in msg
    assert "confirmed=true" in msg
    # Incomplete draft + confirmed — still blocked
    incomplete = validate_specialist_tool(
        agent="tickets",
        tool_name="create_ticket",
        draft={"customerName": "Anto"},
        workflow_id="create_ticket",
        draft_key="ticket_draft",
        args={"confirmed": True},
    )
    assert incomplete["success"] is False
    assert incomplete["error_code"] == "CONFIRMATION_REQUIRED"


def test_mcp_dispatch_create_ticket_accepts_draft_and_trusted_approval(monkeypatch):
    """Harness-approved create must pass draft/trust so registry confirm does not loop."""
    from app.mcp.dispatch import dispatch_tool
    from app.tools.express_client import ToolActor

    seen: dict = {}

    def _fake_execute(agent, name, args, **kwargs):
        seen["draft"] = kwargs.get("draft")
        seen["last_query"] = kwargs.get("last_query")
        seen["args"] = dict(args or {})
        return {"success": True, "payload": {"ticketNumber": "#1001"}}

    monkeypatch.setattr("app.mcp.dispatch.execute_tool_call", _fake_execute)
    monkeypatch.setattr(
        "app.mcp.dispatch.assert_tool_authorized", lambda **kwargs: None
    )
    monkeypatch.setattr(
        "app.mcp.dispatch.verify_mcp_token",
        lambda token: {"organization_id": "1000", "actor_id": "1005", "role": "admin"},
    )
    draft = {
        "customerName": "Fazil",
        "customerEmail": "smohamedfazil16@gmail.com",
        "contact": "smohamedfazil16@gmail.com",
        "issue": "Lola chatbot is too slow",
        "customerDirectoryStatus": "verified",
        "customerId": "1001",
    }
    out = dispatch_tool(
        "create_ticket",
        {"customerName": "Fazil", "confirmed": True},
        agent="ticket_creation_executor",
        actor=ToolActor(
            user_id="1005", organization_id="1000", user_role="admin"
        ),
        draft=draft,
        workflow_id="create_ticket",
        draft_key="ticket_draft",
        trusted_approval="trusted_structured",
        mcp_token="tok",
    )
    assert out.get("success") is True
    assert seen.get("draft") == draft
    assert (seen.get("last_query") or {}).get("pending_update", {}).get(
        "approval_mode"
    ) == "trusted_structured"


def test_hydrate_create_ticket_args_from_draft():
    from app.agents.ticketing_coworker import _hydrate_create_ticket_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Anto",
        "customerEmail": "anto@gmail.com",
        "issue": "Voice bot not responding",
        "subject": "Voice bot not responding",
        "priority": "high",
        "queue": "NLP",
        "assignee": "Mohammed Fazil",
        "awaiting": "confirm",
    }
    out = _hydrate_create_ticket_args(mem, {})
    assert out["customerName"] == "Anto"
    assert out["description"] == "Voice bot not responding"
    assert out["issue"] == "Voice bot not responding"
    # Lean create: strip pre-file enrich leftovers
    assert "subject" not in out
    assert "priority" not in out
    assert "assignee" not in out
    # Completeness alone must not invent consent — summary confirm owns that.
    assert out.get("confirmed") is not True


def test_hydrate_create_ticket_does_not_auto_arm_confirmed():
    """Completing fields must not invent consent — summary confirm comes next."""
    from app.agents.ticketing_coworker import _hydrate_create_ticket_args
    from app.memory.session import SharedMemory
    from app.workflow_schemas import arm_confirmed_for_write_tool

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Mohamed Fazil",
        "customerEmail": "smohamedfazil16@gmail.com",
        "contact": "smohamedfazil16@gmail.com",
        "customerDirectoryStatus": "verified",
        "customerId": "1001",
    }
    out = _hydrate_create_ticket_args(
        mem,
        {
            "customerEmail": "smohamedfazil16@gmail.com",
            "customerName": "Mohamed Fazil",
            "description": "Lola chatbot is not working fine",
        },
    )
    assert out.get("confirmed") is not True
    assert out["description"] == "Lola chatbot is not working fine"
    armed = arm_confirmed_for_write_tool(
        args={
            "customerName": "Mohamed Fazil",
            "customerEmail": "smohamedfazil16@gmail.com",
            "description": "Lola chatbot is not working fine",
        },
        draft=mem.durable["ticket_draft"],
        workflow_id="create_ticket",
        draft_key="ticket_draft",
    )
    assert armed.get("confirmed") is not True


def test_guided_write_strips_confirmed_until_prior_summary():
    """Issue collect turn must not file; affirm after awaiting-confirm may proceed."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.request_id = "issue-turn"
    mem.durable["ticket_draft"] = {
        "customerName": "Mohamed Fazil",
        "customerEmail": "a@b.com",
        "contact": "a@b.com",
        "customerId": "1",
        "customerDirectoryStatus": "verified",
        "awaiting": "issue",
    }
    mem.set_task_state(new_harness_task_state("ticket.create"))
    assert (
        tc._allow_guided_write_confirmed(
            mem,
            "create_ticket",
            field_bound_this_turn=False,
            awaiting_confirm_at_turn_start=False,
        )
        is False
    )
    mem.durable["ticket_draft"]["awaiting"] = "confirm"
    mem.durable["pending_ask"] = "confirm"
    mem.request_id = "affirm-turn"
    assert (
        tc._allow_guided_write_confirmed(
            mem,
            "create_ticket",
            field_bound_this_turn=False,
            awaiting_confirm_at_turn_start=True,
        )
        is True
    )
    assert (
        tc._allow_guided_write_confirmed(
            mem,
            "create_ticket",
            field_bound_this_turn=True,
            awaiting_confirm_at_turn_start=True,
        )
        is False
    )


def test_all_specialist_prompts_have_six_sections():
    from app.prompts.builder import SPECIALIST_PROMPT_BUILDERS, build_supervisor_prompt
    from app.tasks.phrase import _system_for

    snap = {"durable": {}}
    for name, builder in SPECIALIST_PROMPT_BUILDERS.items():
        prompt = builder(
            module=name,
            surface="list",
            memory_snapshot=snap,
            actor_role="agent",
        )
        for heading in (
            "## Role",
            "## Goal",
            "## Instructions",
            "## Context",
            "## Output",
            "## Guardrails",
        ):
            assert heading in prompt, f"{name} missing {heading}"
        assert "PRIMARY:" in prompt, f"{name} missing PRIMARY"
        assert "CONTINUE_WORKFLOW" not in prompt
    supervisor = build_supervisor_prompt(
        module="tickets",
        surface="list",
        memory_snapshot=snap,
        actor_role="agent",
    )
    assert "## Role" in supervisor and "route_to_agent" in supervisor
    assert "PRIMARY:" in supervisor

    for mod in ("ticket", "team", "macro", "kb", "priority", "customer", "nav", "greeting"):
        phrase = _system_for(mod)
        assert isinstance(phrase, str) and phrase.strip()
        # Phrase helpers are LLM seeds for non-native paths — not CRM six-section builders.


def test_teams_prompt_has_clear_confirm_write_path():
    from app.prompts.builder import build_teams_prompt

    prompt = build_teams_prompt(
        module="teams",
        surface="create",
        memory_snapshot={"durable": {}},
        actor_role="admin",
    )
    assert "create_queue" in prompt
    assert "confirmed=true" in prompt
    assert "Did you mean" in prompt
    assert "patch_team_draft" in prompt
    assert "add_team_members" in prompt
    assert "stay on add_team_members" in prompt or "NEVER ask which team again" in prompt
    assert "show available members" in prompt
    assert "list_agents" in prompt
    assert "List EVERY available staff name" in prompt
    assert "Eligible staff only" in prompt
    assert "APPENDS" in prompt or "append" in prompt.lower()
    assert "add_members=true" in prompt


def test_add_members_context_stays_on_chosen_team():
    from app.prompts.builder import build_teams_prompt

    prompt = build_teams_prompt(
        module="teams",
        surface="list",
        memory_snapshot={
            "durable": {
                "current_workflow": "add_team_members",
                "team_draft": {
                    "id": "q-mkt",
                    "name": "marketing",
                    "team": "marketing",
                    "flow": "add_team_members",
                    "awaiting": "members_names",
                    "available_members": ["Deva NS", "Sri Annamalai"],
                    "current_members": ["Yaswanth MG", "Mohammed Fazil"],
                },
                "last_entity": {"type": "team", "id": "q-mkt", "name": "marketing"},
            }
        },
        actor_role="admin",
    )
    assert "primary_create_workflow=add_team_members" in prompt
    assert "primary_create_workflow=create_team" not in prompt
    assert "stay_on_team=" in prompt
    assert "marketing" in prompt
    assert "available_members=" in prompt
    assert "Do not ask which team again" in prompt
    assert "eligible_only=" in prompt
    assert "existing_members=" in prompt
    assert "Yaswanth MG" in prompt


def test_absorb_does_not_store_show_members_as_team_or_roster():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "q-mkt",
        "name": "marketing",
        "team": "marketing",
        "flow": "add_team_members",
        "awaiting": "members_names",
    }
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "show available members", "teams", ui) is False
    assert mem.durable["team_draft"]["team"] == "marketing"
    assert mem.durable["team_draft"].get("members") in (None, [], "")

    mem.durable["team_draft"]["awaiting"] = "members_team"
    mem.durable["team_draft"].pop("team", None)
    mem.durable["team_draft"].pop("name", None)
    assert tc._absorb_guided_field_utterance(mem, "show available team", "teams", ui) is False


def test_add_members_roster_excludes_people_already_on_team():
    from app.agents.ticketing_coworker import (
        _stash_current_team_members_from_list_queues,
        _stash_team_roster_from_list_agents,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "q-mkt",
        "name": "marketing",
        "flow": "add_team_members",
        "awaiting": "members_names",
    }
    _stash_current_team_members_from_list_queues(
        mem,
        {
            "success": True,
            "payload": [
                {
                    "id": "q-mkt",
                    "queueName": "marketing",
                    "members": [
                        {"name": "Yaswanth MG"},
                        {"name": "Mohammed Fazil"},
                    ],
                }
            ],
        },
    )
    assert mem.durable["team_draft"]["current_members"] == ["Yaswanth MG", "Mohammed Fazil"]
    _stash_team_roster_from_list_agents(
        mem,
        {
            "success": True,
            "payload": [
                {"name": "Yaswanth MG"},
                {"name": "Deva NS"},
                {"name": "Raghuram M"},
                {"name": "Mohammed Fazil"},
            ],
        },
    )
    assert mem.durable["team_draft"]["available_members"] == ["Deva NS", "Raghuram M"]


def test_needs_confirm_proposal_skips_guided_creates():
    """Guided create_* must not emit Confirm chips — chat yes/yesh owns consent."""
    from app.agent_turn import chat_result_to_agent_turn

    envelope = chat_result_to_agent_turn(
        {
            "reply": "Ready to save when you agree.",
            "agent": "customers",
            "actions": [],
            "data": {
                "customer_draft": {
                    "name": "Sidharth",
                    "email": "sidharth@gmail.com",
                    "phone": "8978676755",
                    "awaiting": "confirm",
                },
                "workflow": "create_customer",
                "last_tool_outcome": {
                    "tool": "create_customer",
                    "success": False,
                    "error_code": "CONFIRMATION_REQUIRED",
                    "kind": "needs_confirm",
                    "arguments": {"name": "Sidharth"},
                },
            },
        },
        module="customers",
        page_surface="create",
    )
    names = [p.get("name") for p in (envelope.get("toolProposals") or [])]
    assert "propose_create_customer" not in names
    assert "propose_create_ticket" not in names


def test_needs_confirm_proposal_still_allows_non_create_chips():
    from app.agent_turn import chat_result_to_agent_turn

    envelope = chat_result_to_agent_turn(
        {
            "reply": "Confirm escalate?",
            "agent": "tickets",
            "actions": [],
            "data": {
                "last_tool_outcome": {
                    "tool": "escalate_ticket",
                    "success": False,
                    "error_code": "CONFIRMATION_REQUIRED",
                    "kind": "needs_confirm",
                    "arguments": {"ticket_number": "100"},
                },
            },
        },
        module="tickets",
        page_surface="detail",
    )
    names = [p.get("name") for p in (envelope.get("toolProposals") or [])]
    assert "propose_escalate" in names
    prop = next(p for p in envelope["toolProposals"] if p["name"] == "propose_escalate")
    assert prop.get("auto") is False


def test_needs_confirm_proposal_skips_delete_priority_chip():
    """Catalog deletes confirm in chat — never emit Confirm: Delete priority chips."""
    from app.agent_turn import chat_result_to_agent_turn

    envelope = chat_result_to_agent_turn(
        {
            "reply": "Are you sure you want to delete Very low?",
            "agent": "admin",
            "actions": [
                {
                    "type": "delete_priority",
                    "id": "9",
                    "displayName": "Very low",
                    "awaiting": "delete_confirm",
                    "kind": "priority",
                }
            ],
            "data": {
                "priority_draft": {
                    "id": "9",
                    "displayName": "Very low",
                    "awaiting": "delete_confirm",
                    "kind": "priority",
                },
                "workflow": "create_priority",
                "last_tool_outcome": {
                    "tool": "delete_priority",
                    "success": False,
                    "error_code": "CONFIRMATION_REQUIRED",
                    "kind": "needs_confirm",
                    "arguments": {"priority_id": "9"},
                },
            },
        },
        module="admin",
        page_surface="list",
        page="Priorities",
    )
    names = [p.get("name") for p in (envelope.get("toolProposals") or [])]
    assert "propose_delete_priority" not in names
    assert "propose_delete_status" not in names
    assert not any(str(n).startswith("propose_delete_") for n in names if n)


def test_ground_priority_hours_blocks_ghost_success(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: 'Got "moderate". What resolution hours (SLA) should it use?',
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_priority"
    mem.durable["priority_draft"] = {
        "displayName": "moderate",
        "awaiting": "hours",
        "kind": "priority",
    }
    ghost = (
        "I have successfully recorded that a moderate priority has been set "
        "with a 24-hour resolution window."
    )
    out = tc._ground_priority_hours_reply(mem, ghost, turn_writes=[])
    assert out is not None
    assert "24" not in out
    assert "hour" in out.lower() or "sla" in out.lower()
    assert mem.durable["priority_draft"].get("awaiting") == "hours"


def test_create_priority_intent_is_not_display_name():
    from app.workflow_schemas import (
        bind_awaiting_value,
        display_name_from_create_priority_utterance,
        looks_like_create_priority_command,
        normalize_priority_fields,
        slot_compatible,
    )

    intent = "i want to set the new priority"
    assert looks_like_create_priority_command(intent)
    assert bind_awaiting_value("create_priority", "name", intent) == {}
    assert normalize_priority_fields({"displayName": intent}) == {}
    assert not slot_compatible("catalog_label", intent)
    assert display_name_from_create_priority_utterance("create priority Critical") is None
    assert looks_like_create_priority_command("Critical") is False
    assert slot_compatible("catalog_label", "Critical")
    named = "Create a new priority named E2P130119"
    from app.workflow_schemas import usable_priority_label

    assert usable_priority_label(named, start_utterance=named) == ""
    assert not slot_compatible("catalog_label", "change Immediate to Fast")
    assert bind_awaiting_value("create_priority", "name", "3 hours") == {}
    assert bind_awaiting_value("create_priority", "hours", "3 hours") == {
        "resolutionHours": 3
    }


def test_create_priority_typo_start_is_not_display_name():
    from app.workflow_schemas import (
        mark_priority_intent_start,
        sanitize_priority_draft_fields,
        usable_priority_label,
    )

    start = "create priorites"
    assert usable_priority_label(start) == start
    assert usable_priority_label(start, start_utterance=start) == ""
    assert usable_priority_label("P2", start_utterance=start) == "P2"
    stamped = mark_priority_intent_start({"awaiting": "name"}, start)
    assert stamped.get("_intent_start_text") == start
    assert not stamped.get("displayName")
    cleaned = sanitize_priority_draft_fields(
        {
            "displayName": start,
            "awaiting": "hours",
            "kind": "priority",
            "_intent_start_text": start,
        }
    )
    assert not cleaned.get("displayName")
    assert cleaned.get("awaiting") == "name"


def test_absorb_priority_start_typo_stays_on_name():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {"awaiting": "name", "kind": "priority"}
    mem.durable["current_workflow"] = "create_priority"
    tc._stamp_catalog_label_intent_start_if_fresh(
        mem, "create priorites", "priority.create"
    )
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "create priorites", "admin", ui) is True
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("awaiting") == "name"
    assert not draft.get("displayName")
    assert draft.get("_intent_start_text") == "create priorites"
    assert ui and ui[-1].get("type") == "create_priority"
    assert "_intent_start_text" not in ui[-1]
    assert not ui[-1].get("displayName")


def test_stamp_priority_clears_domain_mistaken_label():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {
        "awaiting": "hours",
        "displayName": "create priorites",
        "kind": "priority",
    }
    tc._stamp_catalog_label_intent_start_if_fresh(
        mem, "create priorites", "priority.create"
    )
    draft = mem.durable.get("priority_draft") or {}
    assert not draft.get("displayName")
    assert draft.get("_intent_start_text") == "create priorites"
    assert draft.get("awaiting") == "name"


def test_absorb_real_priority_label_after_start_stamp():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {
        "awaiting": "name",
        "kind": "priority",
        "_intent_start_text": "create priorites",
    }
    mem.durable["current_workflow"] = "create_priority"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "P2", "admin", ui) is True
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("displayName") == "P2"
    assert draft.get("awaiting") == "hours"
    assert draft.get("_intent_start_text") == "create priorites"
    assert ui[-1].get("displayName") == "P2"
    assert "_intent_start_text" not in ui[-1]


def test_absorb_named_priority_from_start_utterance():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    start = "Create a new priority named E2P130119"
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    tc._sync_guided_draft_from_task(mem, "priority.create")
    tc._stamp_catalog_label_intent_start_if_fresh(mem, start, "priority.create")
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, start, "admin", ui) is True
    draft = mem.durable.get("priority_draft") or {}
    assert not draft.get("displayName")
    assert draft.get("awaiting") == "name"
    assert draft.get("_intent_start_text") == start
    assert not draft.get("resolutionHours")


def test_absorb_named_macro_from_start_utterance():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state, usable_macro_title

    start = "Create a new macro titled E2M130119"
    assert usable_macro_title(start, start_utterance=start) == ""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("macro.create"))
    tc._sync_guided_draft_from_task(mem, "macro.create")
    tc._stamp_macro_intent_start_if_fresh(mem, start)
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, start, "macros", ui) is True
    draft = mem.durable.get("macro_draft") or {}
    assert not draft.get("title")
    assert draft.get("awaiting") == "title"
    assert draft.get("_intent_start_text") == start


def test_patch_priority_rejects_start_utterance_as_label():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {
        "awaiting": "name",
        "kind": "priority",
        "_intent_start_text": "create priorites",
    }
    mem.durable["current_workflow"] = "create_priority"
    result = tc._execute_local_ui_tool(
        "patch_priority_draft",
        {"displayName": "create priorites"},
        memory=mem,
        ui_actions=[],
    )
    assert result.get("success") is True
    draft = mem.durable.get("priority_draft") or {}
    assert not draft.get("displayName")
    assert draft.get("awaiting") == "name"
    assert draft.get("_intent_start_text") == "create priorites"


def test_ground_priority_rejects_intent_as_name(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "What short name should this priority use?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_priority"
    mem.durable["priority_draft"] = {
        "displayName": "i want to set the new priority",
        "awaiting": "hours",
        "kind": "priority",
    }
    out = tc._ground_priority_hours_reply(
        mem,
        "I've noted the name as i want to set the new priority.",
        turn_writes=[],
    )
    assert out is not None
    assert "noted the name" not in out.lower()
    assert mem.durable["priority_draft"].get("awaiting") == "name"
    assert not mem.durable["priority_draft"].get("displayName")


def test_ground_priority_rejects_typo_start_as_name(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "What short name should this priority use?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_priority"
    mem.durable["priority_draft"] = {
        "displayName": "create priorites",
        "awaiting": "hours",
        "kind": "priority",
        "_intent_start_text": "create priorites",
    }
    out = tc._ground_priority_hours_reply(
        mem,
        "I have recorded the display name as create priorites.",
        turn_writes=[],
    )
    assert out is not None
    assert "recorded" not in out.lower()
    assert mem.durable["priority_draft"].get("awaiting") == "name"
    assert not mem.durable["priority_draft"].get("displayName")


def test_pending_confirm_hydrate_fills_args_without_auto_consent():
    """Prior propose args hydrate; confirmed stays LLM-owned (not auto-set)."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ConfirmationEvidence
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state, preferred_armed_write_tool

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.request_id = "turn-2"
    args = {
        "priority_id": "2001",
        "displayName": "Critical",
        "resolutionHours": 1,
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "update_priority",
        "success": False,
        "error_code": "CONFIRMATION_REQUIRED",
        "kind": "needs_confirm",
        "arguments": args,
    }
    mem.durable["pending_ask"] = "confirm"
    state = new_harness_task_state("priority.update")
    evidence = ConfirmationEvidence(
        confirmation_id="c1",
        task_version=state.task_version,
        skill_version=state.skill_version,
        argument_hash="abc",
        requested_request_id="turn-1",
    )
    mem.set_task_state(
        state.model_copy(
            update={"status": "awaiting_confirmation", "confirmation": evidence}
        )
    )
    assert tc._pending_confirm_write_tool(mem) == "update_priority"
    hydrated = tc._hydrate_pending_confirm_write_args(mem, "update_priority", {})
    assert "confirmed" not in hydrated
    assert hydrated.get("priority_id") == "2001"
    assert hydrated.get("displayName") == "Critical"
    # LLM must pass confirmed=true itself when it judges consent.
    with_llm_consent = tc._hydrate_pending_confirm_write_args(
        mem, "update_priority", {"confirmed": True}
    )
    assert with_llm_consent.get("confirmed") is True
    assert preferred_armed_write_tool(mem.durable) == "update_priority"


def test_update_priority_bound_accepts_display_name_alias(monkeypatch):
    from app.tools import bound as bound_mod

    seen: dict = {}

    def fake_update(pid, *, display_name=None, resolution_hours=None, active=None):
        seen["pid"] = pid
        seen["display_name"] = display_name
        return {"success": True, "payload": {"id": pid, "displayName": display_name}}

    monkeypatch.setattr("app.tools.catalog_tools.update_priority", fake_update)
    out = bound_mod._update_priority("2783", displayName="E2PF145433")
    assert out.get("success") is True
    assert seen["pid"] == "2783"
    assert seen["display_name"] == "E2PF145433"


def test_catalog_create_strips_confirmed_until_prior_propose():
    """Hours/name collect must not create with confirmed=true on the same turn."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ConfirmationEvidence
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.request_id = "hours-turn"
    mem.durable["priority_draft"] = {
        "displayName": "Critical",
        "resolutionHours": 22,
        "awaiting": "confirm",
        "kind": "priority",
    }
    mem.set_task_state(new_harness_task_state("priority.create"))
    assert tc._prior_interactive_confirm_ready(mem, "create_priority") is False
    # Same-turn field bind: still blocked even if draft already awaiting confirm.
    assert (
        tc._allow_catalog_create_confirmed(
            mem, "create_priority", field_bound_this_turn=True
        )
        is False
    )
    # Later affirm turn after chat summary (no tool propose yet): allowed.
    mem.request_id = "affirm-turn"
    assert (
        tc._allow_catalog_create_confirmed(
            mem, "create_priority", field_bound_this_turn=False
        )
        is True
    )

    # After a prior CONFIRMATION_REQUIRED propose, consent may proceed.
    mem.durable["last_tool_outcome"] = {
        "tool": "create_priority",
        "success": False,
        "error_code": "CONFIRMATION_REQUIRED",
        "kind": "needs_confirm",
        "arguments": {"displayName": "Critical", "resolutionHours": 22},
    }
    state = mem.current_task_state()
    assert state is not None
    mem.set_task_state(
        state.model_copy(
            update={
                "status": "awaiting_confirmation",
                "confirmation": ConfirmationEvidence(
                    confirmation_id="c1",
                    task_version=state.task_version,
                    skill_version=state.skill_version,
                    argument_hash="x",
                    requested_request_id="hours-turn",
                ),
            }
        )
    )
    assert tc._prior_interactive_confirm_ready(mem, "create_priority") is True

    hydrated = tc._hydrate_catalog_create_args(
        mem, {"displayName": "Critical", "confirmed": True}, "create_priority"
    )
    # Hydrate must not invent consent; hours come from draft.
    assert hydrated.get("resolutionHours") == 22


def test_catalog_create_success_rejects_idle_greeting_phrase(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_tool_outcome"] = {
        "tool": "create_priority",
        "success": True,
        "arguments": {"displayName": "P1", "resolutionHours": 2},
        "payload": {"displayName": "P1", "resolutionHours": 2, "id": "2643"},
    }

    def _bad_phrase(**_kwargs):
        return (
            "Hello! I'm your Worktual co-worker, and I can assist you with "
            "various tasks across the platform. How can I help you today?"
        )

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", _bad_phrase)
    text = tc._catalog_create_reply_text(mem, _bad_phrase())
    assert text
    assert "P1" in text
    assert "2" in text
    assert not tc._looks_like_idle_greeting(text)


def test_resolve_confirm_tool_maps_propose_without_changing_real_tools():
    """Chip propose_* → write tool + confirmed; real tool names stay as-is."""
    from app.agent_turn import resolve_confirm_tool

    name, args = resolve_confirm_tool(
        "propose_create_ticket",
        {"customerName": "Priya", "customerEmail": "p@acme.com", "issue": "VPN"},
    )
    assert name == "create_ticket"
    assert args.get("confirmed") is True
    assert args.get("customerName") == "Priya"

    name2, args2 = resolve_confirm_tool("create_ticket", {"confirmed": True, "issue": "x"})
    assert name2 == "create_ticket"
    assert args2.get("confirmed") is True
    assert "auto" not in args2

    name3, args3 = resolve_confirm_tool("propose_delete_team", {"id": "q1"})
    assert name3 == "delete_queue"
    assert args3.get("confirmed") is True

    name4, args4 = resolve_confirm_tool("propose_create_team", {"name": "NLU"})
    assert name4 == "create_queue"
    assert args4.get("confirmed") is True


def test_confirm_chip_propose_create_ticket_executes_real_tool(monkeypatch):
    """UI Confirm chip with propose_* must run create_ticket — not fail as unknown tool."""
    from app.agent_turn import run_agent_turn

    captured: dict = {}

    def _fake_execute(agent, name, args, **kwargs):
        captured["agent"] = agent
        captured["name"] = name
        captured["args"] = dict(args or {})
        return '{"success": true, "payload": {"ticketNumber": "#99001"}}'

    monkeypatch.setattr("app.tools.bound.execute_tool_call", _fake_execute)
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Ticket #99001 filed.",
    )

    out = run_agent_turn(
        message="confirm",
        page="Create Ticket",
        organization_id="1000",
        session_id="s1",
        user_id="u1",
        user_role="admin",
        module="tickets",
        page_surface="create",
        confirm_tool={
            "name": "propose_create_ticket",
            "args": {
                "customerName": "Priya",
                "customerEmail": "priya@acme.com",
                "issue": "Billing glitch",
            },
            "auto": False,
            "risk": "high",
        },
    )
    assert captured.get("name") == "create_ticket"
    assert captured.get("args", {}).get("confirmed") is True
    assert captured.get("agent") == "tickets"
    assert out.get("uiRefresh", {}).get("lists") == ["tickets"]
    assert "99001" in str(out.get("assistantText") or out.get("reply") or "") or out.get(
        "reply"
    )


def test_ensure_guided_ui_actions_only_active_workflow():
    from app.agents.ticketing_coworker import (
        _ensure_guided_ui_actions,
        _execute_local_ui_tool,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Anto",
        "awaiting": "contact",
    }
    mem.durable["current_workflow"] = "create_ticket"
    actions: list[dict] = []
    out = _execute_local_ui_tool(
        "patch_macro_draft",
        {"title": "Knowledge Deflection", "awaiting": "body"},
        memory=mem,
        ui_actions=actions,
    )
    assert out.get("success") is True
    assert mem.durable.get("current_workflow") == "create_macro"
    assert mem.durable.get("ticket_draft") is None
    assert any(p.get("flow") == "create_ticket" for p in (mem.durable.get("parked_drafts") or []))
    ensured = _ensure_guided_ui_actions(mem, actions)
    navigates = [a.get("view") for a in ensured if a.get("type") == "navigate"]
    creates = [a.get("type") for a in ensured if str(a.get("type") or "").startswith("create_")]
    assert navigates == ["macros"]
    assert creates == ["create_macro"]


def test_clear_draft_after_create_macro_emits_done_and_open():
    from app.agents.ticketing_coworker import _clear_draft_after_write
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "title": "Knowledge Deflection",
        "body": "Quick links",
        "awaiting": "confirm",
    }
    mem.durable["current_workflow"] = "create_macro"
    actions: list[dict] = [
        {
            "type": "create_macro",
            "title": "Knowledge Deflection",
            "awaiting": "confirm",
        }
    ]
    _clear_draft_after_write(
        "create_macro",
        mem,
        actions,
        result={
            "success": True,
            "payload": {"id": "m-1", "title": "Knowledge Deflection", "body": "Quick links"},
        },
    )
    assert mem.durable.get("macro_draft") is None
    assert mem.durable.get("current_workflow") is None
    assert not any(
        a.get("type") == "create_macro" and not a.get("done") for a in actions
    )
    assert any(a.get("type") == "create_macro" and a.get("done") for a in actions)
    assert any(a.get("type") == "open_macro" and a.get("id") == "m-1" for a in actions)
    assert any(a.get("type") == "refresh_macros" for a in actions)
    from app.agents.ticketing_coworker import _ensure_guided_ui_actions

    ensured = _ensure_guided_ui_actions(mem, actions)
    assert not any(
        a.get("type") == "create_macro" and not a.get("done") for a in ensured
    )

    from app.agent_turn import chat_result_to_agent_turn

    envelope = chat_result_to_agent_turn(
        {
            "reply": "What should the macro body be?",
            "agent": "macros",
            "actions": [
                {"type": "navigate", "view": "macros"},
                {"type": "create_macro", "title": "Knowledge Deflection", "awaiting": "body"},
            ],
            "data": {
                "workflow": "create_macro",
                "macro_draft": {"title": "Knowledge Deflection", "awaiting": "body"},
                "ticket_draft": {"customerName": "Anto", "awaiting": "contact"},
            },
        },
        module="macros",
        page_surface="list",
    )
    patch = envelope.get("patch") or {}
    assert patch.get("title") == "Knowledge Deflection"
    assert "customerName" not in patch
    names = [p.get("name") for p in (envelope.get("toolProposals") or [])]
    assert "patch_macro_draft" in names
    assert "patch_ticket_draft" not in names


def test_normalize_catalog_resolution_hours_sub_hour():
    from app.workflow_schemas import normalize_catalog_resolution_hours

    assert normalize_catalog_resolution_hours(0.5) == 1
    assert normalize_catalog_resolution_hours(1) == 1
    assert normalize_catalog_resolution_hours(4.6) == 5
    assert normalize_catalog_resolution_hours("3 hrs") == 3
    assert normalize_catalog_resolution_hours("24 hours") == 24


def test_absorb_priority_hours_phrase():
    from app.agents.ticketing_coworker import (
        _absorb_guided_field_utterance,
        _sync_guided_draft_from_task,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    _sync_guided_draft_from_task(mem, "priority.create")
    ui: list = []
    assert _absorb_guided_field_utterance(mem, "speed", "admin", ui) is True
    assert _absorb_guided_field_utterance(mem, "3 hrs", "admin", ui) is True
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("displayName") == "speed"
    assert draft.get("resolutionHours") == 3
    assert draft.get("awaiting") == "confirm"


def test_absorb_priority_hours_is_not_display_name():
    from app.agents.ticketing_coworker import (
        _absorb_guided_field_utterance,
        _sync_guided_draft_from_task,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    _sync_guided_draft_from_task(mem, "priority.create")
    ui: list = []
    assert _absorb_guided_field_utterance(mem, "3 hours", "admin", ui) is False
    draft = mem.durable.get("priority_draft") or {}
    assert not draft.get("displayName")
    assert draft.get("resolutionHours") in (None, "")
    assert draft.get("awaiting") in ("name", None, "")


def test_absorb_priority_hours_via_harness_executor_agent_name():
    """Harness TaskState alone must drive absorb even when agent_name is executor id."""
    from app.agents.ticketing_coworker import (
        _absorb_guided_field_utterance,
        _guided_spec_for_agent,
        _sync_guided_draft_from_task,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    _sync_guided_draft_from_task(mem, "priority.create")
    assert _guided_spec_for_agent(mem, "priority_status_crud_executor") == (
        "priority_draft",
        "create_priority",
        "create_priority",
    )
    ui: list = []
    assert (
        _absorb_guided_field_utterance(mem, "P1", "priority_status_crud_executor", ui)
        is True
    )
    assert (
        _absorb_guided_field_utterance(mem, "2", "priority_status_crud_executor", ui)
        is True
    )
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("displayName") == "P1"
    assert draft.get("resolutionHours") == 2
    assert draft.get("awaiting") == "confirm"


def test_align_mispinned_priority_update_recovers_hours_answer():
    """Stuck priority.update + P1 then hours remounts create and seeds confirm."""
    from app.agents.ticketing_coworker import (
        _align_mispinned_catalog_create,
        _catalog_field_collect_fallback,
        _executor_llm_recovery_text,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    mem.add_message("user", "p1")
    mem.add_message("assistant", "Got it, P1. How many resolution hours?")
    mem.add_message("user", "suggest me")
    mem.add_message("assistant", "Common targets are 2, 4, or 8 hours.")
    _align_mispinned_catalog_create(mem, "2")
    state = mem.current_task_state()
    assert state is not None
    assert state.task_id == "priority.create"
    assert state.skill_name == "priority-create"
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("displayName") == "p1"
    assert draft.get("resolutionHours") == 2
    assert draft.get("awaiting") == "confirm"
    recovered = _catalog_field_collect_fallback(mem, "2", allow_phrase=False)
    assert recovered and "p1" in recovered.lower() and "2" in recovered
    assert _executor_llm_recovery_text(mem, "2")


def test_align_keeps_real_priority_update_with_id():
    from app.agents.ticketing_coworker import _align_mispinned_catalog_create
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(
        new_harness_task_state(
            "priority.update",
            collected={"priority_id": "2001", "displayName": "Critical"},
        )
    )
    _align_mispinned_catalog_create(mem, "2")
    assert mem.current_task_state().task_id == "priority.update"


def test_hydrate_catalog_create_args_fills_draft_without_auto_consent():
    """Complete draft hydrates args; confirmed stays LLM-owned (not auto-set)."""
    from app.agents.ticketing_coworker import _hydrate_catalog_create_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {
        "displayName": "VIP",
        "resolutionHours": 1,
        "awaiting": "confirm",
        "kind": "priority",
    }
    out = _hydrate_catalog_create_args(mem, {}, "create_priority")
    assert out.get("displayName") == "VIP"
    assert out.get("resolutionHours") == 1
    assert out.get("confirmed") is None
    assert out.get("auto") is None


def test_patch_priority_draft_emits_create_ui_action():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {"displayName": "VIP", "awaiting": "hours"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    create = next((a for a in ui if a.get("type") == "create_priority"), None)
    assert create is not None
    assert create.get("displayName") == "VIP"
    assert create.get("awaiting") == "hours"
    assert mem.durable.get("current_workflow") == "create_priority"


def test_patch_priority_with_catalog_id_forces_delete_confirm():
    """Selecting an existing catalog row (id present) must not open create SLA hours."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {
            "id": "pri-golg",
            "displayName": "golg",
            "kind": "priority",
        },
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("id") == "pri-golg"
    assert str(draft.get("awaiting") or "").lower() == "delete_confirm"
    assert not any(a.get("type") == "create_priority" for a in ui)
    assert any(
        a.get("type") == "delete_priority" and a.get("awaiting") == "delete_confirm"
        for a in ui
    )


def test_admin_prompt_idle_omits_create_priority_schema():
    from app.prompts.builder import build_admin_prompt

    idle = build_admin_prompt(
        module="admin",
        surface="list",
        memory_snapshot={"durable": {}},
        actor_role="admin",
    )
    assert "primary_create_workflow=create_priority" not in idle

    deleting = build_admin_prompt(
        module="admin",
        surface="priorities",
        memory_snapshot={
            "durable": {
                "current_workflow": "create_priority",
                "priority_draft": {
                    "awaiting": "delete_confirm",
                    "kind": "priority",
                    "id": "p1",
                    "displayName": "golg",
                },
                "pending_ask": "delete_confirm",
            }
        },
        actor_role="admin",
    )
    assert "primary_create_workflow=create_priority" not in deleting
    assert "active_catalog_op=delete_priority" in deleting or "delete_priority" in deleting
    assert "ask_next_field_id=delete_confirm" in deleting


def test_patch_priority_strips_invented_hours_with_name():
    """Name turn must not invent resolutionHours — next ask is SLA hours."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {"awaiting": "name", "kind": "priority"}
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {"displayName": "Immediate", "resolutionHours": 1},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("displayName") == "Immediate"
    assert draft.get("resolutionHours") in (None, "", 0)
    assert str(draft.get("awaiting") or "").lower() == "hours"


def test_hydrate_create_priority_rejects_invented_hours():
    from app.agents.ticketing_coworker import _hydrate_catalog_create_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {
        "displayName": "Immediate",
        "awaiting": "hours",
        "kind": "priority",
    }
    out = _hydrate_catalog_create_args(
        mem, {"displayName": "Immediate", "resolutionHours": 4}, "create_priority"
    )
    assert "resolutionHours" not in out or out.get("resolutionHours") in (None, 0)
    assert out.get("confirmed") is not True


def test_sync_priority_supplied_fields_into_draft():
    """Domain snake_case supplied_fields must land on priority_draft before write."""
    from app.agents.ticketing_coworker import _sync_guided_draft_from_task
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(
        new_harness_task_state(
            "priority.create",
            collected={
                "display_name": "Speed",
                "resolution_hours": 3,
            },
            provenance={"display_name": "domain", "resolution_hours": "domain"},
        )
    )
    _sync_guided_draft_from_task(mem, "priority.create")
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("displayName") == "Speed"
    assert draft.get("resolutionHours") == 3
    assert draft.get("awaiting") == "confirm"
    assert mem.durable.get("current_workflow") == "create_priority"


def test_hydrate_create_priority_uses_task_collected_hours():
    from app.agents.ticketing_coworker import _hydrate_catalog_create_args
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(
        new_harness_task_state(
            "priority.create",
            collected={"display_name": "Speed", "resolution_hours": 3},
        )
    )
    out = _hydrate_catalog_create_args(
        mem,
        {"displayName": "Speed", "resolutionHours": 3, "confirmed": True},
        "create_priority",
    )
    assert out.get("displayName") == "Speed"
    assert out.get("resolutionHours") == 3
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("resolutionHours") == 3


def test_absorb_create_article_command_stays_on_title():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {"awaiting": "title"}
    mem.durable["current_workflow"] = "create_kb"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "create article", "kb", ui) is True
    draft = mem.durable.get("kb_draft") or {}
    assert not draft.get("title")
    assert draft.get("awaiting") == "title"


def test_absorb_create_article_titled_stays_on_title(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        tc,
        "_fetch_kb_category_names",
        lambda: ["General", "Billing"],
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {"awaiting": "title"}
    mem.durable["current_workflow"] = "create_kb"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(
        mem, "create article titled Reset VPN", "kb", ui
    ) is True
    draft = mem.durable.get("kb_draft") or {}
    assert not draft.get("title")
    assert draft.get("awaiting") == "title"
    assert draft.get("_intent_start_text")


def test_patch_kb_rejects_invented_new_article_title():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {"awaiting": "title"}
    mem.durable["current_workflow"] = "create_kb"
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_kb_draft",
        {"title": "New Article", "awaiting": "category"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    draft = mem.durable.get("kb_draft") or {}
    assert not draft.get("title")
    assert draft.get("awaiting") == "title"


def test_shared_memory_keeps_durable_conversation_for_specialists():
    from app.memory.session import SharedMemory

    mem = SharedMemory(
        organization_id="1",
        user_id="u",
        session_id="s",
        durable={
            "recent_history": [
                {"role": "user", "text": "create a moderate priority"},
                {"role": "assistant", "text": "What resolution hours?"},
            ]
        },
        history=[{"role": "user", "text": "create article"}],
    )
    roles_texts = {(m["role"], m["content"]) for m in mem.messages}
    assert ("user", "create a moderate priority") in roles_texts
    assert ("assistant", "What resolution hours?") in roles_texts
    assert ("user", "create article") in roles_texts


def test_absorb_kb_long_paste_saves_body_keeps_category(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        tc,
        "_fetch_kb_category_names",
        lambda: ["General", "Billing", "Accounts"],
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {"title": "Login KB", "awaiting": "category"}
    mem.durable["current_workflow"] = "create_kb"
    ui: list[dict] = []
    body = (
        "You can fix most sign-in problems by clearing your browser cache and cookies "
        "or checking your network connection. Basic Browser Steps..."
    )
    assert tc._absorb_guided_field_utterance(mem, body, "kb", ui) is True
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("body") == body
    assert not draft.get("category")
    assert draft.get("awaiting") == "category"
    assert "Billing" in (draft.get("available_categories") or [])


def test_absorb_kb_category_pick_from_list(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        tc,
        "_fetch_kb_category_names",
        lambda: ["General", "Billing", "Accounts"],
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {
        "title": "Login KB",
        "body": "Clear cache then retry login.",
        "awaiting": "category",
        "available_categories": ["General", "Billing", "Accounts"],
    }
    mem.durable["current_workflow"] = "create_kb"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "Accounts", "kb", ui) is True
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("category") == "Accounts"
    assert draft.get("awaiting") == "confirm"


def test_patch_kb_rejects_body_plus_invented_category(monkeypatch):
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        tc,
        "_fetch_kb_category_names",
        lambda: ["General", "Billing"],
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {"title": "Login KB", "awaiting": "category"}
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_kb_draft",
        {
            "body": "Long troubleshooting steps for login issues go here.",
            "category": "General",
        },
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("body")
    assert not draft.get("category")
    assert draft.get("awaiting") == "category"


def test_patch_team_draft_requires_exact_roster_names_for_typos():
    """Typos are not auto-fixed in code — LLM must confirm canonical names first."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    roster = [
        "Yaswanth MG",
        "Mohammed Fazil",
        "Ashika A",
        "Sri Annamalai",
        "Raghuram M",
        "Deva NS",
    ]
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "name": "ccaas",
        "description": "CCaaS routing team",
        "awaiting": "members",
        "available_members": roster,
    }
    ui: list[dict] = []
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"members": ["yaswabth", "fazil", "annamali"]},
        memory=mem,
        ui_actions=ui,
    )
    assert out.get("success") is False
    assert out.get("error_code") == "MEMBER_NOT_ON_ROSTER"
    assert (mem.durable.get("team_draft") or {}).get("members") is None


def test_patch_team_draft_accepts_exact_roster_spellings():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    roster = ["Yaswanth MG", "Mohammed Fazil", "Sri Annamalai"]
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "name": "ccaas",
        "description": "CCaaS team",
        "awaiting": "members",
        "available_members": roster,
    }
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"members": ["yaswanth mg", "Mohammed Fazil", "SRI ANNAMALAI"]},
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True
    members = (mem.durable.get("team_draft") or {}).get("members") or []
    assert members == ["Yaswanth MG", "Mohammed Fazil", "Sri Annamalai"]
    assert (mem.durable.get("team_draft") or {}).get("awaiting") == "confirm"


def test_patch_team_draft_rejects_members_without_roster():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "name": "ccaas",
        "description": "CCaaS team",
        "awaiting": "members",
    }
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"members": ["yaswanth", "fazil"]},
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is False
    assert out.get("error_code") == "ROSTER_REQUIRED"
    assert (mem.durable.get("team_draft") or {}).get("members") is None


def test_teams_prompt_asks_llm_to_confirm_canonical_member_names():
    from app.prompts.builder import build_teams_prompt

    prompt = build_teams_prompt(
        module="admin",
        surface="agent-queues",
        memory_snapshot={},
        actor_role="admin",
        page="Teams",
    )
    assert "Did you mean" in prompt
    assert "exact roster spellings" in prompt
    assert "tool resolves against" not in prompt
    assert "Never re-ask which team" in prompt


def test_wants_add_missing_customer_is_llm_owned_noop():
    """Add-customer after CDP miss is specialist LLM — no keyword affirm gate."""
    from app.workflow_schemas import (
        utterance_plausibly_confirms,
        wants_add_missing_customer,
    )

    assert wants_add_missing_customer("okay then addd") is False
    assert wants_add_missing_customer("yes") is False
    assert wants_add_missing_customer("add them") is False
    assert wants_add_missing_customer("add customer") is False
    assert wants_add_missing_customer("cancel") is False
    assert wants_add_missing_customer("") is False
    # Confirm phrase helper is a permanent no-op (LLM owns consent).
    assert utterance_plausibly_confirms("yes") is False
    assert utterance_plausibly_confirms("yehh") is False
    assert utterance_plausibly_confirms("go ahead and file it") is False


def test_create_customer_yesh_executes_pinned_executor_mcp(monkeypatch):
    """Trusted structured task plus semantic confirmation executes through MCP."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "customer-1",
                        "name": "create_customer",
                        "arguments": {"confirmed": True},
                    }
                ],
            },
            {"content": "Customer Sidharth is saved.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)
    created: dict[str, Any] = {}

    def _dispatch(name, args, **kwargs):
        created["name"] = name
        created["args"] = dict(args)
        return {
            "success": True,
            "payload": {
                "customer": {
                    "id": "55",
                    "name": "Sidharth",
                    "email": "sidharth@gmail.com",
                    "phone": "8978676755",
                }
            },
        }

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.durable["customer_draft"] = {
        "awaiting": "confirm",
        "name": "Sidharth",
        "email": "sidharth@gmail.com",
        "phone": "8978676755",
    }
    memory.durable["current_workflow"] = "create_customer"
    memory.durable["pending_ask"] = "confirm"
    request = RunRequest(
        message="yesh",
        session_id="s1",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="customers",
        surface="create",
        session_memory={"trustedStructured": True},
    )
    out = tc.run_coworker_agent(
        agent_name="customers",
        memory=memory,
        query="yesh",
        context={
            "request": request,
            "module": "customers",
            "surface": "create",
            "page": "Customers",
        },
    )
    assert created.get("name") == "create_customer"
    assert created.get("args", {}).get("confirmed") is True
    assert created.get("args", {}).get("name") == "Sidharth"
    assert created.get("args", {}).get("email") == "sidharth@gmail.com"
    assert memory.durable.get("customer_draft") is None
    assert out.get("response_type") == "final"
    assert str(out.get("assistant_text") or "").strip()


def test_create_ticket_cdp_miss_stays_with_pinned_ticket_executor(monkeypatch):
    """A CDP miss stays in canonical ticket TaskState for its pinned Executor."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    executor_calls: list[tuple[str, str]] = []

    class ContinueLLM:
        def run(self, *a, **k):
            return {
                "content": "",
                "tool_calls": [{"name": "continue_active_task", "arguments": {}}],
            }

    monkeypatch.setattr(tc, "get_llm", lambda: ContinueLLM())

    def fake_executor(**kwargs):
        executor_calls.append(
            (kwargs["harness_executor"], kwargs["harness_skill"])
        )
        return {
            "response_type": "final",
            "assistant_text": "I need the customer's contact details before continuing.",
            "data": {},
        }

    monkeypatch.setattr(tc, "_run_executor_loop", fake_executor)
    memory = SharedMemory(organization_id="org-1", user_id="u1", session_id="s1")
    memory.durable["ticket_draft"] = {
        "awaiting": "confirm",
        "customerName": "Sidharth",
        "customerEmail": "",
        "issue": "CRM not working",
        "priority": "medium",
    }
    memory.durable["current_workflow"] = "create_ticket"

    tc._flag_ticket_customer_not_found(memory)
    assert memory.durable["ticket_draft"].get("customer_not_found") is True

    request = RunRequest(
        message="okay then addd",
        session_id="s1",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="tickets",
        surface="create",
    )
    out = tc.run_coworker_agent(
        agent_name="tickets",
        memory=memory,
        query="okay then addd",
        context={
            "request": request,
            "module": "tickets",
            "surface": "create",
            "page": "Create Ticket",
        },
    )
    assert out.get("response_type") == "final"
    assert out.get("agent") == "ticket_creation_executor"
    assert executor_calls == [("ticket_creation_executor", "ticket-create")]
    state = memory.current_task_state()
    assert state and state.task_id == "ticket.create"
    assert state.executor == "ticket_creation_executor"
    assert state.collected["customer_not_found"] is True
    assert state.provenance["customer_not_found"] == "hydrated_draft"


def test_tickets_prompt_offers_chat_add_customer_not_myaccount_only():
    from app.prompts.builder import build_tickets_prompt

    prompt = build_tickets_prompt(
        module="tickets",
        surface="create",
        memory_snapshot={},
        actor_role="admin",
        page="Create Ticket",
    )
    assert "route_to_agent" in prompt
    assert "customers" in prompt
    assert "MyAccount" in prompt
    assert "Never claim customers can only be added in MyAccount" in prompt


def test_apply_customer_binds_native_create_ticket_park_flow():
    from app.memory_contract import apply_customer_row_to_parked_tickets

    parked = apply_customer_row_to_parked_tickets(
        [
            {
                "flow": "create_ticket",
                "draft": {
                    "awaiting": "confirm",
                    "customerName": "Sidharth",
                    "issue": "CRM",
                },
            }
        ],
        customer_id="99",
        name="Sidharth",
        email="sid@example.com",
        phone="9999999999",
    )
    assert len(parked) == 1
    assert parked[0]["flow"] == "ticket"
    assert parked[0]["draft"]["customerId"] == "99"
    assert parked[0]["draft"]["customerEmail"] == "sid@example.com"


def test_clear_create_customer_arms_pending_resume(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import ALLOWED_DURABLE_KEYS, SharedMemory

    assert "pending_resume" in ALLOWED_DURABLE_KEYS

    monkeypatch.setattr(
        "app.memory_contract.maybe_offer_resume",
        lambda *a, **k: None,
    )

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_draft"] = {
        "name": "Sidharth",
        "email": "sid@example.com",
        "phone": "9999999999",
        "awaiting": "confirm",
    }
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "awaiting": "confirm",
                "customerName": "Sidharth",
                "issue": "CRM login",
            },
        }
    ]
    actions: list[dict] = []
    # Express nests the directory row under payload.customer (no top-level id).
    tc._clear_draft_after_write(
        "create_customer",
        mem,
        actions,
        result={
            "success": True,
            "payload": {
                "customer": {
                    "id": "99",
                    "name": "Sidharth",
                    "email": "sid@example.com",
                    "phone": "9999999999",
                },
                "inviteSent": False,
            },
        },
    )
    assert mem.durable.get("customer_draft") is None
    assert not mem.durable.get("parked_drafts")
    ticket = mem.durable.get("ticket_draft") or {}
    assert ticket.get("customerId") == "99"
    assert ticket.get("customerDirectoryStatus") == "verified"
    assert ticket.get("issue") == "CRM login"
    assert mem.durable.get("current_workflow") == "create_ticket"
    last_ent = mem.durable.get("last_entity") or {}
    assert last_ent.get("id") == "99"
    assert last_ent.get("email") == "sid@example.com"
    assert not mem.durable.get("pending_resume")
    assert any(a.get("type") == "create_ticket" for a in actions)
    assert any(a.get("type") == "navigate" and a.get("view") == "create-ticket" for a in actions)
    assert not any(
        a.get("type") == "navigate" and a.get("view") == "customers" for a in actions
    )
    live = [a for a in actions if a.get("type") == "create_ticket" and not a.get("done")]
    assert live
    assert live[0].get("customerId") == "99" or live[0].get("issue") == "CRM login"

    """If park bind missed nested create_customer payload, resume still binds via last_entity."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.agents.workflow_nlu.decide_workflow_turn",
        lambda *a, **k: {"action": "RESUME_WORKFLOW"},
    )
    monkeypatch.setattr(
        "app.agents.workflow_nlu.ground_resume_offer_decision",
        lambda decision, state: decision,
    )

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "awaiting": "confirm",
                "customerName": "Mohamed Fazil",
                "customerEmail": "smohamedfazil16@gmail.com",
                "issue": "lola voice bot not working",
                "priority": "High",
                "customer_not_found": True,
            },
        }
    ]
    mem.durable["pending_resume"] = {"flow": "ticket", "workflow_id": "create_ticket"}
    mem.durable["pending_ask"] = "resume_offer"
    mem.durable["last_entity"] = {
        "type": "customer",
        "id": "cust-77",
        "name": "Mohamed Fazil",
        "email": "smohamedfazil16@gmail.com",
        "phone": "9597036512",
    }

    request = RunRequest(
        message="yes continue",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="admin",
            user_name="Admin",
        ),
        session_id="s",
    )
    context = {
        "request": request,
        "module": "tickets",
        "surface": "create",
        "page": "Create Ticket",
        "request_id": "r1",
    }
    target = tc._try_native_resume_parked_workflow(mem, "yes continue", context)
    assert target == "tickets"
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("customerId") == "cust-77"
    assert draft.get("customerPhone") == "9597036512"
    assert "customer_not_found" not in draft
    assert mem.durable.get("force_armed_write") is True
    hydrated = tc._hydrate_create_ticket_args(mem, {})
    assert hydrated.get("customerId") == "cust-77"
    # Hydrate fills fields only; confirmed stays LLM/force/gate-owned.
    assert hydrated.get("confirmed") is not True


def test_native_resume_unparks_ticket_on_affirm(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.agents.workflow_nlu.decide_workflow_turn",
        lambda *a, **k: {"action": "CONFIRM_WORKFLOW", "operation": "CREATE_TICKET"},
    )
    monkeypatch.setattr(
        "app.agents.workflow_nlu.ground_resume_offer_decision",
        lambda decision, state: {**decision, "action": "RESUME_WORKFLOW"},
    )

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "awaiting": "confirm",
                "customerName": "Sidharth",
                "customerId": "99",
                "customerEmail": "sid@example.com",
                "issue": "CRM login",
                "priority": "Medium",
            },
        }
    ]
    mem.durable["pending_resume"] = {"flow": "ticket", "workflow_id": "create_ticket"}
    mem.durable["pending_ask"] = "resume_offer"
    mem.durable["last_query"] = {
        "pending_resume": mem.durable["pending_resume"],
        "awaiting": "resume_offer",
    }

    request = RunRequest(
        message="yesh",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="admin",
            user_name="Admin",
        ),
        session_id="s",
    )
    context = {
        "request": request,
        "module": "tickets",
        "surface": "create",
        "page": "Create Ticket",
        "request_id": "r1",
    }
    target = tc._try_native_resume_parked_workflow(mem, "yesh", context)
    assert target == "tickets"
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("customerId") == "99"
    assert draft.get("issue") == "CRM login"
    assert draft.get("awaiting") == "confirm"
    assert mem.durable.get("current_workflow") == "create_ticket"
    assert not mem.durable.get("parked_drafts")
    assert mem.durable.get("pending_resume") is None
    assert mem.durable.get("force_armed_write") is True
    assert tc._should_force_native_armed_write(
        mem,
        "yesh",
        context,
        workflow_decision={"action": "RESUME_WORKFLOW"},
    )


def test_native_resume_unparks_kb_on_affirm(monkeypatch):
    """Resume after side quest works for non-ticket modules too."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.agents.workflow_nlu.decide_workflow_turn",
        lambda *a, **k: {"action": "RESUME_WORKFLOW"},
    )
    monkeypatch.setattr(
        "app.agents.workflow_nlu.ground_resume_offer_decision",
        lambda decision, state: decision,
    )

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["parked_drafts"] = [
        {
            "flow": "kb",
            "draft": {
                "awaiting": "confirm",
                "title": "Reset MFA",
                "content": "Step-by-step MFA reset for staff.",
                "body": "Step-by-step MFA reset for staff.",
                "category": "Security",
            },
        }
    ]
    mem.durable["pending_resume"] = {"flow": "kb", "workflow_id": "create_kb"}
    mem.durable["pending_ask"] = "resume_offer"

    request = RunRequest(
        message="yes continue",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="admin",
            user_name="Admin",
        ),
        session_id="s",
    )
    context = {
        "request": request,
        "module": "kb",
        "surface": "create",
        "page": "Knowledge Base",
        "request_id": "r1",
    }
    target = tc._try_native_resume_parked_workflow(mem, "yes continue", context)
    assert target == "kb"
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("title") == "Reset MFA"
    assert draft.get("awaiting") == "confirm"
    assert mem.durable.get("current_workflow") == "create_kb"
    assert mem.durable.get("force_armed_write") is True


def test_ground_write_outcome_when_owed_write_missing(monkeypatch):
    """When confirm write was owed but did not run, replace model prose (no regex)."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Ticket is not filed yet — want me to save it now?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "confirm",
        "customerName": "Brijesh",
        "customerId": "99",
        "customerEmail": "b@example.com",
        "issue": "Lola chatbot issue",
        "priority": "Medium",
    }
    ghost = (
        "Done! The ticket for Brijesh regarding the Lola chatbot issue "
        "has been successfully filed."
    )
    out = tc._ground_write_outcome_reply(
        mem,
        ghost,
        [],
        turn_writes=[],
        turn_failed_writes=[],
        write_was_owed=True,
        armed_tools=frozenset({"create_ticket"}),
    )
    assert out
    assert "successfully filed" not in out.lower()
    assert "not filed" in out.lower() or "save" in out.lower()


def test_ground_write_outcome_keeps_text_after_real_write(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    text = "Ticket #12850 for Brijesh is filed."
    out = tc._ground_write_outcome_reply(
        mem,
        text,
        [{"type": "create_ticket", "done": True, "ticketNumber": "#12850"}],
        turn_writes=["create_ticket"],
        turn_failed_writes=[],
        write_was_owed=True,
        armed_tools=frozenset({"create_ticket"}),
    )
    assert out == text


def test_ground_write_outcome_on_failed_confirm_tool(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Save failed — retry create_ticket?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {"awaiting": "confirm", "customerName": "Brijesh"}
    mem.durable["last_tool_outcome"] = {
        "tool": "create_ticket",
        "success": False,
        "message": "CONFIRMATION_REQUIRED",
    }
    out = tc._ground_write_outcome_reply(
        mem,
        "All set, ticket filed!",
        [],
        turn_writes=[],
        turn_failed_writes=["create_ticket"],
        write_was_owed=False,
        armed_tools=frozenset(),
    )
    assert out
    assert "filed!" not in out.lower()
    assert "failed" in out.lower() or "retry" in out.lower()


def test_super_agent_customers_path_parks_ticket_and_keeps_issue():
    """Super Agent → customers must park ticket_draft with issue intact."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "confirm",
        "customerName": "Manoj",
        "customerEmail": "manoj@gmail.com",
        "issue": "my crm is not responding well and i have expected better responses",
        "subject": "CRM performance and responsiveness issues",
        "description": "Customer reports CRM is not responding well.",
        "priority": "medium",
        "customer_not_found": True,
        "enriched": True,
    }
    tc._ensure_ticket_parked_before_customers(mem)
    assert mem.durable.get("ticket_draft") is None
    parked = mem.durable.get("parked_drafts") or []
    assert parked
    draft = parked[-1]["draft"]
    assert draft.get("issue") == (
        "my crm is not responding well and i have expected better responses"
    )
    assert draft.get("subject") == "CRM performance and responsiveness issues"
    assert mem.durable.get("current_workflow") == "create_customer"
    cust = mem.durable.get("customer_draft") or {}
    assert cust.get("name") == "Manoj"
    assert cust.get("email") == "manoj@gmail.com"


def test_arm_resume_after_customer_restores_ticket_draft():
    """After add-customer, unpark ticket into active draft for panel + create."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "awaiting": "contact",
                "customerName": "Chandru",
                "customerEmail": "chandru@gmail.com",
            },
        }
    ]
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["last_entity"] = {
        "type": "customer",
        "id": "cust-chandru",
        "name": "Chandru",
        "email": "chandru@gmail.com",
        "phone": "9008877665",
    }
    ui: list = []
    tc._arm_native_resume_after_customer(mem, ui_actions=ui)
    assert mem.durable.get("current_workflow") == "create_ticket"
    assert not mem.durable.get("pending_resume")
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("customerId") == "cust-chandru"
    assert draft.get("customerDirectoryStatus") == "verified"
    assert draft.get("customerPhone") == "9008877665"
    assert not mem.durable.get("parked_drafts")
    assert any(a.get("type") == "create_ticket" for a in ui)
    assert any(a.get("type") == "navigate" and a.get("view") == "create-ticket" for a in ui)


def test_create_ticket_gate_passes_after_customer_bind():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Chandru",
        "customerEmail": "chandru@gmail.com",
        "customerId": "cust-1",
        "customerDirectoryStatus": "verified",
        "issue": "Voice bot stopped responding after update",
        "awaiting": "confirm",
    }
    draft = mem.durable["ticket_draft"]
    assert tc._ticket_directory_verified(draft) is True


def test_arm_resume_after_customer_parks_active_ticket_with_issue():
    """If ticket was never parked (Super Agent path), arming resume parks it."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "confirm",
        "customerName": "Manoj",
        "customerEmail": "manoj@gmail.com",
        "issue": "my crm is not responding well",
        "subject": "CRM performance",
        "priority": "medium",
        "customerId": "cust-1",
    }
    mem.durable["customer_draft"] = {
        "awaiting": "confirm",
        "name": "Manoj",
        "email": "manoj@gmail.com",
        "phone": "9887766321",
    }
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["last_entity"] = {
        "type": "customer",
        "id": "cust-1",
        "name": "Manoj",
        "email": "manoj@gmail.com",
        "phone": "9887766321",
    }
    tc._arm_native_resume_after_customer(mem, user_text="9887766321")
    assert mem.durable.get("customer_draft") is None
    assert mem.durable.get("current_workflow") == "create_ticket"
    assert not mem.durable.get("pending_resume")
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("customerId") == "cust-1"
    assert draft.get("customerDirectoryStatus") == "verified"
    assert draft.get("issue") == "my crm is not responding well"
    assert str(draft.get("awaiting") or "") == "confirm"


def test_hydrate_create_ticket_sets_issue_from_description():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import missing_ticket_fields

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Manoj",
        "customerEmail": "manoj@gmail.com",
        "customerId": "cust-1",
        "description": "my crm is not responding well",
        "subject": "CRM performance",
        "awaiting": "confirm",
    }
    assert missing_ticket_fields(mem.durable["ticket_draft"]) == []
    out = tc._hydrate_create_ticket_args(
        mem,
        {
            "customerName": "Manoj",
            "customerEmail": "manoj@gmail.com",
            "description": "my crm is not responding well",
            "subject": "CRM performance",
        },
    )
    assert out.get("issue") == "my crm is not responding well"
    assert (mem.durable.get("ticket_draft") or {}).get("issue") == (
        "my crm is not responding well"
    )


def test_native_resume_after_customer_keeps_issue_and_forces_write(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.agents.workflow_nlu.decide_workflow_turn",
        lambda *a, **k: {"action": "RESUME_WORKFLOW"},
    )
    monkeypatch.setattr(
        "app.agents.workflow_nlu.ground_resume_offer_decision",
        lambda decision, state: decision,
    )

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "awaiting": "confirm",
                "customerName": "Manoj",
                "customerEmail": "manoj@gmail.com",
                "customerId": "cust-1",
                "customerPhone": "9887766321",
                "issue": "my crm is not responding well and i have expected better responses",
                "subject": "CRM performance and responsiveness issues",
                "description": "Customer reports CRM issues.",
                "priority": "medium",
                "queue": "Bug Solvers",
            },
        }
    ]
    mem.durable["pending_resume"] = {"flow": "ticket", "workflow_id": "create_ticket"}
    mem.durable["pending_ask"] = "resume_offer"
    mem.durable["customer_draft"] = {"awaiting": "confirm", "name": "Manoj"}
    mem.durable["current_workflow"] = "create_customer"

    request = RunRequest(
        message="yehh",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="admin",
            user_name="Admin",
        ),
        session_id="s",
    )
    context = {
        "request": request,
        "module": "tickets",
        "surface": "create",
        "page": "Create Ticket",
        "request_id": "r1",
    }
    target = tc._try_native_resume_parked_workflow(mem, "yehh", context)
    assert target == "tickets"
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("issue") == (
        "my crm is not responding well and i have expected better responses"
    )
    assert draft.get("customerId") == "cust-1"
    assert draft.get("awaiting") == "confirm"
    assert mem.durable.get("force_armed_write") is True
    assert mem.durable.get("customer_draft") is None
    assert mem.durable.get("pending_resume") is None


def test_tickets_prompt_mentions_resume_after_add_customer():
    from app.prompts.builder import build_tickets_prompt

    prompt = build_tickets_prompt(
        module="tickets",
        surface="create",
        memory_snapshot={
            "durable": {
                "pending_resume": {"flow": "ticket"},
                "parked_drafts": [
                    {
                        "flow": "ticket",
                        "draft": {
                            "customerName": "Manoj",
                            "issue": "crm down",
                            "awaiting": "confirm",
                        },
                    }
                ],
            }
        },
        actor_role="admin",
    )
    assert "resume_parked_ticket" in prompt
    assert "never re-ask" in prompt.lower()


def test_resume_not_blocked_by_stale_customer_draft_when_offer_open():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["pending_ask"] = "resume_offer"
    mem.durable["pending_resume"] = {"flow": "ticket"}
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["customer_draft"] = {"awaiting": "phone", "name": "Brijesh"}
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "awaiting": "confirm",
                "customerId": "99",
                "customerName": "Brijesh",
                "issue": "Lola chatbot",
            },
        }
    ]
    assert not tc._active_guided_collect_blocking_resume(mem)
    assert mem.durable.get("customer_draft") is None
    assert mem.durable.get("current_workflow") is None


def test_promote_complete_macro_draft_to_confirm():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import armed_write_tools_from_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    # LLM often stores name without awaiting=confirm.
    mem.durable["macro_draft"] = {
        "awaiting": "body",
        "name": "test",
        "body": "hi i have resolved this ticket in 1hr",
    }
    tc._promote_complete_guided_drafts(mem)
    draft = mem.durable["macro_draft"]
    assert draft.get("title") == "test"
    assert draft.get("awaiting") == "confirm"
    tools = armed_write_tools_from_state(dict(mem.durable))
    assert "create_macro" in tools


def test_macro_save_it_forces_when_armed(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "awaiting": "confirm",
        "title": "test",
        "body": "hi i have resolved this ticket in 1hr",
    }
    mem.durable["current_workflow"] = "create_macro"
    request = RunRequest(
        message="save it",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="macros",
        surface="macros",
    )
    context = {
        "request": request,
        "module": "macros",
        "surface": "macros",
        "page": "Macros",
    }
    assert not tc._should_force_native_armed_write(
        mem,
        "save it",
        context,
        workflow_decision={},
    )
    assert tc._should_force_native_armed_write(
        mem,
        "yes",
        context,
        workflow_decision={"action": "CONFIRM_WORKFLOW"},
    )


def test_absorb_create_macros_start_is_not_title():
    """Start utterance (incl. plural) must not fill the macro title panel."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {"awaiting": "title"}
    mem.durable["current_workflow"] = "create_macro"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "create macros", "macros", ui) is True
    draft = mem.durable.get("macro_draft") or {}
    assert draft.get("awaiting") == "title"
    assert not draft.get("title")
    assert draft.get("_intent_start_text") == "create macros"
    assert ui and ui[-1].get("type") == "create_macro"
    assert "_intent_start_text" not in ui[-1]
    assert not ui[-1].get("title")


def test_stamp_macro_clears_domain_mistaken_title():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "awaiting": "title",
        "title": "create macros",
    }
    tc._stamp_macro_intent_start_if_fresh(mem, "create macros")
    draft = mem.durable.get("macro_draft") or {}
    assert not draft.get("title")
    assert draft.get("_intent_start_text") == "create macros"
    assert draft.get("awaiting") == "title"


def test_absorb_real_macro_title_after_start_stamp():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "awaiting": "title",
        "_intent_start_text": "create macros",
    }
    mem.durable["current_workflow"] = "create_macro"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "Backed Issue", "macros", ui) is True
    draft = mem.durable.get("macro_draft") or {}
    assert draft.get("title") == "Backed Issue"
    assert draft.get("awaiting") == "body"
    assert draft.get("_intent_start_text") == "create macros"
    assert ui[-1].get("title") == "Backed Issue"
    assert "_intent_start_text" not in ui[-1]


def test_sanitize_macro_drops_body_copied_from_title():
    from app.workflow_schemas import sanitize_macro_draft_fields

    cleaned = sanitize_macro_draft_fields(
        {
            "title": "Backed Issue",
            "body": "Backed Issue",
            "awaiting": "confirm",
        }
    )
    assert cleaned.get("title") == "Backed Issue"
    assert not cleaned.get("body")
    assert cleaned.get("awaiting") == "body"


def test_patch_macro_title_does_not_copy_into_body_or_confirm():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "awaiting": "title",
        "_intent_start_text": "create macros",
        "body": "Backed Issue",
    }
    mem.durable["current_workflow"] = "create_macro"
    result = tc._execute_local_ui_tool(
        "patch_macro_draft",
        {"title": "Backed Issue"},
        memory=mem,
        ui_actions=[],
    )
    assert result.get("success") is True
    payload = result.get("payload") or {}
    draft = payload.get("draft") or mem.durable.get("macro_draft") or {}
    assert draft.get("title") == "Backed Issue"
    assert not draft.get("body")
    assert draft.get("awaiting") == "body"
    assert payload.get("awaiting") == "body"
    assert "body" in (payload.get("missing") or ["body"])


def test_apply_guided_write_confirmed_on_affirm_not_collect():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "awaiting": "confirm",
        "title": "Backed Issue",
        "body": "Incident overview text here",
    }
    mem.durable["pending_ask"] = "confirm"
    armed = tc._apply_guided_write_confirmed_flag(
        mem,
        "create_macro",
        {"title": "Backed Issue", "body": "Incident overview text here"},
        field_bound_this_turn=False,
        awaiting_confirm_at_turn_start=True,
    )
    assert armed.get("confirmed") is True

    collect = tc._apply_guided_write_confirmed_flag(
        mem,
        "create_macro",
        {"title": "Backed Issue", "confirmed": True},
        field_bound_this_turn=True,
        awaiting_confirm_at_turn_start=False,
    )
    assert collect.get("confirmed") is not True


def test_update_priority_first_affirm_arms_confirmed():
    """Rename/hours answer + update_priority must write — no second confirm."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.request_id = "affirm-1"
    mem.set_task_state(new_harness_task_state("priority.update"))
    assert (
        tc._same_turn_confirm_retry_ok(
            mem,
            "update_priority",
            field_bound_this_turn=False,
            awaiting_confirm_at_turn_start=False,
        )
        is True
    )
    armed = tc._apply_guided_write_confirmed_flag(
        mem,
        "update_priority",
        {"priority_id": "2782", "displayName": "Vip", "resolutionHours": 3},
        field_bound_this_turn=False,
        awaiting_confirm_at_turn_start=False,
    )
    assert armed.get("confirmed") is True
    collect = tc._apply_guided_write_confirmed_flag(
        mem,
        "update_priority",
        {"priority_id": "2782", "displayName": "Vip", "confirmed": True},
        field_bound_this_turn=True,
        awaiting_confirm_at_turn_start=False,
    )
    assert collect.get("confirmed") is not True
    create_first = tc._apply_guided_write_confirmed_flag(
        mem,
        "create_priority",
        {"displayName": "Vip", "resolutionHours": 3, "confirmed": True},
        field_bound_this_turn=False,
        awaiting_confirm_at_turn_start=False,
    )
    assert create_first.get("confirmed") is not True
    assert (
        tc._same_turn_confirm_retry_ok(
            mem,
            "delete_macro",
            field_bound_this_turn=False,
            awaiting_confirm_at_turn_start=False,
        )
        is True
    )
    delete_armed = tc._apply_guided_write_confirmed_flag(
        mem,
        "delete_macro",
        {"macro_id": "1026"},
        field_bound_this_turn=False,
        awaiting_confirm_at_turn_start=False,
    )
    assert delete_armed.get("confirmed") is True
    delete_collect = tc._apply_guided_write_confirmed_flag(
        mem,
        "delete_macro",
        {"macro_id": "1026", "confirmed": True},
        field_bound_this_turn=True,
        awaiting_confirm_at_turn_start=False,
    )
    assert delete_collect.get("confirmed") is not True


def test_stamp_awaiting_confirm_after_update_hours_ask():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.request_id = "hours-ask"
    mem.set_task_state(new_harness_task_state("priority.update"))
    mem.durable["last_entity"] = {"type": "priority", "id": "2782", "name": "E2P143820"}
    tc._stamp_awaiting_confirm_after_unwritten_update(
        mem, "priority-update", turn_successful_writes=[]
    )
    assert mem.durable.get("pending_ask") == "confirm"
    state = mem.current_task_state()
    assert state is not None
    assert state.status == "awaiting_confirmation"
    assert tc._draft_awaiting_confirm(mem, "update_priority") is True


def test_release_stale_pin_after_primary_write_keeps_fresh_collect():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_tool_outcome"] = {
        "tool": "create_priority",
        "success": True,
    }
    stale = new_harness_task_state("priority.create")
    mem.set_task_state(stale.model_copy(update={"mutation_attempted": True}))
    assert tc._release_stale_harness_pin(mem) is True
    assert mem.current_task_state() is None

    fresh = new_harness_task_state("priority.create")
    mem.set_task_state(fresh)
    assert tc._release_stale_harness_pin(mem) is False
    assert mem.current_task_state() is not None
    assert mem.current_task_state().task_id == "priority.create"


def test_client_pin_does_not_remount_after_successful_write():
    from app.agents.ticketing_coworker import (
        _harness_session_pin_fields,
        _primary_write_already_succeeded,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_tool_outcome"] = {
        "tool": "create_priority",
        "success": True,
    }
    assert _primary_write_already_succeeded(mem, "priority.create") is True
    assert mem.current_task_state() is None
    pin = _harness_session_pin_fields(mem)
    assert pin.get("harnessTaskId") is None
    assert pin.get("harnessFields") is None


def test_ground_unverified_mutation_reply_blocks_fake_update(monkeypatch):
    from app.agents import ticketing_coworker as tc

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Ask which existing priority to change.",
    )
    out = tc._ground_unverified_mutation_reply(
        "I've updated the priority name from Immediate to Fast.",
        skill_name="priority-update",
        tools_called=[],
    )
    assert out
    assert "updated the priority name" not in out.lower()
    listed = tc._ground_unverified_mutation_reply(
        "I've updated the priority name from Immediate to Fast.",
        skill_name="priority-update",
        tools_called=["list_priorities"],
    )
    assert listed
    wrote = tc._ground_unverified_mutation_reply(
        "I've updated the priority name from Immediate to Fast.",
        skill_name="priority-update",
        tools_called=["update_priority"],
    )
    assert wrote is None
    ask = tc._ground_unverified_mutation_reply(
        "Which priority would you like to change?",
        skill_name="priority-update",
        tools_called=[],
    )
    assert ask is None
    live = tc._ground_unverified_mutation_reply(
        "I've updated the priority label from **Immediate** to **Fast**.\n\n"
        "What would you like to do next?",
        skill_name="priority-update",
        tools_called=[],
    )
    assert live
    assert "updated the priority" not in live.lower()


def test_super_live_pin_continue_keeps_executor(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    seen: dict = {}

    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {"mode": "continue"},
    )

    def fake_executor(**kwargs):
        seen["instruction"] = kwargs["instruction"]
        seen["query"] = kwargs["query"]
        return {
            "response_type": "final",
            "assistant_text": "Which field should I change?",
            "agent": "priority_status_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_executor)
    req = RunRequest(
        message="change Immediate to Fast",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="admin",
        surface="staff",
        page="Priorities",
    )
    result = tc._run_harness_supervisor(
        llm=object(),
        memory=mem,
        query="change Immediate to Fast",
        context={"request": req, "module": "admin", "surface": "staff"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert mem.current_task_state() is not None
    assert mem.current_task_state().task_id == "priority.update"
    assert seen["instruction"].executor_id == "priority_status_crud_executor"
    assert seen["instruction"].skill_name == "priority-update"
    assert result.get("agent") == "priority_status_crud_executor"


def test_super_live_pin_route_parks_and_reroutes(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    hops: list[int] = []
    orig = tc._run_harness_supervisor

    def wrapper(**kwargs):
        hops.append(1)
        if len(hops) > 1:
            assert kwargs["memory"].current_task_state() is None
            assert kwargs["query"] == "create a new macross"
            return {
                "response_type": "final",
                "assistant_text": "rerouted",
                "agent": "ticketing_super_agent",
            }
        return orig(**kwargs)

    monkeypatch.setattr(tc, "_run_harness_supervisor", wrapper)
    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {
            "mode": "route",
            "args": {
                "domain_id": "catalog_administration_domain",
                "query": "create a new macross",
            },
        },
    )
    req = RunRequest(
        message="create a new macross",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="macros",
        surface="staff",
        page="Macros",
    )
    result = wrapper(
        llm=object(),
        memory=mem,
        query="create a new macross",
        context={"request": req, "module": "macros", "surface": "staff"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert len(hops) == 2
    assert result.get("assistant_text") == "rerouted"
    assert mem.current_task_state() is None


def test_super_empty_create_pin_routes_update_ask():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    class _EmptyLLM:
        def run(self, messages, tools=None, **kwargs):
            return {"content": "", "tool_calls": []}

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    mem.durable["priority_draft"] = {"awaiting": "name", "kind": "priority"}
    mem.durable["current_workflow"] = "create_priority"
    out = tc._super_live_pin_decision(
        llm=_EmptyLLM(),
        memory=mem,
        query="change Immediate to Fast",
        active=mem.current_task_state(),
    )
    assert out.get("mode") == "route"
    assert (out.get("args") or {}).get("query") == "change Immediate to Fast"


def test_super_empty_create_pin_continues_label_answer():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    class _EmptyLLM:
        def run(self, messages, tools=None, **kwargs):
            return {"content": "", "tool_calls": []}

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    mem.durable["priority_draft"] = {"awaiting": "name", "kind": "priority"}
    mem.durable["current_workflow"] = "create_priority"
    out = tc._super_live_pin_decision(
        llm=_EmptyLLM(),
        memory=mem,
        query="P1",
        active=mem.current_task_state(),
    )
    assert out.get("mode") == "continue"


def test_super_no_pin_continue_recovers_catalog_from_team_focus(monkeypatch):
    """Gemma often calls continue_active_task with no pin; do not 502."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _ContinueLLM:
        def run(self, messages, tools=None, **kwargs):
            names = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            if "delegate_to_executor" in names:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "name": "delegate_to_executor",
                            "arguments": {
                                "executor_id": "team_queue_crud_executor",
                                "task_id": "team.members.update",
                                "skill_name": "team-members-update",
                                "objective": "Add a member to the focused team",
                            },
                        }
                    ],
                }
            return {
                "content": "",
                "tool_calls": [{"name": "continue_active_task", "arguments": {}}],
            }

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "team",
        "id": "1020",
        "name": "Web tracking team",
    }
    seen: dict = {}

    def fake_executor(**kwargs):
        seen["instruction"] = kwargs["instruction"]
        seen["query"] = kwargs["query"]
        return {
            "response_type": "final",
            "assistant_text": "Who should I add to Web tracking team?",
            "agent": "team_queue_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_executor)
    req = RunRequest(
        message="i want to add one more member in this team",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="teams",
        surface="staff",
        page="agent-queues",
    )
    result = tc._run_harness_supervisor(
        llm=_ContinueLLM(),
        memory=mem,
        query="i want to add one more member in this team",
        context={"request": req, "module": "teams", "surface": "staff", "page": "agent-queues"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert result.get("agent") == "team_queue_crud_executor"
    assert seen["instruction"].skill_name == "team-members-update"
    assert seen["instruction"].executor_id == "team_queue_crud_executor"
    assert result.get("assistant_text")


def test_super_no_pin_empty_without_focus_still_errors():
    from app.agents import ticketing_coworker as tc
    from app.contracts.errors import LLMEmptyResponse
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _EmptyLLM:
        def run(self, messages, tools=None, **kwargs):
            return {"content": "", "tool_calls": []}

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    req = RunRequest(
        message="hello there colleague",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
    )
    with pytest.raises(LLMEmptyResponse, match="no route or response"):
        tc._run_harness_supervisor(
            llm=_EmptyLLM(),
            memory=mem,
            query="hello there colleague",
            context={"request": req},
            actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
            budgets=BudgetTracker(RunBudgets()),
        )


def test_domain_id_from_trusted_focus_uses_last_entity_not_utterance():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {"type": "team", "id": "1020", "name": "Web tracking team"}
    assert (
        tc._domain_id_from_trusted_focus(mem, {})
        == "catalog_administration_domain"
    )
    recovered = tc._recover_super_new_task_route(
        memory=mem,
        query="i want to add one more member in this team",
        context={},
        route_result={
            "content": "",
            "tool_calls": [{"name": "continue_active_task", "arguments": {}}],
        },
    )
    assert recovered == {
        "domain_id": "catalog_administration_domain",
        "query": "i want to add one more member in this team",
    }


def test_absorb_does_not_overwrite_macro_body_with_save():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["macro_draft"] = {
        "awaiting": "body",
        "title": "test",
        "body": "original canned reply text here",
    }
    ui: list = []
    bound = tc._absorb_guided_field_utterance(mem, "save it", "macros", ui)
    assert bound is False
    assert mem.durable["macro_draft"]["body"] == "original canned reply text here"


def test_absorb_and_ensure_refresh_progress_panel_on_corrections():
    """Chat field answers and patches must always re-emit panel values."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["customer_draft"] = {
        "name": "Ada",
        "email": "old@ex.com",
        "awaiting": "email",
    }
    ui: list = [
        {
            "type": "create_customer",
            "name": "Ada",
            "email": "old@ex.com",
            "awaiting": "email",
        }
    ]
    assert tc._absorb_guided_field_utterance(mem, "ada@new.com", "customers", ui) is True
    draft = mem.durable["customer_draft"]
    assert draft["email"] == "ada@new.com"
    assert draft["name"] == "Ada"
    live = [a for a in ui if a.get("type") == "create_customer" and not a.get("done")]
    assert len(live) == 1
    assert live[0]["email"] == "ada@new.com"

    # Stale panel action with old email — ensure overwrites from memory.
    stale = [{"type": "create_customer", "name": "Ada", "email": "stale@ex.com", "awaiting": "phone"}]
    ensured = tc._ensure_guided_ui_actions(mem, stale)
    live2 = [a for a in ensured if a.get("type") == "create_customer" and not a.get("done")]
    assert len(live2) == 1
    assert live2[0]["email"] == "ada@new.com"


def test_absorb_ticket_fields_sync_panel(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    def _hit(data, org, **kwargs):
        out = dict(data)
        out["customerId"] = "cust-jordan"
        out["customerEmail"] = str(data.get("customerEmail") or "jordan@acme.com")
        return out, "ok", [{"id": "cust-jordan"}]

    monkeypatch.setattr("app.tasks.chat_commands._bind_directory_customer", _hit)
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {"awaiting": "name"}
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "Jordan Lee", "tickets", ui) is True
    assert mem.durable["ticket_draft"]["customerName"] == "Jordan Lee"
    assert any(a.get("type") == "create_ticket" and a.get("customerName") == "Jordan Lee" for a in ui)

    assert tc._absorb_guided_field_utterance(mem, "jordan@acme.com", "tickets", ui) is True
    assert mem.durable["ticket_draft"].get("customerEmail") or mem.durable["ticket_draft"].get(
        "contact"
    )
    assert tc._absorb_guided_field_utterance(mem, "Cannot login to portal", "tickets", ui) is True
    live = [a for a in ui if a.get("type") == "create_ticket" and not a.get("done")]
    assert len(live) == 1
    assert "Cannot login" in str(live[0].get("issue") or live[0].get("description") or "")


def test_ticket_issue_absorb_ready_to_confirm_skips_unverified():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "customerName": "Ashika",
        "customerEmail": "ashika2701@gmail.com",
        "contact": "ashika2701@gmail.com",
    }
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False

    mem.durable["ticket_draft"].update(
        {
            "awaiting": "confirm",
            "issue": "invalid credentials even though she had an account",
            "customerId": "1019",
            "customerDirectoryStatus": "verified",
        }
    )
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is True

    mem.durable["ticket_draft"]["customerDirectoryStatus"] = "missing"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False

    mem.durable["ticket_draft"]["customerDirectoryStatus"] = "verified"
    mem.durable["ticket_draft"]["awaiting"] = "issue"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False

    mem.durable["current_workflow"] = "create_priority"
    mem.durable["ticket_draft"]["awaiting"] = "confirm"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False


def test_executor_skips_tool_loop_after_verified_issue_absorb(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, DomainInstruction, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state, task_definition_for

    task = task_definition_for("ticket.create")
    assert task is not None
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["active_domain"] = task.domain
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "customerName": "Ashika",
        "customerEmail": "ashika2701@gmail.com",
        "contact": "ashika2701@gmail.com",
        "customerId": "1019",
        "customerPhone": "9080655773",
        "customerDirectoryStatus": "verified",
    }
    mem.set_task_state(new_harness_task_state(task.id, collected=dict(mem.durable["ticket_draft"])))

    def boom(*args, **kwargs):
        raise AssertionError("tool-loop LLM must not run after issue absorb")

    monkeypatch.setattr(tc, "run_tool_loop", boom)
    monkeypatch.setattr(
        tc,
        "_confirm_fallback_text",
        lambda memory: "Review Ashika's invalid-credentials issue and tell me to save it.",
    )

    req = RunRequest(
        message="invalid credentials even though she had an account",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
        surface="staff",
        page="Create Ticket",
    )
    out = tc._run_harness_executor(
        instruction=DomainInstruction(
            executor_id=task.executor,
            task_id=task.id,
            skill_name=task.skill_name,
            version=task.version,
            objective="Continue active task ticket.create",
        ),
        llm=_FakeLLM([]),
        memory=mem,
        query="invalid credentials even though she had an account",
        context={
            "request": req,
            "module": "tickets",
            "surface": "staff",
            "page": "Create Ticket",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert out.get("response_type") == "final"
    assert "Ashika" in str(out.get("assistant_text") or "")
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("awaiting") == "confirm"
    assert "invalid credentials" in str(draft.get("issue") or "")


def test_absorb_ticket_contact_stores_email_without_auto_handoff(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.chat_commands._bind_directory_customer",
        lambda data, org, **kwargs: (dict(data), "none", []),
    )
    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {"awaiting": "contact", "customerName": "Sidharth"}
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "sid@new.com", "tickets", ui) is True
    draft = mem.durable.get("ticket_draft") or {}
    assert mem.durable.get("current_workflow") == "create_ticket"
    assert str(draft.get("customerEmail") or draft.get("contact") or "").lower() == "sid@new.com"
    assert not draft.get("customerDirectoryStatus")
    assert mem.durable.get("customer_draft") is None


def test_absorb_ticket_contact_directory_hit_keeps_create_ticket(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {"awaiting": "contact", "customerName": "Jordan Lee"}
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "jordan@acme.com", "tickets", ui) is True
    draft = mem.durable.get("ticket_draft") or {}
    assert mem.durable.get("current_workflow") == "create_ticket"
    assert str(draft.get("customerEmail") or draft.get("contact") or "").lower() == (
        "jordan@acme.com"
    )
    assert not draft.get("customerId")
    assert str(draft.get("awaiting") or "").lower() == "contact"


def test_issue_ready_for_enrich_requires_real_issue_text():
    from app.agents.ticketing_coworker import _issue_ready_for_enrich

    assert not _issue_ready_for_enrich(
        {"customerName": "Sid", "customerEmail": "sid@x.com"},
        {"customerName": "Sid", "issue": "sid@x.com"},
    )
    assert _issue_ready_for_enrich(
        {"customerName": "Sid", "customerEmail": "sid@x.com"},
        {"issue": "Voice bot stopped responding after update"},
    )


def test_verify_ticket_customer_miss_marks_draft(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.tools.express_client import ToolActor, tool_actor_scope

    monkeypatch.setattr(
        "app.tasks.chat_commands._bind_directory_customer",
        lambda data, org, **kwargs: (dict(data), "none", []),
    )
    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Annamalai",
        "customerEmail": "annamalai@gmail.com",
        "awaiting": "contact",
    }
    with tool_actor_scope(
        ToolActor(user_id="u", organization_id="org-1", user_role="admin")
    ):
        from app.tools.ticket_write import verify_ticket_customer

        result = verify_ticket_customer(
            {
                "customerName": "Annamalai",
                "customerEmail": "annamalai@gmail.com",
            }
        )
    assert result.get("success") is True
    payload = result.get("payload") or {}
    assert payload.get("exists") is False
    assert "no matching customer record" in str(payload.get("message") or "").lower()
    ui: list = []
    tc._merge_verify_into_ticket_draft(mem, result, ui)
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("customer_not_found") is True
    assert draft.get("customerDirectoryStatus") == "missing"
    assert str(draft.get("awaiting") or "") == "contact"


def test_verify_ticket_customer_hit_advances_to_issue(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.tools.express_client import ToolActor, tool_actor_scope

    def _hit(data, org, **kwargs):
        out = dict(data)
        out["customerId"] = "cust-42"
        out["customerDirectoryStatus"] = "verified"
        return out, "ok", [{"id": "cust-42"}]

    monkeypatch.setattr("app.tasks.chat_commands._bind_directory_customer", _hit)
    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Jordan",
        "customerEmail": "jordan@acme.com",
        "awaiting": "contact",
    }
    with tool_actor_scope(
        ToolActor(user_id="u", organization_id="org-1", user_role="admin")
    ):
        from app.tools.ticket_write import verify_ticket_customer

        result = verify_ticket_customer({"customerEmail": "jordan@acme.com"})
    payload = result.get("payload") or {}
    assert payload.get("exists") is True
    ui: list = []
    tc._merge_verify_into_ticket_draft(mem, result, ui)
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("customerId") == "cust-42"
    assert draft.get("customerDirectoryStatus") == "verified"
    assert str(draft.get("awaiting") or "") == "issue"


def test_verify_ticket_customer_ignores_email_copied_into_phone(monkeypatch):
    """LLM often sends contact + customerEmail both as the email — must not pollute phone."""
    from app.tools.express_client import ToolActor, tool_actor_scope

    seen: dict = {}

    def _hit(data, org, **kwargs):
        seen["phone"] = data.get("customerPhone")
        seen["email"] = data.get("customerEmail")
        out = dict(data)
        out["customerId"] = "1001"
        out["customerDirectoryStatus"] = "verified"
        return out, "ok", [{"id": "1001"}]

    monkeypatch.setattr("app.tasks.chat_commands._bind_directory_customer", _hit)
    with tool_actor_scope(
        ToolActor(user_id="u", organization_id="org-1", user_role="admin")
    ):
        from app.tools.ticket_write import verify_ticket_customer

        result = verify_ticket_customer(
            {
                "customerName": "Fazil",
                "customerEmail": "smohamedfazil16@gmail.com",
                "contact": "smohamedfazil16@gmail.com",
            }
        )
    assert result.get("success") is True
    assert (result.get("payload") or {}).get("exists") is True
    assert seen.get("email") == "smohamedfazil16@gmail.com"
    assert not seen.get("phone") or "@" not in str(seen.get("phone"))


def test_absorb_email_when_awaiting_issue_stores_contact_without_handoff(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "customerName": "Annamalai",
    }
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "annamalai@gmail.com", "tickets", ui) is True
    assert mem.durable.get("current_workflow") == "create_ticket"
    draft = mem.durable.get("ticket_draft") or {}
    assert str(draft.get("customerEmail") or "").lower() == "annamalai@gmail.com"
    assert str(draft.get("awaiting") or "") == "contact"
    assert mem.durable.get("customer_draft") is None


def test_patch_ticket_contact_stores_without_auto_handoff(monkeypatch):
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.chat_commands._bind_directory_customer",
        lambda data, org, **kwargs: (dict(data), "none", []),
    )
    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "contact",
        "customerName": "Sidharth",
    }
    mem.durable["current_workflow"] = "create_ticket"
    actions: list = []
    out = _execute_local_ui_tool(
        "patch_ticket_draft",
        {"customerEmail": "sid@new.com"},
        memory=mem,
        ui_actions=actions,
    )
    assert out.get("success") is True
    assert mem.durable.get("current_workflow") == "create_ticket"
    draft = mem.durable.get("ticket_draft") or {}
    assert str(draft.get("customerEmail") or "").lower() == "sid@new.com"
    assert not draft.get("customerDirectoryStatus")
    assert str(draft.get("awaiting") or "").lower() == "contact"
    payload = out.get("payload") if isinstance(out.get("payload"), dict) else {}
    assert payload.get("awaiting") == "contact"
    assert payload.get("next_tool") == "verify_ticket_customer"
    assert mem.durable.get("customer_draft") is None


def test_patch_ticket_email_change_overwrites_stale_contact(monkeypatch):
    """Changing customerEmail must replace stale contact and clear prior miss status."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.chat_commands._bind_directory_customer",
        lambda data, org, **kwargs: (dict(data), "none", []),
    )
    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "awaiting": "contact",
        "customerName": "Mohamed Fazil",
        "contact": "smohamedfazil@gmail.com",
        "customerEmail": "smohamedfazil@gmail.com",
        "customerDirectoryStatus": "missing",
        "customer_not_found": True,
    }
    actions: list = []
    out = _execute_local_ui_tool(
        "patch_ticket_draft",
        {
            "awaiting": "contact",
            "customerEmail": "smohamedfazil16@gmail.com",
            "customerName": "Mohamed Fazil",
        },
        memory=mem,
        ui_actions=actions,
    )
    assert out.get("success") is True
    draft = mem.durable.get("ticket_draft") or {}
    assert str(draft.get("customerEmail") or "").lower() == "smohamedfazil16@gmail.com"
    assert str(draft.get("contact") or "").lower() == "smohamedfazil16@gmail.com"
    assert not draft.get("customerDirectoryStatus")
    assert not draft.get("customer_not_found")
    payload = out.get("payload") if isinstance(out.get("payload"), dict) else {}
    assert payload.get("next_tool") == "verify_ticket_customer"
    assert payload.get("awaiting") == "contact"


def test_patch_team_add_members_emits_update_team_panel():
    from app.agents.ticketing_coworker import _ensure_guided_ui_actions, _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "id": "t1",
        "name": "Support",
        "flow": "add_team_members",
        "awaiting": "members_names",
        "available_members": ["Alex Kim", "Sam Patel"],
    }
    mem.durable["current_workflow"] = "add_team_members"
    actions: list = []
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"members": ["Alex Kim"], "awaiting": "confirm"},
        memory=mem,
        ui_actions=actions,
    )
    assert out.get("success") is True
    assert mem.durable.get("current_workflow") == "add_team_members"
    assert any(a.get("type") == "update_team" for a in actions)
    ensured = _ensure_guided_ui_actions(mem, [])
    assert any(a.get("type") == "update_team" and "Alex Kim" in str(a.get("members")) for a in ensured)


def test_absorb_team_create_fields_sync_panel():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {"awaiting": "name"}
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "Night Shift", "teams", ui) is True
    assert mem.durable["team_draft"]["name"] == "Night Shift"
    assert any(a.get("type") == "create_team" and a.get("name") == "Night Shift" for a in ui)
    assert tc._absorb_guided_field_utterance(mem, "Handles after-hours tickets", "teams", ui) is True
    assert mem.durable["team_draft"]["description"] == "Handles after-hours tickets"


def test_sync_add_members_seeds_last_entity_team():
    from app.agents.ticketing_coworker import (
        _guided_spec_for_agent,
        _sync_guided_draft_from_task,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("team.members.update"))
    mem.durable["last_entity"] = {"type": "team", "id": "1019", "name": "CCAAS"}
    mem.durable["team_draft"] = {
        "name": "CCAAS",
        "description": "The developers of the product CCAAS",
        "members": ["Sriannamalai R"],
        "awaiting": "confirm",
    }
    _sync_guided_draft_from_task(mem, "team.members.update")
    draft = mem.durable.get("team_draft") or {}
    assert draft.get("id") == "1019"
    assert draft.get("team") == "CCAAS"
    assert draft.get("name") == "CCAAS"
    assert draft.get("flow") == "add_team_members"
    assert not (draft.get("members") or [])
    assert draft.get("awaiting") == "members_names"
    assert mem.durable.get("current_workflow") == "add_team_members"
    assert _guided_spec_for_agent(mem, "teams") == (
        "team_draft",
        "add_team_members",
        "update_team",
    )
    assert _guided_spec_for_agent(mem, "team_queue_crud_executor") == (
        "team_draft",
        "add_team_members",
        "update_team",
    )


def test_absorb_add_members_binds_roster_short_name_not_proceed():
    from app.agents.ticketing_coworker import _absorb_guided_field_utterance
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1019",
        "name": "CCAAS",
        "team": "CCAAS",
        "flow": "add_team_members",
        "awaiting": "members_names",
        "available_members": ["Uday kumar G", "Ashika A", "Mohamed Fazil"],
    }
    ui: list = []
    assert _absorb_guided_field_utterance(
        mem, "i want to add one more member here", "teams", ui
    ) is False
    assert not (mem.durable["team_draft"].get("members") or [])
    assert _absorb_guided_field_utterance(mem, "add", "teams", ui) is False
    assert not (mem.durable["team_draft"].get("members") or [])
    assert _absorb_guided_field_utterance(mem, "uday", "teams", ui) is True
    draft = mem.durable["team_draft"]
    assert draft.get("members") == ["Uday kumar G"]
    assert draft.get("awaiting") == "confirm"
    assert _absorb_guided_field_utterance(mem, "add", "teams", ui) is False
    assert draft.get("members") == ["Uday kumar G"]


def test_absorb_add_members_does_not_bind_start_as_team_name():
    from app.agents.ticketing_coworker import _absorb_guided_field_utterance
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "flow": "add_team_members",
        "awaiting": "members_team",
    }
    ui: list = []
    assert _absorb_guided_field_utterance(
        mem, "i want to add one more member here", "teams", ui
    ) is False
    assert not str((mem.durable["team_draft"] or {}).get("team") or "").strip()
    assert not str((mem.durable["team_draft"] or {}).get("name") or "").strip()


def test_hydrate_update_queue_from_add_members_draft():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "q-uiux",
        "name": "UIUX team",
        "flow": "add_team_members",
        "members": ["Deva NS"],
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(mem, {"confirmed": True})
    assert out["queue_id"] == "q-uiux"
    assert out["members"] == ["Deva NS"]
    assert out["add_members"] is True
    assert out["confirmed"] is True


def test_hydrate_update_queue_drops_invented_member_ids():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1020",
        "name": "Web tracking team",
        "flow": "add_team_members",
        "members": ["Ashika A"],
        "available_members": ["Ashika A", "Uday kumar G"],
        "available_member_ids": ["1007", "1006"],
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(
        mem,
        {"queue_id": "1020", "member_ids": ["1010"], "add_members": True},
    )
    assert "member_ids" not in out
    assert out["members"] == ["Ashika A"]
    assert out["add_members"] is True


def test_hydrate_update_queue_prefers_draft_names_over_wrong_member_ids():
    """LLM often sends another listed teammate's agents.id (Ashika=1007 for Uday)."""
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1020",
        "name": "Web tracking team",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
        "available_members": ["Uday kumar G", "Ashika A"],
        "available_member_ids": ["1006", "1007"],
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(
        mem,
        {
            "queue_id": "1020",
            "member_ids": ["1007"],
            "add_members": True,
            "confirmed": True,
        },
    )
    assert out.get("members") == ["Uday kumar G"]
    assert "member_ids" not in out
    assert out["add_members"] is True


def test_hydrate_update_queue_uses_last_entity_team_id():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["last_entity"] = {"type": "team", "id": "q-focus", "name": "UIUX team"}
    mem.durable["team_draft"] = {
        "name": "UIUX team",
        "flow": "add_team_members",
        "members": ["Deva NS"],
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(mem, {})
    assert out["queue_id"] == "q-focus"
    assert out["add_members"] is True


def test_hydrate_update_queue_resolves_label_via_last_entity_id():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["last_entity"] = {"type": "team", "id": "1019", "name": "CCAAS"}
    mem.durable["team_draft"] = {
        "name": "CCAAS",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(
        mem,
        {"queue_id": "CCAAS", "members": ["Uday kumar G"], "confirmed": True},
    )
    assert out["queue_id"] == "1019"
    assert mem.durable["team_draft"]["id"] == "1019"
    assert out["members"] == ["Uday kumar G"]


def test_hydrate_update_queue_resolves_label_via_list_queues_stash():
    from app.agents.ticketing_coworker import (
        _hydrate_update_queue_args,
        _stash_catalog_pick_from_list,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "CCAAS",
        "name": "CCAAS",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
    }
    _stash_catalog_pick_from_list(
        mem,
        "list_queues",
        {
            "success": True,
            "payload": {
                "data": [
                    {"id": "1019", "queueName": "CCAAS"},
                    {"id": "1020", "queueName": "Web tracking team"},
                ]
            },
        },
    )
    out = _hydrate_update_queue_args(mem, {"queue_id": "CCAAS"})
    assert out["queue_id"] == "1019"
    assert mem.durable["team_draft"]["id"] == "1019"


def test_hydrate_update_queue_does_not_stamp_label_as_id():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "name": "CCAAS",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
    }
    out = _hydrate_update_queue_args(mem, {"queue_id": "CCAAS"})
    assert out["queue_id"] == "CCAAS"
    assert mem.durable["team_draft"].get("id") != "CCAAS"


def test_hydrate_update_queue_drops_llm_id_for_other_listed_team():
    """LLM sent nlp 1017 after the task listed CCAAS 1019."""
    from app.agents.ticketing_coworker import (
        _hydrate_update_queue_args,
        _stash_catalog_pick_from_list,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["last_entity"] = {"type": "team", "id": "1017", "name": "nlp"}
    mem.durable["team_draft"] = {
        "id": "1019",
        "name": "CCAAS",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
        "awaiting": "confirm",
    }
    _stash_catalog_pick_from_list(
        mem,
        "list_queues",
        {
            "success": True,
            "payload": {"data": [{"id": "1019", "queueName": "CCAAS"}]},
        },
    )
    out = _hydrate_update_queue_args(
        mem,
        {
            "queue_id": "1017",
            "members": ["Uday kumar G"],
            "add_members": True,
            "confirmed": True,
        },
    )
    assert out["queue_id"] == "1019"


def test_list_queues_unique_row_overwrites_stale_focus_team_id():
    from app.agents.ticketing_coworker import _stash_current_team_members_from_list_queues
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["last_entity"] = {"type": "team", "id": "1017", "name": "nlp"}
    mem.durable["team_draft"] = {
        "id": "1017",
        "name": "nlp",
        "flow": "add_team_members",
    }
    _stash_current_team_members_from_list_queues(
        mem,
        {
            "success": True,
            "payload": {
                "data": [
                    {
                        "id": "1019",
                        "queueName": "CCAAS",
                        "members": ["Ashika A"],
                    }
                ]
            },
        },
    )
    draft = mem.durable["team_draft"]
    assert draft["id"] == "1019"
    assert draft["name"] == "CCAAS"
    assert mem.durable["last_entity"]["id"] == "1019"
    assert mem.durable["last_entity"]["name"] == "CCAAS"


def test_hydrate_update_queue_prefers_draft_team_over_other_listed_id():
    """Full list_queues stash still must not let LLM write a different listed team."""
    from app.agents.ticketing_coworker import (
        _hydrate_update_queue_args,
        _stash_catalog_pick_from_list,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["last_entity"] = {"type": "team", "id": "1017", "name": "nlp"}
    mem.durable["team_draft"] = {
        "id": "1019",
        "name": "CCAAS",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
        "awaiting": "confirm",
    }
    _stash_catalog_pick_from_list(
        mem,
        "list_queues",
        {
            "success": True,
            "payload": {
                "data": [
                    {"id": "1017", "queueName": "nlp"},
                    {"id": "1019", "queueName": "CCAAS"},
                ]
            },
        },
    )
    out = _hydrate_update_queue_args(
        mem,
        {
            "queue_id": "1017",
            "members": ["Uday kumar G"],
            "add_members": True,
            "confirmed": True,
        },
    )
    assert out["queue_id"] == "1019"


def test_seed_add_members_keeps_draft_team_when_focus_differs():
    from app.agents.ticketing_coworker import _seed_add_members_team_from_focus
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {"type": "team", "id": "1017", "name": "nlp"}
    draft = {
        "id": "1019",
        "name": "CCAAS",
        "team": "CCAAS",
        "flow": "add_team_members",
        "members": ["Uday kumar G"],
    }
    mem.durable["team_draft"] = draft
    _seed_add_members_team_from_focus(mem, draft)
    assert draft["id"] == "1019"
    assert draft["name"] == "CCAAS"
    assert mem.durable["last_entity"]["id"] == "1019"
    assert mem.durable["last_entity"]["name"] == "CCAAS"


def test_missing_catalog_id_allows_same_turn_write_retry():
    from app.runtime.tool_loop import run_tool_loop

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "name": "update_queue",
                        "arguments": {
                            "queue_id": "CCAAS",
                            "members": ["Uday kumar G"],
                            "confirmed": True,
                        },
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c2",
                        "name": "update_queue",
                        "arguments": {
                            "queue_id": "1019",
                            "members": ["Uday kumar G"],
                            "confirmed": True,
                        },
                    }
                ],
            },
            {"content": "Added Uday kumar G to the team.", "tool_calls": []},
        ]
    )
    seen: list[str] = []

    def execute(name, args):
        seen.append(str(args.get("queue_id") or ""))
        if str(args.get("queue_id") or "") == "CCAAS":
            return {
                "success": False,
                "error_code": "MISSING_CATALOG_ID",
                "message": "Call list_queues and pass the numeric id.",
                "retryable": False,
            }
        return {"success": True, "payload": {"id": "1019", "members": ["Uday kumar G"]}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="update_queue",
                description="update team",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets()),
    )
    assert seen == ["CCAAS", "1019"]
    assert "Added" in text


def test_clear_draft_after_update_queue_refreshes_teams():
    from app.agents.ticketing_coworker import _clear_draft_after_write
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "id": "q-uiux",
        "name": "UIUX team",
        "flow": "add_team_members",
        "members": ["Deva NS"],
        "awaiting": "confirm",
    }
    mem.durable["current_workflow"] = "add_team_members"
    actions: list = [
        {"type": "update_team", "id": "q-uiux", "members": ["Deva NS"], "awaiting": "confirm"}
    ]
    _clear_draft_after_write(
        "update_queue",
        mem,
        actions,
        result={"success": True, "payload": {"id": "q-uiux", "name": "UIUX team"}},
    )
    assert mem.durable.get("team_draft") is None
    assert mem.durable.get("current_workflow") is None
    assert any(a.get("type") == "update_team" and a.get("done") for a in actions)
    assert any(a.get("type") == "refresh_teams" for a in actions)
    assert any(a.get("type") == "open_team" and a.get("id") == "q-uiux" for a in actions)


def test_update_queue_wrapper_strips_confirmed_and_needs_id():
    from app.tools.bound import _update_queue

    out = _update_queue(confirmed=True, add_members=True, members=["Deva NS"])
    assert out.get("success") is False
    assert out.get("error_code") in {"BAD_INPUT", "VALIDATION_ERROR"}


def test_hydrate_reassign_write_args_escalate_resolver():
    from app.agents.ticketing_coworker import _hydrate_reassign_write_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "#73",
        "target_role": "resolver",
        "person": "Yaswanth MG",
        "person_id": "1000",
        "awaiting": "confirm",
    }
    out = _hydrate_reassign_write_args(mem, {}, "escalate_ticket")
    assert out["ticket_number"] == "#73"
    assert out["assignee"] == "Yaswanth MG"
    assert out["assignee_id"] == "1000"
    assert out["confirmed"] is True


def test_hydrate_reassign_write_args_update_agent():
    from app.agents.ticketing_coworker import _hydrate_reassign_write_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "#73",
        "target_role": "agent",
        "person": "Raghuram M",
        "awaiting": "confirm",
    }
    out = _hydrate_reassign_write_args(mem, {}, "update_ticket")
    assert out["ticket_number"] == "#73"
    assert out["assignee"] == "Raghuram M"
    assert out.get("resolver") in (None, "")
    assert out["confirmed"] is True


def test_clear_draft_after_reassign_write_refreshes_ticket():
    from app.agents.ticketing_coworker import _clear_draft_after_write
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "#73",
        "target_role": "resolver",
        "person": "Yaswanth MG",
        "awaiting": "confirm",
    }
    mem.durable["current_workflow"] = "reassign_ticket"
    actions: list = []
    _clear_draft_after_write(
        "escalate_ticket",
        mem,
        actions,
        result={
            "success": True,
            "payload": {"ticketNumber": "#73", "resolver": "Yaswanth MG"},
        },
    )
    assert mem.durable.get("reassign_draft") is None
    assert mem.durable.get("current_workflow") is None
    assert any(a.get("type") == "refresh_tickets" for a in actions)
    assert any(a.get("type") == "open_ticket" for a in actions)


def test_tickets_prompt_reassign_writes_on_person_pick():
    from app.prompts.builder import build_tickets_prompt

    text = build_tickets_prompt(
        module="tickets",
        surface="list",
        memory_snapshot={},
        actor_role="agent",
        page="Tickets",
    )
    assert "picking the person is the confirmation" in text.lower() or (
        "same turn" in text.lower() and "confirmed=true" in text.lower()
    )
    assert "never invent staff" in text.lower() or "Never invent staff" in text


def test_deterministic_supervisor_routes_active_create_customer():
    from app.agents.ticketing_coworker import _deterministic_supervisor_route
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["customer_draft"] = {
        "awaiting": "confirm",
        "name": "chandru",
        "email": "chandru@gmail.com",
        "phone": "8877345612",
    }
    mem.durable["pending_ask"] = "confirm"
    mem.durable["parked_drafts"] = [
        {
            "flow": "ticket",
            "draft": {
                "customerName": "chandru",
                "issue": "voice bot broken",
                "awaiting": "confirm",
            },
        }
    ]
    for msg in ("yess", "update the number", "8877345612"):
        out = _deterministic_supervisor_route(mem, msg)
        assert out is not None
        assert out.get("response_type") == "routing_response"
        assert (out.get("route_args") or {}).get("agent_name") == "customers"


def test_patch_customer_rejects_sentence_as_phone():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_draft"] = {
        "awaiting": "phone",
        "name": "chandru",
        "email": "chandru@gmail.com",
    }
    ui: list = []
    bad = (
        "add customer chandru with email chandru@gmail.com and phone 8877345612 "
        "and then create a ticket for them"
    )
    result = _execute_local_ui_tool(
        "patch_customer_draft",
        {"phone": bad, "awaiting": "phone"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is False
    assert result.get("error_code") == "INVALID_FIELD_VALUE"
    assert "8877345612" not in str((mem.durable.get("customer_draft") or {}).get("phone") or "")


def test_ticket_issue_collect_fallback_after_verify(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "What is the short description of the issue?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "customerName": "chandru",
        "customerEmail": "chandru@gmail.com",
        "customerId": "1024",
        "customerDirectoryStatus": "verified",
    }
    text = tc._ticket_issue_collect_fallback(mem, "yes")
    assert text and "issue" in text.lower()


def test_supervisor_continues_active_create_customer(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    class ContinueLLM:
        def run(self, *a, **k):
            return {
                "content": "",
                "tool_calls": [{"name": "continue_active_task", "arguments": {}}],
            }

    monkeypatch.setattr(tc, "get_llm", lambda: ContinueLLM())
    executor_calls: list[tuple[str, str]] = []

    def fake_executor(**kwargs):
        executor_calls.append(
            (kwargs["harness_executor"], kwargs["harness_skill"])
        )
        return {
            "response_type": "final",
            "assistant_text": "Please confirm saving chandru.",
            "data": {},
        }

    monkeypatch.setattr(tc, "_run_executor_loop", fake_executor)
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_customer"
    mem.durable["customer_draft"] = {
        "awaiting": "confirm",
        "name": "chandru",
        "email": "chandru@gmail.com",
        "phone": "8877345612",
    }
    mem.durable["pending_ask"] = "confirm"
    request = RunRequest(
        message="yess",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="customers",
        surface="create",
        page="Customers",
    )
    out = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=mem,
        query="yess",
        context={
            "request": request,
            "module": "customers",
            "surface": "create",
            "page": "Customers",
        },
    )
    assert out.get("response_type") == "final"
    assert out.get("agent") == "customer_directory_crud_executor"
    assert executor_calls == [
        ("customer_directory_crud_executor", "customer-create")
    ]
    state = mem.current_task_state()
    assert state and state.task_id == "customer.create"
    assert state.status == "awaiting_confirmation"
    assert state.collected["email"] == "chandru@gmail.com"
    assert state.provenance["email"] == "hydrated_draft"


def test_supervisor_default_routes_bare_delete_priority_to_admin():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    out = tc._supervisor_default_catalog_route(mem, "delete priority")
    assert out is not None
    assert out.get("response_type") == "routing_response"
    assert (out.get("route_args") or {}).get("agent_name") == "admin"
    assert mem.durable.get("last_query", {}).get("catalog_op") == "delete_pick"


def test_supervisor_pending_clarify_resolves_to_admin():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {
        "pending_clarify": {
            "kind": "catalog_vs_ticket",
            "asked": "Catalog or ticket?",
            "original_query": "delete priority",
            "resolve_agent": "admin",
        }
    }
    out = tc._supervisor_resolve_pending_clarify(mem, "system setting")
    assert out is not None
    assert (out.get("route_args") or {}).get("agent_name") == "admin"
    assert "pending_clarify" not in (mem.durable.get("last_query") or {})


def test_patch_priority_delete_pick_resolves_id_from_stash():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {
        "catalog_op": "delete_pick",
        "catalog_kind": "priority",
        "catalog_pick_options": [{"id": "1903", "displayName": "golg"}],
    }
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {"displayName": "golg"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    draft = mem.durable.get("priority_draft") or {}
    assert draft.get("id") == "1903"
    assert str(draft.get("awaiting") or "").lower() == "delete_confirm"
    assert str(draft.get("awaiting") or "").lower() != "hours"
    assert (result.get("payload") or {}).get("missing") == []
    assert (result.get("payload") or {}).get("workflow") == "delete_priority"
    assert any(a.get("type") == "delete_priority" for a in ui)
    assert not any(a.get("type") == "create_priority" for a in ui)


def test_ground_priority_hours_skips_delete_confirm():
    """Delete pick must not rewrite reply into SLA hours ask."""
    from app.agents.ticketing_coworker import _ground_priority_hours_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["priority_draft"] = {
        "awaiting": "delete_confirm",
        "displayName": "golg",
        "id": "1903",
        "kind": "priority",
        "step": "delete_confirm",
    }
    mem.durable["current_workflow"] = "create_priority"
    reply = "Should I permanently delete priority golg?"
    out = _ground_priority_hours_reply(mem, reply)
    assert out == reply
    draft = mem.durable.get("priority_draft") or {}
    assert str(draft.get("awaiting") or "").lower() == "delete_confirm"
    assert str(mem.durable.get("pending_ask") or "").lower() != "hours"


def test_patch_priority_delete_pick_without_id_does_not_open_hours():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {"catalog_op": "delete_pick", "catalog_kind": "priority"}
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {"displayName": "unknown-label"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is False
    assert result.get("error_code") == "MISSING_CATALOG_ID"
    draft = mem.durable.get("priority_draft") or {}
    assert str(draft.get("awaiting") or "").lower() != "hours"


def test_tickets_prompt_idle_omits_create_ticket_schema():
    from app.prompts.builder import build_tickets_prompt

    idle = build_tickets_prompt(
        module="tickets",
        surface="list",
        memory_snapshot={"durable": {}},
        actor_role="agent",
    )
    assert "primary_create_workflow=create_ticket" not in idle
    assert "bound_tools=" in idle


def test_absorb_skips_priority_name_during_delete_pick():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {"catalog_op": "delete_pick"}
    mem.durable["current_workflow"] = "create_priority"
    mem.durable["priority_draft"] = {"awaiting": "name", "kind": "priority"}
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "golg", "admin", ui) is False


def test_harness_routes_super_domain_executor_skill_and_reuses_active(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    class FakeLLM:
        def __init__(self):
            self.calls = 0

        def run(self, messages, tools=None, **kwargs):
            names = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            self.calls += 1
            if "continue_active_task" in names:
                return {
                    "content": "",
                    "tool_calls": [{"name": "continue_active_task", "arguments": {}}],
                }
            if self.calls == 1:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "name": "route_to_domain",
                            "arguments": {
                                "domain_id": "resolution_lifecycle_domain",
                                "query": "show ticket 12345",
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
                            "executor_id": "ticket_lifecycle_executor",
                            "task_id": "ticket.read.search",
                            "skill_name": "ticket-read-search",
                            "objective": "Read ticket 12345",
                        },
                    }
                ],
            }

    fake = FakeLLM()
    monkeypatch.setattr(tc, "get_llm", lambda: fake)

    specialist_calls: list[tuple[str, str]] = []

    def fake_specialist(**kwargs):
        specialist_calls.append(
            (kwargs["harness_executor"], kwargs["harness_skill"])
        )
        kwargs["memory"].durable["current_workflow"] = "ticket.read.search"
        kwargs["memory"].durable["pending_ask"] = "ticket_number"
        return {
            "response_type": "final",
            "assistant_text": "Which ticket number should I use?",
            "data": {},
        }

    monkeypatch.setattr(tc, "_run_executor_loop", fake_specialist)
    memory = SharedMemory(
        organization_id="1",
        user_id="u1",
        session_id="s1",
        request_id="r1",
    )
    request = RunRequest(
        message="show ticket 12345",
        request_id="r1",
        actor=ActorContext(
            user_id="u1",
            organization_id="1",
            user_role="agent",
        ),
    )
    context = {
        "request": request,
        "request_id": "r1",
        "module": "tickets",
        "surface": "list",
        "page": "Tickets",
    }
    first = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=memory,
        query=request.message,
        context=context,
    )
    assert first["agent"] == "ticket_lifecycle_executor"
    assert fake.calls == 2
    assert specialist_calls == [
        ("ticket_lifecycle_executor", "ticket-read-search")
    ]
    state = memory.current_task_state()
    assert state and state.status == "collecting"

    memory.request_id = "r2"
    request.request_id = "r2"
    second = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=memory,
        query="12345",
        context={**context, "request_id": "r2"},
    )
    assert second["agent"] == "ticket_lifecycle_executor"
    assert fake.calls == 3
    assert len(specialist_calls) == 2


def test_mcp_http_403_extracts_fastapi_detail_not_bare_http():
    from app.mcp.client import _tool_err_from_mcp_http

    err = _tool_err_from_mcp_http(
        403,
        {
            "detail": {
                "error": "TOOL_NOT_ALLOWED",
                "message": "Tool ask_ontology not allowed for agent=analytics_audit_query_executor",
            }
        },
    )
    assert err["success"] is False
    assert err["error_code"] == "FORBIDDEN"
    assert err["retryable"] is False
    assert "ask_ontology" in err["message"]
    assert err["message"] != "HTTP 403"
    assert "HTTP 403" not in err["message"]


def test_remount_analytics_query_for_ontology_updates_task_and_token():
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext
    from app.memory.session import SharedMemory
    from app.mcp.authorization import verify_mcp_token
    from app.workflow_schemas import new_harness_task_state

    memory = SharedMemory(organization_id="1003", user_id="1008", session_id="s1")
    memory.set_task_state(new_harness_task_state("analytics.query"))
    actor = ActorContext(
        user_id="1008",
        organization_id="1003",
        user_role="admin",
    )
    context: dict = {"module": "admin", "surface": "analytics", "mcp_token": "stale"}
    request = type("R", (), {"channel": "staff", "session_id": "s1"})()

    skill = tc._remount_analytics_query_for_ontology(
        memory, context=context, actor=actor, request=request
    )
    assert skill == "analytics-root-cause"
    state = memory.current_task_state()
    assert state and state.task_id == "analytics.root.cause"
    assert state.skill_name == "analytics-root-cause"
    claims = verify_mcp_token(str(context["mcp_token"]))
    assert claims["skill_name"] == "analytics-root-cause"
    assert "ask_ontology" in claims["allowed_tools"]


def test_analytics_query_read_success_completes_pin(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "t1",
                        "name": "ask_semantic_layer",
                        "arguments": {"query": "how many open tickets"},
                    }
                ],
            },
            {"content": "There are 4 open tickets.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(tc, "get_llm", lambda: fake)

    def _dispatch(name, args, **kwargs):
        return {"success": True, "payload": {"open": 4}}

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    memory = SharedMemory(organization_id="1003", user_id="u1", session_id="s1")
    memory.set_task_state(new_harness_task_state("analytics.query"))
    request = RunRequest(
        message="how many open tickets",
        session_id="s1",
        actor=ActorContext(
            user_id="u1", organization_id="1003", user_role="admin"
        ),
        module="admin",
        surface="analytics",
    )
    out = tc.run_coworker_agent(
        agent_name="ticketing_coworker",
        memory=memory,
        query="how many open tickets",
        context={
            "request": request,
            "module": "admin",
            "surface": "analytics",
            "page": "Analytics",
            "mcp_token": "tok",
        },
    )
    assert "4" in (out.get("assistant_text") or out.get("reply") or "") or out.get(
        "response_type"
    )
    state = memory.current_task_state()
    assert state and state.status == "completed"


def test_catalog_row_id_usable_rejects_placeholders():
    from app.tools.catalog_tools import catalog_row_id_usable

    assert catalog_row_id_usable("") == ""
    assert catalog_row_id_usable(None) == ""
    assert catalog_row_id_usable("immediate_id_placeholder") == ""
    assert catalog_row_id_usable("Immediate") == ""
    assert catalog_row_id_usable("2783") == "2783"


def test_update_priority_rejects_invented_id_without_express(monkeypatch):
    from app.tools import catalog_tools

    called: list = []

    def boom(*args, **kwargs):
        called.append((args, kwargs))
        return {"success": True, "payload": {}}

    monkeypatch.setattr(catalog_tools, "express_request", boom)
    out = catalog_tools.update_priority(
        "immediate_id_placeholder",
        display_name="Fast",
        resolution_hours=1,
    )
    assert out.get("success") is False
    assert out.get("error_code") == "VALIDATION_ERROR"
    assert "placeholder" in str(out.get("message") or "").lower() or "numeric" in str(
        out.get("message") or ""
    ).lower()
    assert called == []


def test_hydrate_update_catalog_args_resolves_listed_immediate_id():
    from app.agents.ticketing_coworker import _hydrate_update_catalog_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {
        "catalog_list_options": [{"id": "2783", "displayName": "Immediate"}]
    }
    mem.durable["priority_draft"] = {
        "currentName": "Immediate",
        "displayName": "Fast",
    }
    out = _hydrate_update_catalog_args(
        mem,
        {
            "priority_id": "immediate_id_placeholder",
            "displayName": "Fast",
            "resolutionHours": 1,
        },
        kind="priority",
    )
    assert out.get("priority_id") == "2783"
    assert out.get("displayName") == "Fast"


def test_update_priority_execute_rejects_placeholder_without_list(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, DomainInstruction, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state, task_definition_for

    task = task_definition_for("priority.update")
    assert task is not None
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["active_domain"] = task.domain
    mem.set_task_state(new_harness_task_state(task.id))

    def boom(*args, **kwargs):
        raise AssertionError("invented catalog id must not reach MCP or Express")

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", boom)
    monkeypatch.setattr("app.tools.catalog_tools.express_request", boom)

    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "t1",
                        "name": "update_priority",
                        "arguments": {
                            "priority_id": "immediate_id_placeholder",
                            "displayName": "Fast",
                            "resolutionHours": 1,
                            "confirmed": True,
                        },
                    }
                ],
            },
            {
                "content": "I need the existing priority id from the catalog list first.",
                "tool_calls": [],
            },
        ]
    )
    req = RunRequest(
        message="yess",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="admin",
        surface="staff",
        page="Priorities",
    )
    out = tc._run_harness_executor(
        instruction=DomainInstruction(
            executor_id=task.executor,
            task_id=task.id,
            skill_name=task.skill_name,
            version=task.version,
            objective="Rename Immediate to Fast",
        ),
        llm=llm,
        memory=mem,
        query="yess",
        context={
            "request": req,
            "module": "admin",
            "surface": "staff",
            "page": "Priorities",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    last = mem.durable.get("last_tool_outcome") or {}
    assert last.get("tool") == "update_priority"
    assert last.get("success") is False
    assert last.get("error_code") == "MISSING_CATALOG_ID"
    assert out.get("response_type") == "final"


def test_entity_ref_invented_rejects_placeholders_not_db_ids():
    from app.tools.catalog_tools import catalog_row_id_usable, entity_ref_invented

    assert entity_ref_invented("immediate_id_placeholder") is True
    assert entity_ref_invented("fake_queue") is True
    assert entity_ref_invented("dummy_id") is True
    assert entity_ref_invented("2783") is False
    assert entity_ref_invented("#12940") is False
    assert catalog_row_id_usable("queue_id_placeholder") == ""
    assert catalog_row_id_usable("1901") == "1901"


def test_reject_ungrounded_entity_args_blocks_invented_ids():
    from app.agents.ticketing_coworker import _reject_ungrounded_entity_args

    invented = _reject_ungrounded_entity_args(
        "update_queue",
        {"queue_id": "queue_id_placeholder", "name": "Ops"},
    )
    assert invented and invented.get("success") is False
    assert invented.get("error_code") == "MISSING_CATALOG_ID"

    missing = _reject_ungrounded_entity_args("update_macro", {"title": "Hi"})
    assert missing and missing.get("error_code") == "MISSING_CATALOG_ID"
    assert (missing.get("payload") or {}).get("next_tool") == "list_macros"

    ok = _reject_ungrounded_entity_args(
        "update_priority",
        {"priority_id": "2001", "displayName": "Fast"},
    )
    assert ok is None

    ticket = _reject_ungrounded_entity_args(
        "update_ticket",
        {"ticket_number": "ticket_id_placeholder"},
    )
    assert ticket and ticket.get("error_code") == "MISSING_CATALOG_ID"


def test_hydrate_update_replaces_sort_order_with_listed_id():
    from app.agents.ticketing_coworker import _hydrate_update_catalog_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {
        "catalog_kind": "priority",
        "catalog_list_options": [
            {"id": "2001", "displayName": "Fast", "resolutionHours": 1},
            {"id": "1860", "displayName": "High", "resolutionHours": 8},
        ],
    }
    mem.durable["priority_draft"] = {"currentName": "Fast"}
    out = _hydrate_update_catalog_args(
        mem,
        {
            "priority_id": "5",
            "displayName": "immediate",
            "resolutionHours": 1,
        },
        kind="priority",
    )
    assert out.get("priority_id") == "2001"
    assert out.get("displayName") == "immediate"


def test_hydrate_update_resolves_listed_name_from_user_text():
    from app.agents.ticketing_coworker import _hydrate_update_catalog_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.messages = [{"role": "user", "content": "chenge Fast to immediate"}]
    mem.durable["last_query"] = {
        "catalog_kind": "priority",
        "catalog_list_options": [
            {"id": "2001", "displayName": "Fast", "resolutionHours": 1},
        ],
    }
    out = _hydrate_update_catalog_args(
        mem,
        {"priority_id": "5", "displayName": "immediate"},
        kind="priority",
    )
    assert out.get("priority_id") == "2001"
    assert out.get("resolutionHours") == 1


def test_bind_listed_catalog_target_pins_fast_row():
    from app.agents.ticketing_coworker import _maybe_bind_listed_catalog_target
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    mem.durable["last_query"] = {
        "catalog_kind": "priority",
        "catalog_list_options": [
            {"id": "2001", "displayName": "Fast", "resolutionHours": 1},
            {"id": "1860", "displayName": "High", "resolutionHours": 8},
        ],
    }
    _maybe_bind_listed_catalog_target(
        mem, "chenge Fast to immediate", "priority-update"
    )
    draft = mem.durable.get("priority_draft") or {}
    assert not draft.get("id")
    assert (mem.durable.get("last_entity") or {}).get("id") == "2001"
    assert (mem.durable.get("last_entity") or {}).get("name") == "Fast"
    collected = (mem.current_task_state() or None) and mem.current_task_state().collected
    assert collected.get("priority_id") == "2001"
    assert collected.get("currentName") == "Fast"
    assert collected.get("resolutionHours") == 1


def test_bind_listed_catalog_target_does_not_open_delete_panel():
    from app.agents.ticketing_coworker import (
        _ensure_guided_ui_actions,
        _execute_local_ui_tool,
        _maybe_bind_listed_catalog_target,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    mem.durable["last_query"] = {
        "catalog_kind": "priority",
        "catalog_list_options": [
            {"id": "2001", "displayName": "Fast", "resolutionHours": 1},
        ],
    }
    mem.durable["current_workflow"] = "create_priority"
    mem.durable["priority_draft"] = {
        "id": "2001",
        "displayName": "yes",
        "awaiting": "delete_confirm",
        "kind": "priority",
    }
    _maybe_bind_listed_catalog_target(mem, "change Fast to immediate", "priority-update")
    assert not (mem.durable.get("priority_draft") or {}).get("id")
    assert mem.durable.get("current_workflow") in (None, "")
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {"id": "2001", "displayName": "immediate", "kind": "priority"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    assert str((mem.durable.get("priority_draft") or {}).get("awaiting") or "").lower() != (
        "delete_confirm"
    )
    assert not any(
        str(a.get("type") or "") in {"delete_priority", "create_priority"} and not a.get("done")
        for a in ui
    )
    ensured = _ensure_guided_ui_actions(mem, ui)
    assert not any(
        str(a.get("type") or "") in {"delete_priority", "create_priority"} and not a.get("done")
        for a in ensured
    )


def test_patch_priority_id_during_update_does_not_force_delete_confirm():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    ui: list[dict] = []
    result = _execute_local_ui_tool(
        "patch_priority_draft",
        {"id": "2001", "displayName": "immediate", "kind": "priority"},
        memory=mem,
        ui_actions=ui,
    )
    assert result.get("success") is True
    draft = mem.durable.get("priority_draft") or {}
    assert not draft.get("id")
    assert str(draft.get("awaiting") or "").lower() != "delete_confirm"
    assert not any(a.get("type") == "delete_priority" for a in ui)
    collected = mem.current_task_state().collected
    assert collected.get("priority_id") == "2001"


def test_clear_draft_after_update_priority_refreshes_list():
    from app.agents.ticketing_coworker import (
        _clear_draft_after_write,
        _ensure_guided_ui_actions,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    mem.durable["priority_draft"] = {
        "id": "2001",
        "displayName": "yes",
        "awaiting": "delete_confirm",
        "kind": "priority",
    }
    mem.durable["current_workflow"] = "create_priority"
    actions: list[dict] = [
        {
            "type": "delete_priority",
            "id": "2001",
            "displayName": "yes",
            "awaiting": "delete_confirm",
        }
    ]
    _clear_draft_after_write(
        "update_priority",
        mem,
        actions,
        result={
            "success": True,
            "payload": {"id": "2001", "displayName": "immediate", "resolutionHours": 1},
        },
    )
    assert mem.durable.get("priority_draft") is None
    assert mem.durable.get("current_workflow") is None
    assert not any(
        a.get("type") == "delete_priority" and not a.get("done") for a in actions
    )
    assert any(a.get("type") == "refresh_priorities" for a in actions)
    assert any(a.get("type") == "update_priority" and a.get("done") for a in actions)
    ensured = _ensure_guided_ui_actions(mem, actions)
    assert not any(
        a.get("type") == "delete_priority" and not a.get("done") for a in ensured
    )


def test_reject_sort_order_id_not_in_listed_priorities():
    from app.agents.ticketing_coworker import _reject_ungrounded_entity_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {
        "catalog_list_options": [{"id": "2001", "displayName": "Fast"}],
    }
    blocked = _reject_ungrounded_entity_args(
        "update_priority",
        {"priority_id": "5", "displayName": "immediate"},
        memory=mem,
    )
    assert blocked and blocked.get("error_code") == "MISSING_CATALOG_ID"
    ok = _reject_ungrounded_entity_args(
        "update_priority",
        {"priority_id": "2001", "displayName": "immediate"},
        memory=mem,
    )
    assert ok is None
