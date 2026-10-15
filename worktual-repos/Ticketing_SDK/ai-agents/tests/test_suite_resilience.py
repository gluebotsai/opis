"""
5. Error handling & resilience — timeouts, sanitization, 429, malformed JSON.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.graph import _messages_for_turn, run_chat
from app.main import app
from app.memory_contract import normalize_history
from app.tasks.ticket_reason import _extract_json
from app.tasks.triage import extract_json_object
from tests.helpers import AdvancedFakeLLM, guided_history, patch_llm, patch_no_db

_TASKS_HEADERS = {"X-Coworker-Tasks-Key": "worktual-tasks-dev-secret"}


class TestToolFailureTimeout:
    def test_llm_timeout_surfaces(self, monkeypatch, fresh_memory):
        patch_no_db(monkeypatch)
        patch_llm(
            monkeypatch,
            AdvancedFakeLLM(fail_times=99, fail_exc=TimeoutError("simulated timeout")),
        )
        out = run_chat(
            "how many open tickets are there?",
            organization_id="org-to",
            session_id="s-to",
            history=[{"role": "user", "text": "how many open tickets are there?"}],
        )
        assert out["data"]["serviceError"] == "WORKFLOW_NLU_UNAVAILABLE"

    def test_chat_api_returns_502_on_agent_error(self, monkeypatch, fresh_memory):
        patch_no_db(monkeypatch)
        patch_llm(
            monkeypatch,
            AdvancedFakeLLM(fail_times=99, fail_exc=TimeoutError("boom")),
        )
        client = TestClient(app)
        r = client.post(
            "/chat",
            headers=_TASKS_HEADERS,
            json={
                "message": "how many open tickets are there?",
                "organization_id": "org-api-err",
                "session_id": "s-api-err",
                "history": [{"role": "user", "text": "how many open tickets are there?"}],
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["data"]["serviceError"] == "WORKFLOW_NLU_UNAVAILABLE"
        assert body["ui_actions"] == []


class TestInputSanitization:
    def test_normalize_strips_empty_and_bad_roles(self):
        raw = [
            None,
            {"role": "system", "text": "x"},
            {"role": "user", "text": "  "},
            {"role": "user", "text": "ok"},
            {"role": "USER", "text": "OK2"},
        ]
        out = normalize_history(raw)  # type: ignore[arg-type]
        assert out == [
            {"role": "user", "text": "ok"},
            {"role": "user", "text": "OK2"},
        ]

    def test_messages_for_turn_ignores_script_noise(self):
        hist = [
            {"role": "user", "text": "<script>alert(1)</script>"},
            {"role": "assistant", "text": "noted"},
            {"role": "user", "text": "what is my name?"},
        ]
        _, session = _messages_for_turn("what is my name?", hist)
        assert any("script" in s["text"] for s in session)  # preserved as text, not executed
        assert session[-1]["text"] == "what is my name?"

    def test_oversized_message_still_runs(self, llm):
        big = "x" * 20_000
        out = run_chat(
            big,
            organization_id="org-big",
            session_id="s-big",
            history=[{"role": "user", "text": big}],
        )
        assert out.get("reply") is not None


class TestRateLimitRecovery:
    def test_transient_429_then_success(self, monkeypatch, fresh_memory):
        patch_no_db(monkeypatch)

        class RateLimitError(Exception):
            pass

        llm = AdvancedFakeLLM(
            fail_times=1,
            fail_exc=RateLimitError("429 Too Many Requests"),
            route_mode="heuristic",
        )
        patch_llm(monkeypatch, llm)

        # Semantic decision retries once; the transient first call is recovered.
        out = run_chat(
            "how many open tickets are there?",
            organization_id="org-429",
            session_id="s-429a",
            history=[{"role": "user", "text": "how many open tickets are there?"}],
        )
        assert out["reply"]


class TestMalformedJsonRecovery:
    @pytest.mark.parametrize(
        "raw,ok",
        [
            ('{"a": 1}', True),
            ('```json\n{"a": 1}\n```', True),
            ("not json at all", False),
            ('{"a": 1,}', False),
            ('prefix {"intent":"continue","field":"name","newValue":"x","reason":"r","reply":"hi"} suffix', True),
            ("", False),
        ],
    )
    def test_ticket_reason_extract(self, raw, ok):
        got = _extract_json(raw)
        assert (got is not None) is ok

    @pytest.mark.parametrize(
        "raw,ok",
        [
            ('{"priority":"high"}', True),
            ("blah {\"priority\": \"urgent\"} blah", True),
            ("[", False),
            ("null", False),
        ],
    )
    def test_triage_extract(self, raw, ok):
        got = extract_json_object(raw)
        assert (got is not None) is ok

    def test_guided_history_still_answers_after_noise(self, llm):
        hist = guided_history("manoj", "m@t.test")
        hist = [
            *hist,
            {"role": "assistant", "text": "{not: valid json[[[}"},
            {"role": "user", "text": "what is my name?"},
        ]
        out = run_chat(
            "what is my name?",
            organization_id="org-json",
            session_id="s-json",
            history=hist,
        )
        assert "manoj" in out["reply"].lower()
