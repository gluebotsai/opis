"""Creation Domain cross-domain needs_domain hops (no skills)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch


def test_creation_handoff_to_content_when_enabled(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "creation,content")
    from app.config import get_settings
    from app.mas.domains.registry import get_domain_runner as real_get

    get_settings.cache_clear()

    async def content_domain(ctx):
        return {
            "ok": True,
            "action_status": "completed",
            "agent_id": "email_content",
            "domain_id": "content",
            "reply": "email draft ready",
            "message": "email draft ready",
            "ui_events": [],
        }

    def fake_get(domain_id: str):
        if domain_id == "content":
            return content_domain
        return real_get(domain_id)

    async def run():
        with patch(
            "app.mas.domains.creation.runner.llm_pick_creation_action",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.registry.get_domain_runner",
            side_effect=fake_get,
        ):
            mock_pick.return_value = {
                "kind": "needs_domain",
                "domain_id": "content",
                "restated_query": "generate email template for spring sale",
                "preferred_executor": "email_content",
            }
            from app.mas.runtime.invoke import mas_invoke

            return await mas_invoke(
                {
                    "entry": "sticky_domain",
                    "skip_super": True,
                    "domain_id": "creation",
                    "query": "generate email template for spring sale",
                    "session": {},
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {
                        "query": "generate email template for spring sale",
                        "module": "create_campaign",
                    },
                    "module_hint": "create_campaign",
                }
            )

    out = asyncio.run(run())
    assert out.get("reply") == "email draft ready"
    assert out.get("handoff_hops")
    assert out["handoff_hops"][0]["domain_id"] == "content"
    get_settings.cache_clear()


def test_creation_handoff_falls_back_when_content_disabled(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "creation")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.domains.creation.runner.llm_pick_creation_action",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.creation.runner.get_executor_runner",
        ) as mock_get:
            mock_pick.return_value = {
                "kind": "needs_domain",
                "domain_id": "content",
                "restated_query": "make templates",
            }

            async def brief_exec(ctx):
                return {
                    "ok": True,
                    "action_status": "completed",
                    "agent_id": "brief_validation",
                    "reply": "stayed on create",
                    "message": "stayed on create",
                }

            mock_get.return_value = brief_exec
            from app.mas.runtime.invoke import mas_invoke

            return await mas_invoke(
                {
                    "entry": "sticky_domain",
                    "skip_super": True,
                    "domain_id": "creation",
                    "query": "make templates",
                    "session": {},
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "make templates", "module": "create_campaign"},
                    "module_hint": "create_campaign",
                }
            )

    out = asyncio.run(run())
    assert out.get("agent_id") == "brief_validation"
    assert out.get("reply") == "stayed on create"
    assert not out.get("handoff_hops")
    get_settings.cache_clear()


def test_extract_needs_domain():
    from app.mas.runtime.handoffs import extract_needs_domain

    out = extract_needs_domain(
        {
            "needs_domain": {
                "domain_id": "audience",
                "restated_query": "create contact Ada",
                "preferred_executor": "contact",
            }
        },
        {},
    )
    assert out is not None
    assert out["domain_id"] == "audience"
    assert out["preferred_executor"] == "contact"
