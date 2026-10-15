"""Tests for Minimax LLM parse helpers and length-retry."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.agents.coworker_shared import last_user_text
from app.llm import (
    _bump_max_tokens,
    _messages_for_chat_api,
    chat_with_tools,
    generate_ai_text,
    normalize_tool_turn_content,
    parse_tool_calls,
    strip_think_and_tools,
)


def test_normalize_tool_turn_content_clears_speech_when_tools_present():
    assert normalize_tool_turn_content("Got it — saving now.", [{"id": "1"}]) == ""
    assert normalize_tool_turn_content("", [{"id": "1"}]) == ""
    assert normalize_tool_turn_content("  Hello  ", []) == "Hello"
    assert normalize_tool_turn_content(None, None) == ""


def test_bump_max_tokens_scales_and_caps():
    assert _bump_max_tokens(220) >= 2000
    assert _bump_max_tokens(700) == 2800
    assert _bump_max_tokens(3000) == 8000


def test_messages_for_chat_api_stringify_tool_call_arguments():
    prepared = _messages_for_chat_api(
        [
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "set_workspace",
                            "arguments": {"mode": "create", "label": "New Contact"},
                        },
                    }
                ],
            }
        ]
    )
    arguments = prepared[0]["tool_calls"][0]["function"]["arguments"]
    assert arguments == '{"mode": "create", "label": "New Contact"}'


@pytest.mark.parametrize(
    "messages, expected",
    [
        ([{"role": "user", "text": "hello"}], "hello"),
        ([{"role": "user", "content": "via content"}], "via content"),
        (
            [{"role": "user", "content": [{"type": "text", "text": "part a"}]}],
            "part a",
        ),
        (
            [
                {"role": "assistant", "text": "noop"},
                {"role": "user", "content": "latest"},
            ],
            "latest",
        ),
        ([{"role": "user", "content": ""}], None),
        ([], None),
    ],
)
def test_last_user_text_accepts_text_and_content(messages, expected):
    assert last_user_text(messages) == expected


def test_parse_minimax_tool_calls():
    raw = """
