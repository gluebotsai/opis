"""Creation domain must invoke an executor for generate — never paste fake success."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.mas.runtime.creation_context import creation_pipeline_context
from app.mas.runtime.llm_loop import creation_force_tool_query, llm_pick_creation_action

CREATION_PKG = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "mas"
    / "domains"
    / "creation"
)

_SESSION = {
    "channels": ["email"],
    "templates": [{"channel": "email", "template_id": "t1"}],
    "template_ids_by_channel": {"email": "t1"},
    "campaign": {
        "name": "Diwali Glow",
        "goal": "Drive sales",
        "objective": "Send a Diwali email",
    },
}


def test_force_tool_query_keeps_user_text() -> None:
    out = creation_force_tool_query("create a new one for me")
    assert "create a new one for me" in out
    assert "invoke_executor" in out
    assert "campaign_content" in out


def test_templates_ready_still_hints_regenerate() -> None:
    block = creation_pipeline_context(_SESSION)
    assert "templates_ready: True" in block
    assert "generate/regenerate/create another/" in block
    assert "Do NOT paste a prior" in block


def test_bare_success_retries_then_invokes_campaign_content() -> None:
    async def run():
        with patch(
            "app.mas.runtime.llm_loop.run_single_tool_routing_loop",
            new_callable=AsyncMock,
        ) as mock_loop:
            mock_loop.side_effect = [
                {
                    "ok": True,
                    "tool_name": None,
                    "tool_args": {},
                    "content": (
                        "New email template created! Here's what's ready: "
                        "1 long-form email."
                    ),
                },
                {
                    "ok": True,
                    "tool_name": "invoke_executor",
                    "tool_args": {
                        "executor_id": "campaign_content",
                        "skill_id": "campaign_templates",
                        "skill_action": "continue",
                        "user_confirmed": True,
                        "restated_query": "regenerate email template",
                    },
                    "content": "",
                },
            ]
            out = await llm_pick_creation_action(
                package_dir=CREATION_PKG,
                query="regeneratewith this same idea",
                session=_SESSION,
            )
            return out, mock_loop

    out, mock_loop = asyncio.run(run())
    assert mock_loop.await_count == 2
    retry_kwargs = mock_loop.await_args_list[1].kwargs
    assert retry_kwargs["allow_direct_reply"] is False
    assert retry_kwargs["prior_turns"] is None
    assert "regeneratewith this same idea" in retry_kwargs["user_text"]
    assert out["kind"] == "executor"
    assert out["executor_id"] == "campaign_content"
    assert "direct_reply" not in out
    assert out.get("user_confirmed") is True


def test_first_pass_tool_skips_retry() -> None:
    async def run():
        with patch(
            "app.mas.runtime.llm_loop.run_single_tool_routing_loop",
            new_callable=AsyncMock,
        ) as mock_loop:
            mock_loop.return_value = {
                "ok": True,
                "tool_name": "invoke_executor",
                "tool_args": {
                    "executor_id": "campaign_content",
                    "skill_id": "campaign_templates",
                    "skill_action": "continue",
                    "user_confirmed": True,
                    "restated_query": "create a new email template",
                },
                "content": "",
            }
            out = await llm_pick_creation_action(
                package_dir=CREATION_PKG,
                query="create a new one for me",
                session=_SESSION,
            )
            return out, mock_loop

    out, mock_loop = asyncio.run(run())
    assert mock_loop.await_count == 1
    assert out["kind"] == "executor"
    assert out["executor_id"] == "campaign_content"


def test_clarifying_channels_question_is_direct_reply() -> None:
    async def run():
        with patch(
            "app.mas.runtime.llm_loop.run_single_tool_routing_loop",
            new_callable=AsyncMock,
        ) as mock_loop:
            mock_loop.return_value = {
                "ok": True,
                "tool_name": None,
                "tool_args": {},
                "content": (
                    "Channels: Email.\n"
                    "Want me to generate the template now?"
                ),
            }
            out = await llm_pick_creation_action(
                package_dir=CREATION_PKG,
                query="email only",
                session=_SESSION,
            )
            return out, mock_loop

    out, mock_loop = asyncio.run(run())
    assert mock_loop.await_count == 1
    assert out["kind"] == "direct_reply"
    assert "Want me to generate" in out["direct_reply"]
    assert out.get("executor_id") is None


def test_looks_like_stale_template_success() -> None:
    from app.mas.runtime.llm_loop import looks_like_stale_template_success

    assert looks_like_stale_template_success(
        "New email template created! Here's what's ready: 1 long-form email."
    )
    assert not looks_like_stale_template_success(
        "Channels: Email. Want me to generate the template now?"
    )
    assert not looks_like_stale_template_success("")


def test_retry_failure_does_not_return_hallucinated_success() -> None:
    async def run():
        with patch(
            "app.mas.runtime.llm_loop.run_single_tool_routing_loop",
            new_callable=AsyncMock,
        ) as mock_loop:
            fake = {
                "ok": True,
                "tool_name": None,
                "tool_args": {},
                "content": "New email template created! Here's what's ready.",
            }
            mock_loop.side_effect = [fake, {**fake, "ok": False}]
            return await llm_pick_creation_action(
                package_dir=CREATION_PKG,
                query="proced new temaplte",
                session=_SESSION,
            )

    out = asyncio.run(run())
    assert out["kind"] == "executor"
    assert out["executor_id"] == "brief_validation"
    assert "direct_reply" not in out
    assert "New email template created" not in str(out.get("direct_reply") or "")


def test_last_user_turn_pin_counts_user_messages() -> None:
    from app.mas.runtime.creation_context import last_user_turn_pin

    session = {
        "messages": [
            {"id": "u1", "role": "user", "text": "email alone"},
            {"id": "a1", "role": "assistant", "text": "ok"},
            {"id": "u2", "role": "user", "text": "show template"},
            {"id": "a2", "role": "assistant", "text": "ready"},
            {"id": "u3", "role": "user", "text": "generate again"},
        ]
    }
    pin_id, ordinal = last_user_turn_pin(session)
    assert pin_id == "u3"
    assert ordinal == 3


def test_last_user_turn_pin_does_not_reuse_previous_id() -> None:
    from app.mas.runtime.creation_context import last_user_turn_pin

    session = {
        "messages": [
            {"id": "u1", "role": "user", "text": "first generate"},
            {"id": "a1", "role": "assistant", "text": "ready"},
            {"role": "user", "text": "generate again"},
        ]
    }
    pin_id, ordinal = last_user_turn_pin(session)
    assert pin_id is None
    assert ordinal == 2


def test_keep_new_generation_does_not_return_old_templates() -> None:
    from app.agents.create_campaign.tool_functions import (
        _email_ready_to_persist,
        _keep_new_generation_templates,
    )

    saved = [
        {"template_id": "a", "channel": "email", "fields": {"subject": "A"}},
        {"template_id": "b", "channel": "email", "fields": {"compiled_html": "<p>B</p>"}},
    ]
    kept = _keep_new_generation_templates(
        saved,
        preexisting_ids={"a"},
        persist_payload=[{"template_id": "uuid-b", "channel": "email"}],
    )
    assert [t["template_id"] for t in kept] == ["b"]

    assert not _email_ready_to_persist(
        {"channel": "email", "fields": {"subject": "Fall Sale"}}
    )
    assert _email_ready_to_persist(
        {
            "channel": "email",
            "fields": {"subject": "Fall Sale", "compiled_html": "<html><body><p>Hi</p></body></html>"},
        }
    )


def test_persist_templates_from_nested_or_flat_body() -> None:
    from app.template_store import persist_templates_from_body

    nested = persist_templates_from_body(
        {"data": {"templates": [{"template_id": "1", "channel": "email"}]}}
    )
    flat = persist_templates_from_body(
        {"statusCode": 201, "templates": [{"template_id": "2", "channel": "email"}]}
    )
    assert nested[0]["template_id"] == "1"
    assert flat[0]["template_id"] == "2"
    assert persist_templates_from_body({"statusCode": 201}) == []
