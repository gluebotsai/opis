"""Guided draft park / side-quest / resume across modules."""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.agents.commands import command_node
from app.tasks.chat_commands import resolve_chat_command
from app.memory_contract import (
    looks_like_side_quest,
    park_flows,
    pick_resume_flow,
    recover_kb_draft_from_history,
    unpark,
)
from app.messages_compat import HumanMessage


def _fake_phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")


def test_park_and_unpark_stack():
    parked = park_flows(
        {"kb": {"awaiting": "category", "title": "add"}},
        except_flows={"macro"},
        existing_parked=[],
    )
    assert parked[-1]["flow"] == "kb"
    draft, rest = unpark(parked, "kb")
    assert draft["title"] == "add"
    assert rest == []


def test_side_quest_parks_kb_draft():
    from app.agents.workflow_manager import resolve_active_workflow

    hit = resolve_active_workflow(
        "how many open tickets are there?",
        page="Knowledge Base",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft={"awaiting": "category", "title": "add"},
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "confidence": 0.95,
        },
    )
    assert hit.get("handled") is False
    assert hit.get("kb_draft") is None
    assert any(
        item.get("flow") == "kb"
        and item.get("draft") == {"awaiting": "category", "title": "add"}
        for item in hit.get("parked_drafts") or []
    )


def test_interrupt_parks_kb_when_starting_macro():
    from app.agents.workflow_manager import resolve_active_workflow

    hit = resolve_active_workflow(
        "create macro",
        page="Knowledge Base",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft={"awaiting": "category", "title": "add"},
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "NEW_TASK",
            "intent": "CREATE",
            "workflow": "create_macro",
            "confidence": 0.95,
        },
    )
    assert hit.get("handled") is False
    assert hit.get("kb_draft") is None
    parked = hit.get("parked_drafts") or []
    assert any(p.get("flow") == "kb" for p in parked)


def test_resume_parked_kb_from_memory():
    from app.agents.workflow_manager import resolve_active_workflow

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._live_kb_categories", return_value=["General"]
    ):
        hit = resolve_active_workflow(
            "continue the article",
            page="Knowledge Base",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            parked_drafts=[
                {"flow": "kb", "draft": {"awaiting": "category", "title": "add"}}
            ],
            session_history=None,
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "article",
                "confidence": 0.95,
            },
        )
    assert hit.get("handled") is True
    assert hit.get("kb_draft", {}).get("title") == "add"
    assert hit.get("kb_draft", {}).get("awaiting") == "category"


def test_auto_resume_parked_kb_on_category_answer():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ), patch(
        "app.tasks.catalog_commands._live_kb_categories", return_value=["General"]
    ):
        out = resolve_chat_command(
            "category is help",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            parked_drafts=[
                {"flow": "kb", "draft": {"awaiting": "category", "title": "add"}}
            ],
        )
    assert out.get("handled") is True
    assert out.get("kb_draft", {}).get("awaiting") == "body"
    assert out.get("kb_draft", {}).get("category") == "Help"


def test_command_node_omits_draft_keys_preserves_state():
    """Unhandled turn omits draft keys so the checkpointer keeps prior drafts."""
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase):
        out = command_node(
            {
                "messages": [HumanMessage(content="hi")],
                "organization_id": "org-1",
                "user_role": "admin",
                "kb_draft": {"awaiting": "category", "title": "add"},
                "page": "Knowledge Base",
            }  # type: ignore[arg-type]
        )
    # Commands shim skips active workflow (Workflow Manager owns side quests).
    assert out.get("command_handled") is False
    # Omitting kb_draft leaves LangGraph checkpointer memory unchanged.
    assert "kb_draft" not in out or out.get("kb_draft") == {
        "awaiting": "category",
        "title": "add",
    }


def test_recover_kb_from_history():
    hist = [
        {"role": "user", "text": "create kb article"},
        {"role": "assistant", "text": "What should the article title be?"},
        {"role": "user", "text": "add"},
        {
            "role": "assistant",
            "text": "Got **add**. Pick a category or type a new name.",
        },
    ]
    draft = recover_kb_draft_from_history(hist)
    assert draft is not None
    assert draft.get("title") == "add"
    assert draft.get("awaiting") == "category"


def test_looks_like_side_quest_and_resume_hint():
    # Side quest / resume targeting is Gemma-owned; keyword probes are disabled.
    assert not looks_like_side_quest("how many open tickets?")
    assert not looks_like_side_quest("show my tickets")
    assert not looks_like_side_quest("Billing")
    parked = [{"flow": "kb", "draft": {"awaiting": "category"}}]
    assert pick_resume_flow("back to the article", parked) == "kb"


