from __future__ import annotations

import pytest

from app.agents.reports_analytics_agent import AnalyticsScope
from app.agents.reports_analytics_turn import (
    _format_chat,
    _reports_context_from_memory,
    _sort_tasks,
)


def test_reports_context_from_memory_slots():
    working = {"slots": {"reportsContext": {"lastKpiId": "win_rate"}}}
    assert _reports_context_from_memory(working)["lastKpiId"] == "win_rate"


def test_format_chat_keeps_last_four_turns_in_full():
    tail = "y" * 500 + " Want to see which of these still have no owner?"
    messages = []
    for i in range(5):
        messages.append({"role": "user", "content": f"question {i}"})
        messages.append({"role": "assistant", "content": f"answer {i} {tail}"})
    text = _format_chat(messages)
    assert "question 0" not in text
    assert "answer 0 " not in text
    assert "question 1" in text
    assert "question 4" in text
    assert tail in text


def test_sort_tasks_respects_depends_on():
    tasks = [
        {"id": "t2", "depends_on": ["t1"]},
        {"id": "t1", "depends_on": []},
    ]
    ordered = _sort_tasks(tasks)
    assert [t["id"] for t in ordered] == ["t1", "t2"]


@pytest.mark.asyncio
async def test_run_turn_follow_up_includes_prior_context(monkeypatch):
    from app.agents import reports_analytics_turn as turn_mod

    captured: list[str] = []

    async def fake_llm(*, system: str, user: str, max_tokens: int = 1200, phase: str = "llm"):
        del system, max_tokens, phase
        captured.append(user)
        if "RESULT" not in user and "Original question" not in user:
            return '{"kind":"plan","tasks":[{"id":"t1","executor":"sql","kpi":"lead_count","goal":"count","time":"all time","scope":"org","depends_on":[]}]}'
        return "There are 5 leads."

    async def fake_sql(task, *, org_id, user_id, role):
        return {"status": "ok", "rows": [{"count": 5}], "kpi_id": "lead_count"}

    monkeypatch.setattr(turn_mod, "_llm_text", fake_llm)
    monkeypatch.setattr(turn_mod, "_execute_sql_task", fake_sql)
    monkeypatch.setattr(turn_mod, "is_ai_configured", lambda: True)

    scope = AnalyticsScope(
        organization_id="1000",
        actor_id="42",
        role="admin",
        business_type="b2b",
    )
    out = await turn_mod.run_turn(
        question="and unassigned?",
        scope=scope,
        working_memory={"slots": {"reportsContext": {"timePhrase": "this month", "lastKpiId": "lead_count"}}},
        messages=[{"role": "user", "content": "how many leads?"}, {"role": "assistant", "content": "5 leads."}],
    )
    assert "5" in out["assistantText"]
    assert captured[0].find("timePhrase=this month") >= 0
    assert out["reportsContextPatch"]["lastKpiId"] == "lead_count"


@pytest.mark.asyncio
async def test_run_turn_passes_structured_period_and_canonical_object(monkeypatch):
    from app.agents import reports_analytics_turn as turn_mod

    captured: list[str] = []

    async def fake_llm(*, system: str, user: str, max_tokens: int = 1200, phase: str = "llm"):
        del system, max_tokens, phase
        captured.append(user)
        if "Original question" not in user:
            return (
                '{"kind":"plan","object":"deals","tasks":[{"id":"t1",'
                '"executor":"sql","kpi":"total_pipeline","goal":"open pipeline",'
                '"time":"this month","scope":"org","depends_on":[]}]}'
            )
        return "Pipeline is 10."

    async def fake_sql(task, *, org_id, user_id, role):
        del task, org_id, user_id, role
        return {
            "status": "ok",
            "rows": [{"total_pipeline": 10}],
            "kpi_id": "total_pipeline",
        }

    monkeypatch.setattr(turn_mod, "_llm_text", fake_llm)
    monkeypatch.setattr(turn_mod, "_execute_sql_task", fake_sql)
    scope = AnalyticsScope(
        organization_id="1003",
        actor_id="42",
        role="admin",
        business_type="b2b",
    )
    out = await turn_mod.run_turn(
        question="What is the pipeline?",
        scope=scope,
        time_phrase="this month",
        object_lock="deals",
    )
    assert '"timePhrase": "this month"' in captured[0]
    assert '"objectLock": "deals"' in captured[0]
    assert "Dashboard period filter" not in captured[0]
    assert out["reportsContextPatch"]["objectLock"] == "deals"
    assert out["reportsContextPatch"]["timePhrase"] == "this month"


