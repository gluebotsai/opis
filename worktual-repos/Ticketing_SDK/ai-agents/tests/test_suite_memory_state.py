"""
1. Memory & State — schema, accumulation, cross-node, isolation, checkpoint, bloat.
"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.graph import get_compiled_graph, run_chat
from app.main import ChatRequest, HistoryItem
from app.memory import build_thread_id, thread_config
from app.memory_contract import HISTORY_WINDOW, normalize_history
from app.state import AgentState
from tests.helpers import SESSION_BANK, guided_history


class TestStateSchemaValidation:
    def test_agent_state_keys(self):
        need = {
            "messages",
            "route",
            "page",
            "organization_id",
            "summary",
            "ticket_draft",
            "next_step",
            "session_history",
            "user_id",
            "user_name",
            "reply",
        }
        assert need.issubset(AgentState.__annotations__)

    def test_chat_request_rejects_empty(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="")

    def test_history_items_ok(self):
        req = ChatRequest(
            message="hi",
            history=[HistoryItem(role="user", text="a")],
        )
        assert req.history and req.history[0].text == "a"

    def test_normalize_filters_junk(self):
        assert normalize_history(
            [{"role": "tool", "text": "x"}, {"role": "user", "text": "ok"}]
        ) == [{"role": "user", "text": "ok"}]


class TestStateAccumulation:
    def test_facts_accumulate(self, llm):
        org, sid, hist = "org-acc", "s-acc", []
        for fact in ("alpha", "beta", "gamma"):
            msg = f"remember {fact}"
            hist = [*hist, {"role": "user", "text": msg}]
            out = run_chat(msg, organization_id=org, session_id=sid, history=hist)
            hist.append({"role": "assistant", "text": out["reply"]})
        q = "what did I remember?"
        run_chat(q, organization_id=org, session_id=sid, history=[*hist, {"role": "user", "text": q}])
        prior = llm.last_human.lower()
        for fact in ("alpha", "beta", "gamma"):
            assert fact in prior

    def test_guided_name_survives(self, llm):
        hist = guided_history("manoj", "manoj@x.test")
        q = "what is my name?"
        out = run_chat(
            q,
            organization_id="org-g",
            session_id="s-g",
            history=[*hist, {"role": "user", "text": q}],
        )
        assert "manoj" in out["reply"].lower()


class TestCrossNodePersistence:
    def test_router_and_specialist_share_session(self, llm):
        hist = guided_history("priya", "p@x.test")
        q = "what is my name?"
        run_chat(
            q,
            organization_id="org-xn",
            session_id="s-xn",
            history=[*hist, {"role": "user", "text": q}],
        )
        assert any(r.kind == "workflow_nlu" for r in llm.records)
        assert "priya" in llm.last_human.lower()

    def test_checkpoint_stores_org(self, llm):
        org, sid = "org-cp", "s-cp"
        run_chat(
            "hello",
            organization_id=org,
            session_id=sid,
            history=[{"role": "user", "text": "hello"}],
        )
        snap = get_compiled_graph().get_state(thread_config(build_thread_id(org, sid)))
        assert (snap.values or {}).get("organization_id") == org


class TestThreadIsolation:
    def test_bank_no_cross_leak(self, llm):
        for row in SESSION_BANK:
            hist = [
                *guided_history(row["name"], row["email"], row["issue"]),
                {"role": "user", "text": f"store secret {row['secret']}"},
            ]
            run_chat(
                f"store secret {row['secret']}",
                organization_id=row["org"],
                session_id=row["session"],
                history=hist,
            )

        leaks, misses = [], []
        for row in SESSION_BANK:
            hist = [
                *guided_history(row["name"], row["email"], row["issue"]),
                {"role": "user", "text": f"store secret {row['secret']}"},
                {"role": "assistant", "text": "stored"},
                {"role": "user", "text": "what is my secret and name?"},
            ]
            llm.mark_turn_start()
            run_chat(
                "what is my secret and name?",
                organization_id=row["org"],
                session_id=row["session"],
                history=hist,
            )
            human = llm.last_human
            if row["secret"] not in human or row["name"] not in human:
                misses.append(row["session"])
            for other in SESSION_BANK:
                if other["session"] != row["session"] and other["secret"] in human:
                    leaks.append((row["session"], other["secret"]))
        assert not misses
        assert not leaks

    def test_same_sid_different_org(self, llm):
        sid = "shared"
        run_chat(
            "secret is ALPHA-ONLY",
            organization_id="org-A",
            session_id=sid,
            history=[{"role": "user", "text": "secret is ALPHA-ONLY"}],
        )
        run_chat(
            "what is the secret?",
            organization_id="org-B",
            session_id=sid,
            history=[
                {"role": "user", "text": "hi"},
                {"role": "assistant", "text": "ok"},
                {"role": "user", "text": "what is the secret?"},
            ],
        )
        assert "ALPHA-ONLY" not in llm.last_human


class TestTimeTravelCheckpoint:
    def test_state_history_readable(self, llm):
        org, sid = "org-tt", "s-tt"
        cfg = thread_config(build_thread_id(org, sid))
        run_chat("first", organization_id=org, session_id=sid, history=[{"role": "user", "text": "first"}])
        run_chat(
            "second",
            organization_id=org,
            session_id=sid,
            history=[
                {"role": "user", "text": "first"},
                {"role": "assistant", "text": "ok"},
                {"role": "user", "text": "second"},
            ],
        )
        hist = list(get_compiled_graph().get_state_history(cfg))
        assert hist
        assert get_compiled_graph().get_state(cfg).config is not None


class TestStateSizeBloat:
    def test_window_cap(self):
        huge = [{"role": "user", "text": f"x{i}"} for i in range(HISTORY_WINDOW + 100)]
        assert len(normalize_history(huge)) == HISTORY_WINDOW

    def test_messages_bounded_after_turns(self, llm):
        org, sid, hist = "org-bl", "s-bl", []
        for i in range(10):
            msg = f"t{i}"
            hist = [*hist, {"role": "user", "text": msg}]
            out = run_chat(msg, organization_id=org, session_id=sid, history=hist)
            hist.append({"role": "assistant", "text": out["reply"]})
        msgs = (
            get_compiled_graph()
            .get_state(thread_config(build_thread_id(org, sid)))
            .values.get("messages")
            or []
        )
        assert len(msgs) <= HISTORY_WINDOW + 5

    def test_payload_size(self):
        hist = guided_history("a", "a@b.c")
        assert len(json.dumps(hist)) < 20_000