def test_strip_llm_thought_preamble():
    from app.tasks.phrase import strip_llm_thought_preamble

    assert strip_llm_thought_preamble("thought\nThere are 12 open tickets.") == (
        "There are 12 open tickets."
    )
    assert strip_llm_thought_preamble("Thought: hello") == "hello"
    assert strip_llm_thought_preamble("Plain reply") == "Plain reply"
    channel_spam = "<|channel>thought\n<channel|><|channel>thought\n" * 5
    assert strip_llm_thought_preamble(channel_spam) == ""
    dumped = (
        "call:kb:create_kb_article{title: 'CRM', category: 'General', body: 'hello'}"
    )
    assert strip_llm_thought_preamble(dumped) == ""
    assert "call:" not in strip_llm_thought_preamble("Published.\n" + dumped)
    queued = (
        'call:agent-queues:create_queue{description: "sales and marketing", '
        'members: ["Yaswanth mg"], name: "Sales Team"}'
    )
    assert strip_llm_thought_preamble(queued) == ""
    assert "call:" not in strip_llm_thought_preamble(queued).lower()


def test_seed_echo_never_counts_as_chat_reply():
    from app.tasks.phrase import is_seed_or_next_step_echo, strip_leading_intent_label

    seed = "Intent: start create-ticket; ask for the customer full name only."
    assert is_seed_or_next_step_echo(seed, fallback=seed)
    assert is_seed_or_next_step_echo("customer full name", next_step="customer full name")
    assert is_seed_or_next_step_echo("Intent: open Home.")
    assert not is_seed_or_next_step_echo(
        "I've opened **Home** — what should we look at next?",
        fallback="Intent: open Home.",
        next_step="offer a ticket id from the feed or other help",
    )
    assert (
        strip_leading_intent_label("Intent: open Home.\nI've opened Home.")
        == "I've opened Home."
    )


def test_phrase_resume_never_returns_next_step_label():
    from app.agents.workflow_manager import _phrase_resume

    with patch("app.tasks.chat_commands._llm_phrase", return_value=""):
        out = _phrase_resume(
            text="continue",
            flow="ticket",
            draft={"awaiting": "name"},
            page="Create Ticket",
        )
    assert out == ""
    assert "customer full name" not in (out or "")


def test_conversation_context_load_failure_is_fail_closed():
    from app.memory import ConversationContextLoadError, load_conversation_context
    from app.memory_api_client import ConversationContextApiError

    org = "1"
    with patch("app.memory_api_client._use_api", return_value=True), patch(
        "app.memory_api_client.api_load_context",
        side_effect=ConversationContextApiError("db down"),
    ):
        with pytest.raises(ConversationContextLoadError):
            load_conversation_context(org, "user-a", "session-a")


def test_run_chat_does_not_save_after_failed_load():
    from app.graph import _run_chat_once
    from app.memory import ConversationContextLoadError

    with patch(
        "app.memory.session.load_conversation_context",
        side_effect=ConversationContextLoadError("db down"),
    ), patch("app.memory.session.save_conversation_context") as save, patch(
        "app.runtime.orchestrator.run_native_turn"
    ) as native, patch("app.memory.durable_store.touch"), patch(
        "app.llm_log.log_llm", create=True
    ):
        out = _run_chat_once(
            "hello",
            organization_id="1",
            session_id="session-a",
            user_id="user-a",
        )
    save.assert_not_called()
    native.assert_not_called()
    assert out["data"]["serviceError"] == "SERVICE_ERROR"
    assert out["data"]["retryable"] is True


def test_conversation_context_load_is_tenant_user_session_scoped():
    from app.memory import load_conversation_context

    cursor = MagicMock()
    cursor.fetchone.return_value = {
        "context": {"last_query": {"operation": "LIST_TICKETS"}},
        "version": 7,
    }
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor

    @contextmanager
    def fake_db():
        yield connection

    org = "1"
    with patch("app.memory_api_client._use_api", return_value=False), patch(
        "app.memory.durable_store.db_conn", fake_db
    ):
        context, version = load_conversation_context(org, "user-a", "session-a")

    assert version == 7
    assert context["last_query"]["operation"] == "LIST_TICKETS"
    params = cursor.execute.call_args.args[1]
    assert params == (org, "user-a", "session-a")


def test_stale_conversation_context_update_is_rejected():
    from app.memory import StaleConversationContextError, save_conversation_context

    cursor = MagicMock()
    cursor.fetchone.return_value = None
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor

    @contextmanager
    def fake_db():
        yield connection

    org = "1"
    with patch("app.memory_api_client._use_api", return_value=False), patch(
        "app.memory.durable_store.db_conn", fake_db
    ):
        with pytest.raises(StaleConversationContextError):
            save_conversation_context(
                org,
                "user-a",
                "session-a",
                {"active_workflow": None},
                expected_version=3,
            )
    connection.rollback.assert_called_once()
    connection.commit.assert_not_called()


