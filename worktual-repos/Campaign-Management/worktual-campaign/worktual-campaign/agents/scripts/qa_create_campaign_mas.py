#!/usr/bin/env python3
"""Offline QA — Create-campaign MAS wiring (Super → Creation Domain → native executor)."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, patch


async def main() -> int:
    session: dict = {"session_id": "qa-create", "module": "create_campaign"}
    with patch(
        "app.mas.super_agent.runner._llm_choose_domain",
        new_callable=AsyncMock,
    ) as mock_super, patch(
        "app.mas.domains.creation.runner.llm_pick_creation_action",
        new_callable=AsyncMock,
    ) as mock_domain, patch(
        "app.mas.executors.brief_validation.runner.run_native_create_executor",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_super.return_value = {
            "ok": True,
            "domain_id": "creation",
            "restated_query": "Diwali sale campaign",
        }
        mock_domain.return_value = {
            "ok": True,
            "kind": "executor",
            "executor_id": "brief_validation",
            "restated_query": "Diwali sale campaign",
        }
        mock_exec.return_value = {
            "ok": True,
            "action_status": "completed",
            "reply": "qa ok",
            "mas_native_create": True,
        }
        from app.mas.runtime.invoke import mas_invoke

        out = await mas_invoke(
            {
                "entry": "interactive",
                "skip_super": False,
                "query": "Diwali sale campaign",
                "session": session,
                "session_id": "qa-create",
                "token": "tok",
                "module_hint": "create_campaign",
                "task_spec": {"query": "Diwali sale campaign", "module": "create_campaign"},
            }
        )
    ok = bool(out.get("ok"))
    dr = out.get("domain_result") or {}
    print("mas_invoke ok:", ok)
    print("domain_id:", out.get("domain_id"))
    print("executor:", dr.get("executor_id") or dr.get("agent_id"))
    print("mas_native:", dr.get("mas_native_create"))
    return 0 if ok and dr.get("mas_native_create") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
