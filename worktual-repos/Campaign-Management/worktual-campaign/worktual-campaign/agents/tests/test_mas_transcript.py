"""MAS turn contract and transcript service tests."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.runtime.invoke import mas_invoke
from app.mas.runtime.transcript import extract_turn_chat_meta, extract_turn_reply
from app.mas.runtime.turn import MasTurn, apply_routing_hint
from app.request_context import is_mas_transcript_managed, mas_transcript_scope


def test_mas_turn_from_payload_ignores_restated_query():
    turn = MasTurn.from_payload(
        {"query": "i want template with image, generate now", "entry": "interactive"},
        {"query": "Generate campaign templates based on the current campaign context."},
        {},
    )
    assert turn.verbatim_user_text == "i want template with image, generate now"
    turn_with_session = MasTurn.from_payload(
        {
            "query": "i want template with image, generate now",
            "entry": "interactive",
            "session_id": "s1",
        },
        {"query": "Generate campaign templates based on the current campaign context."},
        {},
    )
    assert turn_with_session.manages_transcript is True


def test_apply_routing_hint_keeps_verbatim_query():
    spec: dict = {"query": "generate now"}
    apply_routing_hint(
        spec,
        "Generate campaign templates based on the current campaign context.",
        "generate now",
    )
    assert spec["query"] == "generate now"
    assert "routing_hint" in spec
    assert "campaign templates" in spec["routing_hint"]


def test_extract_turn_reply_nested_domain_result():
    reply = extract_turn_reply(
        {
            "domain_result": {
                "message": "Templates are ready.",
            }
        }
    )
    assert reply == "Templates are ready."


def test_extract_turn_reply_prefers_nested_executor_over_domain_prose():
    reply = extract_turn_reply(
        {
            "domain_result": {
                "kind": "domain",
                "message": "Routed to domain 'optimization'.",
                "result": {
                    "kind": "executor",
                    "reply": "<p>3 live campaigns.</p>",
                },
            }
        }
    )
    assert reply == "<p>3 live campaigns.</p>"


def test_extract_turn_reply_skips_handoff_metadata():
    reply = extract_turn_reply(
        {
            "action_status": "needs_domain",
            "needs_domain": {"domain_id": "creation", "restated_query": "create campaign"},
            "message": "needs_domain: creation task: Create a new campaign",
            "reply": "needs_domain: creation task: Create a new campaign",
        }
    )
    assert reply == ""


def test_extract_turn_chat_meta_nested_executor():
    meta = extract_turn_chat_meta(
        {
            "domain_result": {
                "kind": "executor",
                "reply": "Open rate is 12%.",
                "analytics": {
                    "visual": {"kind": "kpi", "title": "Rates"},
                },
            }
        }
    )
    assert meta is not None
    assert meta["analytics"]["visual"]["kind"] == "kpi"


def test_extract_turn_reply_executor_kind():
    reply = extract_turn_reply(
        {
            "domain_result": {
                "kind": "executor",
                "agent_id": "analytics",
                "reply": "<p>3 live campaigns.</p>",
            }
        }
    )
    assert reply == "<p>3 live campaigns.</p>"


def test_mas_invoke_records_verbatim_user_not_restated():
    session: dict = {"messages": []}
    captured_task_spec: dict = {}

    async def fake_domain(ctx):
        captured_task_spec.update(dict(ctx.get("task_spec") or {}))
        return {
            "ok": True,
            "reply": "done",
            "message": "done",
        }

    async def run():
        with patch(
            "app.mas.domains.registry.get_domain_runner",
            return_value=fake_domain,
        ):
            with patch(
                "app.session_store.get_or_create_session",
                new_callable=AsyncMock,
            ) as mock_get:
                with patch(
                    "app.mas.runtime.transcript.append_message",
                    new_callable=AsyncMock,
                ) as mock_append:
                    with patch(
                        "app.session_store.save_session",
                        new_callable=AsyncMock,
                        side_effect=lambda s, **_: s,
                    ):
                        mock_get.return_value = session
                        out = await mas_invoke(
                            {
                                "entry": "interactive",
                                "skip_super": True,
                                "domain_id": "creation",
                                "query": "generate now",
                                "session": session,
                                "session_id": "s-transcript",
                                "token": "tok",
                                "task_spec": {
                                    "query": "generate now",
                                    "module": "create_campaign",
                                },
                            }
                        )
                        return out, mock_append

    out, mock_append = asyncio.run(run())
    assert out["reply"] == "done"
    assert captured_task_spec.get("query") == "generate now"
    user_calls = [
        c
        for c in mock_append.call_args_list
        if len(c.args) >= 3 and c.args[1] == "user"
    ]
    assert len(user_calls) == 1
    assert user_calls[0].args[2] == "generate now"


def test_append_message_skips_user_when_transcript_managed():
    async def run():
        from app.session_store import append_message

        with mas_transcript_scope(managed=True):
            assert is_mas_transcript_managed() is True
            session = await append_message("s1", "user", "hello", token="t")
        return session

    session = asyncio.run(run())
    assert session.get("messages") == []


def test_super_routes_with_routing_hint_not_verbatim_overwrite():
    session: dict = {}
    captured: dict = {}

    async def fake_domain(ctx):
        captured["task_spec"] = dict(ctx.get("task_spec") or {})
        captured["query"] = ctx.get("query")
        return {"ok": True, "reply": "ok", "message": "ok"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "domain_id": "creation",
                "restated_query": "Generate campaign templates based on the current campaign context.",
            },
        ):
            with patch(
                "app.mas.domains.registry.get_domain_runner",
                return_value=fake_domain,
            ):
                with patch(
                    "app.session_store.get_or_create_session",
                    new_callable=AsyncMock,
                    return_value=session,
                ):
                    with patch(
                        "app.mas.runtime.transcript.append_message",
                        new_callable=AsyncMock,
                    ) as mock_append:
                        with patch(
                            "app.session_store.save_session",
                            new_callable=AsyncMock,
                            side_effect=lambda s, **_: s,
                        ):
                            out = await mas_invoke(
                                {
                                    "entry": "interactive",
                                    "query": "generate now",
                                    "session": session,
                                    "session_id": "s2",
                                    "token": "tok",
                                    "task_spec": {
                                        "query": "generate now",
                                        "module": "create_campaign",
                                    },
                                    "module_hint": "create_campaign",
                                }
                            )
                            return out, mock_append

    out, mock_append = asyncio.run(run())
    assert out["ok"] is True
    assert captured["query"] == "generate now"
    assert captured["task_spec"]["query"] == "generate now"
    assert "routing_hint" in captured["task_spec"]
    user_calls = [
        c
        for c in mock_append.call_args_list
        if len(c.args) >= 3 and c.args[1] == "user"
    ]
    assert user_calls[0].args[2] == "generate now"