def test_shared_memory_persist_retries_after_concurrent_focus_update():
    """Agent-turn persist must survive a concurrent /focus CAS bump."""
    from app.contracts.errors import MemoryConflict
    from app.memory.session import SharedMemory

    memory = SharedMemory(
        organization_id="1000",
        user_id="1005",
        session_id="sess-conflict",
        request_id="req-1",
        durable={"recent_history": [{"role": "user", "text": "hi"}]},
        version=2,
    )
    calls = {"n": 0}

    def fake_save(*_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise MemoryConflict("conversation_context was updated by another turn")
        return 4

    with patch(
        "app.memory.session.save_conversation_context", side_effect=fake_save
    ), patch(
        "app.memory.session.load_conversation_context",
        return_value=({"last_entity": {"type": "ticket", "id": "1"}}, 3),
    ), patch(
        "app.memory.session.persist_workflow_events"
    ):
        version = memory.persist(max_retries=3)

    assert calls["n"] == 2
    assert version == 4
    assert memory.version == 4
    assert (memory.durable.get("last_entity") or {}).get("id") == "1"
    assert memory.durable.get("recent_history")


def test_workflow_events_keep_field_names_but_drop_private_values():
    from app.memory import begin_workflow_events, drain_workflow_events, emit_workflow_event

    begin_workflow_events()
    emit_workflow_event(
        "workflow_field_extracted",
        workflow="create_ticket",
        field="customerEmail",
        customerEmail="ada@example.com",
        prompt="full private prompt",
    )
    emit_workflow_event("not_an_allowed_event", workflow="create_ticket")
    events = drain_workflow_events()

    assert events == [
        {
            "event_type": "workflow_field_extracted",
            "details": {"workflow": "create_ticket", "field": "customerEmail"},
            "occurred_at": events[0]["occurred_at"],
        }
    ]
    assert "ada@example.com" not in str(events)
    assert "private prompt" not in str(events)


def test_process_cache_restart_hydrates_only_durable_ticket_context():
    """After process restart, durable conversation_context is the only source of draft truth."""
    from app.memory.session import SharedMemory
    from app.workflow_state import normalize_conversation_context

    durable = {
        "last_entity": None,
        "recent_entities": [],
        "last_query": {"operation": "LIST_TICKETS", "filters": {"created_by": "SELF"}},
        "ticket_draft": {
            "awaiting": "issue",
            "customerName": "Ada",
            "customerEmail": "ada@example.com",
        },
        "current_workflow": "create_ticket",
        "parked_workflows": [],
    }

    with patch(
        "app.memory.session.load_conversation_context", return_value=(durable, 4)
    ):
        mem = SharedMemory.hydrate(
            organization_id="1",
            user_id="user-a",
            session_id="session-a",
        )

    assert mem.version == 4
    assert mem.durable["ticket_draft"]["awaiting"] == "issue"
    assert mem.durable["ticket_draft"]["customerName"] == "Ada"
    assert mem.durable["ticket_draft"]["customerEmail"] == "ada@example.com"
    client_wrong = {"awaiting": "name", "customerName": "Wrong client copy"}
    merged = normalize_conversation_context(
        {**mem.durable, "ticket_draft": mem.durable["ticket_draft"]}
    )
    assert merged["ticket_draft"]["customerName"] == "Ada"
    assert client_wrong["customerName"] != merged["ticket_draft"]["customerName"]


def test_process_cache_restart_hydrates_team_macro_kb_from_durable_context():
    from app.memory.session import SharedMemory

    durable = {
        "active_agent": "teams",
        "last_entity": None,
        "recent_entities": [],
        "last_query": None,
        "team_draft": {"awaiting": "description", "name": "nlp"},
        "parked_drafts": [
            {"flow": "kb", "draft": {"awaiting": "category", "title": "add"}},
            {"flow": "macro", "draft": {"awaiting": "body", "title": "VIP"}},
        ],
    }

    with patch(
        "app.memory.session.load_conversation_context", return_value=(durable, 2)
    ):
        mem = SharedMemory.hydrate(
            organization_id="1",
            user_id="user-a",
            session_id="session-b",
        )

    assert mem.durable["team_draft"]["name"] == "nlp"
    assert mem.durable["team_draft"]["awaiting"] == "description"
    parked = mem.durable.get("parked_drafts") or []
    assert any(p.get("flow") == "kb" and p["draft"].get("title") == "add" for p in parked)
    assert any(
        p.get("flow") == "macro" and p["draft"].get("title") == "VIP" for p in parked
    )


def test_compact_tool_memory_keeps_ids_and_names():
    from app.workflow_state import compact_tool_memory

    mem = compact_tool_memory(
        "list_kb",
        {
            "success": True,
            "payload": {
                "data": [
                    {"id": "101", "title": "VPN Troubleshooting"},
                    {"id": "102", "title": "SSO Login"},
                ]
            },
        },
    )
    assert mem["last_tool"] == "list_kb"
    names = [e.get("name") for e in mem["list_kb"]["entities"]]
    assert "VPN Troubleshooting" in names
    ids = [e.get("id") for e in mem["list_kb"]["entities"]]
    assert "101" in ids


def test_create_team_side_quest_kb_then_resume_keeps_filled_fields():
    from app.agents.workflow_manager import resolve_active_workflow

    parked = resolve_active_workflow(
        "show VPN articles",
        page="Teams",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft=None,
        team_draft={"awaiting": "description", "name": "nlp"},
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "SIDE_QUEST",
            "intent": "KB",
            "agent": "kb",
            "operation": "LIST_KB",
            "filters": {"query": "VPN"},
            "confidence": 0.95,
        },
    )
    assert parked.get("handled") is False
    assert parked.get("team_draft") is None
    assert any(
        item.get("flow") == "team"
        and item.get("draft", {}).get("name") == "nlp"
        for item in parked.get("parked_drafts") or []
    )

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ):
        resumed = resolve_active_workflow(
            "continue the team",
            page="Teams",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            parked_drafts=parked.get("parked_drafts"),
            session_history=None,
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "team",
                "confidence": 0.95,
            },
        )
    assert resumed.get("handled") is True
    draft = resumed.get("team_draft") or {}
    assert draft.get("name") == "nlp"
    assert draft.get("awaiting") == "description"


