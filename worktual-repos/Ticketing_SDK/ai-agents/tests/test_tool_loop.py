"""Bounded tool-loop mechanics."""

from __future__ import annotations

import json
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


def test_delete_priority_one_call_for_multiple_ids():
    """Named P3 and P5: one delete_priority with both listed ids."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "delete_priority",
                        "arguments": {
                            "priority_ids": ["2781", "2937"],
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
                        "name": "delete_priority",
                        "arguments": {
                            "priority_ids": ["2781", "2937"],
                            "confirmed": True,
                        },
                    }
                ],
            },
            {
                "content": "P3 and P5 were removed.",
                "tool_calls": [],
            },
        ]
    )
    calls: list[dict[str, Any]] = []

    def execute(name, args):
        calls.append({"name": name, "args": dict(args)})
        return {
            "success": True,
            "payload": {
                "deleted": [
                    {"id": "2781", "priority": "p3"},
                    {"id": "2937", "priority": "p5"},
                ],
                "failed": [],
                "count": 2,
            },
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="delete_priority",
                description="delete priority",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="p3 and p5",
    )
    assert len(calls) == 1
    assert calls[0]["args"].get("priority_ids") == ["2781", "2937"]
    assert "p3" in text.lower() or "removed" in text.lower()


def test_delete_priority_blocks_same_id_retry():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "delete_priority",
                        "arguments": {"priority_id": "2781", "confirmed": True},
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "2",
                        "name": "delete_priority",
                        "arguments": {"priority_id": "2781", "confirmed": True},
                    }
                ],
            },
            {"content": "P3 is already deleted.", "tool_calls": []},
        ]
    )
    calls: list[dict[str, Any]] = []

    def execute(name, args):
        calls.append({"name": name, "args": dict(args)})
        return {
            "success": True,
            "payload": {"id": args.get("priority_id"), "deleted": True},
        }

    run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="delete_priority",
                description="delete priority",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="delete p3 again",
    )
    assert len(calls) == 1


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


def test_kb_write_tool_follows_publication_intent():
    from app.workflow_schemas import (
        armed_write_tools_from_state,
        guided_choice_awaiting_write,
        is_confirm_awaiting,
        write_tool_armed,
        write_tool_for_armed_draft,
    )

    collecting = {
        "title": "test",
        "category": "General",
        "body": "Clear the cache.",
        "awaiting": "publication_intent",
    }
    assert is_confirm_awaiting(collecting) is False
    assert write_tool_for_armed_draft("kb_draft", collecting) is None
    assert write_tool_armed(draft=collecting, draft_key="kb_draft") is False
    assert guided_choice_awaiting_write({"kb_draft": collecting}) is True

    draft_ready = {**collecting, "publication_intent": "draft"}
    assert is_confirm_awaiting(draft_ready) is True
    assert write_tool_for_armed_draft("kb_draft", draft_ready) == "draft_kb_article"
    assert write_tool_armed(draft=draft_ready, draft_key="kb_draft") is True
    assert "draft_kb_article" in armed_write_tools_from_state({"kb_draft": draft_ready})

    publish_ready = {**collecting, "publication_intent": "publish"}
    assert write_tool_for_armed_draft("kb_draft", publish_ready) == "create_kb_article"

    from app.workflow_schemas import patch_recorded_write_consent

    from app.workflow_schemas import ground_fields_in_utterance

    grounded = ground_fields_in_utterance(
        {"publication_intent": "draft"},
        "darft thissss",
    )
    assert grounded.get("publication_intent") == "draft"
    assert ground_fields_in_utterance(
        {"publication_intent": "maybe"},
        "darft thissss",
    ) == {}

    assert patch_recorded_write_consent({"publication_intent": "draft"}, None) is True
    assert patch_recorded_write_consent({"title": "test"}, None) is False
    assert (
        patch_recorded_write_consent(
            {},
            {
                "payload": {
                    "updated_fields": ["publication_intent"],
                    "draft": {"publication_intent": "publish"},
                }
            },
        )
        is True
    )


def _kb_create_tools():
    return [
        ToolDefinition(
            name="patch_kb_draft",
            description="patch",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="draft_kb_article",
            description="draft",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="create_kb_article",
            description="publish",
            input_schema={"type": "object", "properties": {}},
        ),
    ]


def test_tool_loop_kb_disposition_patch_writes_without_second_llm_tool():
    """LLM stores publication_intent; runtime runs the matching write."""
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s-kb")
    mem.durable["current_workflow"] = "create_kb"
    mem.durable["kb_draft"] = {
        "title": "test",
        "category": "General",
        "body": "Clear the cache.",
        "awaiting": "publication_intent",
    }
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "p1",
                        "name": "patch_kb_draft",
                        "arguments": {"publication_intent": "draft"},
                    }
                ],
            },
            {"content": "On it.", "tool_calls": []},
            {"content": "Saved as staff-only.", "tool_calls": []},
        ]
    )
    called: list[str] = []

    def execute(name, args):
        called.append(name)
        if name == "patch_kb_draft":
            draft = dict(mem.durable.get("kb_draft") or {})
            draft["publication_intent"] = "draft"
            draft["awaiting"] = "confirm"
            draft["ready"] = True
            mem.durable["kb_draft"] = draft
            return {
                "success": True,
                "payload": {
                    "updated_fields": ["publication_intent"],
                    "draft": draft,
                },
            }
        return {"success": True, "payload": {"id": "1", "title": "test"}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=_kb_create_tools(),
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8)),
        user_message="draft this",
    )
    assert text == "Saved as staff-only."
    assert called == ["patch_kb_draft", "draft_kb_article"]


def test_tool_loop_kb_publish_choice_writes_create():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s-kb-pub")
    mem.durable["current_workflow"] = "create_kb"
    mem.durable["kb_draft"] = {
        "title": "test",
        "category": "General",
        "body": "Clear the cache.",
        "awaiting": "publication_intent",
    }
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "p1",
                        "name": "patch_kb_draft",
                        "arguments": {"publication_intent": "publish"},
                    }
                ],
            },
            {"content": "On it.", "tool_calls": []},
            {"content": "Published for customers.", "tool_calls": []},
        ]
    )
    called: list[str] = []

    def execute(name, args):
        called.append(name)
        if name == "patch_kb_draft":
            draft = dict(mem.durable.get("kb_draft") or {})
            draft["publication_intent"] = "publish"
            draft["awaiting"] = "confirm"
            draft["ready"] = True
            mem.durable["kb_draft"] = draft
            return {
                "success": True,
                "payload": {
                    "updated_fields": ["publication_intent"],
                    "draft": draft,
                },
            }
        return {"success": True, "payload": {"id": "1", "title": "test"}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=_kb_create_tools(),
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8)),
        user_message="publish it so customers can read it",
    )
    assert text == "Published for customers."
    assert called == ["patch_kb_draft", "create_kb_article"]


def test_tool_loop_kb_field_patch_does_not_write():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s-kb-title")
    mem.durable["current_workflow"] = "create_kb"
    mem.durable["kb_draft"] = {
        "title": "test",
        "category": "General",
        "awaiting": "body",
    }
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "p1",
                        "name": "patch_kb_draft",
                        "arguments": {"body": "Clear the cache."},
                    }
                ],
            },
            {"content": "On it.", "tool_calls": []},
            {"content": "Want this kept for the team or published?", "tool_calls": []},
        ]
    )
    called: list[str] = []

    def execute(name, args):
        called.append(name)
        draft = dict(mem.durable.get("kb_draft") or {})
        draft["body"] = "Clear the cache."
        draft["awaiting"] = "publication_intent"
        mem.durable["kb_draft"] = draft
        return {
            "success": True,
            "payload": {"updated_fields": ["body"], "draft": draft},
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=_kb_create_tools(),
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8)),
        user_message="body is clear the cache",
    )
    assert "team" in text
    assert called == ["patch_kb_draft"]


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


def test_draft_awaiting_confirm_includes_escalate_draft():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["escalate_draft"] = {
        "awaiting": "confirm",
        "ticket_number": "106",
        "assignee": "Uday kumar G",
    }
    assert tc._draft_awaiting_confirm(mem, "escalate_ticket") is True


def test_pending_confirm_write_tool_from_armed_escalate_draft():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["escalate_draft"] = {
        "awaiting": "confirm",
        "ticket_number": "106",
        "assignee": "Uday kumar G",
        "assignee_id": "1006",
    }
    mem.durable["current_workflow"] = "escalate"
    mem.durable["pending_ask"] = "confirm"
    mem.set_task_state(new_harness_task_state("ticket.escalate"))
    assert tc._pending_confirm_write_tool(mem) == "escalate_ticket"


def test_harness_escalate_yes_force_armed_without_tool_call(monkeypatch):
    """Armed escalate confirm + NLU CONFIRM must call escalate_ticket even if LLM re-asks."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import (
        ActorContext,
        DomainInstruction,
        RunBudgets,
        RunRequest,
    )
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state, task_definition_for

    task = task_definition_for("ticket.escalate")
    assert task is not None
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["active_domain"] = task.domain
    mem.durable["current_workflow"] = "escalate"
    mem.durable["escalate_draft"] = {
        "awaiting": "confirm",
        "ticket_number": "106",
        "assignee": "Uday kumar G",
        "assignee_id": "1006",
    }
    mem.durable["pending_ask"] = "confirm"
    mem.set_task_state(new_harness_task_state(task.id))
    fake = _FakeLLM(
        [
            {
                "content": (
                    "It looks like the system needs one more go-ahead from you "
                    "before I can file this."
                ),
                "tool_calls": [],
            },
            {"content": "Done! Ticket #106 escalated.", "tool_calls": []},
        ]
    )
    monkeypatch.setattr(
        "app.agents.workflow_nlu.decide_workflow_turn",
        lambda state, text: {"action": "CONFIRM_WORKFLOW", "fields": {}},
    )
    escalated: dict[str, Any] = {}

    def _dispatch(name, args, **kwargs):
        escalated["name"] = name
        escalated["args"] = dict(args)
        return {
            "success": True,
            "payload": {"resolver": "Uday kumar G", "ticketNumber": "106"},
        }

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", _dispatch)
    req = RunRequest(
        message="yes",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
        surface="staff",
        page="Tickets",
    )
    out = tc._run_harness_executor(
        instruction=DomainInstruction(
            executor_id=task.executor,
            task_id=task.id,
            skill_name=task.skill_name,
            version=task.version,
            objective="Confirm escalation of ticket #106 to Uday kumar G",
        ),
        llm=fake,
        memory=mem,
        query="yes",
        context={
            "request": req,
            "module": "tickets",
            "surface": "staff",
            "page": "Tickets",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
    )
    assert escalated.get("name") == "escalate_ticket"
    assert escalated.get("args", {}).get("confirmed") is True
    assert out.get("response_type") == "final"
    assert mem.durable.get("escalate_draft") is None


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


def test_merge_client_ticket_draft_keeps_verify_and_issue():
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import _merge_client_draft_into_durable

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "customerName": "Fazil",
        "customerEmail": "smohamedfazil16@gmail.com",
        "customerId": "150b0063-aa36-4f60-940c-2e4c7f569964",
        "customerDirectoryStatus": "verified",
        "issue": "All metrics on the page are wrong",
        "attachments": ["/uploads/a.png"],
    }
    _merge_client_draft_into_durable(
        mem,
        "ticket_draft",
        {
            "awaiting": "issue",
            "customerName": "Fazil",
            "customerEmail": "smohamedfazil16@gmail.com",
            "attachments": ["/uploads/b.png"],
        },
    )
    draft = mem.durable["ticket_draft"]
    assert draft["customerDirectoryStatus"] == "verified"
    assert draft["customerId"] == "150b0063-aa36-4f60-940c-2e4c7f569964"
    assert draft["issue"] == "All metrics on the page are wrong"
    assert draft["attachments"] == ["/uploads/a.png", "/uploads/b.png"]


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
    assert "ask_knowledge_graph" in prompt
    assert "customer_not_found=true" in prompt
    assert "draft_customer_draft" in prompt
    assert "→ START_" not in prompt
    assert "CONFIRM_WORKFLOW" not in prompt


def test_search_kb_empty_args_use_this_turn_text():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    seen: list[dict[str, Any]] = []
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "kb1", "name": "search_kb", "arguments": {}},
                ],
            },
            {"content": "<p>Here is how to check the order.</p>", "tool_calls": []},
        ]
    )

    def execute(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        seen.append({"name": name, "arguments": arguments})
        return {
            "success": True,
            "payload": {"title": "Order status", "steps": ["Open orders"]},
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="search_kb",
                description="search",
                input_schema={
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=4, max_tool_calls=4)),
        user_message="how to check order status",
    )
    assert seen == [
        {
            "name": "search_kb",
            "arguments": {"query": "how to check order status"},
        }
    ]
    assert "order" in text.lower()
    assert "Repeated tool-call cycle" not in text


def test_search_kb_keeps_model_query():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    seen: list[dict[str, Any]] = []
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "kb1",
                        "name": "search_kb",
                        "arguments": {"query": "track a shipment"},
                    },
                ],
            },
            {"content": "<p>Use the tracking page.</p>", "tool_calls": []},
        ]
    )

    def execute(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        seen.append(arguments)
        return {"success": True, "payload": {"title": "Tracking"}}

    run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="search_kb",
                description="search",
                input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=4, max_tool_calls=4)),
        user_message="how to check order status",
    )
    assert seen == [{"query": "track a shipment"}]


def test_budget_cycle_detection():
    tracker = BudgetTracker(RunBudgets(max_tool_calls=10))
    tracker.record_tool_call("list_tickets", {"limit": 1})
    tracker.record_tool_call("list_tickets", {"limit": 1})
    with pytest.raises(ToolLoopExhausted):
        tracker.record_tool_call("list_tickets", {"limit": 1})


def test_identical_patch_ticket_draft_soft_breaks_instead_of_empty_cycle():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    same = {
        "content": "",
        "tool_calls": [
            {
                "id": "p1",
                "name": "patch_ticket_draft",
                "arguments": {
                    "customerName": "Priya Moorthy",
                    "customerEmail": "priyamoorthy0725@gmail.com",
                },
            }
        ],
    }
    llm = _FakeLLM(
        [
            same,
            {**same, "tool_calls": [{**same["tool_calls"][0], "id": "p2"}]},
            {**same, "tool_calls": [{**same["tool_calls"][0], "id": "p3"}]},
            {
                "content": "<p>I still need their email or phone to file this.</p>",
                "tool_calls": [],
            },
        ]
    )
    calls: list[str] = []

    def execute(name, args):
        calls.append(name)
        return {
            "success": True,
            "payload": {
                "updated_fields": [],
                "awaiting": "contact",
                "next_action": "clarify_or_park",
                "message": "This utterance did not fill the open slot.",
            },
        }

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="patch_ticket_draft",
                description="draft",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="unable to view order details in account",
    )
    assert "Repeated tool-call cycle" not in text
    assert "email" in text.lower() or "phone" in text.lower()
    assert len(calls) == 1


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


