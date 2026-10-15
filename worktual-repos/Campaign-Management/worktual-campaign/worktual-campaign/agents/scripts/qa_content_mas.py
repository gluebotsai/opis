#!/usr/bin/env python3
"""Offline QA — Content MAS wiring (Super → Domain → native executor)."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, patch


async def main() -> int:
    session: dict = {"session_id": "qa-content", "module": "whatsapp_approved"}
    with patch(
        "app.mas.super_agent.runner._llm_choose_domain",
        new_callable=AsyncMock,
    ) as mock_super, patch(
        "app.mas.domains.content.runner.llm_pick_content_executor",
        new_callable=AsyncMock,
    ) as mock_domain, patch(
        "app.mas.executors.whatsapp_approved_send.runner.run_native_content_executor",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_super.return_value = {
            "ok": True,
            "domain_id": "content",
            "restated_query": "send to John",
        }
        mock_domain.return_value = {
            "ok": True,
            "executor_id": "whatsapp_approved_send",
            "restated_query": "send to John",
        }
        mock_exec.return_value = {
            "ok": True,
            "action_status": "completed",
            "reply": "qa ok",
            "mas_native_content": True,
        }
        from app.mas.runtime.invoke import mas_invoke

        out = await mas_invoke(
            {
                "entry": "interactive",
                "skip_super": False,
                "query": "send to John",
                "session": session,
                "session_id": "qa-content",
                "token": "tok",
                "module_hint": "whatsapp_approved",
                "task_spec": {"query": "send to John", "module": "whatsapp_approved"},
            }
        )
    ok = bool(out.get("ok"))
    dr = out.get("domain_result") or {}
    print("mas_invoke ok:", ok)
    print("domain_id:", out.get("domain_id"))
    print("executor:", dr.get("executor_id") or dr.get("agent_id"))
    print("mas_native:", dr.get("mas_native_content"))
    return 0 if ok and dr.get("mas_native_content") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
