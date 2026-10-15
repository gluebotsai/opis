#!/usr/bin/env python3
"""Offline QA — Optimization MAS wiring (Super → Domain → native executor)."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, patch


async def main() -> int:
    session: dict = {"session_id": "qa-opt", "module": "monitoring"}
    with patch(
        "app.mas.super_agent.runner._llm_choose_domain",
        new_callable=AsyncMock,
    ) as mock_super, patch(
        "app.mas.domains.optimization.runner.llm_pick_optimization_executor",
        new_callable=AsyncMock,
    ) as mock_domain, patch(
        "app.mas.executors.monitoring.runner.run_native_optimization_executor",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_super.return_value = {
            "ok": True,
            "domain_id": "optimization",
            "restated_query": "list live campaigns",
        }
        mock_domain.return_value = {
            "ok": True,
            "executor_id": "monitoring",
            "restated_query": "list live campaigns",
        }
        mock_exec.return_value = {
            "ok": True,
            "action_status": "completed",
            "reply": "qa ok",
            "mas_native_optimization": True,
        }
        from app.mas.runtime.invoke import mas_invoke

        out = await mas_invoke(
            {
                "entry": "interactive",
                "skip_super": False,
                "query": "list live campaigns",
                "session": session,
                "session_id": "qa-opt",
                "token": "tok",
                "module_hint": "monitoring",
                "task_spec": {"query": "list live campaigns", "module": "monitoring"},
            }
        )
    ok = bool(out.get("ok"))
    dr = out.get("domain_result") or {}
    print("mas_invoke ok:", ok)
    print("domain_id:", out.get("domain_id"))
    print("executor:", dr.get("executor_id") or dr.get("agent_id"))
    print("mas_native:", dr.get("mas_native_optimization"))
    return 0 if ok and dr.get("mas_native_optimization") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