def test_duplicate_check_gate_allows_same_turn_create_retry():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "name": "create_ticket",
                        "arguments": {"customerName": "Pat", "issue": "vpn down"},
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c2",
                        "name": "create_ticket",
                        "arguments": {
                            "customerName": "Pat",
                            "issue": "vpn down",
                            "confirmed": True,
                        },
                    }
                ],
            },
            {"content": "Filed ticket #12900.", "tool_calls": []},
        ]
    )
    calls = []

    def execute(name, args):
        calls.append(name)
        if len(calls) == 1:
            return {
                "success": False,
                "error_code": "DUPLICATE_CHECK_REQUIRED",
                "message": "stamp first",
                "retryable": False,
            }
        return {"success": True, "payload": {"ticketNumber": "#12900"}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="create_ticket",
                description="file",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=8, max_tool_calls=8)),
        user_message="yesh",
    )
    assert len(calls) == 2
    assert "12900" in text or "filed" in text.lower() or "ticket" in text.lower()


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
            ["ask_knowledge_graph"],
            ["ask_knowledge_graph"],
        ),
        (
            "how many open tickets and why",
            "analytics.root.cause",
            ["ask_semantic_layer", "ask_knowledge_graph"],
            ["ask_semantic_layer", "ask_knowledge_graph"],
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
    from app.workflow_schemas import (
        looks_like_field_edit_instruction,
        looks_like_person_name,
    )

    assert looks_like_person_name("maha") is True
    assert looks_like_person_name("change the name") is False
    assert looks_like_person_name("update email") is False
    assert looks_like_person_name("Priya Sharma") is True
    assert looks_like_field_edit_instruction("i want to change the name") is True
    assert looks_like_field_edit_instruction("Networking Issue") is False
    assert looks_like_field_edit_instruction(
        "The bot terminated the transaction without charging the customer "
        "and generated this high-priority ticket. Call the customer back to "
        "safely process the billing manually after checking the gateway logs."
    ) is False


def test_staff_ticket_create_reply_block_targets_agent_not_customer():
    from app.agents.ticketing_coworker import (
        _CUSTOMER_CHANNEL_REPLY_BLOCK,
        _STAFF_TICKET_CREATE_REPLY_BLOCK,
    )

    staff = _STAFF_TICKET_CREATE_REPLY_BLOCK.lower()
    assert "staff agent" in staff
    assert "not in this chat" in staff
    assert "hi aakash" in staff
    assert "what issue should i file" in staff
    assert _CUSTOMER_CHANNEL_REPLY_BLOCK not in _STAFF_TICKET_CREATE_REPLY_BLOCK


def test_verify_success_message_distinguishes_staff_and_portal(monkeypatch):
    from app.tools.express_client import ToolActor, tool_actor_scope

    def _hit(data, org, **kwargs):
        out = dict(data)
        out["customerId"] = "1020"
        out["customerDirectoryStatus"] = "verified"
        return out, "ok", [{"id": "1020"}]

    monkeypatch.setattr("app.tasks.chat_commands._bind_directory_customer", _hit)
    with tool_actor_scope(
        ToolActor(user_id="u", organization_id="org-1", user_role="admin")
    ):
        from app.tools.ticket_write import verify_ticket_customer

        result = verify_ticket_customer({"customerEmail": "aakash@gmail.com"})
    msg = str((result.get("payload") or {}).get("message") or "").lower()
    assert "staff surface" in msg
    assert "portal surface" in msg
    assert "customer-facing" not in msg


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
    assert bad["success"] is True
    assert bad["payload"]["awaiting"] == "name"
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


@pytest.mark.parametrize(
    (
        "tool",
        "draft_key",
        "fill",
        "correction_awaiting",
        "keep_key",
        "keep_value",
        "replacement",
        "next_awaiting",
    ),
    [
        (
            "patch_ticket_draft",
            "ticket_draft",
            {"customerName": "Maha"},
            "name",
            "customerName",
            "Maha",
            {"customerName": "Sam"},
            "contact",
        ),
        (
            "patch_customer_draft",
            "customer_draft",
            {"name": "Maha"},
            "name",
            "name",
            "Maha",
            {"name": "Sam"},
            "email",
        ),
        (
            "patch_kb_draft",
            "kb_draft",
            {"title": "Old Title"},
            "title",
            "title",
            "Old Title",
            {"title": "Network Issue"},
            "category",
        ),
        (
            "patch_macro_draft",
            "macro_draft",
            {"title": "Reset password"},
            "title",
            "title",
            "Reset password",
            {"title": "Welcome note"},
            "body",
        ),
        (
            "patch_team_draft",
            "team_draft",
            {"name": "ML Team"},
            "name",
            "name",
            "ML Team",
            {"name": "AI/ML"},
            "description",
        ),
        (
            "patch_priority_draft",
            "priority_draft",
            {"displayName": "Gold"},
            "name",
            "displayName",
            "Gold",
            {"displayName": "Silver"},
            "hours",
        ),
        (
            "patch_status_draft",
            "status_draft",
            {"displayName": "Waiting"},
            "name",
            "displayName",
            "Waiting",
            {"displayName": "On Hold"},
            "confirm",
        ),
        (
            "patch_escalate_draft",
            "escalate_draft",
            {"ticket_number": "T-101"},
            "ticket_number",
            "ticket_number",
            "T-101",
            {"ticket_number": "T-202"},
            "assignee",
        ),
        (
            "patch_reassign_draft",
            "reassign_draft",
            {"ticket_number": "T-101"},
            "ticket_number",
            "ticket_number",
            "T-101",
            {"ticket_number": "T-202"},
            "target_role",
        ),
    ],
)
def test_guided_correction_keeps_value_then_applies_replacement(
    tool,
    draft_key,
    fill,
    correction_awaiting,
    keep_key,
    keep_value,
    replacement,
    next_awaiting,
):
    """All guided modules: unusable patch keeps awaiting; real value advances."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list = []
    filled = _execute_local_ui_tool(tool, fill, memory=mem, ui_actions=ui)
    assert filled["success"] is True
    assert mem.durable[draft_key][keep_key] == keep_value

    for unusable in ("null", "none"):
        kept = _execute_local_ui_tool(
            tool,
            {"awaiting": correction_awaiting, keep_key: unusable},
            memory=mem,
            ui_actions=ui,
        )
        assert kept["success"] is True, kept
        draft = mem.durable[draft_key]
        assert draft[keep_key] == keep_value
        assert str(draft.get("awaiting") or "").strip().lower() == correction_awaiting

    renamed = _execute_local_ui_tool(
        tool,
        {"awaiting": correction_awaiting, **replacement},
        memory=mem,
        ui_actions=ui,
    )
    assert renamed["success"] is True, renamed
    draft = mem.durable[draft_key]
    for key, value in replacement.items():
        assert draft[key] == value
    assert str(draft.get("awaiting") or "").strip().lower() == next_awaiting


@pytest.mark.parametrize(
    (
        "tool",
        "draft_key",
        "fill",
        "keep_key",
        "keep_value",
        "invented",
        "correction_awaiting",
        "said_value",
        "said_patch",
        "next_awaiting",
    ),
    [
        (
            "patch_ticket_draft",
            "ticket_draft",
            {"customerName": "Maha"},
            "customerName",
            "Maha",
            {"customerName": "Severe"},
            "name",
            "Sam",
            {"customerName": "Sam"},
            "contact",
        ),
        (
            "patch_customer_draft",
            "customer_draft",
            {"name": "Maha"},
            "name",
            "Maha",
            {"name": "Severe"},
            "name",
            "Sam",
            {"name": "Sam"},
            "email",
        ),
        (
            "patch_kb_draft",
            "kb_draft",
            {"title": "Old Title"},
            "title",
            "Old Title",
            {"title": "Invented Title"},
            "title",
            "Network Issue",
            {"title": "Network Issue"},
            "category",
        ),
        (
            "patch_macro_draft",
            "macro_draft",
            {"title": "Reset password"},
            "title",
            "Reset password",
            {"title": "Invented Macro"},
            "title",
            "Welcome note",
            {"title": "Welcome note"},
            "body",
        ),
        (
            "patch_team_draft",
            "team_draft",
            {"name": "ML Team"},
            "name",
            "ML Team",
            {"name": "Severe"},
            "name",
            "AI/ML",
            {"name": "AI/ML"},
            "description",
        ),
        (
            "patch_priority_draft",
            "priority_draft",
            {"displayName": "Gold"},
            "displayName",
            "Gold",
            {"displayName": "Severe"},
            "name",
            "Silver",
            {"displayName": "Silver"},
            "hours",
        ),
        (
            "patch_status_draft",
            "status_draft",
            {"displayName": "Waiting"},
            "displayName",
            "Waiting",
            {"displayName": "On Hold"},
            "name",
            "On Hold",
            {"displayName": "On Hold"},
            "confirm",
        ),
        (
            "patch_escalate_draft",
            "escalate_draft",
            {"ticket_number": "T-101"},
            "ticket_number",
            "T-101",
            {"ticket_number": "T-202"},
            "ticket_number",
            "T-202",
            {"ticket_number": "T-202"},
            "assignee",
        ),
        (
            "patch_reassign_draft",
            "reassign_draft",
            {"ticket_number": "T-101"},
            "ticket_number",
            "T-101",
            {"ticket_number": "T-202"},
            "ticket_number",
            "T-202",
            {"ticket_number": "T-202"},
            "target_role",
        ),
    ],
)
def test_guided_patch_grounds_like_ticket_create(
    tool,
    draft_key,
    fill,
    keep_key,
    keep_value,
    invented,
    correction_awaiting,
    said_value,
    said_patch,
    next_awaiting,
):
    """Invented replacements not in this utterance stay off the draft."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list = []
    filled = _execute_local_ui_tool(tool, fill, memory=mem, ui_actions=ui)
    assert filled["success"] is True
    assert mem.durable[draft_key][keep_key] == keep_value

    mem.add_message("user", "change the name")
    invented_out = _execute_local_ui_tool(
        tool,
        {"awaiting": correction_awaiting, **invented},
        memory=mem,
        ui_actions=ui,
    )
    assert invented_out["success"] is True, invented_out
    draft = mem.durable[draft_key]
    assert draft[keep_key] == keep_value
    assert str(draft.get("awaiting") or "").strip().lower() == correction_awaiting

    mem.add_message("user", f"change the name to {said_value}")
    renamed = _execute_local_ui_tool(
        tool,
        {"awaiting": correction_awaiting, **said_patch},
        memory=mem,
        ui_actions=ui,
    )
    assert renamed["success"] is True, renamed
    draft = mem.durable[draft_key]
    for key, value in said_patch.items():
        assert draft[key] == value
    assert str(draft.get("awaiting") or "").strip().lower() == next_awaiting


@pytest.mark.parametrize(
    ("task_id", "draft_key", "draft", "query"),
    [
        (
            "ticket.create",
            "ticket_draft",
            {"customerName": "Maha", "awaiting": "name"},
            "Sam",
        ),
        (
            "customer.create",
            "customer_draft",
            {"name": "Maha", "awaiting": "name"},
            "Sam",
        ),
        (
            "knowledge.article.create",
            "kb_draft",
            {"title": "Old Title", "awaiting": "title"},
            "Network Issue",
        ),
        (
            "macro.create",
            "macro_draft",
            {"title": "Reset password", "awaiting": "title"},
            "Welcome note",
        ),
        (
            "team.create",
            "team_draft",
            {"name": "ML Team", "awaiting": "name"},
            "AI/ML",
        ),
        (
            "priority.create",
            "priority_draft",
            {"displayName": "Gold", "awaiting": "name", "kind": "priority"},
            "Silver",
        ),
        (
            "status.create",
            "status_draft",
            {"displayName": "Waiting", "awaiting": "name", "kind": "status"},
            "On Hold",
        ),
        (
            "ticket.escalate",
            "escalate_draft",
            {"ticket_number": "T-101", "awaiting": "ticket_number"},
            "T-202",
        ),
        (
            "ticket.reassign",
            "reassign_draft",
            {"ticket_number": "T-101", "awaiting": "ticket_number"},
            "T-202",
        ),
    ],
)
def test_utterance_fits_live_pin_slot_for_replacement(
    task_id, draft_key, draft, query
):
    """Replacement values bind the open slot by schema — Super keeps the pin."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state(task_id))
    mem.durable[draft_key] = dict(draft)
    assert tc._utterance_fits_live_pin_slot(mem, query, mem.current_task_state()) is True


def test_patch_team_change_name_null_keeps_name_and_awaiting():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list = []
    _execute_local_ui_tool(
        "patch_team_draft",
        {"name": "ML Team", "awaiting": "description"},
        memory=mem,
        ui_actions=ui,
    )
    assert mem.durable["team_draft"]["name"] == "ML Team"
    assert mem.durable["team_draft"]["awaiting"] == "description"

    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"awaiting": "name", "name": "null"},
        memory=mem,
        ui_actions=ui,
    )
    assert out["success"] is True
    draft = mem.durable["team_draft"]
    assert draft["name"] == "ML Team"
    assert draft["awaiting"] == "name"
    assert not str(draft.get("description") or "").strip()

    renamed = _execute_local_ui_tool(
        "patch_team_draft",
        {"awaiting": "name", "name": "AI/ML"},
        memory=mem,
        ui_actions=ui,
    )
    assert renamed["success"] is True
    draft = mem.durable["team_draft"]
    assert draft["name"] == "AI/ML"
    assert draft["awaiting"] == "description"


def test_absorb_team_replacement_name_after_change_slot():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "name": "ML Team",
        "awaiting": "name",
        "flow": "create_team",
    }
    mem.durable["current_workflow"] = "create_team"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "AI/ML", "teams", ui) is True
    draft = mem.durable.get("team_draft") or {}
    assert draft.get("name") == "AI/ML"
    assert not str(draft.get("description") or "").strip()
    assert draft.get("awaiting") == "description"


def test_ground_unverified_skips_live_team_create_collect():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "name": "AI/ML",
        "description": "AI/ML",
        "awaiting": "members",
    }
    claim = "I've changed the team name to AI/ML. Who should be on this team?"
    assert (
        tc._ground_unverified_mutation_reply(
            claim,
            skill_name="team-create",
            tools_called=["patch_team_draft", "list_agents"],
            memory=mem,
        )
        is None
    )


def test_another_name_is_not_a_person_name():
    from app.workflow_schemas import looks_like_person_name

    assert looks_like_person_name("another name") is False
    assert looks_like_person_name("different email") is False


def test_patch_kb_retargets_title_change_without_overwriting():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {
        "title": "Networking Issue",
        "category": "Troubleshooting",
        "awaiting": "body",
        "_intent_start_text": "create article",
        "available_categories": ["General", "Billing", "Troubleshooting", "Accounts"],
    }
    mem.durable["current_workflow"] = "create_kb"
    ui: list = []
    result = _execute_local_ui_tool(
        "patch_kb_draft",
        {"title": "i want to change the name"},
        memory=mem,
        ui_actions=ui,
    )
    draft = mem.durable["kb_draft"]
    assert result["success"] is True
    assert result["payload"]["awaiting"] == "title"
    assert draft["title"] == "Networking Issue"
    assert draft["category"] == "Troubleshooting"
    assert not str(draft.get("body") or "").strip()


def test_patch_kb_does_not_invent_category_on_title_collect():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.add_message("user", "Networking Issue")
    mem.durable["kb_draft"] = {
        "awaiting": "title",
        "_intent_start_text": "create article",
        "available_categories": ["General", "Billing", "Troubleshooting", "Accounts"],
    }
    mem.durable["current_workflow"] = "create_kb"
    ui: list = []
    result = _execute_local_ui_tool(
        "patch_kb_draft",
        {"title": "Networking Issue", "category": "Troubleshooting"},
        memory=mem,
        ui_actions=ui,
    )
    draft = mem.durable["kb_draft"]
    assert result["success"] is True
    assert draft["title"] == "Networking Issue"
    assert not str(draft.get("category") or "").strip()
    assert result["payload"]["awaiting"] == "category"


def test_kb_absorb_does_not_store_change_name_as_body():
    from app.agents.ticketing_coworker import _absorb_guided_field_utterance
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {
        "title": "Networking Issue",
        "category": "Troubleshooting",
        "awaiting": "body",
        "_intent_start_text": "create article",
    }
    mem.durable["current_workflow"] = "create_kb"
    bound = _absorb_guided_field_utterance(
        mem, "i want to change the name", "kb", []
    )
    draft = mem.durable["kb_draft"]
    assert bound is False
    assert draft["title"] == "Networking Issue"
    assert not str(draft.get("body") or "").strip()
    assert draft["awaiting"] == "body"


def test_build_customer_list_html_table_uses_tool_rows_only():
    from app.agents.ticketing_coworker import (
        _build_customer_list_html_table,
        _compose_customer_list_reply_html,
        _looks_like_tabular_reply,
    )

    rows = [
        {
            "name": "arun",
            "email": "arun@gmail.com",
            "phone": "",
            "totalTickets": 1,
            "status": "Active",
            "createdAt": "2026-09-04",
        }
    ]
    html = _build_customer_list_html_table(rows)
    assert "arun@gmail.com" in html
    assert "karthik" not in html
    composed = _compose_customer_list_reply_html(
        "Here are customers:",
        {"data": rows, "totalRows": 1, "offset": 0, "hasMore": False},
    )
    assert "<table" in composed
    assert _looks_like_tabular_reply("| Name | Email |\n| --- | --- |")


def test_ground_customer_list_reply_strips_invented_html_table(monkeypatch):
    from app.agents.ticketing_coworker import _ground_customer_list_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_list_cursor"] = {
        "offset": 24,
        "pageSize": 12,
        "totalRows": 26,
        "hasMore": True,
        "pendingPage": True,
        "filters": {},
    }
    real_row = {
        "name": "zeta-last",
        "email": "zeta@gmail.com",
        "phone": "",
        "totalTickets": 0,
        "status": "Active",
        "createdAt": "2026-08-20",
    }

    def fake_list(**kwargs):
        return {
            "success": True,
            "payload": {
                "data": [real_row],
                "totalRows": 26,
                "offset": kwargs.get("offset", 0),
                "limit": 12,
                "hasMore": False,
            },
        }

    monkeypatch.setattr("app.tools.catalog_tools.list_customers", fake_list)
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Final customers from the directory:",
    )
    fake_html = (
        "I've retrieved the final set of customer records for you."
        '<table class="coworker-data-table"><thead><tr><th>Name</th></tr></thead>'
        "<tbody><tr><td>Karthik</td></tr></tbody></table>"
    )
    reply = _ground_customer_list_reply(
        fake_html,
        list_payload=None,
        turn_tools_called=[],
        memory=mem,
        harness_skill="customer-read-360",
        query="show more",
        page="Customers",
    )
    assert reply
    assert "Karthik" not in reply
    assert "zeta@gmail.com" in reply


def test_ground_customer_list_reply_pending_page_without_table(monkeypatch):
    from app.agents.ticketing_coworker import _ground_customer_list_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_list_cursor"] = {
        "offset": 12,
        "pageSize": 12,
        "totalRows": 26,
        "hasMore": True,
        "pendingPage": True,
        "filters": {},
    }

    def fake_list(**kwargs):
        return {
            "success": True,
            "payload": {
                "data": [{"name": "page2", "email": "p2@x.com", "phone": "", "totalTickets": 0, "status": "Active", "createdAt": "2026-08-01"}],
                "totalRows": 26,
                "offset": 12,
                "limit": 12,
                "hasMore": False,
            },
        }

    monkeypatch.setattr("app.tools.catalog_tools.list_customers", fake_list)
    monkeypatch.setattr("app.tasks.phrase.phrase_reply", lambda **kwargs: "Next page:")
    reply = _ground_customer_list_reply(
        "One moment while I load the next page.",
        list_payload=None,
        turn_tools_called=[],
        memory=mem,
        harness_skill="customer-read-360",
        query="show more",
        page="Customers",
    )
    assert reply
    assert "p2@x.com" in reply


def test_ground_customer_list_reply_strips_hallucinated_table(monkeypatch):
    from app.agents.ticketing_coworker import _ground_customer_list_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_list_cursor"] = {
        "offset": 12,
        "pageSize": 12,
        "totalRows": 33,
        "hasMore": True,
        "filters": {},
    }
    page2_rows = [
        {
            "name": "real-next",
            "email": "real-next@gmail.com",
            "phone": "",
            "totalTickets": 0,
            "status": "Active",
            "createdAt": "2026-08-30",
        }
    ]

    def fake_list(**kwargs):
        return {
            "success": True,
            "payload": {
                "data": page2_rows,
                "totalRows": 33,
                "offset": kwargs.get("offset", 0),
                "limit": kwargs.get("limit", 12),
                "hasMore": False,
            },
        }

    monkeypatch.setattr("app.tools.catalog_tools.list_customers", fake_list)
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Next page from the directory:",
    )
    fake_table = (
        "| Name | Email |\n| --- | --- |\n| **karthik** | karthik@gmail.com |"
    )
    reply = _ground_customer_list_reply(
        fake_table,
        list_payload=None,
        turn_tools_called=[],
        memory=mem,
        harness_skill="customer-read-360",
        query="see more",
        page="Customers",
    )
    assert reply
    assert "karthik" not in reply
    assert "real-next@gmail.com" in reply


def test_normalize_ticket_time_range_aliases():
    from app.tools.ticket_read import normalize_ticket_time_range

    assert normalize_ticket_time_range("past_month") == "last_30d"
    assert normalize_ticket_time_range("past one month") == "last_30d"
    assert normalize_ticket_time_range("last_30d") == "last_30d"
    assert normalize_ticket_time_range("2026-08-10/2026-09-10") == "2026-08-10/2026-09-10"


def test_list_tickets_maps_past_month_and_slims_rows(monkeypatch):
    from app.contracts import tool_ok
    from app.tools.ticket_read import list_tickets

    captured: dict[str, Any] = {}

    def fake_express(method, path, **kwargs):
        captured["params"] = kwargs.get("params")
        return tool_ok(
            [
                {
                    "id": f"#{i}",
                    "subject": f"Ticket {i}",
                    "customerName": "Ada",
                    "status": "Open",
                    "priority": "high",
                    "createdAt": "2026-09-01T00:00:00Z",
                    "description": "long body " * 40,
                    "aiSummary": "summary " * 40,
                }
                for i in range(1, 21)
            ]
        )

    monkeypatch.setattr("app.tools.ticket_read.express_request", fake_express)
    monkeypatch.setattr("app.tools.ticket_read.invoke_tool", lambda name, args, express_call: express_call())
    out = list_tickets(created_range="past_month", limit=20)
    assert out["success"] is True
    assert captured["params"]["createdRange"] == "last_30d"
    assert captured["params"]["includeTotal"] == "1"
    assert captured["params"]["offset"] == 0
    rows = out["payload"]["data"]
    assert len(rows) == 20
    assert "description" not in rows[0]
    assert "aiSummary" not in rows[0]
    assert rows[0]["id"] == "#1"


def test_ground_ticket_list_reply_renders_all_tool_rows(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the ticket records for last 30d:",
    )
    rows = [
        {
            "id": f"#{i}",
            "subject": f"Row {i}",
            "customerName": "Pat",
            "status": "Open",
            "priority": "high",
            "createdAt": "2026-09-01T12:00:00Z",
        }
        for i in range(1, 21)
    ]
    reply = _ground_ticket_list_reply(
        "| ID | Subject |\n| :--- | :--- |\n| **#97** | only seven shown |",
        list_payload={"data": rows, "totalRows": 20, "createdRange": "last_30d", "offset": 0},
        turn_tools_called=["list_tickets"],
        memory=SharedMemory(organization_id="1", user_id="u", session_id="s"),
        ui_actions=[],
        harness_skill="ticket-read-search",
        query="show past one month ticket records",
        page="Tickets",
    )
    assert reply
    assert "coworker-data-table" in reply
    assert reply.count("<tr>") == 21  # header + 20
    assert "#20" in reply
    assert "only seven shown" not in reply


def test_ground_ticket_list_reply_renders_ask_sql_rows(monkeypatch):
    from app.agents.ticketing_coworker import (
        _ground_ticket_list_reply,
        _ticket_list_payload_from_sql,
    )
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the tickets currently in progress:",
    )
    sql_payload = {
        "rows": [
            {
                "ticket_number": "#1508",
                "subject": "Unable to Track Order Delivery",
                "status": "Pending",
                "priority": "high",
                "customer_name": "Ashika A",
                "created_at": "2026-09-21T05:48:25.468Z",
                "due_at": "2026-09-21T12:00:00Z",
            },
            {
                "ticket_number": "#1503",
                "subject": "Voice Bot Telugu Language",
                "status": "Pending",
                "priority": "medium",
                "customer_name": "Ashika A",
                "created_at": "2026-09-20T10:24:28.541Z",
            },
        ],
        "status": "not_applicable",
    }
    mapped = _ticket_list_payload_from_sql(sql_payload, {"limit": 12})
    assert mapped is not None
    assert mapped["hasMore"] is False
    reply = _ground_ticket_list_reply(
        "<p>Here are the tickets currently in progress.</p>",
        list_payload=mapped,
        turn_tools_called=["ask_sql_layer"],
        memory=SharedMemory(organization_id="1", user_id="u", session_id="s"),
        ui_actions=[],
        harness_skill="ticket-read-search",
        query="show me inprogress ticket",
        page="Tickets",
    )
    assert reply
    assert "coworker-data-table" in reply
    assert "#1508" in reply
    assert "#1503" in reply
    assert "Ashika A" in reply
    assert "Pending" in reply
    assert "due_at" in reply
    assert "created_at" in reply
    assert "ticket_number" in reply


def test_ground_ticket_list_reply_stamps_ui_status_filter(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the closed tickets:",
    )
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    memory.durable["ticket_list_cursor"] = {
        "offset": 12,
        "pageSize": 12,
        "filters": {"status": "Closed"},
    }
    actions: list = []
    reply = _ground_ticket_list_reply(
        "Here are the closed tickets.",
        list_payload={
            "data": [{"id": "#1", "subject": "A", "status": "Closed"}],
            "totalRows": 283,
            "filters": {"status": "Closed"},
        },
        turn_tools_called=["ask_sql_layer"],
        memory=memory,
        ui_actions=actions,
        harness_skill="ticket-read-search",
        query="show me closed tickets",
        page="Tickets",
    )
    assert reply
    assert any(
        a.get("type") == "set_filter"
        and a.get("module") == "tickets"
        and a.get("status") == "Closed"
        and a.get("query") == ""
        for a in actions
    )
    assert any(
        a.get("type") == "navigate" and a.get("view") == "tickets-list" for a in actions
    )


def test_sql_ticket_page_uses_express_total_not_page_length(monkeypatch):
    from app.agents.ticketing_coworker import (
        _ticket_list_page_note,
        _ticket_list_payload_from_sql,
    )

    rows = [
        {
            "ticket_number": f"#{16000 + i}",
            "subject": f"Item {i}",
            "status": "Closed",
        }
        for i in range(12)
    ]

    def _count(**kwargs):
        assert kwargs.get("status") == "Closed"
        return {
            "success": True,
            "payload": {"data": rows[:1], "totalRows": 87, "hasMore": True},
        }

    monkeypatch.setattr("app.tools.ticket_read.list_tickets", _count)
    mapped = _ticket_list_payload_from_sql(
        {"rows": rows},
        {"limit": 12, "filters": [{"dimension": "status", "value": "Closed"}]},
    )
    assert mapped is not None
    assert mapped["totalRows"] == 87
    assert mapped["totalKnown"] is True
    assert mapped["hasMore"] is True
    assert mapped["filters"].get("status") == "Closed"
    note = _ticket_list_page_note(mapped)
    assert "1–12 of 87" in note
    assert "next 12" in note


def test_ground_customer_list_reply_renders_ask_sql_rows(monkeypatch):
    from app.agents.ticketing_coworker import (
        _ground_customer_list_reply,
        _ticket_list_payload_from_sql,
    )
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the customers in the directory:",
    )
    mapped = _ticket_list_payload_from_sql(
        {
            "rows": [
                {
                    "customer_name": "Kirti Patidar",
                    "customer_email": "hansa14solanki@gmail.com",
                    "phone": "",
                    "status": "Active",
                    "created_at": "2026-09-25",
                }
            ],
            "totalRows": 1,
            "offset": 0,
        },
        {"limit": 12},
    )
    assert mapped is not None
    reply = _ground_customer_list_reply(
        "<p>You've got 1 customer.</p>",
        list_payload=mapped,
        turn_tools_called=["ask_sql_layer"],
        memory=SharedMemory(organization_id="1", user_id="u", session_id="s"),
        harness_skill="customer-read-360",
        query="show all customers",
        page="Customers",
    )
    assert reply
    assert "coworker-data-table" in reply
    assert "Kirti Patidar" in reply
    assert "hansa14solanki@gmail.com" in reply


def test_customer_directory_prompt_uses_customer_sql_not_ticket():
    from app.prompts.builder import load_agent_definition
    from app.skills.catalog import clear_skill_caches, tools_for_skill
    from app.tools.registry import SQL_LIST_AGENTS, tools_for_agent

    load_agent_definition.cache_clear()
    clear_skill_caches()
    prompt = load_agent_definition("customer_directory_crud_executor").prompt
    assert "entityHint: wt:Customer" in prompt
    assert "Call list_customers this turn only when SQL fails" in prompt
    assert "wt:Ticket for ticket lists" not in prompt
    assert "customer_directory_crud_executor" in SQL_LIST_AGENTS
    assert "ask_sql_layer" in tools_for_agent("customer_directory_crud_executor")
    assert "ask_sql_layer" in tools_for_skill(
        "customer-read-360", "customer_directory_crud_executor"
    )


def test_ground_ticket_list_reply_renders_portal_list_tickets(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the tickets you created:",
    )
    rows = [
        {
            "id": "#2101",
            "subject": "Login issue",
            "status": "Open",
            "assignee": "Lokesh B",
            "aiSummary": "staff only",
        },
        {"id": "#2102", "subject": "Billing", "status": "Pending"},
    ]
    reply = _ground_ticket_list_reply(
        "<p>You don't have any tickets on file.</p>",
        list_payload={"data": rows, "totalRows": 2},
        turn_tools_called=["portal_list_tickets"],
        memory=SharedMemory(organization_id="1", user_id="u", session_id="s"),
        ui_actions=[],
        harness_skill="ticket-read-search",
        query="show my ticket status",
        page="portal",
    )
    assert reply
    assert "coworker-data-table" in reply
    assert "#2101" in reply
    assert "#2102" in reply
    assert "You don't have any tickets on file" not in reply
    assert "assignee" not in reply
    assert "aiSummary" not in reply
    assert "Lokesh B" not in reply


def test_project_portal_ticket_list_keeps_customer_fields_only():
    from app.agents.ticketing_coworker import _project_portal_ticket_list_row

    row = _project_portal_ticket_list_row(
        {
            "id": "#1587",
            "subject": "Damaged",
            "description": "Item broken",
            "customerName": "Ashika A",
            "customerEmail": "a@x.com",
            "customerPhone": "",
            "channel": "Web",
            "status": "Pending",
            "updatedAt": "2h ago",
            "createdAt": "2026-09-23",
            "assignee": "Lokesh B",
            "resolver": "Chandru R",
            "aiSummary": "hidden",
            "priority": "medium",
        }
    )
    assert set(row) == {
        "id",
        "subject",
        "description",
        "customerName",
        "customerEmail",
        "customerPhone",
        "channel",
        "status",
        "updatedAt",
        "createdAt",
    }
    assert row["id"] == "#1587"
    assert row["customerPhone"] is None
    assert "assignee" not in row


def test_is_portal_session_from_role():
    from app.agents.ticketing_coworker import _is_portal_session

    class _Actor:
        user_role = "portal_customer"
        portal_customer_id = "c-9"

    assert _is_portal_session(actor=_Actor(), context={"module": "portal"}) is True
    assert _is_portal_session(context={"module": "tickets"}) is False


def test_super_prompt_routes_portal_ticket_status_to_resolution():
    from pathlib import Path

    text = (
        Path(__file__).resolve().parents[1]
        / "app/agents/definitions/ticketing_super_agent/agent.md"
    ).read_text(encoding="utf-8")
    assert "Portal — their tickets / status" in text
    assert "portal_list_tickets" in text
    assert "Never route that to `intake_deflection_domain`" in text
    assert "not** a portal customer asking for the status" in text


def test_kb_list_next_page_uses_cursor_offset():
    from app.agents.ticketing_coworker import _kb_list_page_args
    from app.memory.session import ALLOWED_DURABLE_KEYS

    assert "kb_list_cursor" in ALLOWED_DURABLE_KEYS
    cursor = {
        "offset": 10,
        "pageSize": 10,
        "totalRows": 58,
        "hasMore": True,
        "pendingPage": True,
    }
    error, cleaned = _kb_list_page_args(
        {}, cursor=cursor, scope_already_requested=False
    )
    assert error is not None
    assert error["error_code"] == "KB_PAGE_OFFSET_REQUIRED"
    assert "offset=10" in error["message"]

    error, cleaned = _kb_list_page_args(
        {"offset": 10, "limit": 10}, cursor=cursor, scope_already_requested=False
    )
    assert error is None
    assert cleaned["offset"] == 10
    assert cleaned["limit"] == 10

    error, cleaned = _kb_list_page_args(
        {}, cursor=cursor, scope_already_requested=True
    )
    assert error is None
    assert cleaned["offset"] == 10
    assert cleaned["limit"] == 10

    error, cleaned = _kb_list_page_args(
        {"offset": 0}, cursor=cursor, scope_already_requested=False
    )
    assert error is None
    assert cleaned["offset"] == 0


def test_team_read_list_queues_requires_one_team_or_directory():
    from app.agents.ticketing_coworker import _team_read_list_queues_args

    error, cleaned = _team_read_list_queues_args({}, scope_already_requested=False)
    assert error is not None
    assert error["error_code"] == "TEAM_SCOPE_REQUIRED"
    assert "query" not in cleaned

    error, cleaned = _team_read_list_queues_args(
        {"query": "Offers & Loyalty Support"},
        scope_already_requested=False,
    )
    assert error is None
    assert cleaned["query"] == "Offers & Loyalty Support"
    assert "list_all" not in cleaned

    error, cleaned = _team_read_list_queues_args(
        {"list_all": True},
        scope_already_requested=False,
    )
    assert error is None
    assert "query" not in cleaned
    assert "list_all" not in cleaned

    error, cleaned = _team_read_list_queues_args({}, scope_already_requested=True)
    assert error is None
    assert cleaned == {}


def test_ground_team_list_reply_one_team_uses_member_count(monkeypatch):
    from app.agents.ticketing_coworker import _ground_team_list_reply

    seen: dict = {}

    def _phrase(**kwargs):
        seen.update(kwargs)
        return "Here are the members of Offers & Loyalty Support."

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", _phrase)
    reply = _ground_team_list_reply(
        "Here are the members.",
        list_payload={
            "data": [
                {
                    "id": "1070",
                    "queueName": "Offers & Loyalty Support",
                    "members": ["Lokesh B", "Chandru R"],
                    "openTickets": 1524,
                    "slaStatus": "At Risk",
                }
            ],
            "totalRows": 1,
            "query": "Offers & Loyalty Support",
        },
        turn_tools_called=["list_queues"],
        harness_skill="team-read",
        query="Offers & Loyalty Support list all members from this team",
        page="Teams",
    )
    assert seen["context"]["teamName"] == "Offers & Loyalty Support"
    assert seen["context"]["memberCount"] == 2
    assert seen["context"]["teamCount"] == 1
    assert reply
    assert "Offers & Loyalty Support" in reply
    assert "Lokesh B" in reply
    assert "Chandru R" in reply
    assert "Customer Account" not in reply


def test_ground_team_list_reply_renders_all_tool_rows(monkeypatch):
    from app.agents.ticketing_coworker import _ground_team_list_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the teams currently set up in your system:",
    )
    rows = [
        {
            "id": "1019",
            "queueName": "CCAAS",
            "members": ["Sriannamalai R", "Ashika A", "Priya Moorthy", "Lokesh B"],
            "openTickets": 11,
            "slaStatus": "At Risk",
        },
        {
            "id": "1020",
            "queueName": "IT Service Management",
            "members": ["Ashika A", "Uday kumar G", "Shobana Shree", "Anshu kushwaha"],
            "openTickets": 3,
            "slaStatus": "At Risk",
        },
        {
            "id": "1021",
            "queueName": "Data Science",
            "members": ["Mohamed Fazil"],
            "openTickets": 0,
            "slaStatus": "On Track",
        },
    ]
    reply = _ground_team_list_reply(
        (
            "CCAAS (Sriannamalai R, Ashika A) and IT Service Management "
            "(Ashika A, Uday kumar G) are At Risk."
        ),
        list_payload={"data": rows, "totalRows": 3},
        turn_tools_called=["list_queues"],
        harness_skill="team-read",
        query="show all teams",
        page="Teams",
    )
    assert reply
    assert "coworker-data-table" in reply
    assert reply.count("<tr>") == 4  # header + 3 teams
    assert "CCAAS" in reply
    assert "IT Service Management" in reply
    assert "Data Science" in reply
    assert "Mohamed Fazil" in reply
    assert "<strong>At Risk</strong>" in reply
    assert "CCAAS (Sriannamalai R" not in reply


def test_ground_team_list_reply_hidden_outside_team_read(monkeypatch):
    from app.agents.ticketing_coworker import _ground_team_list_reply

    reply = _ground_team_list_reply(
        "Team CCAAS has four members.",
        list_payload={
            "data": [{"id": "1019", "queueName": "CCAAS", "members": ["Ada"]}],
            "totalRows": 1,
        },
        turn_tools_called=["list_queues"],
        harness_skill="team-members-update",
        query="add Ada to CCAAS",
        page="Teams",
    )
    assert reply is None


def test_ground_ticket_list_reply_hidden_on_ticket_create(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here are the ticket records:",
    )
    reply = _ground_ticket_list_reply(
        "I pulled four tickets.",
        list_payload={
            "data": [
                {
                    "id": "#91",
                    "subject": "CRM data",
                    "customerName": "Ashika",
                    "status": "Resolved",
                    "priority": "urgent",
                    "createdAt": "2026-09-01T12:00:00Z",
                }
            ],
            "totalRows": 1,
            "offset": 0,
        },
        turn_tools_called=["list_tickets"],
        memory=SharedMemory(organization_id="1", user_id="u", session_id="s"),
        ui_actions=[],
        harness_skill="ticket-create",
        query="the crm data got vanished",
        page="Create Ticket",
    )
    assert reply is None


def test_ground_ticket_list_reply_strips_invented_show_more_without_tool(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list[dict] = []
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: (
            "I don't have another verified page from the database in this turn. "
            "Open the Tickets page to browse the full list."
        ),
    )
    reply = _ground_ticket_list_reply(
        (
            "I've retrieved more tickets:"
            '<table class="coworker-data-table"><tbody>'
            "<tr><td>#85</td><td>Lola chatbot message latency</td></tr>"
            "</tbody></table>"
        ),
        list_payload=None,
        turn_tools_called=[],
        memory=mem,
        ui_actions=ui,
        harness_skill="ticket-read-search",
        query="show more",
        page="Tickets",
    )
    assert reply
    assert "#85" not in reply
    assert "coworker-data-table" not in reply
    assert any(a.get("type") == "navigate" and a.get("view") == "assigned" for a in ui)


def test_ensure_ticket_list_cursor_from_last_tool_outcome():
    from app.agents.ticketing_coworker import _ensure_ticket_list_cursor
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_tool_outcome"] = {
        "tool": "list_tickets",
        "success": True,
        "arguments": {"created_range": "last_30d"},
        "payload": {
            "totalRows": 97,
            "offset": 0,
            "limit": 12,
            "rowCount": 12,
            "hasMore": True,
            "createdRange": "last_30d",
        },
    }
    _ensure_ticket_list_cursor(mem)
    cursor = mem.durable["ticket_list_cursor"]
    assert cursor["offset"] == 12
    assert cursor["hasMore"] is True
    assert cursor["pendingPage"] is True
    assert cursor["filters"]["created_range"] == "last_30d"


def test_ticket_list_cursor_survives_durable_allowlist():
    from app.memory.session import ALLOWED_DURABLE_KEYS, SharedMemory

    assert "ticket_list_cursor" in ALLOWED_DURABLE_KEYS
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_list_cursor"] = {
        "offset": 12,
        "pageSize": 12,
        "totalRows": 97,
        "hasMore": True,
        "pendingPage": True,
        "filters": {"created_range": "last_30d"},
    }
    kept = mem.allowlisted_durable()
    assert kept["ticket_list_cursor"]["offset"] == 12
    restored = SharedMemory._normalize_durable(kept)
    assert restored["ticket_list_cursor"]["offset"] == 12
    assert restored["ticket_list_cursor"]["filters"]["created_range"] == "last_30d"


def test_stash_ticket_list_cursor_treats_truncated_dump_as_more():
    from app.agents.ticketing_coworker import _stash_ticket_list_cursor
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    _stash_ticket_list_cursor(
        mem,
        {
            "data": [{"id": f"#{i}", "subject": f"T{i}"} for i in range(97, 85, -1)],
            "totalRows": 97,
            "limit": None,
            "hasMore": False,
            "truncated": True,
            "createdRange": "last_30d",
        },
        {"created_range": "last_30d"},
    )
    cursor = mem.durable["ticket_list_cursor"]
    assert cursor["hasMore"] is True
    assert cursor["pendingPage"] is True
    assert cursor["offset"] == 12
    assert cursor["totalRows"] == 97
    assert cursor["filters"]["created_range"] == "last_30d"


def test_ground_ticket_list_reply_fetches_when_dump_left_hasMore_false(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply
    from app.contracts import tool_ok
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_list_cursor"] = {
        "offset": 12,
        "pageSize": 12,
        "totalRows": 97,
        "hasMore": False,
        "pendingPage": False,
        "filters": {"created_range": "last_30d"},
    }

    def fake_list(**kwargs):
        assert kwargs.get("offset") == 12
        return tool_ok(
            {
                "data": [
                    {
                        "id": "#74",
                        "subject": "Verified next page",
                        "customerName": "Ada",
                        "status": "Open",
                        "priority": "high",
                        "createdAt": "2026-08-20T00:00:00Z",
                    }
                ],
                "totalRows": 97,
                "offset": 12,
                "limit": 12,
                "hasMore": True,
                "createdRange": "last_30d",
            }
        )

    monkeypatch.setattr("app.tools.ticket_read.list_tickets", fake_list)
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here is the next page from the database:",
    )
    reply = _ground_ticket_list_reply(
        (
            '<table class="coworker-data-table"><tbody>'
            "<tr><td>#85</td><td>Lola chatbot message latency</td></tr>"
            "</tbody></table>"
        ),
        list_payload=None,
        turn_tools_called=[],
        memory=mem,
        ui_actions=[],
        harness_skill="ticket-read-search",
        query="show more",
        page="Tickets",
    )
    assert reply
    assert "Verified next page" in reply
    assert "Lola chatbot message latency" not in reply


def test_ground_ticket_list_reply_fetches_next_page_on_show_more(monkeypatch):
    from app.agents.ticketing_coworker import _ground_ticket_list_reply
    from app.contracts import tool_ok
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_list_cursor"] = {
        "offset": 12,
        "pageSize": 12,
        "totalRows": 24,
        "hasMore": True,
        "pendingPage": True,
        "filters": {"created_range": "last_30d"},
    }

    def fake_list(**kwargs):
        assert kwargs.get("offset") == 12
        assert kwargs.get("created_range") == "last_30d"
        return tool_ok(
            {
                "data": [
                    {
                        "id": "#85",
                        "subject": "Real next row",
                        "customerName": "Ada",
                        "status": "Open",
                        "priority": "high",
                        "createdAt": "2026-08-20T00:00:00Z",
                    }
                ],
                "totalRows": 24,
                "offset": 12,
                "limit": 12,
                "hasMore": False,
                "createdRange": "last_30d",
            }
        )

    monkeypatch.setattr("app.tools.ticket_read.list_tickets", fake_list)
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here is the next page from the database:",
    )
    reply = _ground_ticket_list_reply(
        (
            '<table class="coworker-data-table"><tbody>'
            "<tr><td>#85</td><td>Lola chatbot message latency</td></tr>"
            "</tbody></table>"
        ),
        list_payload=None,
        turn_tools_called=[],
        memory=mem,
        ui_actions=[],
        harness_skill="ticket-read-search",
        query="show more",
        page="Tickets",
    )
    assert reply
    assert "Real next row" in reply
    assert "Lola chatbot message latency" not in reply


def test_stash_customer_360_candidate_single_row_only():
    from app.agents.ticketing_coworker import _stash_customer_360_candidate
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    _stash_customer_360_candidate(
        mem,
        {
            "data": [{"name": "Shobana", "email": "shobana@gmail.com", "id": "1038"}],
            "totalRows": 33,
            "offset": 0,
            "limit": 12,
            "hasMore": True,
        },
    )
    cand = mem.durable.get("customer_360_candidate")
    assert cand
    assert cand["email"] == "shobana@gmail.com"
    assert cand["awaiting_consent"] is True


def test_ground_customer_360_reply_prefetches_on_consent(monkeypatch):
    from app.agents.ticketing_coworker import _ground_customer_360_reply
    from app.contracts import tool_ok
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_360_candidate"] = {
        "email": "shobana@gmail.com",
        "name": "Shobana Priyadharshini",
        "awaiting_consent": True,
    }

    def fake_360(**kwargs):
        return tool_ok(
            {
                "email": "shobana@gmail.com",
                "totalTickets": 2,
                "avgCsat": 4.5,
                "ratingsCount": 1,
                "tickets": [
                    {
                        "id": "#101",
                        "subject": "Login issue",
                        "status": "Open",
                        "priority": "High",
                        "assignee": "Agent A",
                        "csatScore": 4.5,
                        "createdAt": "2026-08-01",
                    }
                ],
            }
        )

    monkeypatch.setattr("app.tools.catalog_tools.get_customer_360", fake_360)
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Here is the ticket history for Shobana:",
    )
    reply = _ground_customer_360_reply(
        "I'm sorry, I couldn't retrieve the history for shobana@gmail.com right now.",
        c360_payload=None,
        turn_tools_called=[],
        memory=mem,
        harness_skill="customer-read-360",
        query="yes",
        page="Customers",
    )
    assert reply
    assert "coworker-data-table" in reply
    assert "Login issue" in reply
    assert "couldn't retrieve" not in reply.lower()


def test_ground_customer_360_reply_surfaces_prefetch_error():
    from app.agents.ticketing_coworker import _ground_customer_360_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    reply = _ground_customer_360_reply(
        "I'm sorry, I couldn't retrieve the history for shobana@gmail.com right now.",
        c360_payload=None,
        c360_error={
            "error_code": "FORBIDDEN",
            "message": "Authentication required",
        },
        turn_tools_called=["get_customer_360"],
        memory=mem,
        harness_skill="customer-read-360",
        query="yes",
        page="Customers",
    )
    assert reply
    assert "Authentication required" in reply
    assert "couldn't retrieve" not in reply.lower()


def test_ground_customer_360_reply_keeps_directory_list_this_turn(monkeypatch):
    from app.agents.ticketing_coworker import _ground_customer_360_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_360_candidate"] = {
        "email": "shobana.isabel@gmail.com",
        "name": "Shobana",
        "customerId": "1038",
        "awaiting_consent": True,
    }
    called: list[str] = []

    def fake_360(*, email: str):
        called.append(email)
        return {
            "success": False,
            "error_code": "NO_ACTOR",
            "message": "Tool actor (user/org) is required",
        }

    monkeypatch.setattr("app.tools.catalog_tools.get_customer_360", fake_360)
    directory_html = (
        "Here is Shobana from the directory."
        '<table class="coworker-data-table"><tbody>'
        "<tr><td>Shobana</td><td>shobana.isabel@gmail.com</td></tr>"
        "</tbody></table>"
    )
    reply = _ground_customer_360_reply(
        directory_html,
        c360_payload=None,
        turn_tools_called=["list_customers"],
        memory=mem,
        harness_skill="customer-read-360",
        query="show shobana details",
        page="Customers",
    )
    assert reply is None
    assert called == []


def test_fetch_customer_360_payload_uses_memory_actor(monkeypatch):
    from app.agents.ticketing_coworker import _fetch_customer_360_payload
    from app.contracts import tool_ok
    from app.memory.session import SharedMemory
    from app.tools.express_client import get_tool_actor

    mem = SharedMemory(organization_id="org-1", user_id="u-9", session_id="s")
    seen: dict[str, str | None] = {}

    def fake_360(*, email: str):
        actor = get_tool_actor()
        seen["email"] = email
        seen["org"] = getattr(actor, "organization_id", None)
        seen["user"] = getattr(actor, "user_id", None)
        return tool_ok({"email": email, "totalTickets": 0, "tickets": []})

    monkeypatch.setattr("app.tools.catalog_tools.get_customer_360", fake_360)
    payload, err = _fetch_customer_360_payload(mem, "shobana.isabel@gmail.com")
    assert err is None
    assert payload
    assert payload["email"] == "shobana.isabel@gmail.com"
    assert seen["org"] == "org-1"
    assert seen["user"] == "u-9"


def test_ground_customer_list_reply_opens_single_match_profile(monkeypatch):
    from app.agents.ticketing_coworker import _ground_customer_list_reply
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: "Found Shobana:",
    )
    ui_actions: list[dict] = []
    reply = _ground_customer_list_reply(
        "Looking up Shobana.",
        list_payload={
            "data": [
                {
                    "id": "1038",
                    "name": "Shobana",
                    "email": "shobana.isabel@gmail.com",
                    "phone": "",
                    "totalTickets": 1,
                    "status": "Active",
                    "createdAt": "2026-09-08",
                }
            ],
            "totalRows": 1,
            "offset": 0,
            "limit": 12,
            "hasMore": False,
        },
        turn_tools_called=["list_customers"],
        memory=mem,
        harness_skill="customer-read-360",
        query="show shobana",
        page="Customers",
        ui_actions=ui_actions,
    )
    assert reply
    assert "shobana.isabel@gmail.com" in reply
    assert any(
        a.get("type") == "open_customer" and str(a.get("id")) == "1038"
        for a in ui_actions
    )
    assert any(
        a.get("type") == "navigate" and a.get("view") == "customers"
        for a in ui_actions
    )


def test_prefetch_customer_360_on_consent_calls_tool(monkeypatch):
    from app.agents.ticketing_coworker import _prefetch_customer_360_on_consent
    from app.contracts import tool_ok
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["customer_360_candidate"] = {
        "email": "a@example.com",
        "awaiting_consent": True,
    }
    calls: list[str] = []

    def fake_360(*, email: str):
        calls.append(email)
        return tool_ok({"email": email, "totalTickets": 0, "tickets": []})

    monkeypatch.setattr("app.tools.catalog_tools.get_customer_360", fake_360)
    turn_tools: list[str] = []
    payload, err = _prefetch_customer_360_on_consent(mem, turn_tools_called=turn_tools)
    assert calls == ["a@example.com"]
    assert "get_customer_360" in turn_tools
    assert payload
    assert payload["email"] == "a@example.com"
    assert err is None


def test_ground_export_analytics_reply_replaces_markdown(monkeypatch):
    from app.agents.ticketing_coworker import _ground_export_analytics_reply

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kwargs: (
            "Your **analytics export** for the last 24 hours is ready — "
            "the download should start automatically."
        ),
    )
    reply = _ground_export_analytics_reply(
        "[Download](/api/analytics/export?range=7days)",
        export_payload={"range": "24hours", "href": "/api/analytics/export?range=24hours"},
        query="okay",
        page="Analytics",
    )
    assert reply
    assert "/api/analytics/export" not in reply
    assert "24 hours" in reply.lower() or "download" in reply.lower()


def test_ground_export_analytics_reply_fallback_without_llm(monkeypatch):
    from app.agents.ticketing_coworker import _ground_export_analytics_reply

    def _boom(**kwargs):
        raise RuntimeError("phrase down")

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", _boom)
    reply = _ground_export_analytics_reply(
        "[Download](/api/analytics/export?range=7days)",
        export_payload={"range": "24hours", "href": "/api/analytics/export?range=24hours"},
        query="okay",
        page="Analytics",
    )
    assert reply
    assert "last 24 hours" in reply
    assert "/api/" not in reply


def test_append_export_analytics_download_ui_actions():
    from app.agents.ticketing_coworker import _append_export_analytics_download

    ui: list[dict] = []
    _append_export_analytics_download(
        {
            "success": True,
            "payload": {
                "href": "/api/analytics/export?range=24hours",
                "range": "24hours",
            },
        },
        ui,
    )
    assert {"type": "download", "href": "/api/analytics/export?range=24hours", "filename": "worktual-analytics-24hours.csv"} in ui
    assert {"type": "refresh_analytics"} in ui

    _append_export_analytics_download(
        {
            "success": True,
            "payload": {
                "href": "/api/analytics/export?range=24hours",
                "range": "24hours",
            },
        },
        ui,
    )
    assert sum(1 for a in ui if a.get("type") == "download") == 1


def test_export_analytics_range_alias_via_execute_tool_call(monkeypatch):
    import json

    from app.tools import bound as bound_mod

    monkeypatch.setattr(
        bound_mod,
        "validate_specialist_tool",
        lambda **kwargs: {"success": True},
    )
    raw = bound_mod.execute_tool_call(
        "analytics_audit_query_executor",
        "export_analytics",
        {"range": "24hours"},
        role="admin",
    )
    parsed = json.loads(raw)
    assert parsed.get("success") is True
    assert parsed["payload"]["href"] == "/api/analytics/export?range=24hours"
    assert parsed["payload"]["range"] == "24hours"


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
        "customerDirectoryStatus": "verified",
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
        "customerDirectoryStatus": "verified",
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


def test_hydrate_create_ticket_args_passes_verified_order_id():
    from app.agents.ticketing_coworker import _hydrate_create_ticket_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Anto",
        "customerEmail": "anto@gmail.com",
        "issue": "Order never arrived",
        "orderId": "ORD-55",
        "orderVerified": True,
        "productId": "P-12",
    }
    out = _hydrate_create_ticket_args(mem, {})
    assert out["orderId"] == "ORD-55"
    assert out["productId"] == "P-12"
    assert out["description"] == "Order never arrived"


def test_merge_order_lookup_awaits_product_when_items_exist():
    from app.agents.ticketing_coworker import _merge_order_lookup_into_ticket_draft
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "orderId": "ORD-55",
        "issue": "cracked lid",
        "needsOrderCheck": True,
    }
    _merge_order_lookup_into_ticket_draft(
        mem,
        {
            "success": True,
            "payload": {
                "exists": True,
                "orderId": "ORD-55",
                "items": [
                    {"productId": "P-1", "name": "Bottle", "quantity": 1},
                    {"productId": "P-2", "name": "Lid", "quantity": 1},
                ],
            },
        },
    )
    draft = mem.durable["ticket_draft"]
    assert draft.get("orderVerified") is True
    assert draft.get("orderItemCount") == 2
    assert draft.get("awaiting") == "productId"
    assert not str(draft.get("productId") or "").strip()


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
    assert mem.durable["team_draft"]["org_staff"] == [
        "Yaswanth MG",
        "Deva NS",
        "Raghuram M",
        "Mohammed Fazil",
    ]


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


def test_align_keeps_priority_update_when_listed_row_has_no_collected_id():
    """Hours answer after finding Critical must not remount create (MCP 403)."""
    from app.agents.ticketing_coworker import _align_mispinned_catalog_create
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.update"))
    mem.durable["priority_draft"] = {
        "displayName": "Critical",
        "awaiting": "hours",
        "step": "hours",
        "kind": "priority",
    }
    mem.durable["last_query"] = {
        "catalog_kind": "priority",
        "catalog_list_options": [
            {"id": "3469", "displayName": "Critical", "resolutionHours": 4},
        ],
    }
    mem.add_message("user", "update the resolution time of the priority critical")
    _align_mispinned_catalog_create(mem, "1 hour")
    state = mem.current_task_state()
    assert state is not None
    assert state.task_id == "priority.update"
    assert str(state.collected.get("priority_id") or "") == "3469"


def test_align_remounts_create_pin_to_update_for_listed_priority():
    """Create pin + listed Critical + hours → update so update_priority is allowed."""
    from app.agents.ticketing_coworker import _align_mispinned_catalog_update
    from app.memory.session import SharedMemory
    from app.skills.catalog import tools_for_skill
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    mem.durable["last_entity"] = {"type": "priority", "id": "3469", "name": "Critical"}
    mem.durable["last_query"] = {
        "catalog_kind": "priority",
        "catalog_list_options": [
            {"id": "3469", "displayName": "Critical", "resolutionHours": 4},
        ],
    }
    _align_mispinned_catalog_update(mem, "1 hour")
    state = mem.current_task_state()
    assert state is not None
    assert state.task_id == "priority.update"
    assert state.skill_name == "priority-update"
    assert str(state.collected.get("priority_id") or "") == "3469"
    allowed = tools_for_skill("priority-update", "priority_status_crud_executor")
    assert "update_priority" in allowed
    create_only = tools_for_skill("priority-create", "priority_status_crud_executor")
    assert "update_priority" not in create_only


def test_align_remounts_read_pin_to_delete_on_delete_confirm_draft():
    from app.agents.ticketing_coworker import _align_mispinned_catalog_delete
    from app.memory.session import SharedMemory
    from app.skills.catalog import tools_for_skill
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.read"))
    mem.durable["priority_draft"] = {
        "id": "2792",
        "awaiting": "delete_confirm",
        "kind": "priority",
    }
    _align_mispinned_catalog_delete(mem, "yeah")
    state = mem.current_task_state()
    assert state is not None
    assert state.task_id == "priority.delete"
    assert state.skill_name == "priority-delete"
    allowed = tools_for_skill("priority-delete", "priority_status_crud_executor")
    assert "delete_priority" in allowed
    read_only = tools_for_skill("priority-read", "priority_status_crud_executor")
    assert "delete_priority" not in read_only


def test_remount_catalog_delete_for_write_from_read_pin():
    from types import SimpleNamespace

    from app.agents.ticketing_coworker import _remount_catalog_delete_for_write
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.read"))
    actor = SimpleNamespace(
        organization_id="1",
        user_id="u",
        user_role="admin",
    )
    skill = _remount_catalog_delete_for_write(
        mem,
        tool_name="delete_priority",
        context={"module": "admin", "surface": "staff"},
        actor=actor,
        request=SimpleNamespace(),
    )
    assert skill == "priority-delete"
    assert mem.current_task_state().task_id == "priority.delete"


def test_align_does_not_remount_create_from_stale_last_entity():
    """A leftover focused priority must not steal a new create collect."""
    from app.agents.ticketing_coworker import _align_mispinned_catalog_update
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("priority.create"))
    mem.durable["last_entity"] = {"type": "priority", "id": "3469", "name": "Critical"}
    mem.durable["priority_draft"] = {
        "displayName": "P1",
        "awaiting": "hours",
        "kind": "priority",
    }
    mem.add_message("user", "create a new priority")
    mem.add_message("user", "P1")
    _align_mispinned_catalog_update(mem, "2")
    assert mem.current_task_state().task_id == "priority.create"


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


def test_patch_kb_title_followup_lists_available_categories(monkeypatch):
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        tc,
        "_fetch_kb_category_names",
        lambda: ["Accounts", "Billing", "General", "Troubleshooting"],
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_kb"
    mem.durable["kb_draft"] = {
        "awaiting": "title",
        "_intent_start_text": "create an article",
    }
    out = _execute_local_ui_tool(
        "patch_kb_draft",
        {"title": "Billing Actions"},
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True
    payload = out.get("payload") or {}
    assert payload.get("awaiting") == "category"
    message = str(payload.get("message") or "")
    for name in ("Accounts", "Billing", "General", "Troubleshooting"):
        assert name in message
    draft = payload.get("draft") or {}
    assert draft.get("available_categories") == [
        "Accounts",
        "Billing",
        "General",
        "Troubleshooting",
    ]


def test_phrase_kb_category_ask_gets_available_categories(monkeypatch):
    from app.agents import ticketing_coworker as tc

    captured: dict = {}

    def _fake_phrase(**kwargs):
        captured.update(kwargs)
        return "Pick a category from the list."

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", _fake_phrase)
    out = tc._phrase_guided_collect_ask(
        module="kb",
        awaiting="category",
        draft={
            "title": "Resolve Local Browser & Access Issues",
            "available_categories": ["Accounts", "Billing", "Troubleshooting"],
        },
        hint="ask category",
        fallback="What is the category?",
    )
    assert out == "Pick a category from the list."
    assert captured.get("kind") == "got_title"
    ctx = captured.get("context") or {}
    assert ctx.get("available_categories") == [
        "Accounts",
        "Billing",
        "Troubleshooting",
    ]
    assert "Billing" in str(ctx.get("categoryChoices") or "")


def test_absorb_kb_does_not_bind_category_or_body(monkeypatch):
    """Category and body are Executor patch_kb_draft only — not utterance absorb."""
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
    assert tc._absorb_guided_field_utterance(mem, body, "kb", ui) is False
    assert not (mem.durable.get("kb_draft") or {}).get("body")
    assert not (mem.durable.get("kb_draft") or {}).get("category")

    mem.durable["kb_draft"] = {
        "title": "Login KB",
        "body": "Clear cache then retry login.",
        "awaiting": "category",
        "available_categories": ["General", "Billing", "Accounts"],
    }
    assert tc._absorb_guided_field_utterance(mem, "Accounts", "kb", ui) is True
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("category") == "Accounts"


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


def test_patch_team_draft_accepts_remaining_roster_from_current_members():
    """Remove/replace patches remaining names that are already on the team."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.add_message("user", "remove uday")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1018",
        "name": "Billing & Invoicing",
        "flow": "add_team_members",
        "awaiting": "members_names",
        "current_members": ["Uday kumar G", "Ashika A"],
        "available_members": ["Sriannamalai R", "Mohamed Fazil"],
        "org_staff": [
            "Uday kumar G",
            "Ashika A",
            "Sriannamalai R",
            "Mohamed Fazil",
        ],
    }
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {
            "id": "1018",
            "members": ["Ashika A"],
            "add_members": False,
            "awaiting": "confirm",
        },
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True
    draft = mem.durable.get("team_draft") or {}
    assert draft.get("members") == ["Ashika A"]
    assert draft.get("add_members") is False
    assert draft.get("awaiting") == "confirm"


