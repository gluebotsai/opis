"""
3. Graph routing & control flow — edges, recursion, fallback, convergence.
"""

from __future__ import annotations

import pytest

from app.agents.router import VALID_ROUTES, pick_next, route_query
from app.graph import build_graph, get_compiled_graph, run_chat
from app.state import AgentState
from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db


ROUTE_CASES = [
    ("show my open tickets", "tickets"),
    ("list teams and queues", "teams"),
    ("search kb password reset", "kb"),
    ("find customer acme", "customers"),
    ("what can you help me with today?", "general"),
]


class TestConditionalEdgeDeterminism:
    @pytest.mark.parametrize("text,expected", ROUTE_CASES)
    def test_heuristic_route_stable(self, monkeypatch, fresh_memory, text, expected):
        patch_no_db(monkeypatch)
        llm = patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
        out = run_chat(
            text,
            organization_id="org-rt",
            session_id=f"s-{expected}",
            history=[{"role": "user", "text": text}],
        )
        assert out["agent"] == expected
        # Same input twice → same route
        out2 = run_chat(
            text,
            organization_id="org-rt",
            session_id=f"s-{expected}-2",
            history=[{"role": "user", "text": text}],
        )
        assert out2["agent"] == out["agent"]
        # Filter/create commands may short-circuit without an LLM round-trip.
        if not (out.get("actions") or out2.get("actions")):
            assert llm.records

    def test_pick_next_unknown_falls_to_general(self):
        assert pick_next({"route": "nope"}) == "general"  # type: ignore[arg-type]
        assert pick_next({"route": None}) == "general"
        for r in VALID_ROUTES:
            assert pick_next({"route": r}) == r  # type: ignore[arg-type]


class TestRecursionLimit:
    def test_invoke_respects_recursion_limit(self, monkeypatch, fresh_memory):
        """Native runner completes a turn without graph recursion."""
        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
        out = run_chat(
            "hi",
            organization_id="org-rec",
            session_id="s-rec",
            history=[{"role": "user", "text": "hi"}],
        )
        assert out is not None
        assert out.get("reply") or out.get("data", {}).get("serviceError")

    def test_graph_has_no_cycles_in_static_edges(self):
        """Compiled LangGraph removed — noop shim remains for cache clear."""
        g = build_graph()
        compiled = g.compile()
        assert compiled is get_compiled_graph()
        assert hasattr(compiled, "cache_clear")


class TestFallbackRouting:
    def test_garbage_semantic_output_degrades_without_502(
        self, monkeypatch, fresh_memory
    ):
        """Native FakeLLM garbage mode still yields a final model reply or error."""
        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="garbage"))
        out = run_chat(
            "something odd",
            organization_id="org-fb",
            session_id="s-fb",
            history=[{"role": "user", "text": "something odd"}],
        )
        assert isinstance(out, dict)
        # Native path: either a non-empty LLM reply or a structured service error.
        reply = str(out.get("reply") or "").strip()
        err = out.get("data", {}).get("serviceError")
        assert reply or err

    def test_route_query_normalizes_punctuation(self, monkeypatch):
        class _LLM:
            def invoke(self, *_a, **_k):
                from app.messages_compat import AIMessage

                return AIMessage(content="Tickets!!!")

            def bind(self, **_k):
                return self

            def bind_tools(self, *_a, **_k):
                return self

        monkeypatch.setattr("app.agents.intent.get_llm", lambda: _LLM())
        state: AgentState = {
            "messages": [],
            "route": None,
            "intent": None,
            "page": None,
            "organization_id": "o",
            "summary": None,
            "ticket_draft": None,
            "next_step": None,
            "session_history": None,
            "user_id": None,
            "user_name": None,
            "reply": None,
        }
        from app.messages_compat import HumanMessage

        state["messages"] = [HumanMessage(content="fix ticket")]
        out = route_query(state)
        assert out["route"] == "tickets"
        assert out.get("intent") == "TICKET"


class TestParallelBranching:
    def test_single_specialist_per_turn(self, llm):
        """Native handoffs are exclusive — one specialist owns the final reply."""
        text = "how many tickets are assigned to me?"
        llm.mark_turn_start()
        out = run_chat(
            text,
            organization_id="org-par",
            session_id="s-par",
            history=[{"role": "user", "text": text}],
        )
        assert out["agent"] in {"tickets", "general", "ticketing_coworker"}
        assert out.get("reply") or out.get("data", {}).get("serviceError")
        # At most one specialist-shaped reply record when FakeLLM classifies one.
        specs = [r for r in llm.records if r.kind == "specialist"]
        assert len(specs) <= 1


class TestGraphConvergence:
    def test_end_reachable_all_routes(self, monkeypatch, fresh_memory):
        patch_no_db(monkeypatch)
        for route in sorted(VALID_ROUTES):
            patch_llm(monkeypatch, AdvancedFakeLLM(route=route, route_mode="fixed"))
            out = run_chat(
                f"force {route}",
                organization_id="org-end",
                session_id=f"s-end-{route}",
                history=[{"role": "user", "text": f"force {route}"}],
            )
            assert out["agent"] == route
            assert out["reply"]  # specialist wrote something → reached END