@pytest.mark.asyncio
async def test_execute_kg_task_reuses_full_kg_agent(monkeypatch):
    from app.agents import reports_analytics_turn as turn_mod
    from app.agents.reports_b2b.kg_executor.core.models import (
        AgentContext,
        Fact,
        SynthesisOutput,
    )

    captured: dict[str, str] = {}

    class FakeKgAgent:
        def __init__(self, context):
            assert context.org_id == 1003

        def run(self, question):
            captured["question"] = question
            return SynthesisOutput(
                markdown="Grounded graph summary.",
                facts=[
                    Fact(
                        label="Deal blockers",
                        value=2,
                        unit="deals",
                        breakdown=[{"stage": "negotiate", "count": 2}],
                    )
                ],
                status="success",
                attempts_made=2,
            )

    monkeypatch.setattr(turn_mod, "CRMB2BKGAgent", FakeKgAgent)
    output, notes, rows = await turn_mod._execute_kg_task(
        {
            "id": "t2",
            "executor": "kg",
            "goal": "Explain deal blockers",
            "object": "deals",
        },
        kg_ctx=AgentContext(org_id=1003, user_id=42, role="admin"),
    )
    assert output is not None
    assert output.attempts_made == 2
    assert rows == [{"stage": "negotiate", "count": 2}]
    assert "verified graph facts" in notes
    assert "Explain deal blockers" in captured["question"]


@pytest.mark.asyncio
async def test_run_turn_does_not_crash_with_active_agent_turn_log(monkeypatch, tmp_path):
    """Regression: observability begin_turn must not break run_turn (no missing hooks)."""
    from app.agents import reports_analytics_turn as turn_mod
    from app.observability import turn_log
    from app.observability.file_sink import log_dir as sink_log_dir

    monkeypatch.setattr(turn_log, "log_dir", lambda: tmp_path)
    monkeypatch.setattr("app.observability.file_sink._DEFAULT_LOG_DIR", tmp_path)

    async def fake_llm(*, system: str, user: str, max_tokens: int = 1200, phase: str = "llm"):
        del system, max_tokens, phase
        if "Question:" in user:
            return (
                '{"kind":"plan","tasks":[{"id":"t1","executor":"sql","kpi":"lead_count",'
                '"goal":"count leads","time":"yesterday","scope":"own","depends_on":[]}]}'
            )
        return "You have 2 leads."

    async def fake_sql(task, *, org_id, user_id, role):
        del task, org_id, user_id, role
        return {"status": "ok", "rows": [{"count": 2}], "kpi_id": "lead_count"}

    monkeypatch.setattr(turn_mod, "_llm_text", fake_llm)
    monkeypatch.setattr(turn_mod, "_execute_sql_task", fake_sql)
    monkeypatch.setattr(turn_mod, "load_agent_prompt", lambda _path: "domain prompt")
    monkeypatch.setattr(turn_mod, "is_ai_configured", lambda: True)

    turn_log.begin_turn(
        user_query="how many leads created yesterday",
        session_id="cw_test",
        request_id="req_test",
        organization_id="1003",
        user_id="1017",
    )
    turn_log.record_attending_agent("reports-analytics-agent")

    scope = AnalyticsScope(
        organization_id="1003",
        actor_id="1017",
        role="sales_rep",
        business_type="b2b",
    )
    out = await turn_mod.run_turn(
        question="how many leads created yesterday",
        scope=scope,
    )
    turn_log.finish_turn(out["assistantText"], final_agent="reports-analytics-agent")

    assert "2" in out["assistantText"]
    log_text = turn_log.agent_turn_log_path().read_text(encoding="utf-8")
    assert "how many leads created yesterday" in log_text
    assert "FINAL RESPONSE" in log_text
    assert sink_log_dir() == tmp_path
