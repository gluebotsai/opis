"""
2. Latency & Performance — node timing, E2E, TTFT proxy, tools, tokens, concurrency.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

from app.graph import run_chat
from app.tasks.phrase import phrase_reply
from app.tasks.ticket_reason import ticket_reason_turn
from tests.helpers import AdvancedFakeLLM, guided_history, patch_llm

NODE_BUDGET_MS = 50
E2E_BUDGET_MS = 400
TTFT_BUDGET_MS = 120
CONCURRENCY_N = 12


class TestNodeLevelLatency:
    def test_router_and_specialist_under_budget(self, llm):
        """Semantic workflow/intent decision + specialist stay under budget."""
        hist = guided_history("manoj", "m@t.test")
        q = "what is my name?"
        llm.mark_turn_start()
        run_chat(
            q,
            organization_id="org-lat",
            session_id="s-lat",
            history=[*hist, {"role": "user", "text": q}],
        )
        by_kind: dict[str, list[float]] = {}
        for r in llm.records:
            by_kind.setdefault(r.kind, []).append(r.ms)
        assert "workflow_nlu" in by_kind
        # Idle NORMAL_ROUTE uses Cheap Intent (frozen architecture).
        assert "intent" in by_kind or "specialist" in by_kind
        assert any(k in by_kind for k in ("specialist", "other", "intent"))
        for kind, times in by_kind.items():
            assert max(times) < NODE_BUDGET_MS, f"{kind} {max(times):.1f}ms"


class TestEndToEndLatency:
    def test_e2e_under_budget(self, llm):
        hist = guided_history("manoj", "m@t.test")
        q = "what is my name?"
        t0 = time.perf_counter()
        out = run_chat(
            q,
            organization_id="org-e2e",
            session_id="s-e2e",
            history=[*hist, {"role": "user", "text": q}],
        )
        ms = (time.perf_counter() - t0) * 1000
        assert out["reply"]
        assert ms < E2E_BUDGET_MS, f"e2e {ms:.1f}ms"


class TestTTFT:
    def test_time_to_first_model_completion(self, llm):
        """No streaming — TTFT ≈ first LLM invoke completion."""
        hist = guided_history("manoj", "m@t.test")
        q = "what is my name?"
        llm.mark_turn_start()
        t0 = time.perf_counter()
        run_chat(
            q,
            organization_id="org-ttft",
            session_id="s-ttft",
            history=[*hist, {"role": "user", "text": q}],
        )
        assert llm.records
        assert llm.records[0].ms < TTFT_BUDGET_MS
        assert (time.perf_counter() - t0) * 1000 < E2E_BUDGET_MS


class TestToolBenchmarks:
    def test_phrase_task_fast(self, llm):
        t0 = time.perf_counter()
        reply = phrase_reply(
            module="greeting",
            kind="chitchat",
            fallback="hello seed that must not echo",
            user_text="hi",
            page_label="Home",
        )
        ms = (time.perf_counter() - t0) * 1000
        assert reply
        assert "hello seed that must not echo" not in reply.lower()
        assert ms < NODE_BUDGET_MS * 3

    def test_ticket_reason_fast(self, llm):
        t0 = time.perf_counter()
        out = ticket_reason_turn(
            user_text="manoj",
            step_id="customerName",
            fallback_reply="name?",
        )
        ms = (time.perf_counter() - t0) * 1000
        assert out and out.get("reply")
        assert ms < NODE_BUDGET_MS * 3


class TestTokenOverhead:
    def test_prompt_not_pathological(self, llm):
        hist = guided_history("manoj", "m@t.test")
        q = "what is my name?"
        llm.mark_turn_start()
        run_chat(
            q,
            organization_id="org-tok",
            session_id="s-tok",
            history=[*hist, {"role": "user", "text": q}],
        )
        assert llm.total_tokens_in < 8_000
        assert llm.total_tokens_out < 1_000
        spec = [r for r in llm.records if r.kind == "specialist"]
        decisions = [r for r in llm.records if r.kind == "workflow_nlu"]
        if decisions:
            assert decisions[-1].tokens_in < 4_000


class TestConcurrencyLoad:
    def test_parallel_chats_stable(self, monkeypatch, fresh_memory):
        from tests.helpers import patch_no_db

        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))

        def make(i: int):
            def _():
                hist = guided_history("manoj", "m@t.test")
                q = "what is my name?"
                return run_chat(
                    q,
                    organization_id=f"org-par-{i}",
                    session_id=f"s-par-{i}",
                    history=[*hist, {"role": "user", "text": q}],
                )

            return _

        errors: list[BaseException] = []
        results = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = [pool.submit(make(i)) for i in range(CONCURRENCY_N)]
            for f in futs:
                try:
                    results.append(f.result())
                except BaseException as e:  # noqa: BLE001
                    errors.append(e)
        assert not errors, errors[:3]
        assert len(results) == CONCURRENCY_N
        assert all(r.get("reply") for r in results)
