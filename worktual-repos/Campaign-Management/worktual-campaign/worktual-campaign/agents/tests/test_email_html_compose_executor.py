"""email_html_compose MAS executor — wraps Phase 2 plugin."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.mas.executors.email_html_compose.runner import (
    compose_email_template_card,
    run_email_html_compose_executor,
)
from app.mas.executors.registry import get_executor_runner


@pytest.mark.asyncio
async def test_compose_email_template_card_passes_company_pack() -> None:
    card = {
        "template_id": "new-1",
        "channel": "email",
        "fields": {
            "subject": "Hi",
            "compiled_html": "<html><body><p>Hi</p></body></html>",
            "pipeline": "compose",
        },
    }
    with patch(
        "app.mas.phase2_compose.plugin.run_phase2_email_create",
        new_callable=AsyncMock,
        return_value=card,
    ) as mocked:
        out = await compose_email_template_card(
            campaign={"name": "Sale", "objective": "10% off"},
            channel_plan={"how_it_works": "Email"},
            user_request="make a festive long mail with more images",
            company_pack={"brand": {"name": "Loom"}},
            campaign_profile={"industry": "retail"},
        )
    assert out["template_id"] == "new-1"
    kwargs = mocked.await_args.kwargs
    assert kwargs["company_pack"]["brand"]["name"] == "Loom"
    assert kwargs["campaign_profile"]["industry"] == "retail"
    assert "festive" in kwargs["user_request"]


@pytest.mark.asyncio
async def test_run_email_html_compose_executor_returns_template() -> None:
    card = {
        "template_id": "tid-9",
        "channel": "email",
        "fields": {
            "subject": "Diwali",
            "compiled_html": "<html><body><p>Festive</p></body></html>",
            "pipeline": "compose",
        },
    }
    with patch(
        "app.mas.executors.email_html_compose.runner.compose_email_template_card",
        new_callable=AsyncMock,
        return_value=card,
    ):
        out = await run_email_html_compose_executor(
            {
                "task_spec": {
                    "idea": "Diwali sale with elegant long copy and images",
                    "campaign": {"name": "Diwali", "objective": "10% off"},
                }
            }
        )
    assert out["ok"] is True
    assert out["executor_id"] == "email_html_compose"
    assert out["template"]["template_id"] == "tid-9"
    assert "Email template is ready" in out["reply"]
    assert "Diwali" in out["reply"]


@pytest.mark.asyncio
async def test_registry_wires_email_html_compose() -> None:
    runner = get_executor_runner("email_html_compose")
    with patch(
        "app.mas.executors.email_html_compose.runner.compose_email_template_card",
        new_callable=AsyncMock,
        return_value={
            "template_id": "x",
            "fields": {"compiled_html": "<p>ok</p>", "subject": "S"},
        },
    ):
        out = await runner(
            {
                "task_spec": {
                    "campaign": {"name": "N", "objective": "O"},
                    "idea": "a reasonably long idea for a marketing email about spring",
                }
            }
        )
    assert out["ok"] is True