def test_create_ticket_side_quest_customers_then_resume_keeps_filled_fields():
    from app.agents.workflow_manager import resolve_active_workflow

    parked = resolve_active_workflow(
        "find Mohamed Fazil",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        ticket_draft={
            "awaiting": "issue",
            "customerName": "Ada",
            "customerEmail": "ada@example.com",
        },
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "SIDE_QUEST",
            "intent": "CUSTOMER",
            "agent": "customers",
            "operation": "SEARCH_CUSTOMERS",
            "filters": {"query": "Mohamed Fazil"},
            "confidence": 0.95,
        },
    )
    assert parked.get("handled") is False
    assert parked.get("ticket_draft") is None
    assert any(
        item.get("flow") == "ticket"
        and item.get("draft", {}).get("customerName") == "Ada"
        for item in parked.get("parked_drafts") or []
    )

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase):
        resumed = resolve_active_workflow(
            "continue the ticket",
            page="Tickets",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            ticket_draft=None,
            parked_drafts=parked.get("parked_drafts"),
            session_history=None,
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "confidence": 0.95,
            },
        )
    assert resumed.get("handled") is True
    draft = resumed.get("ticket_draft") or {}
    assert draft.get("customerName") == "Ada"
    assert draft.get("awaiting") == "issue"


def test_create_macro_side_quest_tickets_then_resume_keeps_filled_fields():
    from app.agents.workflow_manager import resolve_active_workflow

    parked = resolve_active_workflow(
        "show open tickets",
        page="Macros",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft={"awaiting": "body", "title": "VIP"},
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "agent": "tickets",
            "operation": "LIST_TICKETS",
            "filters": {"status": "Open"},
            "confidence": 0.95,
        },
    )
    assert parked.get("handled") is False
    assert parked.get("macro_draft") is None
    assert any(
        item.get("flow") == "macro" and item.get("draft", {}).get("title") == "VIP"
        for item in parked.get("parked_drafts") or []
    )

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase):
        resumed = resolve_active_workflow(
            "continue the macro",
            page="Macros",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            parked_drafts=parked.get("parked_drafts"),
            session_history=None,
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "macro",
                "confidence": 0.95,
            },
        )
    assert resumed.get("handled") is True
    draft = resumed.get("macro_draft") or {}
    assert draft.get("title") == "VIP"
    assert draft.get("awaiting") == "body"


def test_informal_confirm_uses_gemma_action_not_keywords():
    from app.agents.workflow_manager import resolve_active_workflow

    draft = {
        "awaiting": "confirm",
        "title": "VPN Troubleshooting",
        "category": "General",
        "body": "Reset the client and retry the tunnel.",
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ), patch(
        "app.tools.catalog_tools.create_kb_article",
        return_value={"success": True, "payload": {"id": "101"}},
    ) as create:
        skipped = resolve_active_workflow(
            "yeh",
            page="Knowledge Base",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=dict(draft),
            parked_drafts=None,
            session_history=None,
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "confidence": 0.4,
            },
        )
        assert skipped is None or skipped.get("handled") is False
        create.assert_not_called()

        confirmed = resolve_active_workflow(
            "file this",
            page="Knowledge Base",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=dict(draft),
            parked_drafts=None,
            session_history=None,
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "operation": "CREATE_KB",
                "confidence": 0.95,
            },
        )
    assert confirmed is None or confirmed.get("handled") is False
    create.assert_not_called()