def test_team_members_update_skill_documents_remove_path():
    from pathlib import Path

    body = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "skills"
        / "team-members-update"
        / "SKILL.md"
    ).read_text(encoding="utf-8")
    assert "list_queues" in body
    assert "remaining roster" in body
    assert "add_members: false" in body or "add_members=false" in body


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

    team_mem = SharedMemory(organization_id="1", user_id="u", session_id="s-team")
    team_mem.durable["team_draft"] = {
        "name": "Campaign Team",
        "description": "Product developers take a product from concept to market.",
        "members": ["Uday kumar G", "Ashika A"],
        "awaiting": "members",
    }
    proceed = tc._apply_guided_write_confirmed_flag(
        team_mem,
        "create_queue",
        {
            "name": "Campaign Team",
            "description": "Product developers take a product from concept to market.",
            "members": ["Uday kumar G", "Ashika A"],
            "confirmed": True,
        },
        field_bound_this_turn=False,
        awaiting_confirm_at_turn_start=False,
    )
    assert proceed.get("confirmed") is True
    too_early = tc._apply_guided_write_confirmed_flag(
        team_mem,
        "create_queue",
        {
            "name": "Campaign Team",
            "description": "Product developers take a product from concept to market.",
            "members": ["Uday kumar G", "Ashika A"],
            "confirmed": True,
        },
        field_bound_this_turn=True,
        awaiting_confirm_at_turn_start=False,
    )
    assert too_early.get("confirmed") is not True

    kb_mem = SharedMemory(organization_id="1", user_id="u", session_id="s-kb")
    kb_mem.durable["kb_draft"] = {
        "title": "Resolve Local Browser Issues",
        "category": "General",
        "body": "Have the user open a private window and clear cached data.",
        "publication_intent": "draft",
        "awaiting": "publication_intent",
    }
    kb_write = tc._apply_guided_write_confirmed_flag(
        kb_mem,
        "draft_kb_article",
        {
            "title": "Resolve Local Browser Issues",
            "content": "Have the user open a private window and clear cached data.",
            "category": "General",
            "confirmed": True,
        },
        field_bound_this_turn=True,
        awaiting_confirm_at_turn_start=False,
    )
    assert kb_write.get("confirmed") is True
    kb_incomplete_draft = dict(kb_mem.durable["kb_draft"])
    kb_incomplete_draft.pop("publication_intent", None)
    kb_mem.durable["kb_draft"] = kb_incomplete_draft
    kb_incomplete = tc._apply_guided_write_confirmed_flag(
        kb_mem,
        "draft_kb_article",
        {"title": "Resolve Local Browser Issues", "confirmed": True},
        field_bound_this_turn=True,
        awaiting_confirm_at_turn_start=False,
    )
    assert kb_incomplete.get("confirmed") is not True


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


