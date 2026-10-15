"""Domain executor pick tests (no skills)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.domains._common import run_domain_with_executor_pick


def test_domain_uses_hint_before_llm(tmp_path):
    agent_md = tmp_path / "agent.md"
    agent_md.write_text("# t\n## role\ntest\n", encoding="utf-8")

    async def run():
        with patch(
            "app.mas.domains._common.llm_pick_executor", new_callable=AsyncMock
        ) as mock_pick, patch(
            "app.mas.domains._common.get_executor_runner"
        ) as get_runner:
            mock_exec = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "message": "ok",
                    "reply": "ok",
                }
            )
            get_runner.return_value = mock_exec

            def resolve(task_spec, ctx):
                return "monitoring"

            out = await run_domain_with_executor_pick(
                domain_id="optimization",
                package_dir=tmp_path,
                ctx={
                    "session": {},
                    "entry": "interactive",
                    "query": "how is it going",
                    "task_spec": {"query": "how is it going", "module": "monitoring"},
                    "module_hint": "monitoring",
                },
                default_executor="monitoring",
                resolve_preferred=resolve,
            )
            return out, mock_pick, mock_exec

    out, mock_pick, mock_exec = asyncio.run(run())
    assert out["ok"] is True
    assert out["executor_id"] == "monitoring"
    mock_pick.assert_not_called()
    mock_exec.assert_awaited_once()


def test_domain_llm_pick_when_no_hint(tmp_path):
    (tmp_path / "agent.md").write_text("# t\n## role\ntest\n", encoding="utf-8")

    async def run():
        with patch(
            "app.mas.domains._common.llm_pick_executor",
            new_callable=AsyncMock,
            return_value="analytics",
        ) as mock_pick, patch(
            "app.mas.domains._common.get_executor_runner"
        ) as get_runner:
            mock_exec = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "message": "kpi",
                    "reply": "kpi",
                }
            )
            get_runner.return_value = mock_exec
            out = await run_domain_with_executor_pick(
                domain_id="optimization",
                package_dir=tmp_path,
                ctx={
                    "session": {},
                    "entry": "interactive",
                    "query": "open rates last week",
                    "task_spec": {"query": "open rates last week"},
                },
                default_executor="monitoring",
                resolve_preferred=lambda *_: None,
            )
            return out, mock_pick

    out, mock_pick = asyncio.run(run())
    assert out["executor_id"] == "analytics"
    mock_pick.assert_awaited_once()