<think>planning</think>
I'll update the stage.
<minimax:tool_call>
<invoke name="propose_stage_change">
<parameter name="dealId">deal_1</parameter>
<parameter name="stage">negotiate</parameter>
</invoke>
</minimax:tool_call>
"""
    calls = parse_tool_calls(raw)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "propose_stage_change"
    assert calls[0]["function"]["arguments"]["dealId"] == "deal_1"
    assert calls[0]["function"]["arguments"]["stage"] == "negotiate"

    content, reasoning = strip_think_and_tools(raw)
    assert reasoning == "planning"
    assert content is not None
    assert "minimax:tool_call" not in content
    assert "propose_stage_change" not in (content or "")


def test_parse_glm_pipe_tool_call():
    from app.llm import parse_tool_calls, strip_think_and_tools

    raw = (
        '<|tool_call|>call:seo_save_generated_content'
        '{"contentType":"package","title":"Voice bots","body":{"blog":{"title":"Hi"}}}'
    )
    calls = parse_tool_calls(raw)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "seo_save_generated_content"
    assert calls[0]["function"]["arguments"]["title"] == "Voice bots"
    content, _ = strip_think_and_tools(raw)
    assert "seo_save_generated_content" not in (content or "")


def _fake_completion(content: str | None, finish_reason: str, tool_calls=None):
    msg = MagicMock()
    msg.content = content
    msg.tool_calls = tool_calls
    choice = MagicMock()
    choice.message = msg
    choice.finish_reason = finish_reason
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def test_strip_think_and_tools_treats_unclosed_think_as_reasoning_only():
    raw = "<think>still reasoning\n\n{\"subject\":\"Hi\"}"
    content, reasoning = strip_think_and_tools(raw)
    assert "still reasoning" in (reasoning or "")
    assert content is None


@pytest.mark.asyncio
async def test_chat_retries_with_thinking_disabled_when_still_empty():
    empty_thinking = _fake_completion("<think>plan", "length")
    filled = _fake_completion('{"ok":true}', "stop")

    client = MagicMock()
    client.chat.completions.create = MagicMock(
        side_effect=[empty_thinking, filled]
    )

    with (
        patch("app.llm.get_settings") as gs,
        patch("app.llm._openai_client", return_value=client),
    ):
        gs.return_value.llm_api_key = "EMPTY"
        gs.return_value.llm_base_url = "http://81.17.61.148:8064/v1"
        gs.return_value.llm_model = "worktual-minimax"
        gs.return_value.dependency_circuit_failures = 5
        gs.return_value.dependency_circuit_recovery_seconds = 30
        out = await chat_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=220,
            timeout_ms=5_000,
        )

    assert out is not None
    assert out["content"] == '{"ok":true}'
    assert client.chat.completions.create.call_count == 2
    first_thinking = client.chat.completions.create.call_args_list[0].kwargs[
        "extra_body"
    ]["chat_template_kwargs"]["enable_thinking"]
    second_thinking = client.chat.completions.create.call_args_list[1].kwargs[
        "extra_body"
    ]["chat_template_kwargs"]["enable_thinking"]
    assert first_thinking is False
    assert second_thinking is False


@pytest.mark.asyncio
async def test_chat_retries_when_finish_length_empty():
    empty = _fake_completion(None, "length")
    filled = _fake_completion('{"ok":true}', "stop")

    client = MagicMock()
    client.chat.completions.create = MagicMock(side_effect=[empty, filled])

    with (
        patch("app.llm.get_settings") as gs,
        patch("app.llm._openai_client", return_value=client),
    ):
        gs.return_value.llm_api_key = "EMPTY"
        gs.return_value.llm_base_url = "http://81.17.61.148:8064/v1"
        gs.return_value.llm_model = "worktual-minimax"
        out = await chat_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=220,
            timeout_ms=5_000,
        )

    assert out is not None
    assert out["content"] == '{"ok":true}'
    assert client.chat.completions.create.call_count == 2
    first_tokens = client.chat.completions.create.call_args_list[0].kwargs["max_tokens"]
    second_tokens = client.chat.completions.create.call_args_list[1].kwargs["max_tokens"]
    assert first_tokens == 220
    assert second_tokens > first_tokens


@pytest.mark.asyncio
async def test_chat_retries_when_finish_length_has_partial_text():
    cut = _fake_completion("Would you like to see the remaining deals that were", "length")
    done = _fake_completion(
        "Would you like to see the remaining deals that were not on the first page?",
        "stop",
    )
    client = MagicMock()
    client.chat.completions.create = MagicMock(side_effect=[cut, done])

    with (
        patch("app.llm.get_settings") as gs,
        patch("app.llm._openai_client", return_value=client),
    ):
        gs.return_value.llm_api_key = "EMPTY"
        gs.return_value.llm_base_url = "http://81.17.61.148:8064/v1"
        gs.return_value.llm_model = "worktual-minimax"
        out = await chat_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=220,
            timeout_ms=5_000,
        )

    assert out is not None
    assert out["content"].endswith("first page?")
    assert client.chat.completions.create.call_count == 2
    assert (
        client.chat.completions.create.call_args_list[1].kwargs["max_tokens"]
        > client.chat.completions.create.call_args_list[0].kwargs["max_tokens"]
    )


@pytest.mark.asyncio
async def test_generate_ai_text_uses_retry_path():
    empty = _fake_completion("", "length")
    filled = _fake_completion("Hello from retry", "stop")
    client = MagicMock()
    client.chat.completions.create = MagicMock(side_effect=[empty, filled])

    with (
        patch("app.llm.get_settings") as gs,
        patch("app.llm._openai_client", return_value=client),
    ):
        gs.return_value.llm_api_key = "EMPTY"
        gs.return_value.llm_base_url = "http://81.17.61.148:8064/v1"
        gs.return_value.llm_model = "worktual-minimax"
        text = await generate_ai_text(system="s", user="u", max_tokens=100)

    assert text == "Hello from retry"


@pytest.mark.asyncio
async def test_chat_parses_xml_tools_when_native_missing():
    raw = """
<minimax:tool_call>
<invoke name="navigate">
<parameter name="href">/sales</parameter>
</invoke>
</minimax:tool_call>
"""
    resp = _fake_completion(raw, "stop", tool_calls=None)
    client = MagicMock()
    client.chat.completions.create = MagicMock(return_value=resp)

    with (
        patch("app.llm.get_settings") as gs,
        patch("app.llm._openai_client", return_value=client),
    ):
        gs.return_value.llm_api_key = "EMPTY"
        gs.return_value.llm_base_url = "http://81.17.61.148:8064/v1"
        gs.return_value.llm_model = "worktual-minimax"
        out = await chat_with_tools(
            messages=[{"role": "user", "content": "open sales"}],
            tools=[{"type": "function", "function": {"name": "navigate"}}],
        )

    assert out is not None
    assert out["tool_calls"][0]["function"]["name"] == "navigate"
    assert out["tool_calls"][0]["function"]["arguments"]["href"] == "/sales"