def test_stamp_awaiting_confirm_after_reopen_proceed_ask():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.request_id = "reopen-ask"
    mem.set_task_state(new_harness_task_state("ticket.resolve.reopen"))
    mem.durable["last_entity"] = {
        "type": "ticket",
        "id": "#100",
        "ticketNumber": "#100",
        "status": "Resolved",
    }
    tc._stamp_awaiting_confirm_after_unwritten_update(
        mem, "ticket-resolve-reopen", turn_successful_writes=[]
    )
    assert mem.durable.get("pending_ask") == "confirm"
    state = mem.current_task_state()
    assert state is not None
    assert state.status == "awaiting_confirmation"
    last = mem.durable.get("last_tool_outcome")
    assert last["tool"] == "update_ticket"
    assert last["error_code"] == "CONFIRMATION_REQUIRED"
    assert last["arguments"]["ticket_number"] == "#100"
    assert tc._pending_confirm_write_tool(mem) == "update_ticket"


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
    monkeypatch.setattr(
        tc,
        "_revalidate_live_pin_should_continue",
        lambda **kwargs: False,
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


def test_kb_create_category_turn_hint_patches_when_name_given():
    from app.agents.ticketing_coworker import _kb_create_category_turn_hint

    pick = _kb_create_category_turn_hint("Troubleshooting", ["Billing", "General", "Troubleshooting"])
    assert "patch_kb_draft" in pick
    assert "Do not call list_kb_categories again" in pick
    ask = _kb_create_category_turn_hint("create a article", ["Billing", "General"])
    assert "list_kb_categories" in ask
    assert "patch_kb_draft" not in ask


def test_super_live_pin_route_keeps_kb_title_replacement(monkeypatch):
    """Replacement title after 'change this name' stays on the live create pin."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("knowledge.article.create"))
    mem.durable["kb_draft"] = {
        "title": "Old Name",
        "category": "General",
        "awaiting": "title",
        "_intent_start_text": "create article",
    }
    mem.durable["current_workflow"] = "create_kb"
    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {
            "mode": "route",
            "args": {
                "domain_id": "catalog_administration_domain",
                "query": "Network Issue",
            },
        },
    )
    monkeypatch.setattr(
        tc,
        "_revalidate_live_pin_should_continue",
        lambda **kwargs: False,
    )
    seen: dict = {}

    def fake_exec(**kwargs):
        seen["kept"] = True
        state = kwargs["memory"].current_task_state()
        assert state is not None
        assert state.task_id == "knowledge.article.create"
        return {
            "response_type": "final",
            "assistant_text": "kept",
            "agent": "kb_quality_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_exec)
    req = RunRequest(
        message="Network Issue",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="kb",
        surface="staff",
        page="Knowledge Base",
    )
    result = tc._run_harness_supervisor(
        llm=object(),
        memory=mem,
        query="Network Issue",
        context={"request": req, "module": "kb", "surface": "staff"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert seen.get("kept") is True
    assert result.get("assistant_text") == "kept"
    assert mem.current_task_state() is not None
    assert mem.current_task_state().task_id == "knowledge.article.create"
    assert (mem.durable.get("kb_draft") or {}).get("awaiting") == "title"


def test_super_route_from_deflection_pin_is_not_overridden(monkeypatch):
    """Self-service pin has no guided collect slot — honor Super route."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("intake.self.service.deflection"))
    mem.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "kb_resolution",
        "pending_kb": {"articles": [{"id": "a1", "title": "VPN"}]},
        "issue": "VPN will not connect",
    }
    hops: list[str] = []
    orig = tc._run_harness_supervisor

    def wrapper(**kwargs):
        state = kwargs["memory"].current_task_state()
        hops.append(state.task_id if state else "")
        if len(hops) > 1:
            assert kwargs["memory"].current_task_state() is None
            assert kwargs["memory"].durable.get("_portal_create_after_self_service") is True
            return {
                "response_type": "final",
                "assistant_text": "routed-create",
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
                "domain_id": "intake_deflection_domain",
                "query": "please file a ticket",
            },
        },
    )
    monkeypatch.setattr(
        tc,
        "_revalidate_live_pin_should_continue",
        lambda **kwargs: True,
    )
    req = RunRequest(
        message="please file a ticket",
        session_id="s",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
        page="Support portal",
    )
    result = wrapper(
        llm=object(),
        memory=mem,
        query="please file a ticket",
        context={"request": req, "module": "portal", "surface": "home"},
        actor=ToolActor(
            user_id="u",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert len(hops) == 2
    assert result.get("assistant_text") == "routed-create"
    assert mem.current_task_state() is None


def test_enquiry_does_not_typed_fit_create_issue_slot():
    """Free-text issue is Super intent — schema must not treat enquiry as a field."""
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["ticket_draft"] = {"awaiting": "issue"}
    state = mem.current_task_state()
    query = "i want to track my order"
    assert tc._utterance_fits_live_pin_slot(mem, query, state) is True
    assert (
        tc._utterance_fits_live_pin_slot(mem, query, state, typed_only=True) is False
    )


def test_super_route_off_create_pin_honors_enquiry(monkeypatch):
    """Super NEW_TASK off ticket-create is not overridden by issue-slot bind."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["ticket_draft"] = {"awaiting": "issue", "surface": "portal"}
    hops: list[int] = []
    orig = tc._run_harness_supervisor

    def wrapper(**kwargs):
        hops.append(1)
        if len(hops) > 1:
            assert kwargs["memory"].current_task_state() is None
            return {
                "response_type": "final",
                "assistant_text": "routed-deflection",
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
                "domain_id": "intake_deflection_domain",
                "query": "i want to track my order",
            },
        },
    )
    req = RunRequest(
        message="i want to track my order",
        session_id="s",
        actor=ActorContext(
            user_id="u",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
        page="Support portal",
    )
    result = wrapper(
        llm=object(),
        memory=mem,
        query="i want to track my order",
        context={"request": req, "module": "portal", "surface": "home"},
        actor=ToolActor(
            user_id="u",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert len(hops) == 2
    assert result.get("assistant_text") == "routed-deflection"
    assert mem.current_task_state() is None


def test_portal_create_must_deflect_first_helper():
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    req = RunRequest(
        message="cannot hear the agent",
        session_id="s",
        actor=ActorContext(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
    )
    actor = ToolActor(
        user_id="c1",
        organization_id="1",
        user_role="portal_customer",
        portal_customer_id="c1",
    )
    ctx = {"request": req, "module": "portal", "surface": "home"}
    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["ticket_draft"] = {"awaiting": "issue", "surface": "portal"}
    assert tc._portal_create_must_deflect_first(
        mem, actor=actor, context=ctx, active=mem.current_task_state()
    )
    mem.durable["_portal_create_after_self_service"] = True
    assert (
        tc._portal_create_must_deflect_first(
            mem, actor=actor, context=ctx, active=mem.current_task_state()
        )
        is False
    )
    mem.durable.pop("_portal_create_after_self_service")
    mem.durable["ticket_draft"]["awaiting"] = "confirm"
    assert (
        tc._portal_create_must_deflect_first(
            mem, actor=actor, context=ctx, active=mem.current_task_state()
        )
        is False
    )
    staff_mem = SharedMemory(organization_id="1", user_id="u", session_id="staff")
    staff_mem.set_task_state(new_harness_task_state("ticket.create"))
    staff_mem.durable["ticket_draft"] = {"awaiting": "issue"}
    staff_req = RunRequest(
        message="file a ticket",
        session_id="staff",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
        surface="staff",
    )
    assert (
        tc._portal_create_must_deflect_first(
            staff_mem,
            actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
            context={"request": staff_req, "module": "tickets", "surface": "staff"},
            active=staff_mem.current_task_state(),
        )
        is False
    )


def test_portal_leftover_create_does_not_hydrate_before_kb(monkeypatch):
    """Leftover portal ticket_draft must not remount create before search_kb."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "surface": "portal",
        "customerId": "c1",
        "customerName": "Ada",
    }
    pin_seen: list[str] = []

    def fake_pin(**kwargs):
        pin_seen.append(str(getattr(kwargs.get("active"), "task_id", "") or ""))
        return {"mode": "continue"}

    monkeypatch.setattr(tc, "_super_live_pin_decision", fake_pin)

    class _RouteLLM:
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
                                "executor_id": "ai_resolution_executor",
                                "task_id": "intake.self.service.deflection",
                                "skill_name": "intake-self-service-deflection",
                                "objective": "Search KB for this problem",
                            },
                        }
                    ],
                }
            return {
                "content": "",
                "tool_calls": [
                    {
                        "name": "route_to_domain",
                        "arguments": {
                            "domain_id": "intake_deflection_domain",
                            "query": "cannot hear the agent",
                        },
                    }
                ],
            }

    seen: dict = {}

    def fake_exec(**kwargs):
        seen["task"] = kwargs["instruction"].task_id
        seen["skill"] = kwargs["instruction"].skill_name
        seen["executor"] = kwargs["instruction"].executor_id
        return {
            "response_type": "final",
            "assistant_text": "Try these steps from the article.",
            "agent": "ai_resolution_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_exec)
    req = RunRequest(
        message="cannot hear the agent",
        session_id="s",
        actor=ActorContext(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
        page="Support portal",
    )
    result = tc._run_harness_supervisor(
        llm=_RouteLLM(),
        memory=mem,
        query="cannot hear the agent",
        context={"request": req, "module": "portal", "surface": "home"},
        actor=ToolActor(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert pin_seen == []
    assert seen.get("skill") == "intake-self-service-deflection"
    assert seen.get("executor") == "ai_resolution_executor"
    assert seen.get("task") == "intake.self.service.deflection"
    assert result.get("agent") == "ai_resolution_executor"


def test_super_continue_portal_create_without_kb_parks_for_deflection(monkeypatch):
    """Super CONTINUE on leftover portal create still parks so Domain can search_kb."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["ticket_draft"] = {"awaiting": "issue", "surface": "portal"}
    hops: list[str] = []
    exec_called: list[str] = []
    orig = tc._run_harness_supervisor

    def wrapper(**kwargs):
        state = kwargs["memory"].current_task_state()
        hops.append(state.task_id if state else "")
        if len(hops) > 1:
            assert kwargs["memory"].current_task_state() is None
            return {
                "response_type": "final",
                "assistant_text": "routed-deflection",
                "agent": "ticketing_super_agent",
            }
        return orig(**kwargs)

    monkeypatch.setattr(tc, "_run_harness_supervisor", wrapper)
    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {"mode": "continue"},
    )

    def fake_exec(**kwargs):
        exec_called.append(kwargs["instruction"].task_id)
        return {
            "response_type": "final",
            "assistant_text": "what is the issue",
            "agent": "ticket_creation_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_exec)
    req = RunRequest(
        message="cannot hear the agent in CCASS",
        session_id="s",
        actor=ActorContext(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
        page="Support portal",
    )
    result = wrapper(
        llm=object(),
        memory=mem,
        query="cannot hear the agent in CCASS",
        context={"request": req, "module": "portal", "surface": "home"},
        actor=ToolActor(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert hops == ["ticket.create", ""]
    assert exec_called == []
    assert result.get("assistant_text") == "routed-deflection"
    assert mem.current_task_state() is None


def test_super_continue_portal_create_after_self_service_keeps_executor(monkeypatch):
    """After search_kb / file-after-self-service, leftover create may collect."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["ticket_draft"] = {"awaiting": "issue", "surface": "portal"}
    mem.durable["_portal_create_after_self_service"] = True
    seen: dict = {}

    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {"mode": "continue"},
    )

    def fake_exec(**kwargs):
        seen["task"] = kwargs["instruction"].task_id
        seen["skill"] = kwargs["instruction"].skill_name
        return {
            "response_type": "final",
            "assistant_text": "what should I write up",
            "agent": "ticket_creation_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_exec)
    req = RunRequest(
        message="the agent audio is silent on every call",
        session_id="s",
        actor=ActorContext(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
        page="Support portal",
    )
    result = tc._run_harness_supervisor(
        llm=object(),
        memory=mem,
        query="the agent audio is silent on every call",
        context={"request": req, "module": "portal", "surface": "home"},
        actor=ToolActor(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert seen.get("task") == "ticket.create"
    assert result.get("agent") == "ticket_creation_executor"
    assert mem.current_task_state() is not None
    assert mem.current_task_state().task_id == "ticket.create"


def test_portal_create_after_self_service_still_hydrates(monkeypatch):
    """Empty or finished search_kb then file — leftover create may remount."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["_portal_create_after_self_service"] = True
    mem.durable["ticket_draft"] = {
        "awaiting": "issue",
        "surface": "portal",
        "customerId": "c1",
        "customerName": "Ada",
    }
    pin_seen: list[str] = []

    def fake_pin(**kwargs):
        pin_seen.append(str(getattr(kwargs.get("active"), "task_id", "") or ""))
        return {"mode": "continue"}

    monkeypatch.setattr(tc, "_super_live_pin_decision", fake_pin)
    seen: dict = {}

    def fake_exec(**kwargs):
        seen["task"] = kwargs["instruction"].task_id
        return {
            "response_type": "final",
            "assistant_text": "what should I write up",
            "agent": "ticket_creation_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_exec)
    req = RunRequest(
        message="please file a ticket",
        session_id="s",
        actor=ActorContext(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
        page="Support portal",
    )
    result = tc._run_harness_supervisor(
        llm=object(),
        memory=mem,
        query="please file a ticket",
        context={"request": req, "module": "portal", "surface": "home"},
        actor=ToolActor(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert pin_seen == ["ticket.create"]
    assert seen.get("task") == "ticket.create"
    assert result.get("agent") == "ticket_creation_executor"


def test_staff_create_pin_continue_unchanged(monkeypatch):
    """Staff file-a-ticket collect stays on ticket.create."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["ticket_draft"] = {"awaiting": "issue"}
    seen: dict = {}
    monkeypatch.setattr(
        tc,
        "_super_live_pin_decision",
        lambda **kwargs: {"mode": "continue"},
    )

    def fake_exec(**kwargs):
        seen["task"] = kwargs["instruction"].task_id
        return {
            "response_type": "final",
            "assistant_text": "what is the issue",
            "agent": "ticket_creation_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_exec)
    req = RunRequest(
        message="wifi will not connect",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
        surface="staff",
        page="Create Ticket",
    )
    result = tc._run_harness_supervisor(
        llm=object(),
        memory=mem,
        query="wifi will not connect",
        context={"request": req, "module": "tickets", "surface": "staff"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert seen.get("task") == "ticket.create"
    assert result.get("agent") == "ticket_creation_executor"


def test_patch_stamp_only_keeps_portal_confirm_ready():
    """Stamp-only patch must not drop issueReady or reopen issue."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "confirm",
        "customerName": "Ada",
        "customerEmail": "ada@example.com",
        "contact": "ada@example.com",
        "customerId": "c1",
        "customerDirectoryStatus": "verified",
        "issue": "Cannot hear the agent during CCaaS calls after headset checks.",
        "issueReady": True,
    }
    mem.add_message("user", "yes")
    out = _execute_local_ui_tool(
        "patch_ticket_draft",
        {"precreate_duplicate_check": "not_duplicate"},
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("issueReady") is True
    assert draft.get("precreate_duplicate_check") == "not_duplicate"
    assert draft.get("awaiting") == "confirm"
    assert out.get("payload", {}).get("missing") == []


def test_patch_issue_and_stamps_together_keeps_both():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.set_task_state(new_harness_task_state("ticket.create"))
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "issue",
        "customerName": "Ada",
        "customerEmail": "ada@example.com",
        "contact": "ada@example.com",
        "customerId": "c1",
        "customerDirectoryStatus": "verified",
    }
    out = _execute_local_ui_tool(
        "patch_ticket_draft",
        {
            "issue": (
                "Order BXUK-2026-010056 (paid, unfulfilled) has not been received. "
                "Placed on Sep 19, 2026 and still hasn't arrived."
            ),
            "issueReady": True,
            "precreate_duplicate_check": "not_duplicate",
        },
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("issue", "").startswith("Order BXUK-2026-010056")
    assert draft.get("issueReady") is True
    assert draft.get("precreate_duplicate_check") == "not_duplicate"
    assert draft.get("awaiting") == "confirm"


def test_sync_ticket_draft_does_not_reopen_confirm_issue():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.set_task_state(
        new_harness_task_state(
            "ticket.create",
            collected={
                "customerName": "Ada",
                "issue": "Cannot hear the agent during CCaaS calls after headset checks.",
            },
        )
    )
    mem.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "confirm",
        "customerName": "Ada",
        "customerEmail": "ada@example.com",
        "contact": "ada@example.com",
        "customerId": "c1",
        "customerDirectoryStatus": "verified",
        "issue": "Cannot hear the agent during CCaaS calls after headset checks.",
        "issueReady": True,
        "precreate_duplicate_check": "not_duplicate",
    }
    tc._sync_guided_draft_from_task(mem, "ticket.create")
    draft = mem.durable.get("ticket_draft") or {}
    assert draft.get("issueReady") is True
    assert draft.get("awaiting") == "confirm"
    assert draft.get("precreate_duplicate_check") == "not_duplicate"


def test_should_commit_portal_create_after_self_service_never_auto_files():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "confirm",
        "customerName": "Ada",
        "customerId": "c1",
        "customerDirectoryStatus": "verified",
        "issue": "Red lines on the analytics dashboard",
        "precreate_duplicate_check": "not_duplicate",
    }
    mem.durable["_portal_create_after_self_service"] = True
    assert (
        tc._should_commit_portal_create_after_self_service(mem, already_wrote=False)
        is False
    )
    assert (
        tc._should_commit_portal_create_after_self_service(mem, already_wrote=True)
        is False
    )
    mem.durable.pop("_portal_create_after_self_service")
    assert (
        tc._should_commit_portal_create_after_self_service(mem, already_wrote=False)
        is False
    )
    assert "<p>" in tc._CHAT_REPLY_STYLE_BLOCK
    assert "<ul><li>" in tc._CHAT_REPLY_STYLE_BLOCK
    assert "valid HTML" in tc._CHAT_REPLY_STYLE_BLOCK
    assert "Never markdown" in tc._CHAT_REPLY_STYLE_BLOCK
    assert "no **bold**" in tc._CHAT_REPLY_STYLE_BLOCK
    assert "still not working" not in tc._SUPER_DOMAIN_OWNERSHIP
    assert "An unsolved walk is still deflection" in tc._SUPER_DOMAIN_OWNERSHIP


def test_kb_publication_intent_ask_is_everyday_words():
    from app.agents.ticketing_coworker import (
        _awaiting_ask_label,
        _guided_collect_ask_fallback,
        _patch_followup_message,
    )

    assert "publication_intent" not in _awaiting_ask_label("publication_intent")
    ask = _guided_collect_ask_fallback("publication_intent", {})
    assert "publication_intent" not in ask.lower()
    assert "staff" in ask.lower() or "publish" in ask.lower()
    hint = _patch_followup_message("publication_intent", {})
    assert "publication_intent" in hint
    assert "everyday" in hint.lower()


def test_sync_kb_draft_keeps_title_correction_slot():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(
        new_harness_task_state(
            "knowledge.article.create",
            collected={"title": "Old Name", "category": "General"},
        )
    )
    mem.durable["kb_draft"] = {
        "title": "Old Name",
        "category": "General",
        "awaiting": "title",
        "_intent_start_text": "create article",
    }
    tc._sync_guided_draft_from_task(mem, "knowledge.article.create")
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("title") == "Old Name"
    assert draft.get("category") == "General"
    assert draft.get("awaiting") == "title"


def test_absorb_kb_replacement_title_keeps_category():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["kb_draft"] = {
        "title": "Old Name",
        "category": "General",
        "awaiting": "title",
        "_intent_start_text": "create article",
        "available_categories": ["General", "Billing"],
    }
    mem.durable["current_workflow"] = "create_kb"
    ui: list[dict] = []
    assert tc._absorb_guided_field_utterance(mem, "Network Issue", "kb", ui) is True
    draft = mem.durable.get("kb_draft") or {}
    assert draft.get("title") == "Network Issue"
    assert draft.get("category") == "General"
    assert not str(draft.get("body") or "").strip()
    assert draft.get("awaiting") == "body"


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


def test_empty_domain_bounces_to_super_instead_of_502(monkeypatch):
    """Catalog has no notes Skill; empty Domain must not 502 the staff chat."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _EmptyDomainLLM:
        def run(self, messages, tools=None, **kwargs):
            names = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = (
                    tool.get("function")
                    if isinstance(tool.get("function"), dict)
                    else {}
                )
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            if "delegate_to_executor" in names:
                return {"content": "", "tool_calls": []}
            return {
                "content": "",
                "tool_calls": [
                    {
                        "name": "route_to_domain",
                        "arguments": {
                            "domain_id": "catalog_administration_domain",
                            "query": "create a notes",
                        },
                    }
                ],
            }

    seen: dict = {}

    def bounce(**kwargs):
        seen["domain_id"] = kwargs["domain_id"]
        seen["query"] = (kwargs.get("bounce_args") or {}).get("query")
        return {
            "response_type": "final",
            "assistant_text": "Which ticket should I add a note to?",
            "agent": "ticket_lifecycle_executor",
        }

    monkeypatch.setattr(tc, "_rerun_super_after_domain_return", bounce)
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    req = RunRequest(
        message="create a notes",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="tickets",
        surface="staff",
    )
    result = tc._run_harness_supervisor(
        llm=_EmptyDomainLLM(),
        memory=mem,
        query="create a notes",
        context={"request": req, "module": "tickets", "surface": "staff"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert result.get("agent") == "ticket_lifecycle_executor"
    assert seen["domain_id"] == "catalog_administration_domain"
    assert seen["query"] == "create a notes"
    assert "note" in str(result.get("assistant_text") or "").lower()


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


def test_route_to_domain_tool_omits_bounced_domain():
    from app.mcp.catalog import route_to_domain_tool

    tool = route_to_domain_tool(
        exclude_domains=frozenset({"resolution_lifecycle_domain"})
    )
    enum = tool.input_schema["properties"]["domain_id"]["enum"]
    assert "resolution_lifecycle_domain" not in enum
    assert "intake_deflection_domain" in enum


def test_super_route_tool_follows_avoid_durable():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["_super_avoid_domain"] = "resolution_lifecycle_domain"
    schema = tc._super_route_to_domain_tool(mem)
    enum = schema["function"]["parameters"]["properties"]["domain_id"]["enum"]
    assert "resolution_lifecycle_domain" not in enum
    assert "intake_deflection_domain" in enum


def test_trusted_focus_route_skips_super_for_open_ticket_detail():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "ticket",
        "id": "#97",
        "name": "Lola chatbot message latency",
        "status": "Resolved",
    }
    ctx = {
        "request": type("R", (), {"module": "tickets", "page": None})(),
        "module": "tickets",
    }
    assert tc._trusted_focus_route_args(mem, ctx, "reopen this ticket") is None
    assert tc._trusted_focus_route_args(mem, ctx, "create a ticket") is None
    assert tc._trusted_focus_route_args(mem, {}, "hi") is None
    recovered = tc._recover_super_new_task_route(
        memory=mem,
        query="create a ticket",
        context=ctx,
        route_result={"content": "", "tool_calls": []},
    )
    assert recovered is None


def test_trusted_focus_routes_short_followup_after_last_tool():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "team",
        "id": "1018",
        "name": "MCP team",
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "update_queue",
        "success": True,
        "payload": {"id": "1018", "queueName": "MCP team"},
    }
    assert tc._trusted_focus_route_args(mem, {}, "yes") is None
    assert tc._trusted_focus_route_args(mem, {}, "hi") is None


def test_super_prose_after_team_write_routes_from_last_entity(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _ProseLLM:
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
                                "objective": "Continue the focused team member update",
                            },
                        }
                    ],
                }
            return {
                "content": (
                    "I'm sorry, I'm not sure what you'd like me to do next. "
                    "Could you please clarify how I can help you?"
                ),
                "tool_calls": [],
            }

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "team",
        "id": "1018",
        "name": "MCP team",
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "update_queue",
        "success": False,
        "error_code": "ROSTER_NOT_APPLIED",
        "message": "Current members: Ashika A, Sriannamalai R, Mohamed Fazil",
    }
    monkeypatch.setattr(tc, "_trusted_focus_route_args", lambda *a, **k: None)
    seen: dict = {}

    def fake_executor(**kwargs):
        seen["instruction"] = kwargs["instruction"]
        seen["query"] = kwargs["query"]
        return {
            "response_type": "final",
            "assistant_text": "Retrying the MCP team member update.",
            "agent": "team_queue_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_executor)
    req = RunRequest(
        message="yes",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="teams",
        surface="staff",
        page="agent-queues",
    )
    result = tc._run_harness_supervisor(
        llm=_ProseLLM(),
        memory=mem,
        query="yes",
        context={
            "request": req,
            "module": "teams",
            "surface": "staff",
            "page": "agent-queues",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert result.get("agent") == "team_queue_crud_executor"
    assert seen["instruction"].skill_name == "team-members-update"
    assert seen["query"] == "yes"
    assert "not sure" not in str(result.get("assistant_text") or "").lower()


def test_super_greeting_without_last_tool_stays_on_super(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _HiLLM:
        def run(self, messages, tools=None, **kwargs):
            return {"content": "Hello. How can I help?", "tool_calls": []}

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "team",
        "id": "1018",
        "name": "MCP team",
    }
    monkeypatch.setattr(tc, "_trusted_focus_route_args", lambda *a, **k: None)
    req = RunRequest(
        message="hi",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="teams",
        surface="staff",
        page="agent-queues",
    )
    result = tc._run_harness_supervisor(
        llm=_HiLLM(),
        memory=mem,
        query="hi",
        context={
            "request": req,
            "module": "teams",
            "surface": "staff",
            "page": "agent-queues",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert result.get("agent") == "ticketing_super_agent"
    assert "Hello" in str(result.get("assistant_text") or "")


def test_super_greeting_prompt_includes_freshness(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    captured: list[str] = []

    class _HiLLM:
        def run(self, messages, tools=None, **kwargs):
            captured.append(str((messages or [{}])[0].get("content") or ""))
            return {"content": "Good morning. What should we start with?", "tool_calls": []}

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.add_message("assistant", "<p>Hey! Good to see you. What can I help you with today?</p>")
    monkeypatch.setattr(tc, "_trusted_focus_route_args", lambda *a, **k: None)
    req = RunRequest(
        message="hi",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="home",
        surface="staff",
        page="home",
    )
    result = tc._run_harness_supervisor(
        llm=_HiLLM(),
        memory=mem,
        query="hi",
        context={
            "request": req,
            "module": "home",
            "surface": "staff",
            "page": "home",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert result.get("agent") == "ticketing_super_agent"
    assert captured
    assert "Reply freshness" in captured[0]
    assert "Last assistant reply (do not copy)" in captured[0]
    assert "Hey! Good to see you" in captured[0]


def test_super_greeting_retries_when_last_assistant_repeated(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _RepeatThenVaryLLM:
        def __init__(self) -> None:
            self.n = 0

        def run(self, messages, tools=None, **kwargs):
            self.n += 1
            if self.n == 1:
                return {
                    "content": "<p>Hey! Good to see you. What can I help you with today?</p>",
                    "tool_calls": [],
                }
            return {
                "content": "<p>Glad you are here. What should we work on first?</p>",
                "tool_calls": [],
            }

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.add_message(
        "assistant",
        "<p>Hey! Good to see you. What can I help you with today?</p>",
    )
    monkeypatch.setattr(tc, "_trusted_focus_route_args", lambda *a, **k: None)
    llm = _RepeatThenVaryLLM()
    req = RunRequest(
        message="hi",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="home",
        surface="staff",
        page="home",
    )
    result = tc._run_harness_supervisor(
        llm=llm,
        memory=mem,
        query="hi",
        context={
            "request": req,
            "module": "home",
            "surface": "staff",
            "page": "home",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert llm.n >= 2
    assert "Glad you are here" in str(result.get("assistant_text") or "")


def test_super_live_pin_prose_continues_collect():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory
    from app.workflow_schemas import new_harness_task_state

    class _ProseLLM:
        def run(self, messages, tools=None, **kwargs):
            return {
                "content": "I'm not sure what you'd like me to do next.",
                "tool_calls": [],
            }

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    active = new_harness_task_state("team.members.update")
    mem.set_task_state(active)
    decision = tc._super_live_pin_decision(
        llm=_ProseLLM(),
        memory=mem,
        query="yes",
        active=active,
        role="admin",
    )
    assert decision == {"mode": "continue"}


def test_pending_confirm_tool_from_awaiting_task_state():
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ConfirmationEvidence, TaskState
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.set_task_state(
        TaskState(
            task_id="ticket.resolve.reopen",
            task_version="1.0.0",
            skill_name="ticket-resolve-reopen",
            skill_version="1.0.0",
            domain="resolution_lifecycle_domain",
            executor="ticket_lifecycle_executor",
            status="awaiting_confirmation",
            confirmation=ConfirmationEvidence(
                confirmation_id="c1",
                task_version="1.0.0",
                skill_version="1.0.0",
                argument_hash="abc",
            ),
        )
    )
    mem.durable["last_tool_outcome"] = {
        "tool": "update_ticket",
        "error_code": "CONFIRMATION_REQUIRED",
        "kind": "needs_confirm",
        "arguments": {"ticket_number": "#97", "status": "Reopened"},
    }
    assert tc._pending_confirm_write_tool(mem) == "update_ticket"


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
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False

    mem.durable["ticket_draft"]["precreate_duplicate_check"] = "not_duplicate"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is True

    mem.durable["ticket_draft"]["customerDirectoryStatus"] = "missing"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False

    mem.durable["ticket_draft"]["customerDirectoryStatus"] = "verified"
    mem.durable["ticket_draft"]["awaiting"] = "issue"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False

    mem.durable["current_workflow"] = "create_priority"
    mem.durable["ticket_draft"]["awaiting"] = "confirm"
    assert tc._ticket_create_issue_absorbed_ready_to_confirm(mem) is False


def test_prefetch_precreate_customer_tickets_slims_rows(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Ashika",
        "customerEmail": "ashika2701@gmail.com",
        "customerId": "1019",
        "customerDirectoryStatus": "verified",
        "issue": "the crm data got vanished",
    }

    def fake_list(**kwargs):
        assert kwargs.get("customer") == "ashika2701@gmail.com"
        assert kwargs.get("scope") == "search"
        return {
            "success": True,
            "payload": {
                "data": [
                    {
                        "id": "#91",
                        "subject": "The customer data vanished",
                        "status": "Resolved",
                        "customerName": "Ashika",
                        "orderId": "ORD-9",
                    }
                ],
                "totalRows": 1,
            },
        }

    monkeypatch.setattr("app.tools.ticket_read.list_tickets", fake_list)
    out = tc._prefetch_precreate_customer_tickets(mem)
    assert out is not None
    assert out["tickets"][0]["id"] == "#91"
    assert out["tickets"][0]["orderId"] == "ORD-9"
    assert out["draftIssue"] == "the crm data got vanished"
    assert (mem.durable.get("ticket_draft") or {}).get(
        "_precreate_duplicate_evidence"
    ) == {
        "customer": "ashika2701@gmail.com",
        "issue": "the crm data got vanished",
    }


def test_executor_requires_patch_to_store_ticket_issue():
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
    issue = "invalid credentials even though she had an account"
    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "p1",
                        "name": "patch_ticket_draft",
                        "arguments": {"issue": issue},
                    }
                ],
            },
            {
                "content": "Review Ashika's invalid-credentials issue and tell me to save it.",
                "tool_calls": [],
            },
        ]
    )

    req = RunRequest(
        message=issue,
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
        llm=fake,
        memory=mem,
        query=issue,
        context={
            "request": req,
            "module": "tickets",
            "surface": "staff",
            "page": "Create Ticket",
        },
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets(max_rounds=4)),
    )
    assert out.get("response_type") == "final"
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
    assert payload.get("cannot_create") is True
    assert payload.get("suggested_action") != "offer_add_customer"
    msg = str(payload.get("message") or "").lower()
    assert "cannot add" in msg or "cannot file" in msg or "no cdp" in msg
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


def test_patch_ticket_ungrounded_contact_asks_clarify_not_verify(monkeypatch):
    from app.agents.ticketing_coworker import _execute_local_ui_tool

    monkeypatch.setattr(
        "app.tasks.chat_commands._bind_directory_customer",
        lambda data, org, **kwargs: (dict(data), "none", []),
    )
    mem = SharedMemory(organization_id="org-1", user_id="u", session_id="s")
    mem.add_message("user", "unable to view order details in account")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "awaiting": "contact",
        "customerName": "Priya Moorthy",
    }
    out = _execute_local_ui_tool(
        "patch_ticket_draft",
        {
            "customerName": "Priya Moorthy",
            "customerEmail": "priyamoorthy0725@gmail.com",
        },
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True
    payload = out.get("payload") if isinstance(out.get("payload"), dict) else {}
    assert payload.get("updated_fields") == []
    assert payload.get("next_action") == "clarify_or_park"
    assert payload.get("next_tool") != "verify_ticket_customer"
    assert "did not fill the open slot" in str(payload.get("message") or "")
    draft = mem.durable.get("ticket_draft") or {}
    assert not str(draft.get("customerEmail") or "").strip()
    assert str(draft.get("awaiting") or "") == "contact"


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
    assert mem.durable["team_draft"].get("awaiting") == "description"
    assert any(a.get("type") == "create_team" and a.get("name") == "Night Shift" for a in ui)
    # Correction sentences are not stored as description.
    assert tc._absorb_guided_field_utterance(mem, "change the team name", "teams", ui) is False
    assert mem.durable["team_draft"].get("description") in (None, "")
    assert tc._absorb_guided_field_utterance(
        mem, "Handles after-hours tickets", "teams", ui
    ) is True
    assert mem.durable["team_draft"].get("description") == "Handles after-hours tickets"
    assert mem.durable["team_draft"].get("awaiting") in {"members", "create_members"}
    assert any(
        a.get("type") == "create_team"
        and a.get("description") == "Handles after-hours tickets"
        for a in ui
    )


def test_absorb_team_description_not_pin_envelope():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {"awaiting": "description", "name": "HRTech & CRM"}
    ui: list = []
    assert tc._absorb_guided_field_utterance(mem, "pinned:team-create", "teams", ui) is False
    assert mem.durable["team_draft"].get("description") in (None, "")
    assert (
        tc._absorb_guided_field_utterance(
            mem, "this team used to solve problems", "teams", ui
        )
        is True
    )
    assert mem.durable["team_draft"]["description"] == "this team used to solve problems"
    assert any(
        a.get("type") == "create_team"
        and a.get("description") == "this team used to solve problems"
        and str(a.get("awaiting") or "").lower() in {"members", "create_members"}
        for a in ui
    )


def test_absorb_skips_team_description_before_llm():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "description",
        "name": "Software Engineering (App Development)",
    }
    ui: list = []
    assert (
        tc._absorb_guided_field_utterance(
            mem,
            "chznge the name",
            "teams",
            ui,
            allow_open_description=False,
        )
        is False
    )
    assert mem.durable["team_draft"].get("description") in (None, "")
    assert mem.durable["team_draft"].get("awaiting") == "description"


def test_absorb_team_description_after_tools_skips_when_llm_patched():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "name",
        "name": "Software Engineering (App Development)",
    }
    ui: list = []
    assert (
        tc._absorb_team_description_after_tools(
            mem,
            "chznge the name",
            "teams",
            ui,
            ["patch_team_draft"],
        )
        is False
    )
    assert mem.durable["team_draft"].get("description") in (None, "")


def test_absorb_team_description_after_tools_when_llm_only_listed():
    from app.agents import ticketing_coworker as tc
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "description",
        "name": "HRTech & CRM",
    }
    ui: list = []
    assert (
        tc._absorb_team_description_after_tools(
            mem,
            "this team used to solve problems",
            "teams",
            ui,
            ["list_agents"],
        )
        is True
    )
    assert mem.durable["team_draft"]["description"] == "this team used to solve problems"
    assert str(mem.durable["team_draft"].get("awaiting") or "").lower() in {
        "members",
        "create_members",
    }


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


def test_hydrate_update_queue_keeps_explicit_replace_flag():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1018",
        "name": "MCP team",
        "flow": "add_team_members",
        "members": ["Ashika A", "Sriannamalai R"],
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(
        mem,
        {
            "queue_id": "1018",
            "members": ["Ashika A", "Sriannamalai R"],
            "add_members": False,
            "confirmed": True,
        },
    )
    assert out["add_members"] is False
    assert out["members"] == ["Ashika A", "Sriannamalai R"]
    assert out["queue_id"] == "1018"


def test_hydrate_update_queue_uses_draft_replace_flag():
    from app.agents.ticketing_coworker import _hydrate_update_queue_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1018",
        "name": "Billing & Invoicing",
        "flow": "add_team_members",
        "members": ["Ashika A"],
        "current_members": ["Uday kumar G", "Ashika A"],
        "add_members": False,
        "awaiting": "confirm",
    }
    out = _hydrate_update_queue_args(mem, {"confirmed": True})
    assert out["add_members"] is False
    assert out["members"] == ["Ashika A"]
    assert out["queue_id"] == "1018"


def test_update_queue_roster_applied_replace_and_append():
    from app.agents.ticketing_coworker import _update_queue_roster_applied

    payload = {
        "success": True,
        "payload": {
            "members": ["Ashika A", "Sriannamalai R", "Mohamed Fazil"],
        },
    }
    assert not _update_queue_roster_applied(
        {
            "add_members": False,
            "members": ["Ashika A", "Sriannamalai R"],
        },
        payload,
    )
    assert _update_queue_roster_applied(
        {
            "add_members": True,
            "members": ["Ashika A", "Sriannamalai R"],
        },
        payload,
    )
    assert _update_queue_roster_applied(
        {
            "add_members": False,
            "members": ["Ashika A", "Sriannamalai R", "Mohamed Fazil"],
        },
        payload,
    )


def test_ground_update_queue_does_not_claim_remove_when_roster_unchanged(monkeypatch):
    from app.agents.ticketing_coworker import _ground_successful_write_reply

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: (
            "The MCP team still has Ashika A, Sriannamalai R, and Mohamed Fazil."
        ),
    )
    reply = _ground_successful_write_reply(
        {
            "tool": "update_queue",
            "arguments": {
                "add_members": False,
                "members": ["Ashika A", "Sriannamalai R"],
            },
            "payload": {
                "id": "1018",
                "queueName": "MCP team",
                "members": ["Ashika A", "Sriannamalai R", "Mohamed Fazil"],
            },
        },
        text="I have removed Mohamed Fazil from the MCP team.",
        query="yes",
        page="agent-queues",
    )
    assert "removed Mohamed Fazil" not in reply
    assert "Mohamed Fazil" in reply


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


def test_hydrate_update_ticket_uses_focused_last_entity_ticket():
    from app.agents.ticketing_coworker import _hydrate_reassign_write_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "ticket",
        "id": "#90",
        "ticketNumber": "#90",
        "name": "CRM Lead Generation Failure",
        "status": "Overdue",
    }
    out = _hydrate_reassign_write_args(
        mem, {"status": "Reopened", "confirmed": True}, "update_ticket"
    )
    assert out["ticket_number"] == "#90"
    assert out["status"] == "Reopened"

    armed = _hydrate_reassign_write_args(mem, {"status": "open"}, "update_ticket")
    assert armed["ticket_number"] == "#90"
    assert armed["status"] == "open"
    assert armed.get("confirmed") is True


def test_open_ui_item_prompt_block_names_focused_ticket():
    from app.prompts.builder import open_ui_item_prompt_block

    block = open_ui_item_prompt_block(
        {
            "last_entity": {
                "type": "ticket",
                "id": "96",
                "ticketNumber": "#96",
                "name": "Razorpay billing conflict",
                "status": "In Progress",
                "assignee": "Mohamed Fazil",
            }
        }
    )
    assert "Open UI item" in block
    assert "ticket_number: #96" in block
    assert "Razorpay billing conflict" in block
    empty = open_ui_item_prompt_block({"last_entity": None})
    assert "No ticket" in empty


def test_seed_reassign_draft_from_open_ticket():
    from app.agents.ticketing_coworker import _seed_ticket_number_from_open_ui
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "ticket",
        "id": "96",
        "ticketNumber": "#96",
        "name": "Razorpay billing conflict",
    }
    _seed_ticket_number_from_open_ui(mem, "ticket-reassign")
    draft = mem.durable.get("reassign_draft") or {}
    assert draft.get("ticket_number") == "#96"
    assert draft.get("awaiting") != "ticket"


def test_flatten_nested_update_ticket_args_from_server_gemma():
    from app.llm.tool_calls import flatten_tool_arguments, normalize_tool_calls
    from app.agents.ticketing_coworker import (
        _hydrate_pending_confirm_write_args,
        _hydrate_reassign_write_args,
    )
    from app.memory.session import SharedMemory

    wrapped = {
        "arguments": {"confirmed": True, "status": "Reopened"},
        "idempotency_key": "null",
    }
    flat = flatten_tool_arguments(wrapped)
    assert flat.get("confirmed") is True
    assert flat.get("status") == "Reopened"
    assert "arguments" not in flat
    assert "idempotency_key" not in flat

    parsed = normalize_tool_calls(
        [
            {
                "id": "c1",
                "type": "function",
                "function": {
                    "name": "update_ticket",
                    "arguments": json.dumps(wrapped),
                },
            }
        ]
    )
    assert parsed[0]["arguments"]["confirmed"] is True
    assert parsed[0]["arguments"]["status"] == "Reopened"

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "ticket",
        "id": "#100",
        "ticketNumber": "#100",
        "status": "Resolved",
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "update_ticket",
        "error_code": "CONFIRMATION_REQUIRED",
        "kind": "needs_confirm",
        "arguments": {"status": "Reopened"},
    }
    filled = _hydrate_pending_confirm_write_args(mem, "update_ticket", wrapped)
    filled = _hydrate_reassign_write_args(mem, filled, "update_ticket")
    assert filled.get("confirmed") is True
    assert filled.get("status") == "Reopened"
    assert filled.get("ticket_number") == "#100"


def test_hydrate_reassign_write_args_resolver_uses_update_ticket():
    from app.agents.ticketing_coworker import _hydrate_reassign_write_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "#73",
        "target_role": "resolver",
        "person": "Yaswanth MG",
        "person_id": "1000",
        "awaiting": "confirm",
        "roster_roles": {"Yaswanth MG": "resolver"},
    }
    out = _hydrate_reassign_write_args(mem, {}, "update_ticket")
    assert out["ticket_number"] == "#73"
    assert out["resolver"] == "Yaswanth MG"
    assert out.get("assignee") in (None, "")
    assert out["confirmed"] is True


def test_hydrate_reassign_strips_null_assignee_on_resolver_write():
    from app.agents.ticketing_coworker import _hydrate_reassign_write_args
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "100",
        "target_role": "resolver",
        "person": "Ashika A",
        "awaiting": "confirm",
        "roster_roles": {"Ashika A": "resolver"},
    }
    out = _hydrate_reassign_write_args(
        mem,
        {
            "assignee": "null",
            "confirmed": True,
            "resolver": "Ashika A",
            "ticket_number": "100",
        },
        "update_ticket",
    )
    assert out["resolver"] == "Ashika A"
    assert "assignee" not in out
    assert out["ticket_number"] == "100"


def test_reassign_enforce_draft_roles_overrides_wrong_target_role():
    from app.workflow_schemas import enforce_reassign_draft_roles

    draft = enforce_reassign_draft_roles(
        {
            "person": "Raghuram M",
            "target_role": "resolver",
            "roster_roles": {"Raghuram M": "agent"},
        }
    )
    assert draft["target_role"] == "agent"


def test_reject_reassign_agent_as_resolver():
    from app.agents.ticketing_coworker import _reject_reassign_role_mismatch
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "#99",
        "target_role": "resolver",
        "person": "Raghuram M",
        "roster_roles": {"Raghuram M": "agent"},
    }
    blocked = _reject_reassign_role_mismatch(
        mem,
        "update_ticket",
        {"ticket_number": "#99", "resolver": "Raghuram M", "confirmed": True},
    )
    assert blocked is not None
    assert blocked.get("error_code") == "VALIDATION_ERROR"
    assert (blocked.get("payload") or {}).get("code") == "ROLE_SLOT_MISMATCH"
    assert "Raghuram M" in str(blocked.get("message") or "")


