"""Agent flow log writes day-wise files and drops day 6."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.agent_log import (
    DayWiseFileHandler,
    a2a_log_path,
    coworker_log_path,
    fmt,
    invoke_logged,
    log_agent_turn,
    log_file_path,
    log_llm_error,
    logger,
    patch_keys,
    proactive_log_path,
    reset_for_tests,
    trace_handoff,
    trace_tool_call,
    trace_tool_response,
)


@pytest.fixture()
def agent_log_dir(tmp_path: Path) -> Path:
    reset_for_tests(tmp_path)
    return tmp_path


def test_trace_handoff_and_tool_steps(agent_log_dir: Path) -> None:
    from app.agent_log import _CHANNEL

    token = _CHANNEL.set("coworker")
    try:
        trace_handoff(
            from_agent="coworker-link-agent",
            to_agent="reports-analytics-agent",
            reason="analytics",
        )
        trace_tool_call(
            agent="reports-analytics-agent",
            tool="run_kpi",
            args={"kpi": "open_deals"},
        )
        trace_tool_response(
            agent="reports-analytics-agent",
            tool="run_kpi",
            ok=True,
            response={"rowCount": 3},
        )
    finally:
        _CHANNEL.reset(token)
    text = coworker_log_path().read_text(encoding="utf-8")
    assert '"step": "handoff"' in text
    assert '"fromAgent": "coworker-link-agent"' in text
    assert '"step": "tool_call"' in text
    assert '"step": "tool_res"' in text


def test_log_agent_turn_writes_today_file(agent_log_dir: Path) -> None:
    log_agent_turn(
        agent="crm-agent",
        ok=True,
        intent="contact_draft",
        module="contact",
        surface="create",
        user_text="yes",
        result={
            "ok": True,
            "source": "ai",
            "assistantText": "Shall I save them?",
            "patch": {"companyName": "TCS", "title": "Product Manager"},
            "toolProposals": [{"name": "propose_create_contact", "args": {"auto": True}}],
        },
        ms=42.2,
    )
    today = agent_log_dir / f"coworker-{date.today().isoformat()}.log"
    assert today == log_file_path()
    assert today == coworker_log_path()
    lines = today.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0].split(" INFO ", 1)[-1])
    assert payload["agent"] == "crm-agent"
    assert payload["intent"] == "contact_draft"
    assert payload["module"] == "contact"
    assert payload["user"] == "yes"
    assert payload["speech"] == "Shall I save them?"
    assert payload["patch"]["companyName"] == "TCS"
    assert payload["tools"] == ["propose_create_contact"]


def test_log_llm_error(agent_log_dir: Path) -> None:
    log_llm_error(RuntimeError("connection refused"))
    text = proactive_log_path().read_text(encoding="utf-8")
    assert "connection refused" in text
    assert '"agent": "llm"' in text
    assert '"step": "error"' in text


def test_patch_keys() -> None:
    assert patch_keys({"patch": {"firstName": "Sivaji", "lastName": "R"}}) == [
        "firstName",
        "lastName",
    ]
    assert patch_keys({"contactDraftPatch": {"email": "a@b.com"}}) == ["email"]
    assert patch_keys({"ok": True}) == []


def test_logger_checkpoint(agent_log_dir: Path) -> None:
    logger.info(
        fmt(
            agent="crm-agent",
            step="native_first",
            module="contact",
            surface="list",
            commit=False,
            tools=["set_workspace"],
            speech="I'll open create.",
        )
    )
    logger.error(
        fmt(
            agent="coworker",
            step="speech_dropped",
            ok=False,
            reason="empty",
            prior="I'll open create.",
            tools=["set_workspace"],
        )
    )
    lines = log_file_path().read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0].split(" INFO ", 1)[-1])
    assert first["agent"] == "crm-agent"
    assert first["step"] == "native_first"
    assert first["tools"] == ["set_workspace"]
    assert first["commit"] is False
    second = json.loads(lines[1].split(" ERROR ", 1)[-1])
    assert second["step"] == "speech_dropped"
    assert second["ok"] is False


@pytest.mark.asyncio
async def test_invoke_logged_records_exception(agent_log_dir: Path) -> None:
    async def boom() -> dict:
        raise ValueError("draft failed")

    with pytest.raises(ValueError, match="draft failed"):
        await invoke_logged("crm-agent", boom, intent="contact_draft", user_text="yes")
    text = coworker_log_path().read_text(encoding="utf-8")
    assert "draft failed" in text
    assert '"ok": false' in text
    assert not proactive_log_path().exists() or "draft failed" not in (
        proactive_log_path().read_text(encoding="utf-8")
        if proactive_log_path().exists()
        else ""
    )


@pytest.mark.asyncio
async def test_proactive_agent_writes_separate_file(agent_log_dir: Path) -> None:
    async def ok_job() -> dict:
        return {"ok": True, "source": "ai", "assistantText": "scored"}

    await invoke_logged(
        "lifecycle-lead",
        ok_job,
        contact_id="c1",
    )
    proactive = agent_log_dir / f"proactive-{date.today().isoformat()}.log"
    assert proactive == proactive_log_path()
    text = proactive.read_text(encoding="utf-8")
    assert "lifecycle-lead" in text
    assert "scored" in text
    coworker = coworker_log_path()
    assert (not coworker.exists()) or "lifecycle-lead" not in coworker.read_text(
        encoding="utf-8"
    )


def test_a2a_logger_has_own_file(agent_log_dir: Path) -> None:
    from app.agent_log import a2a_trace

    a2a_trace(step="ready", crm={"url": "http://192.168.13.159:8020"})
    path = a2a_log_path()
    assert path == agent_log_dir / f"a2a-{date.today().isoformat()}.log"
    assert "ready" in path.read_text(encoding="utf-8")
    assert "192.168.13.159" in path.read_text(encoding="utf-8")


def test_prunes_sixth_day(agent_log_dir: Path) -> None:
    today = date.today()
    handler = DayWiseFileHandler(agent_log_dir, keep_days=5)
    kept: list[Path] = []
    for age in range(0, 6):
        day = today - timedelta(days=age)
        path = handler.path_for(day)
        path.write_text(f"day {day.isoformat()}\n", encoding="utf-8")
        if age < 5:
            kept.append(path)
    oldest = handler.path_for(today - timedelta(days=5))
    assert oldest.exists()
    removed = handler.prune(today)
    assert oldest in removed
    assert not oldest.exists()
    for path in kept:
        assert path.exists()
