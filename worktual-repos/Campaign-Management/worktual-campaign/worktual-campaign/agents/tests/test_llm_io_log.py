"""LLM I/O audit log formatting and redaction."""

from __future__ import annotations

import app.mas.runtime.llm_io_log as llm_io


def test_llm_io_log_writes_sections_and_redacts(tmp_path, monkeypatch):
    log_file = tmp_path / "llm_io.log"
    llm_io._enabled_cache = True  # noqa: SLF001
    llm_io._path_cache = log_file  # noqa: SLF001

    llm_io.llm_io_set_context(session_id="sess-1", module="create_campaign")
    llm_io.llm_io_set_round(0)
    llm_io.log_llm_input(
        {"messages": [{"role": "user", "content": "hi"}], "password": "secret"}
    )
    llm_io.log_llm_output({"content": "hello", "tool_calls": []})
    llm_io.log_tool_call("brief", {"goal": "launch"})
    llm_io.log_tool_response("brief", {"ok": True, "token": "abc"})

    text = log_file.read_text(encoding="utf-8")
    assert "=====================INPUT=====================" in text
    assert "====================OUTPUT====================" in text
    assert "====================TOOL CALL==================" in text
    assert "====================TOOL RESPONSE==================" in text
    assert "session_id=sess-1" in text
    assert "round=0" in text
    assert "UTC" in text
    assert "***REDACTED***" in text
    assert "secret" not in text
    assert '"abc"' not in text

    llm_io._enabled_cache = None  # noqa: SLF001
    llm_io._path_cache = None  # noqa: SLF001
    llm_io.llm_io_clear_context()