def test_write_tool_for_reassign_uses_update_ticket():
    from app.workflow_schemas import write_tool_for_armed_draft

    assert (
        write_tool_for_armed_draft(
            "reassign_draft",
            {"target_role": "resolver", "person": "Yaswanth MG", "awaiting": "confirm"},
        )
        == "update_ticket"
    )


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


def test_hydrate_reassign_maps_resolver_id_from_roster_tool_result():
    from app.agents.ticketing_coworker import (
        _hydrate_reassign_write_args,
        _stash_reassign_from_resolve_person,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    _stash_reassign_from_resolve_person(
        mem,
        {
            "success": True,
            "payload": {
                "ticket_number": "93",
                "target_role": "resolver",
                "person_data": [
                    {
                        "person_name": "Uday kumar G",
                        "person_id": "1006",
                        "role": "resolver",
                    }
                ],
            },
        },
    )
    assert mem.durable["reassign_draft"]["roster_ids"]["1006"] == "Uday kumar G"
    out = _hydrate_reassign_write_args(
        mem,
        {
            "ticket_number": "93",
            "resolver": "1006",
            "confirmed": True,
        },
        "update_ticket",
    )
    assert out["resolver"] == "Uday kumar G"
    assert "assignee" not in out


def test_stash_reassign_binds_suggested_person_on_proceed():
    from app.agents.ticketing_coworker import _stash_reassign_from_resolve_person
    from app.memory.session import SharedMemory
    from app.workflow_schemas import draft_complete

    mem = SharedMemory(organization_id="1", user_id="u", session_id="reassign-proceed")
    _stash_reassign_from_resolve_person(
        mem,
        {
            "success": True,
            "payload": {
                "ticket_number": "1503",
                "target_role": "resolver",
                "proceed": 1,
                "user_query": "Reassign resolver to Chandru R",
                "person_data": [
                    {
                        "person_name": "Arun Ayyappan",
                        "person_id": "1030",
                        "role": "resolver",
                    },
                    {
                        "person_name": "Chandru R",
                        "person_id": "1032",
                        "role": "resolver",
                    },
                ],
                "suggested_person": {
                    "person_name": "Chandru R",
                    "person_id": "1032",
                    "role": "resolver",
                },
            },
        },
    )
    draft = mem.durable["reassign_draft"]
    assert draft["person"] == "Chandru R"
    assert draft["person_id"] == "1032"
    assert draft["target_role"] == "resolver"
    assert draft["awaiting"] == "confirm"
    assert draft_complete("reassign_ticket", draft) is True


def test_failed_update_ticket_reply_quotes_tool_error(monkeypatch):
    from app.agents.ticketing_coworker import _ground_write_outcome_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: f"Write failed: {kw.get('context', {}).get('toolError')}",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["reassign_draft"] = {
        "ticket_number": "93",
        "target_role": "resolver",
        "awaiting": "person",
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "update_ticket",
        "success": False,
        "error_code": "VALIDATION_ERROR",
        "message": "Unknown resolver",
    }
    out = _ground_write_outcome_reply(
        mem,
        "Let me try that again for you.",
        [],
        turn_writes=[],
        turn_failed_writes=["update_ticket"],
        write_was_owed=False,
        armed_tools=frozenset(),
    )
    assert "Unknown resolver" in (out or "")


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


def test_draft_kb_article_counts_as_committed_write():
    from app.agents.ticketing_coworker import _turn_committed_write

    assert _turn_committed_write(["patch_kb_draft"]) is False
    assert _turn_committed_write(["patch_kb_draft", "draft_kb_article"]) is True
    assert _turn_committed_write(["publish_kb_article"]) is True


def test_committed_kb_draft_reply_is_grounded_in_write_result(monkeypatch):
    """A saved draft must be reported, never re-collected as a new article."""
    from app.agents.ticketing_coworker import _ground_successful_write_reply

    captured: dict = {}

    def fake_phrase(**kwargs):
        captured.update(kwargs)
        return "Network Issue is saved as a staff-only draft."

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", fake_phrase)
    outcome = {
        "tool": "draft_kb_article",
        "payload": {
            "id": "KB-MTVM0L6H-5V77",
            "title": "Network Issue",
            "category": "Troubleshooting",
            "status": "Draft",
        },
    }
    reply = _ground_successful_write_reply(
        outcome,
        text="I am ready to help you set up a new knowledge article. What title do you want?",
        query="yess",
        page="kb",
    )

    assert reply == "Network Issue is saved as a staff-only draft."
    assert captured["module"] == "kb"
    assert captured["kind"] == "created"
    assert captured["context"]["filed"] is True
    assert captured["context"]["status"] == "Draft"
    assert captured["context"]["title"] == "Network Issue"

    # A reply that already quotes the saved row is left alone (no extra LLM call).
    captured.clear()
    assert (
        _ground_successful_write_reply(
            outcome,
            text="Saved Network Issue as a staff-only draft.",
            query="yess",
            page="kb",
        )
        == ""
    )
    assert not captured


def test_write_reply_grounding_covers_guided_write_tools(monkeypatch):
    """Every guided write except catalog creates phrases from its tool result."""
    from app.agents.ticketing_coworker import (
        _WRITE_REPLY_MODULE,
        _ground_successful_write_reply,
    )

    monkeypatch.setattr("app.tasks.phrase.phrase_reply", lambda **kw: "Saved.")
    for tool in _WRITE_REPLY_MODULE:
        assert (
            _ground_successful_write_reply(
                {"tool": tool, "payload": {"title": "Router Guide", "status": "Draft"}},
                text="Let's start over. What should the title be?",
                query="yes",
                page=None,
            )
            == "Saved."
        )

    # Catalog creates keep their existing grounded rewriter.
    assert (
        _ground_successful_write_reply(
            {"tool": "create_priority", "payload": {"displayName": "P1"}},
            text="Let's start over.",
            query="yes",
            page=None,
        )
        == ""
    )


def test_committed_write_reply_replaces_stored_assistant_turn():
    from app.agents.ticketing_coworker import _replace_last_assistant_message
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.add_message("assistant", "Please tell me the title for this article.")

    _replace_last_assistant_message(
        mem,
        "Please tell me the title for this article.",
        "Network Issue is saved as a draft.",
    )

    assert mem.messages[-1]["content"] == "Network Issue is saved as a draft."
    assert (
        mem.durable["recent_history"][-1]["text"]
        == "Network Issue is saved as a draft."
    )


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
                "message": "Tool ask_knowledge_graph not allowed for agent=analytics_audit_query_executor",
            }
        },
    )
    assert err["success"] is False
    assert err["error_code"] == "FORBIDDEN"
    assert err["retryable"] is False
    assert "ask_knowledge_graph" in err["message"]
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
    assert "ask_knowledge_graph" in claims["allowed_tools"]


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
    from app.tools.catalog_tools import catalog_row_id_usable, kb_article_id_usable

    assert catalog_row_id_usable("") == ""
    assert catalog_row_id_usable(None) == ""
    assert catalog_row_id_usable("immediate_id_placeholder") == ""
    assert catalog_row_id_usable("Immediate") == ""
    assert catalog_row_id_usable("2783") == "2783"
    assert catalog_row_id_usable("[2937]") == "2937"
    assert catalog_row_id_usable("KB-MTWPFYTF-BBKP") == ""
    assert kb_article_id_usable("KB-MTWPFYTF-BBKP") == "KB-MTWPFYTF-BBKP"
    assert kb_article_id_usable("kb-mtwpfytf-bbkp") == "KB-MTWPFYTF-BBKP"
    assert kb_article_id_usable("2783") == "2783"
    assert kb_article_id_usable("Network Issue") == ""
    assert kb_article_id_usable("KB-fake_id") == ""
    assert kb_article_id_usable("article_id_placeholder") == ""


