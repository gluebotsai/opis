from __future__ import annotations

import pytest

from app.agents.reports_b2b.kg_executor.core.llm import call_llm


def test_kg_llm_bridge_uses_shared_chat_contract(monkeypatch):
    captured: dict = {}

    async def fake_chat_with_tools(**kwargs):
        captured.update(kwargs)
        return {"content": '{"steps":[]}'}

    monkeypatch.setattr("app.llm.is_ai_configured", lambda: True)
    monkeypatch.setattr("app.llm.chat_with_tools", fake_chat_with_tools)
    result = call_llm(
        [
            {"role": "system", "content": "KG planner"},
            {"role": "user", "content": "Explain blocked deals"},
        ],
        temperature=0.1,
        max_tokens=700,
    )
    assert result == '{"steps":[]}'
    assert captured["tools"] is None
    assert captured["max_tokens"] == 700
    assert captured["temperature"] == 0.1
    assert captured["enable_thinking"] is False


@pytest.mark.asyncio
async def test_kg_llm_bridge_is_safe_inside_async_turn(monkeypatch):
    async def fake_chat_with_tools(**_kwargs):
        return {"content": "ok"}

    monkeypatch.setattr("app.llm.is_ai_configured", lambda: True)
    monkeypatch.setattr("app.llm.chat_with_tools", fake_chat_with_tools)
    assert call_llm([{"role": "user", "content": "360 on Orange"}]) == "ok"
