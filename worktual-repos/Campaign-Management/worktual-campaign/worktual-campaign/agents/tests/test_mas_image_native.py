"""Image MAS — enhance gate, safety, domain routing."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_image_native_enabled_by_default():
    from app.mas.executors.shared.image_native import is_native_image
    from app.mas.runtime.flags import is_image_native_enabled

    assert is_native_image() is True
    assert is_image_native_enabled() is True


def test_tools_for_mas_image_executor_subsets():
    from app.agents.image.tools.schemas import tools_for_mas_image_executor

    gen = {t["function"]["name"] for t in tools_for_mas_image_executor("image_generate")}
    ref = {t["function"]["name"] for t in tools_for_mas_image_executor("image_refine")}
    att = {t["function"]["name"] for t in tools_for_mas_image_executor("image_attach")}
    assert gen == {"ENHANCE_IMAGE_PROMPT", "GENERATE_IMAGE", "GET_LAST_IMAGE"}
    assert ref == {"ENHANCE_IMAGE_PROMPT", "REFINE_IMAGE", "GET_LAST_IMAGE"}
    assert att == {"GET_LAST_IMAGE", "ATTACH_IMAGE"}


def test_is_unsafe_image_request():
    from app.agents.image.enhance import is_unsafe_image_request

    assert is_unsafe_image_request("create nsfw porn banner") is True
    assert is_unsafe_image_request("Diwali sale email hero") is False


def test_is_unsafe_enhanced_prompt_ignores_avoid_section():
    from app.agents.image.enhance import is_unsafe_enhanced_prompt

    safe = (
        "Festive email hero with product focal point. "
        "Avoid: No pornographic or NSFW content."
    )
    assert is_unsafe_enhanced_prompt(safe) is False


def test_validate_enhanced_prompt_rejects_raw_only():
    from app.agents.image.enhance import validate_enhanced_prompt

    ok, err = validate_enhanced_prompt("sale banner", "sale banner")
    assert ok is False
    assert err


def test_validate_enhanced_prompt_rejects_raw_plus_avoid():
    from app.agents.image.enhance import DEFAULT_NEGATIVES, validate_enhanced_prompt

    raw = "sale banner"
    fake = f"{raw}. Avoid: {DEFAULT_NEGATIVES}"
    ok, err = validate_enhanced_prompt(raw, fake)
    assert ok is False
    assert err


def test_merge_image_slots_from_session_channel():
    from app.agents.image.enhance import merge_image_slots_from_session

    session = {"channels": ["email"], "campaign": {"name": "Summer", "goal": "Leads"}}
    spec = merge_image_slots_from_session(session, {"query": "hero image"})
    assert spec["channel"] == "email"
    assert spec["campaign_name"] == "Summer"
    assert spec["campaign_goal"] == "Leads"


def test_enhance_empty_prompt_asks():
    async def run():
        from app.agents.image.tools.handlers import dispatch_tool

        with patch(
            "app.agents.image.tools.handlers.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess, patch(
            "app.agents.image.tools.handlers.save_session",
            new_callable=AsyncMock,
        ):
            session = {"session_id": "s-img", "module": "image", "mas_task": {"slots": {}}}
            mock_sess.return_value = session
            return await dispatch_tool("ENHANCE_IMAGE_PROMPT", "s-img", "tok", {})

    out = asyncio.run(run())
    assert out.get("ok") is False
    assert out.get("needs_image_brief") is True


def test_enhance_fail_closed_when_director_does_not_expand():
    async def run():
        from app.agents.image.enhance import enhance_image_prompt

        with patch("app.llm.OpenAILLM") as mock_cls:
            instance = mock_cls.return_value
            instance.run.return_value = {"content": "Diwali sale banner"}
            return await enhance_image_prompt("Diwali sale banner")

    out = asyncio.run(run())
    assert out.ok is False
    err = str(out.error or "").lower()
    assert "expand" in err or "short" in err or "visual direction" in err


def test_generate_blocked_without_enhance():
    async def run():
        from app.agents.image.tools.handlers import dispatch_tool

        with patch(
            "app.agents.image.tools.handlers.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess, patch(
            "app.agents.image.tools.handlers.save_session",
            new_callable=AsyncMock,
        ):
            session = {"session_id": "s-img", "module": "image", "mas_task": {"slots": {}}}
            mock_sess.return_value = session
            return await dispatch_tool(
                "GENERATE_IMAGE",
                "s-img",
                "tok",
                {"enhanced_prompt": "A detailed hero with lighting and mood."},
            )

    out = asyncio.run(run())
    assert out.get("ok") is False
    assert "ENHANCE_IMAGE_PROMPT" in str(out.get("error", ""))


def test_unsafe_request_refused_at_enhance():
    async def run():
        from app.agents.image.tools.handlers import dispatch_tool

        with patch(
            "app.agents.image.tools.handlers.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess, patch(
            "app.agents.image.tools.handlers.save_session",
            new_callable=AsyncMock,
        ):
            session = {"session_id": "s-img", "module": "image", "mas_task": {"slots": {}}}
            mock_sess.return_value = session
            return await dispatch_tool(
                "ENHANCE_IMAGE_PROMPT",
                "s-img",
                "tok",
                {"user_prompt": "nsfw explicit porn poster"},
            )

    out = asyncio.run(run())
    assert out.get("ok") is False
    assert out.get("refused") is True


def test_enhance_then_generate_mock():
    async def run():
        from app.agents.image.enhance import EnhanceResult
        from app.agents.image.tools.handlers import dispatch_tool

        enhanced = (
            "Festive Diwali sale email hero banner, warm gold lighting, product focal point, "
            "16:9 landscape, clean crop for headline overlay. Avoid: watermarks and clutter."
        )
        with patch(
            "app.agents.image.tools.handlers.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess, patch(
            "app.agents.image.tools.handlers.save_session",
            new_callable=AsyncMock,
        ), patch(
            "app.agents.image.tools.handlers.enhance_image_prompt",
            new_callable=AsyncMock,
        ) as mock_enhance, patch(
            "app.integrations.gemini_image.generate_and_upload_rebuild_url",
            new_callable=AsyncMock,
        ) as mock_gen, patch(
            "app.gallery.image_asset_registry.register_gallery_image",
            new_callable=AsyncMock,
        ):
            session = {"session_id": "s-img", "module": "image", "mas_task": {"slots": {}}}
            mock_sess.return_value = session
            mock_enhance.return_value = EnhanceResult(ok=True, enhanced_prompt=enhanced)
            mock_gen.return_value = {
                "url": "http://example/media/1.png",
                "media_id": "m1",
                "used_stub": True,
            }

            e1 = await dispatch_tool(
                "ENHANCE_IMAGE_PROMPT",
                "s-img",
                "tok",
                {"user_prompt": "Diwali sale banner for email", "channel": "email"},
            )
            blocked = await dispatch_tool(
                "GENERATE_IMAGE",
                "s-img",
                "tok",
                {"enhanced_prompt": enhanced},
            )
            g1 = await dispatch_tool(
                "GENERATE_IMAGE",
                "s-img",
                "tok",
                {"enhanced_prompt": enhanced, "user_confirmed": True},
            )
            return e1, blocked, g1

    e1, blocked, g1 = asyncio.run(run())
    assert e1.get("ok") is True
    assert e1.get("awaiting_generate_confirm") is True
    assert "Avoid" in str(e1.get("enhanced_prompt", "")) or len(e1.get("enhanced_prompt", "")) > 40
    assert blocked.get("ok") is False
    assert blocked.get("needs_confirm") is True
    assert g1.get("ok") is True
    assert g1.get("image_url") == "http://example/media/1.png"


def test_image_domain_forced_generate():
    session: dict = {"session_id": "s1", "module": "image", "channels": ["email"]}

    async def run():
        with patch(
            "app.mas.domains.image.runner.get_executor_runner",
        ) as mock_get:
            mock_runner = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "reply": "done",
                    "mas_native_image": True,
                }
            )
            mock_get.return_value = mock_runner
            from app.mas.domains.image.runner import run_image_domain

            return await run_image_domain(
                {
                    "session": session,
                    "domain_id": "image",
                    "entry": "interactive",
                    "query": "hero for email",
                    "module_hint": "image",
                    "task_spec": {
                        "query": "hero for email",
                        "image_action": "generate",
                        "channel": "email",
                    },
                    "token": "tok",
                    "session_id": "s1",
                }
            ), mock_get

    out, mock_get = asyncio.run(run())
    assert out.get("executor_id") == "image_generate"
    mock_get.assert_called_with("image_generate")


def test_create_chat_image_attach_defers_when_cards_exist():
    from app.mas.domains.image.runner import _needs_creation_build

    session = {
        "module": "create_campaign",
        "channels": ["email"],
        "templates": [{"template_id": "e1", "channel": "email"}],
        "template_ids_by_channel": {"email": "e1"},
    }
    blocked = _needs_creation_build(
        session=session,
        executor_id="campaign_images",
        query="add a hero image",
        task_spec={"module": "create_campaign"},
    )
    assert blocked is not None
    assert blocked.get("needs_domain", {}).get("domain_id") == "creation"
    assert blocked.get("needs_domain", {}).get("preferred_executor") == "campaign_content"
    assert "NEW" in str(blocked.get("message") or "")


def test_create_chat_attach_tool_freezes_existing_cards():
    from app.agents.image.tools.handlers import _create_chat_existing_cards_frozen

    session = {
        "module": "create_campaign",
        "channels": ["email"],
        "templates": [{"template_id": "e1", "channel": "email"}],
        "template_ids_by_channel": {"email": "e1"},
    }
    frozen = _create_chat_existing_cards_frozen(session, {})
    assert frozen is not None
    assert frozen.get("needs_new_generate") is True
    assert _create_chat_existing_cards_frozen(
        session, {"chat_context": "edit"}
    ) is None
    assert (
        _create_chat_existing_cards_frozen(
            session, {"generation_batch_id": "b2"}, allow_new_batch=True
        )
        is None
    )


def test_image_generate_executor_requires_native():
    async def run():
        with patch(
            "app.mas.executors.image_generate.runner.is_native_image",
            return_value=False,
        ):
            from app.mas.executors.image_generate.runner import run_image_generate_executor

            return await run_image_generate_executor(
                {"session_id": "s", "token": "t", "task_spec": {"query": "x"}}
            )

    out = asyncio.run(run())
    assert out.get("ok") is False
    assert "MAS_IMAGE_NATIVE" in str(out.get("error", ""))


def test_strip_merge_tags_removes_first_name():
    from app.agents.image.enhance import strip_merge_tags, visual_alignment_copy

    raw = "Hi {{first_name}}, we hit 1M. Thank you {{ FIRST_NAME }}!!"
    assert "{{" not in strip_merge_tags(raw)
    assert "first_name" not in strip_merge_tags(raw).lower()
    snippet = visual_alignment_copy("Hi {{first_name}}, celebrate with the team.")
    assert "{{" not in snippet
    assert "first_name" not in snippet.lower()


def test_email_framing_has_no_headline_overlay():
    from app.agents.image.enhance import (
        DEFAULT_NEGATIVES,
        build_enhance_user_message,
        build_visual_director_system,
        channel_framing_hint,
    )

    frame = channel_framing_hint("email").lower()
    assert "headline overlay" not in frame
    assert "no letters" in frame or "no text" in frame
    system = build_visual_director_system().lower()
    assert "zero readable text" in system
    assert "headline overlay" not in system
    negs = DEFAULT_NEGATIVES.lower()
    assert "readable text" in negs
    assert "{{" not in DEFAULT_NEGATIVES

    msg = build_enhance_user_message(
        "office celebration photo Hi {{first_name}}",
        channel="email",
        campaign_brief="Hi {{first_name}}, WE HIT 1M! Thank you for your support.",
        template_subject="Big News Inside: We've hit a major milestone!",
    )
    assert "{{" not in msg
    assert "do not paint" in msg.lower() or "do not render" in msg.lower()
    assert "headline overlay" not in msg.lower()