def test_publish_kb_accepts_drafted_external_id_and_hydrates_from_focus(monkeypatch):
    """Draft write returns KB-…; publish must not treat that as a label."""
    from app.agents.ticketing_coworker import (
        _hydrate_kb_article_id_args,
        _reject_ungrounded_entity_args,
    )
    from app.memory.session import SharedMemory
    from app.tools import catalog_tools

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_entity"] = {
        "type": "article",
        "id": "KB-MTWPFYTF-BBKP",
        "title": "Network Issue",
        "status": "Draft",
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "draft_kb_article",
        "success": True,
        "payload": {
            "id": "KB-MTWPFYTF-BBKP",
            "title": "Network Issue",
            "status": "Draft",
        },
    }
    filled = _hydrate_kb_article_id_args(mem, {"confirmed": True})
    assert filled["article_id"] == "KB-MTWPFYTF-BBKP"
    assert (
        _reject_ungrounded_entity_args(
            "publish_kb_article", filled, memory=mem
        )
        is None
    )

    called: list = []

    def fake_express(method, path, **kwargs):
        called.append((method, path, kwargs.get("json_body")))
        return {
            "success": True,
            "payload": {
                "id": "KB-MTWPFYTF-BBKP",
                "title": "Network Issue",
                "status": "Published",
            },
        }

    monkeypatch.setattr(catalog_tools, "express_request", fake_express)
    out = catalog_tools.publish_kb_article("KB-MTWPFYTF-BBKP")
    assert out.get("success") is True
    assert called and called[0][0] == "PATCH"
    assert "KB-MTWPFYTF-BBKP" in str(called[0][1])
    assert (called[0][2] or {}).get("status") == "Published"


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

    drafted = _reject_ungrounded_entity_args(
        "publish_kb_article",
        {"article_id": "KB-MTWPFYTF-BBKP"},
    )
    assert drafted is None

    titled = _reject_ungrounded_entity_args(
        "publish_kb_article",
        {"article_id": "Network Issue"},
    )
    assert titled and titled.get("error_code") == "MISSING_CATALOG_ID"

    ticket = _reject_ungrounded_entity_args(
        "update_ticket",
        {"ticket_number": "ticket_id_placeholder"},
    )
    assert ticket and ticket.get("error_code") == "MISSING_CATALOG_ID"


def test_coerce_catalog_id_values_absorbs_stringified_array():
    from app.tools.catalog_tools import coerce_catalog_id_values

    assert coerce_catalog_id_values("[2937]") == [2937]
    assert coerce_catalog_id_values(["2937", "2781"]) == ["2937", "2781"]
    assert coerce_catalog_id_values("") == []
    assert coerce_catalog_id_values(2937) == [2937]


