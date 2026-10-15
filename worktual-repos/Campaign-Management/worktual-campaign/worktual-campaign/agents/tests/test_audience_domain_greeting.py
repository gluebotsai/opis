"""Audience domain direct reply for greetings — no executor."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.mas.domains.audience.runner import run_audience_domain


@pytest.mark.asyncio
async def test_domain_replies_directly_for_greeting():
    session = {"session_id": "greet-domain-1", "module": "contacts", "mas_task": {}}

    with patch(
        "app.mas.domains.audience.runner.select_audience_skill",
        new_callable=AsyncMock,
    ) as mock_pick, patch(
        "app.mas.domains.audience.runner.run_audience_executor_via_harness",
        new_callable=AsyncMock,
    ) as mock_harness:
        from app.mas.skills.selector import SkillPick

        mock_pick.return_value = SkillPick(
            ok=True,
            direct_reply="Hi! I can help you look up, add, or edit contacts. What do you need?",
        )
        out = await run_audience_domain(
            {
                "session": session,
                "session_id": "greet-domain-1",
                "token": "tok",
                "task_spec": {"query": "hello", "module": "contacts"},
                "query": "hello",
                "verbatim_user_text": "hello",
                "module_hint": "contacts",
            }
        )

    assert out.get("ok") is True
    assert "look up" in str(out.get("reply") or "").lower()
    mock_harness.assert_not_called()