def test_reject_delete_priority_needs_listed_ids_and_absorbs_string_array():
    from app.agents.ticketing_coworker import _reject_ungrounded_entity_args
    from app.memory.session import SharedMemory

    empty = _reject_ungrounded_entity_args("delete_priority", {}, memory=None)
    assert empty and empty.get("error_code") == "MISSING_CATALOG_ID"

    unlisted = _reject_ungrounded_entity_args(
        "delete_priority",
        {"priority_ids": "[2937]", "confirmed": True},
        memory=SharedMemory(organization_id="1", user_id="u", session_id="s"),
    )
    assert unlisted and unlisted.get("error_code") == "MISSING_CATALOG_ID"
    assert (unlisted.get("payload") or {}).get("next_tool") == "list_priorities"

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["last_query"] = {
        "catalog_list_options": [
            {"id": "2937", "displayName": "p5"},
            {"id": "2781", "displayName": "p3"},
        ]
    }
    ok = _reject_ungrounded_entity_args(
        "delete_priority",
        {"priority_ids": "[2937]", "confirmed": True},
        memory=mem,
    )
    assert ok is None

    both = _reject_ungrounded_entity_args(
        "delete_priority",
        {"priority_ids": ["2781", "2937"], "confirmed": True},
        memory=mem,
    )
    assert both is None


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


def test_xml_tool_calls_array_parses_kb_disposition_write():
    from app.llm.tool_calls import (
        content_looks_like_inline_tool_call,
        inline_tool_calls_from_content,
    )

    raw = (
        "<tool_calls>\n"
        '[{"name":"patch_kb_draft","arguments":{"publication_intent":"draft"}},'
        '{"name":"draft_kb_article","arguments":{"title":"Sharing Feedback",'
        '"category":"Customer Support","body":"Identify the feedback.",'
        '"confirmed":true}}]\n'
        "</tool_calls>"
    )
    assert content_looks_like_inline_tool_call(raw)
    calls = inline_tool_calls_from_content(raw)
    assert [c["name"] for c in calls] == ["patch_kb_draft", "draft_kb_article"]
    assert calls[0]["arguments"]["publication_intent"] == "draft"
    assert calls[1]["arguments"]["confirmed"] is True
    assert calls[1]["arguments"]["title"] == "Sharing Feedback"
    assert calls[1]["arguments"]["content"] == "Identify the feedback."


def test_tool_loop_executes_xml_tool_calls_leak():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="xml-tools")
    leak = (
        "<tool_calls>"
        '[{"name":"patch_kb_draft","arguments":{"publication_intent":"draft"}},'
        '{"name":"draft_kb_article","arguments":{"confirmed":true}}]'
        "</tool_calls>"
    )
    llm = _FakeLLM(
        [
            {"content": leak, "tool_calls": []},
            {"content": "Saved Sharing Feedback as a staff-only draft.", "tool_calls": []},
        ]
    )
    called: list[str] = []

    def execute(name, args):
        called.append(name)
        return {"success": True, "payload": {"tool": name, "arguments": args}}

    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="patch_kb_draft",
                description="patch",
                input_schema={"type": "object", "properties": {}},
            ),
            ToolDefinition(
                name="draft_kb_article",
                description="write",
                input_schema={"type": "object", "properties": {}},
            ),
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
        user_message="draft",
    )
    assert called == ["patch_kb_draft", "draft_kb_article"]
    assert "staff-only draft" in text


def test_gemma_wrapped_inline_update_queue_parses():
    from app.llm.tool_calls import (
        content_looks_like_inline_tool_call,
        inline_tool_calls_from_content,
    )

    raw = (
        '<|tool_call>call:ticketing:update_queue{add_members:true,confirmed:true,'
        'members:[<|"|>Ashika A<|"|>],queue_id:<|"|>1015<|"|>}<tool_call|>'
    )
    assert content_looks_like_inline_tool_call(raw)
    calls = inline_tool_calls_from_content(raw)
    assert len(calls) == 1
    assert calls[0]["name"] == "update_queue"
    args = calls[0]["arguments"]
    assert args["add_members"] is True
    assert args["confirmed"] is True
    assert args["members"] == ["Ashika A"]
    assert args["queue_id"] == "1015"


def test_tool_loop_executes_gemma_inline_tool_leak():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    leak = (
        '<|tool_call>call:ticketing:update_queue{add_members:true,confirmed:true,'
        'members:[<|"|>Ashika A<|"|>],queue_id:<|"|>1015<|"|>}<tool_call|>'
    )
    llm = _FakeLLM(
        [
            {"content": leak, "tool_calls": []},
            {"content": "Added Ashika A to the team.", "tool_calls": []},
        ]
    )
    called: dict[str, Any] = {}

    def execute(name, args):
        called["name"] = name
        called["args"] = args
        return {"success": True, "payload": {"queue_id": "1015"}}

    tools = [
        ToolDefinition(
            name="update_queue",
            description="Update queue",
            parameters={"type": "object", "properties": {}},
        )
    ]
    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=tools,
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=5)),
        user_message="yes",
    )
    assert called["name"] == "update_queue"
    assert called["args"]["confirmed"] is True
    assert called["args"]["members"] == ["Ashika A"]
    assert text == "Added Ashika A to the team."
    assert leak not in text


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

    batch_ok = _reject_ungrounded_entity_args(
        "delete_priority",
        {"priority_ids": ["2001", "2002"], "confirmed": True},
        memory=mem,
    )
    assert batch_ok and batch_ok.get("error_code") == "MISSING_CATALOG_ID"
    mem.durable["last_query"] = {
        "catalog_list_options": [
            {"id": "2001", "displayName": "p3"},
            {"id": "2002", "displayName": "p5"},
        ],
    }
    batch_listed = _reject_ungrounded_entity_args(
        "delete_priority",
        {"priority_ids": ["2001", "2002"], "confirmed": True},
        memory=mem,
    )
    assert batch_listed is None


def test_compute_guided_ready_ticket_customer_kb():
    from app.workflow_schemas import compute_guided_ready

    assert not compute_guided_ready(
        "create_ticket",
        {
            "customerName": "Anto",
            "customerEmail": "anto@gmail.com",
            "issue": "VPN down",
        },
    )
    assert compute_guided_ready(
        "create_ticket",
        {
            "customerName": "Anto",
            "customerEmail": "anto@gmail.com",
            "issue": "VPN down",
            "customerDirectoryStatus": "verified",
        },
    )
    assert compute_guided_ready(
        "create_customer",
        {"name": "Anto", "email": "anto@gmail.com"},
    )
    assert not compute_guided_ready(
        "create_kb",
        {"title": "VPN", "category": "Network", "body": "Reset the tunnel."},
    )
    assert compute_guided_ready(
        "create_kb",
        {
            "title": "VPN",
            "category": "Network",
            "body": "Reset the tunnel.",
            "publication_intent": "draft",
        },
    )


def test_seed_portal_identity_skips_email_and_uses_session():
    from app.agents.ticketing_coworker import (
        _filter_portal_vs_staff_ticket_tools,
        seed_portal_ticket_identity,
    )
    from app.contracts import ToolDefinition
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import first_open_guided_slot, missing_ticket_fields

    mem = SharedMemory(organization_id="1", user_id="1019", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "email",
        "customerName": "Mohamed Fazil",
        "issue": "the CRM page is blank",
    }
    req = RunRequest(
        message="yess",
        session_id="s",
        actor=ActorContext(
            user_id="1019",
            organization_id="1",
            user_role="portal_customer",
            user_name="Mohamed Fazil",
            user_email="fazil@example.com",
            portal_customer_id="1019",
        ),
        module="portal",
        surface="home",
    )
    seed_portal_ticket_identity(mem, req)
    draft = mem.durable["ticket_draft"]
    assert draft["surface"] == "portal"
    assert draft["customerId"] == "1019"
    assert draft["customerDirectoryStatus"] == "verified"
    assert draft["customerEmail"] == "fazil@example.com"
    assert draft["contact"] == "fazil@example.com"
    assert draft["awaiting"] == "confirm"
    assert missing_ticket_fields(draft) == []
    assert first_open_guided_slot("create_ticket", draft) == "confirm"

    tools = [
        ToolDefinition(
            name="create_ticket",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="portal_create_ticket",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="verify_ticket_customer",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="patch_ticket_draft",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
    ]
    actor = ToolActor(
        user_id="1019",
        organization_id="1",
        user_role="portal_customer",
        portal_customer_id="1019",
    )
    filtered = _filter_portal_vs_staff_ticket_tools(
        tools, mem, actor=actor, context={"module": "portal"}
    )
    assert {t.name for t in filtered} == {"portal_create_ticket", "patch_ticket_draft"}


def test_portal_yes_confirm_rewrites_staff_create_ticket():
    """Live portal 'yess' called create_ticket {confirmed:true} → Express 403."""
    from app.agents.ticketing_coworker import (
        _absorb_guided_field_utterance,
        _rewrite_staff_create_ticket_for_portal,
        seed_portal_ticket_identity,
    )
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.tools.express_client import ToolActor

    mem = SharedMemory(organization_id="1", user_id="1019", session_id="s")
    mem.durable["ticket_draft"] = {
        "awaiting": "email",
        "customerName": "Mohamed Fazil",
        "issue": "blank CRM page",
    }
    mem.durable["current_workflow"] = "create_ticket"
    req = RunRequest(
        message="yess",
        session_id="s",
        actor=ActorContext(
            user_id="1019",
            organization_id="1",
            user_role="portal_customer",
            user_name="Mohamed Fazil",
            user_email="fazil@example.com",
            portal_customer_id="1019",
        ),
        module="portal",
        surface="home",
    )
    seed_portal_ticket_identity(mem, req)
    actor = ToolActor(
        user_id="1019",
        organization_id="1",
        user_role="portal_customer",
        portal_customer_id="1019",
    )
    assert (
        _rewrite_staff_create_ticket_for_portal(
            "create_ticket",
            mem,
            actor=actor,
            context={"module": "portal", "request": req},
            request=req,
        )
        == "portal_create_ticket"
    )
    staff = ToolActor(user_id="5", organization_id="1", user_role="agent")
    assert (
        _rewrite_staff_create_ticket_for_portal(
            "create_ticket",
            SharedMemory(organization_id="1", user_id="5", session_id="staff"),
            actor=staff,
        )
        == "create_ticket"
    )
    ui: list = []
    bound = _absorb_guided_field_utterance(
        mem, "fazil@example.com", "tickets", ui
    )
    assert bound is False
    assert mem.durable["ticket_draft"]["awaiting"] == "confirm"

    collect = SharedMemory(organization_id="1", user_id="1019", session_id="s2")
    collect.durable["current_workflow"] = "create_ticket"
    collect.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "email",
        "customerName": "Mohamed Fazil",
        "customerId": "1019",
        "customerDirectoryStatus": "verified",
        "issue": "blank CRM page",
    }
    assert (
        _absorb_guided_field_utterance(
            collect, "fazil@example.com", "tickets", []
        )
        is False
    )
    assert collect.durable["ticket_draft"].get("customerEmail") in (None, "")


def test_portal_confirm_ready_force_file_on_nlu_confirm_not_field_edit():
    from app.agents.ticketing_coworker import (
        _portal_confirm_force_blocked_by_field_edit,
        _should_force_native_armed_write,
        _ticket_create_issue_absorbed_ready_to_confirm,
    )
    from app.memory.session import SharedMemory
    from app.workflow_schemas import armed_write_tools_from_state, write_tool_for_armed_draft

    mem = SharedMemory(organization_id="1", user_id="c1", session_id="s")
    mem.durable["current_workflow"] = "create_ticket"
    mem.durable["ticket_draft"] = {
        "surface": "portal",
        "awaiting": "confirm",
        "customerName": "Ashika",
        "customerEmail": "ashika@test.com",
        "contact": "ashika@test.com",
        "customerId": "c1",
        "customerDirectoryStatus": "verified",
        "issue": "Red line across the CRM dashboard",
        "issueReady": True,
        "precreate_duplicate_check": "not_duplicate",
        "attachments": ["/uploads/shot.png"],
    }
    assert _ticket_create_issue_absorbed_ready_to_confirm(mem) is True
    assert (
        write_tool_for_armed_draft("ticket_draft", mem.durable["ticket_draft"])
        == "portal_create_ticket"
    )
    assert "portal_create_ticket" in armed_write_tools_from_state(
        {"ticket_draft": mem.durable["ticket_draft"], "current_workflow": "create_ticket"}
    )
    from app.contracts.execution import ActorContext, RunRequest

    req = RunRequest(
        message="yes",
        session_id="s",
        actor=ActorContext(
            user_id="c1",
            organization_id="1",
            user_role="portal_customer",
            portal_customer_id="c1",
        ),
        module="portal",
        surface="home",
    )
    ctx = {"module": "portal", "request": req}
    assert (
        _should_force_native_armed_write(
            mem,
            "yes",
            ctx,
            workflow_decision={"action": "CONFIRM_WORKFLOW"},
        )
        is True
    )
    assert (
        _portal_confirm_force_blocked_by_field_edit(
            {"action": "CONTINUE_WORKFLOW", "fields": {"issue": "sidebar overlap"}}
        )
        is True
    )
    assert _portal_confirm_force_blocked_by_field_edit({"action": "CONFIRM_WORKFLOW"}) is False


def test_seed_portal_identity_does_not_start_create_on_greeting():
    from app.agents.ticketing_coworker import seed_portal_ticket_identity
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="1019", session_id="s")
    req = RunRequest(
        message="hi",
        session_id="s",
        actor=ActorContext(
            user_id="1019",
            organization_id="1",
            user_role="portal_customer",
            user_name="Mohamed Fazil",
            portal_customer_id="1019",
        ),
        module="portal",
        surface="home",
    )
    seed_portal_ticket_identity(mem, req)
    assert mem.durable.get("ticket_draft") is None


def test_snap_rejects_skip_ahead_and_keeps_current_slot():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s2")
    ui: list = []
    mem.durable["customer_draft"] = {"awaiting": "name"}
    mem.durable["current_workflow"] = "create_customer"
    bad = _execute_local_ui_tool(
        "patch_customer_draft",
        {"email": "skip@example.com"},
        memory=mem,
        ui_actions=ui,
    )
    assert bad["success"] is False
    assert bad["error_code"] == "SEQUENCE_VIOLATION"

    ok = _execute_local_ui_tool(
        "patch_customer_draft",
        {"name": "Maha"},
        memory=mem,
        ui_actions=ui,
    )
    assert ok["success"] is True
    draft = mem.durable["customer_draft"]
    assert draft["name"] == "Maha"
    assert not str(draft.get("email") or "").strip()
    assert draft["awaiting"] == "email"
    assert any(a.get("type") == "create_customer" and a.get("name") == "Maha" for a in ui)


def test_correction_keeps_siblings_and_stamps_ready():
    from app.agents.ticketing_coworker import (
        _ensure_guided_ui_actions,
        _execute_local_ui_tool,
        _stamp_guided_drafts_at_turn_start,
    )
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    ui: list = []
    _execute_local_ui_tool(
        "patch_kb_draft",
        {"title": "Networking Issue"},
        memory=mem,
        ui_actions=ui,
    )
    mem.durable["kb_draft"]["available_categories"] = [
        "General",
        "Billing",
        "Troubleshooting",
    ]
    _execute_local_ui_tool(
        "patch_kb_draft",
        {"category": "Troubleshooting"},
        memory=mem,
        ui_actions=ui,
    )
    _execute_local_ui_tool(
        "patch_kb_draft",
        {"awaiting": "title"},
        memory=mem,
        ui_actions=ui,
    )
    draft = mem.durable["kb_draft"]
    assert draft["title"] == "Networking Issue"
    assert draft["category"] == "Troubleshooting"
    assert draft["awaiting"] == "title"
    assert draft["ready"] is False
    _stamp_guided_drafts_at_turn_start(mem)
    assert mem.durable["kb_draft_at_turn_start"]["title"] == "Networking Issue"
    ensured = _ensure_guided_ui_actions(mem, [])
    panel = next(a for a in ensured if a.get("type") == "create_kb")
    assert panel["title"] == "Networking Issue"
    assert panel["category"] == "Troubleshooting"
    assert panel["awaiting"] == "title"
    assert "ready" in panel


def test_kb_long_body_with_customer_priority_words_is_kept():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    body = (
        "Problem: The voicebot successfully captured the payment details, but the "
        "third-party payment gateway failed to respond within the 5-second limit. "
        "Resolution: The bot safely terminated the transaction without charging the "
        "customer and generated this high-priority ticket. Next Steps: Check the "
        "payment gateway logs to confirm no funds were deducted, then call the "
        "customer back to safely process the billing manually."
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="kb-body")
    ui: list = []
    mem.durable["kb_draft"] = {
        "title": "Payment Gateway Timeout",
        "category": "Billing",
        "awaiting": "body",
        "available_categories": ["Accounts", "Billing", "General", "Troubleshooting"],
    }
    mem.durable["current_workflow"] = "create_kb"
    mem.add_message("user", "draft now")
    intent_only = _execute_local_ui_tool(
        "patch_kb_draft",
        {"publication_intent": "draft"},
        memory=mem,
        ui_actions=ui,
    )
    assert intent_only["success"] is False
    assert intent_only["error_code"] == "SEQUENCE_VIOLATION"

    both = _execute_local_ui_tool(
        "patch_kb_draft",
        {"body": body, "publication_intent": "draft"},
        memory=mem,
        ui_actions=ui,
    )
    assert both["success"] is True, both
    draft = mem.durable["kb_draft"]
    assert draft["body"] == body
    assert draft.get("publication_intent") == "draft"
    assert str(draft.get("awaiting") or "") == "confirm"


def test_kb_publication_intent_from_meaning_not_utterance_spelling():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="kb-intent-typo")
    mem.durable["current_workflow"] = "create_kb"
    mem.durable["kb_draft"] = {
        "title": "testtttt",
        "category": "General",
        "body": "Clear the cache.",
        "awaiting": "publication_intent",
        "available_categories": ["General"],
    }
    mem.add_message("user", "darft thissss")
    out = _execute_local_ui_tool(
        "patch_kb_draft",
        {"publication_intent": "draft"},
        memory=mem,
        ui_actions=[],
    )
    assert out["success"] is True, out
    draft = mem.durable["kb_draft"]
    assert draft.get("publication_intent") == "draft"
    assert str(draft.get("awaiting") or "") == "confirm"
    assert "publication_intent" in (out.get("payload") or {}).get("updated_fields", [])


def test_kb_category_is_not_copied_from_title():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="kb-cat")
    ui: list = []
    mem.add_message("user", "Payment Gateway Timeout")
    titled = _execute_local_ui_tool(
        "patch_kb_draft",
        {
            "title": "Payment Gateway Timeout",
            "category": "Payment Gateway",
        },
        memory=mem,
        ui_actions=ui,
    )
    assert titled["success"] is True, titled
    draft = mem.durable["kb_draft"]
    assert draft["title"] == "Payment Gateway Timeout"
    assert not str(draft.get("category") or "").strip()
    assert str(draft.get("awaiting") or "") == "category"

    draft["available_categories"] = [
        "Accounts",
        "Billing",
        "General",
        "Troubleshooting",
    ]
    mem.durable["kb_draft"] = draft
    invented = _execute_local_ui_tool(
        "patch_kb_draft",
        {"category": "Payment Gateway"},
        memory=mem,
        ui_actions=ui,
    )
    assert invented["success"] is False
    assert invented["error_code"] == "CATEGORY_REQUIRED"

    mem.add_message("user", "Billing")
    picked = _execute_local_ui_tool(
        "patch_kb_draft",
        {"category": "Billing"},
        memory=mem,
        ui_actions=ui,
    )
    assert picked["success"] is True, picked
    assert mem.durable["kb_draft"]["category"] == "Billing"
    assert str(mem.durable["kb_draft"].get("awaiting") or "") == "body"


def test_write_tools_hidden_until_ready_and_confirm():
    from app.agents.ticketing_coworker import _filter_writes_until_guided_ready
    from app.contracts import ToolDefinition
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["ticket_draft"] = {
        "customerName": "Anto",
        "customerEmail": "anto@gmail.com",
        "issue": "VPN down",
        "awaiting": "confirm",
    }
    mem.durable["current_workflow"] = "create_ticket"
    tools = [
        ToolDefinition(
            name="create_ticket",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="patch_ticket_draft",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
    ]
    hidden = _filter_writes_until_guided_ready(tools, mem)
    assert [t.name for t in hidden] == ["patch_ticket_draft"]

    mem.durable["ticket_draft"]["customerDirectoryStatus"] = "verified"
    shown = _filter_writes_until_guided_ready(tools, mem)
    assert {t.name for t in shown} == {"create_ticket", "patch_ticket_draft"}


def test_update_queue_shown_on_add_members_confirm():
    from app.agents.ticketing_coworker import _filter_writes_until_guided_ready
    from app.contracts import ToolDefinition
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "add_team_members"
    mem.durable["team_draft"] = {
        "id": "1058",
        "flow": "add_team_members",
        "workflow": "add_team_members",
        "team": "testingggggg",
        "name": "testingggggg",
        "members": ["mohamed fazil"],
        "add_members": True,
        "awaiting": "confirm",
        "ready": True,
    }
    tools = [
        ToolDefinition(
            name="update_queue",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="patch_team_draft",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="create_queue",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
        ToolDefinition(
            name="delete_queue",
            description="x",
            input_schema={"type": "object", "properties": {}},
        ),
    ]
    shown = _filter_writes_until_guided_ready(tools, mem)
    assert {t.name for t in shown} == {"update_queue", "patch_team_draft"}

    mem.durable["team_draft"]["awaiting"] = "members"
    hidden = _filter_writes_until_guided_ready(tools, mem)
    assert {t.name for t in hidden} == {"patch_team_draft"}


def test_create_ticket_not_ready_without_verify():
    from app.tools.registry import validate_specialist_tool

    blocked = validate_specialist_tool(
        agent="tickets",
        tool_name="create_ticket",
        draft={
            "customerName": "Anto",
            "customerEmail": "anto@gmail.com",
            "issue": "VPN down",
        },
        workflow_id="create_ticket",
        draft_key="ticket_draft",
        args={"confirmed": True},
    )
    assert blocked["success"] is False
    assert blocked["error_code"] == "NOT_READY"


def test_guided_collect_change_confirm_matrix_modules():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory
    from app.workflow_schemas import compute_guided_ready

    cases = [
        (
            "patch_status_draft",
            {"displayName": "Waiting"},
            "confirm",
            {"awaiting": "name"},
        ),
        (
            "patch_escalate_draft",
            {"ticket_number": "42"},
            "assignee",
            {"awaiting": "ticket_number"},
        ),
        (
            "patch_reassign_draft",
            {"ticket_number": "42"},
            "target_role",
            {"awaiting": "ticket_number"},
        ),
    ]
    for tool, first, next_slot, retarget in cases:
        mem = SharedMemory(organization_id="1", user_id="u", session_id=tool)
        ui: list = []
        first_out = _execute_local_ui_tool(tool, first, memory=mem, ui_actions=ui)
        assert first_out["success"] is True, first_out
        assert first_out["payload"]["awaiting"] == next_slot
        retarget_out = _execute_local_ui_tool(tool, retarget, memory=mem, ui_actions=ui)
        assert retarget_out["success"] is True
        assert retarget_out["payload"]["awaiting"] == retarget["awaiting"]
        draft_key = first_out["payload"]["draft_key"]
        draft = mem.durable[draft_key]
        if tool == "patch_status_draft":
            assert draft.get("displayName") == "Waiting"
            assert compute_guided_ready(first_out["payload"]["workflow"], draft) is True
        else:
            assert compute_guided_ready(first_out["payload"]["workflow"], draft) is False
        assert any(
            a.get("awaiting") == retarget["awaiting"] for a in ui if isinstance(a, dict)
        )


@pytest.mark.parametrize(
    (
        "tool",
        "fill",
        "correction",
        "skip_ahead",
        "keep_key",
        "keep_value",
        "awaiting",
        "replacement",
        "next_awaiting",
    ),
    [
        (
            "patch_ticket_draft",
            {"customerName": "Maha"},
            {"awaiting": "name", "customerName": "change the name"},
            {"issue": "later issue"},
            "customerName",
            "Maha",
            "name",
            {"customerName": "Sam"},
            "contact",
        ),
        (
            "patch_customer_draft",
            {"name": "Maha"},
            {"awaiting": "name", "name": "change the name"},
            {"email": "skip@example.com"},
            "name",
            "Maha",
            "name",
            {"name": "Sam"},
            "email",
        ),
        (
            "patch_kb_draft",
            {"title": "Old Title"},
            {"awaiting": "title", "title": "change the title"},
            {"body": "later body"},
            "title",
            "Old Title",
            "title",
            {"title": "Network Issue"},
            "category",
        ),
        (
            "patch_macro_draft",
            {"title": "Reset password"},
            {"awaiting": "title", "title": "change the title"},
            {"body": "later body"},
            "title",
            "Reset password",
            "title",
            {"title": "Welcome note"},
            "body",
        ),
        (
            "patch_team_draft",
            {"name": "ML Team"},
            {"awaiting": "name", "name": "change the name"},
            {"description": "later description"},
            "name",
            "ML Team",
            "name",
            {"name": "AI/ML"},
            "description",
        ),
        (
            "patch_priority_draft",
            {"displayName": "Gold"},
            {"awaiting": "name", "displayName": "change the name"},
            {"resolutionHours": 8},
            "displayName",
            "Gold",
            "name",
            {"displayName": "Silver"},
            "hours",
        ),
        (
            "patch_status_draft",
            {"displayName": "Waiting"},
            {"awaiting": "name", "displayName": "change the name"},
            {"hours": 8},
            "displayName",
            "Waiting",
            "name",
            {"displayName": "On Hold"},
            "confirm",
        ),
        (
            "patch_escalate_draft",
            {"ticket_number": "T-101"},
            {"awaiting": "ticket_number", "ticket_number": "change the ticket"},
            {"assignee": "later person"},
            "ticket_number",
            "T-101",
            "ticket_number",
            {"ticket_number": "T-202"},
            "assignee",
        ),
        (
            "patch_reassign_draft",
            {"ticket_number": "T-101"},
            {"awaiting": "ticket_number", "ticket_number": "change the ticket"},
            {"person": "later person"},
            "ticket_number",
            "T-101",
            "ticket_number",
            {"ticket_number": "T-202"},
            "target_role",
        ),
    ],
)
def test_guided_correction_with_skip_ahead_does_not_fail(
    tool,
    fill,
    correction,
    skip_ahead,
    keep_key,
    keep_value,
    awaiting,
    replacement,
    next_awaiting,
):
    """Instruction + leftover later-field keys must retarget, not SEQUENCE_VIOLATE."""
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id=f"corr-{tool}")
    ui: list = []
    filled = _execute_local_ui_tool(tool, fill, memory=mem, ui_actions=ui)
    assert filled["success"] is True, filled

    mixed = {**correction, **skip_ahead}
    retarget = _execute_local_ui_tool(tool, mixed, memory=mem, ui_actions=ui)
    assert retarget["success"] is True, retarget
    assert retarget.get("error_code") != "SEQUENCE_VIOLATION"
    draft_key = filled["payload"]["draft_key"]
    draft = mem.durable[draft_key]
    assert draft[keep_key] == keep_value
    assert str(draft.get("awaiting") or "").strip().lower() == awaiting
    assert any(
        isinstance(a, dict) and str(a.get("awaiting") or "").lower() == awaiting
        for a in ui
    )

    renamed = _execute_local_ui_tool(
        tool,
        {"awaiting": awaiting, **replacement},
        memory=mem,
        ui_actions=ui,
    )
    assert renamed["success"] is True, renamed
    draft = mem.durable[draft_key]
    for key, value in replacement.items():
        assert draft[key] == value
    assert str(draft.get("awaiting") or "").strip().lower() == next_awaiting
    assert draft.get("ready") is False or next_awaiting == "confirm"


def test_hours_instruction_retargets_without_overwriting():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="hours")
    ui: list = []
    _execute_local_ui_tool(
        "patch_priority_draft",
        {"displayName": "Gold"},
        memory=mem,
        ui_actions=ui,
    )
    _execute_local_ui_tool(
        "patch_priority_draft",
        {"resolutionHours": 4},
        memory=mem,
        ui_actions=ui,
    )
    out = _execute_local_ui_tool(
        "patch_priority_draft",
        {"resolutionHours": "change the hours"},
        memory=mem,
        ui_actions=ui,
    )
    assert out["success"] is True, out
    draft = mem.durable["priority_draft"]
    assert draft["resolutionHours"] == 4
    assert str(draft.get("awaiting") or "").strip().lower() == "hours"


def test_ground_kb_category_ask_requires_listed_names(monkeypatch):
    from app.agents.ticketing_coworker import _ground_guided_collect_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: "Accounts\nBilling\nWhich section should this live in?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="g")
    mem.durable["kb_draft"] = {
        "title": "Resolve Local Browser & Access Issues",
        "awaiting": "category",
        "available_categories": ["Accounts", "Billing"],
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "patch_kb_draft",
        "success": True,
        "payload": {"awaiting": "category"},
    }
    out = _ground_guided_collect_reply(
        mem,
        "Got it. Which section should this live in, or type a short new label?",
        turn_tools_called=["patch_kb_draft"],
    )
    assert "Accounts" in (out or "")
    assert "Billing" in (out or "")


def test_ground_guided_collect_reply_rewrites_irrelevant_text(monkeypatch):
    from app.agents.ticketing_coworker import _ground_guided_collect_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: "Still using ML Team. What is the description?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="g")
    mem.durable["team_draft"] = {
        "name": "ML Team",
        "awaiting": "description",
        "ready": False,
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "patch_team_draft",
        "success": True,
        "payload": {"awaiting": "description", "ready": False},
    }
    out = _ground_guided_collect_reply(
        mem,
        "How can I help you create a team today?",
        turn_tools_called=["patch_team_draft"],
    )
    assert "ML Team" in (out or "")
    assert "description" in (out or "").lower()
    kept = _ground_guided_collect_reply(
        mem,
        "Got ML Team. What description should I use?",
        turn_tools_called=["patch_team_draft"],
    )
    assert kept == "Got ML Team. What description should I use?"
    stale = _ground_guided_collect_reply(
        mem,
        "How can I help you create a team today?",
        turn_tools_called=["list_queues"],
    )
    assert stale == "How can I help you create a team today?"
    ghost = _ground_guided_collect_reply(
        mem,
        "I have successfully updated the NLP team with the description provided. "
        "The team details are now saved in the system.",
        turn_tools_called=["list_agents"],
    )
    assert ghost
    assert "saved" not in ghost.lower() or "nothing was saved" in ghost.lower()
    assert "description" in ghost.lower() or "ML Team" in ghost


def test_ground_guided_collect_reply_asks_correction_slot(monkeypatch):
    """Reopen awaiting (name) must not keep a sequential description ask."""
    from app.agents.ticketing_coworker import _ground_guided_collect_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: "ML Team is still the name. What is the new name?",
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="g")
    mem.durable["team_draft"] = {
        "name": "ML Team",
        "description": "Trains models.",
        "awaiting": "name",
        "ready": False,
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "patch_team_draft",
        "success": True,
        "payload": {
            "awaiting": "name",
            "ready": False,
            "draft": {"name": "ML Team", "awaiting": "name"},
            "message": "Ask only for name.",
        },
    }
    out = _ground_guided_collect_reply(
        mem,
        "Got ML Team. What description should I use?",
        turn_tools_called=["patch_team_draft"],
    )
    assert "name" in (out or "").lower()
    assert "description" not in (out or "").lower()


def test_ground_rejects_saved_claim_after_team_name_correction(monkeypatch):
    """Ghost 'I have saved the team' must become an ask for the new name."""
    from app.agents.ticketing_coworker import _ground_guided_collect_reply
    from app.memory.session import SharedMemory

    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: (
            "I have saved the team with the name NLP 1. "
            "The Teams list on the right is now updated."
        ),
    )
    mem = SharedMemory(organization_id="1", user_id="u", session_id="g")
    mem.durable["team_draft"] = {
        "name": "NLP 1",
        "awaiting": "name",
        "ready": False,
    }
    mem.durable["last_tool_outcome"] = {
        "tool": "patch_team_draft",
        "success": True,
        "payload": {
            "awaiting": "name",
            "draft": {"name": "NLP 1", "awaiting": "name"},
            "message": "Ask the user for the new name now.",
        },
    }
    out = _ground_guided_collect_reply(
        mem,
        "I have saved the team with the name NLP 1. The Teams list on the right "
        "is now updated to reflect this change. What would you like to do next?",
        turn_tools_called=["patch_team_draft"],
    )
    text = (out or "").lower()
    assert "nlp 1" in text
    assert "new name" in text
    assert "i have saved" not in text
    assert "teams list" not in text


def test_record_tool_keeps_patch_draft_for_llm():
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.record_tool(
        name="patch_team_draft",
        arguments={"awaiting": "name"},
        result={
            "success": True,
            "payload": {
                "awaiting": "name",
                "ready": False,
                "draft_key": "team_draft",
                "workflow": "create_team",
                "updated_fields": [],
                "message": "Ask only for name.",
                "draft": {
                    "name": "ML Team",
                    "awaiting": "name",
                    "available_members": ["A", "B"],
                    "_intent_start_text": "create team",
                },
            },
        },
    )
    last = mem.durable.get("last_tool_outcome") or {}
    payload = last.get("payload") or {}
    assert payload.get("awaiting") == "name"
    assert payload.get("draft", {}).get("name") == "ML Team"
    assert "available_members" not in (payload.get("draft") or {})
    assert "Ask only for name." in str(last.get("message") or "")


def test_patch_payload_tells_llm_to_ask_awaiting():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    _execute_local_ui_tool(
        "patch_team_draft",
        {"name": "ML Team"},
        memory=mem,
        ui_actions=[],
    )
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"awaiting": "name"},
        memory=mem,
        ui_actions=[],
    )
    assert out["success"] is True
    payload = out.get("payload") or {}
    assert payload.get("awaiting") == "name"
    assert "new name" in str(payload.get("message") or "").lower()
    assert "did not create or save" in str(payload.get("message") or "").lower()
    assert (payload.get("draft") or {}).get("name") == "ML Team"


def test_executor_collect_reply_grounds_after_patch(monkeypatch):
    """Tool succeeds; idle greeting is replaced from the live draft TOOL RESULT."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.mcp.authorization import issue_mcp_token
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    fake = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "p1",
                        "name": "patch_team_draft",
                        "arguments": {"name": "ML Team"},
                    }
                ],
            },
            {
                "content": "How can I help you create a team today?",
                "tool_calls": [],
            },
        ]
    )
    monkeypatch.setattr(
        "app.tasks.phrase.phrase_reply",
        lambda **kw: "Got ML Team. What description should I use?",
    )
    mem = SharedMemory(organization_id="org-1", user_id="u1", session_id="e2e-team")
    mem.set_task_state(new_harness_task_state("team.create"))
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {"awaiting": "name"}
    request = RunRequest(
        message="ML Team",
        session_id="e2e-team",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="admin",
        surface="agent-queues",
    )
    actor = ToolActor(
        user_id="u1",
        organization_id="org-1",
        user_role="admin",
    )
    out = tc._run_executor_loop(
        agent_name="teams",
        llm=fake,
        memory=mem,
        query="ML Team",
        context={
            "request": request,
            "module": "admin",
            "surface": "agent-queues",
            "page": "Teams",
            "mcp_token": issue_mcp_token(
                organization_id="org-1",
                actor_id="u1",
                role="admin",
                module="admin",
                surface="agent-queues",
                agent_id="team_queue_crud_executor",
                task_id="team.create",
                skill_name="team-create",
            ),
        },
        actor=actor,
        budgets=BudgetTracker(RunBudgets(max_rounds=4)),
        module="admin",
        surface="agent-queues",
        page="Teams",
        role="admin",
        harness_executor="team_queue_crud_executor",
        harness_skill="team-create",
    )
    draft = mem.durable.get("team_draft") or {}
    assert draft.get("name") == "ML Team"
    assert str(draft.get("awaiting") or "").lower() == "description"
    reply = str(out.get("assistant_text") or "")
    assert "how can i help you create a team" not in reply.lower()
    assert "ml team" in reply.lower() or "description" in reply.lower()
    actions = out.get("ui_actions") or []
    assert any(
        isinstance(a, dict)
        and a.get("type") == "create_team"
        and str(a.get("name") or "") == "ML Team"
        for a in actions
    )


def test_executor_does_not_absorb_utterance_without_patch(monkeypatch):
    """Open-slot text is not stored unless the executor patches the draft."""
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.mcp.authorization import issue_mcp_token
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor
    from app.workflow_schemas import new_harness_task_state

    fake = _FakeLLM(
        [
            {
                "content": "What should the new name be?",
                "tool_calls": [],
            }
        ]
    )
    mem = SharedMemory(organization_id="org-1", user_id="u1", session_id="no-absorb")
    mem.set_task_state(new_harness_task_state("team.create"))
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "awaiting": "description",
        "name": "Software Engineering (App Development)",
    }
    request = RunRequest(
        message="chznge the name",
        session_id="no-absorb",
        actor=ActorContext(
            user_id="u1",
            organization_id="org-1",
            user_role="admin",
        ),
        module="admin",
        surface="agent-queues",
    )
    actor = ToolActor(
        user_id="u1",
        organization_id="org-1",
        user_role="admin",
    )
    tc._run_executor_loop(
        agent_name="teams",
        llm=fake,
        memory=mem,
        query="chznge the name",
        context={
            "request": request,
            "module": "admin",
            "surface": "agent-queues",
            "page": "Teams",
            "mcp_token": issue_mcp_token(
                organization_id="org-1",
                actor_id="u1",
                role="admin",
                module="admin",
                surface="agent-queues",
                agent_id="team_queue_crud_executor",
                task_id="team.create",
                skill_name="team-create",
            ),
        },
        actor=actor,
        budgets=BudgetTracker(RunBudgets(max_rounds=4)),
        module="admin",
        surface="agent-queues",
        page="Teams",
        role="admin",
        harness_executor="team_queue_crud_executor",
        harness_skill="team-create",
    )
    draft = mem.durable.get("team_draft") or {}
    assert draft.get("name") == "Software Engineering (App Development)"
    assert draft.get("description") in (None, "")
    assert str(draft.get("awaiting") or "").lower() == "description"


def test_absorb_does_not_store_change_the_name_as_team_members():
    from app.agents.ticketing_coworker import _absorb_guided_field_utterance
    from app.memory.session import SharedMemory

    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "name": "ML model training",
        "description": "Trains production models.",
        "awaiting": "members",
        "available_members": ["Yaswanth MG", "Ashika A"],
    }
    ui: list = []
    assert (
        _absorb_guided_field_utterance(mem, "change the name", "teams", ui) is False
    )
    assert not (mem.durable["team_draft"].get("members") or [])
    assert mem.durable["team_draft"]["name"] == "ML model training"


def test_patch_team_correction_value_drops_instruction_members():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    roster = ["Yaswanth MG", "Ashika A"]
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["current_workflow"] = "create_team"
    mem.durable["team_draft"] = {
        "name": "ML model training",
        "description": "Trains production models.",
        "awaiting": "name",
        "members": ["change the name"],
        "available_members": roster,
    }
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {
            "awaiting": "name",
            "name": "AI/ML Model training",
            "members": ["change the name"],
        },
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True, out
    draft = mem.durable["team_draft"]
    assert draft["name"] == "AI/ML Model training"
    assert draft["description"] == "Trains production models."
    assert not (draft.get("members") or [])
    assert draft["awaiting"] == "members"


def test_patch_team_draft_accepts_unique_first_token_member():
    from app.agents.ticketing_coworker import _execute_local_ui_tool
    from app.memory.session import SharedMemory

    roster = ["Yaswanth MG", "Mohammed Fazil", "Ashika A"]
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    mem.durable["team_draft"] = {
        "name": "ccaas",
        "description": "CCaaS team",
        "awaiting": "members",
        "available_members": roster,
    }
    out = _execute_local_ui_tool(
        "patch_team_draft",
        {"members": ["yaswanth"]},
        memory=mem,
        ui_actions=[],
    )
    assert out.get("success") is True, out
    assert (mem.durable.get("team_draft") or {}).get("members") == ["Yaswanth MG"]


def test_domain_return_to_super_reroutes_catalog_create(monkeypatch):
    from app.agents import ticketing_coworker as tc
    from app.contracts.execution import ActorContext, RunBudgets, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.budgets import BudgetTracker
    from app.tools.express_client import ToolActor

    class _LLM:
        def __init__(self) -> None:
            self.super_routes = 0
            self.domain_calls = 0

        def run(self, messages, tools=None, **kwargs):
            names: set[str] = set()
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
                names.add(str(fn.get("name") or tool.get("name") or "").strip())
            if "delegate_to_executor" in names:
                self.domain_calls += 1
                if self.domain_calls == 1:
                    return {
                        "content": "",
                        "tool_calls": [
                            {
                                "name": "return_to_super",
                                "arguments": {
                                    "action": "park",
                                    "query": "create a new team",
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
                                "objective": "Create a new team",
                            },
                        }
                    ],
                }
            if "route_to_domain" in names:
                self.super_routes += 1
                domain = (
                    "resolution_lifecycle_domain"
                    if self.super_routes == 1
                    else "catalog_administration_domain"
                )
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "name": "route_to_domain",
                            "arguments": {
                                "domain_id": domain,
                                "query": "create a new team",
                            },
                        }
                    ],
                }
            return {"content": "", "tool_calls": []}

    seen: dict = {}

    def fake_executor(**kwargs):
        seen["instruction"] = kwargs["instruction"]
        return {
            "response_type": "final",
            "assistant_text": "What should we name this team?",
            "agent": "team_queue_crud_executor",
        }

    monkeypatch.setattr(tc, "_run_harness_executor", fake_executor)
    mem = SharedMemory(organization_id="1", user_id="u", session_id="s")
    req = RunRequest(
        message="create a new team",
        session_id="s",
        actor=ActorContext(user_id="u", organization_id="1", user_role="admin"),
        module="teams",
        surface="staff",
        page="agent-queues",
    )
    llm = _LLM()
    result = tc._run_harness_supervisor(
        llm=llm,
        memory=mem,
        query="create a new team",
        context={"request": req, "module": "teams", "surface": "staff"},
        actor=ToolActor(user_id="u", organization_id="1", user_role="admin"),
        budgets=BudgetTracker(RunBudgets()),
    )
    assert llm.super_routes == 2
    assert llm.domain_calls == 2
    assert seen["instruction"].skill_name == "team-create"
    assert result.get("agent") == "team_queue_crud_executor"


def test_kb_disposition_park_keeps_live_draft():
    from app.agents.ticketing_coworker import _execute_return_to_super
    from app.workflow_schemas import new_harness_task_state

    mem = SharedMemory(organization_id="1", user_id="u", session_id="kb-park")
    mem.durable["kb_draft"] = {
        "title": "Setting Up Your BOOXOO Account",
        "category": "Account & Profile",
        "body": "Open the BOOXOO website.",
        "awaiting": "publication_intent",
    }
    mem.durable["current_workflow"] = "create_kb"
    mem.set_task_state(new_harness_task_state("knowledge.article.create"))
    blocked = _execute_return_to_super(
        {"action": "park", "query": "yes", "reason": "ambiguous"},
        memory=mem,
        harness_skill="knowledge-article-create",
    )
    assert blocked.get("success") is False
    assert blocked.get("error_code") == "CONFLICT"
    assert mem.current_task_state() is not None
    assert mem.durable.get("kb_draft", {}).get("title") == "Setting Up Your BOOXOO Account"
    assert mem.durable.get("_return_to_super_query") is None

    mem.durable["kb_draft"] = {"awaiting": "title"}
    allowed = _execute_return_to_super(
        {"action": "park", "query": "create a new team"},
        memory=mem,
        harness_skill="knowledge-article-create",
    )
    assert allowed.get("success") is True
    assert mem.current_task_state() is None
    assert mem.durable.get("_return_to_super_query") == "create a new team"


def test_tool_loop_stops_after_successful_park():
    mem = SharedMemory(organization_id="1", user_id="u", session_id="park-stop")
    calls = {"n": 0}

    def execute(name, args):
        calls["n"] += 1
        return {
            "success": True,
            "payload": {"action": "park", "query": args.get("query")},
        }

    llm = _FakeLLM(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "name": "return_to_super",
                        "arguments": {"action": "park", "query": "create a team"},
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "2",
                        "name": "return_to_super",
                        "arguments": {"action": "park", "query": "create a team"},
                    }
                ],
            },
        ]
    )
    text = run_tool_loop(
        llm=llm,  # type: ignore[arg-type]
        system_prompt="sys",
        memory=mem,
        tools=[
            ToolDefinition(
                name="return_to_super",
                description="park",
                input_schema={"type": "object", "properties": {}},
            )
        ],
        execute_tool=execute,
        budgets=BudgetTracker(RunBudgets(max_rounds=6)),
        user_message="create a team",
    )
    assert calls["n"] == 1
    assert text.strip() == ""
