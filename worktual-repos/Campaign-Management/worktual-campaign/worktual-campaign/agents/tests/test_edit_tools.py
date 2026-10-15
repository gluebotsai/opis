"""Template edit tools — LLM final text is the user-facing reply."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.runtime.agent import ToolLoopResult


@pytest.mark.asyncio
async def test_edit_tools_uses_model_content_not_tool_reply():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="I dropped the Diwali headline and left the rest of the email as-is. Want a shorter subject too?",
        used_tools=True,
    )

    captured = {}

    async def fake_loop(*args, **kwargs):
        captured["require_content_after_tools"] = kwargs.get("require_content_after_tools")
        captured["unavailable_reply"] = kwargs.get("unavailable_reply")
        dispatch = kwargs["dispatch"]
        await dispatch(
            "apply_template_changes",
            {
                "section_operations": [
                    {"op": "remove", "type": "headline", "one_only": True}
                ]
            },
        )
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Celebrate Diwali",
                "sections": [
                    {"type": "headline", "content": "Brighten Your Business This Diwali"},
                    {"type": "text", "content": "Hi {{first_name}}"},
                ],
            },
            instruction="remove the Brighten Your Business This Diwali",
            campaign={"name": "Diwali Re-engagement"},
        )

    assert captured["require_content_after_tools"] is True
    assert captured["unavailable_reply"] == ""
    assert out["reply"].startswith("I dropped the Diwali headline")
    assert "Done — I removed the hero image" not in out["reply"]
    assert out["intent"] == "modify"
    assert out["persist_fields"] is True
    types = [r["type"] for r in out["fields"]["sections"] if isinstance(r, dict)]
    assert "headline" not in types


@pytest.mark.asyncio
async def test_edit_tools_remove_hero_clears_image():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="The hero photo is off this email now. The rest of the copy is unchanged — want a new image or should we leave it text-only?",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch("remove_hero_image", {})
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Celebrate Diwali",
                "header_image": "https://cdn.example/hero.jpg",
                "sections": [
                    {"type": "headline", "content": "Brighten Your Business This Diwali"},
                    {"type": "image", "url": "https://cdn.example/hero.jpg"},
                    {"type": "text", "content": "Hi {{first_name}}"},
                ],
            },
            instruction="remove the image",
            campaign={},
        )

    assert "hero photo is off" in out["reply"].lower()
    assert not str(out["fields"].get("header_image") or "").strip()
    types = [r["type"] for r in out["fields"]["sections"] if isinstance(r, dict)]
    assert "image" not in types
    assert "headline" in types


@pytest.mark.asyncio
async def test_edit_tools_attach_uploaded_image():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="Attached your upload as the email hero. Want any copy tweaks?",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch("attach_uploaded_image", {})
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Celebrate Diwali",
                "sections": [
                    {"type": "headline", "content": "Brighten Your Business This Diwali"},
                    {"type": "text", "content": "Hi {{first_name}}"},
                ],
            },
            instruction="use my uploaded image",
            campaign={},
            pending_image_uploads=[
                {
                    "image_url": "https://cdn.example/user-upload.jpg",
                    "filename": "hero.jpg",
                }
            ],
        )

    assert out["intent"] == "modify"
    assert "cdn.example/user-upload.jpg" in str(out["fields"].get("header_image") or "")
    assert out["image_url"].endswith("user-upload.jpg")


@pytest.mark.asyncio
async def test_edit_tools_attach_product_slot_keeps_hero():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="Placed your photo in the product slot under the headline.",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "attach_uploaded_image",
            {
                "attach_target": "product",
                "image_url": "https://cdn.example/product.jpg",
            },
        )
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Celebrate Diwali",
                "header_image": "https://cdn.example/hero.jpg",
                "sections": [
                    {"type": "headline", "content": "Diwali"},
                    {
                        "type": "image",
                        "url": "https://cdn.example/hero.jpg",
                        "purpose": "hero",
                    },
                    {"type": "text", "content": "Hi"},
                    {
                        "type": "image",
                        "url": "",
                        "purpose": "product",
                    },
                ],
            },
            instruction="put this on the product image not the banner",
            campaign={},
            pending_image_uploads=[
                {"image_url": "https://cdn.example/product.jpg", "filename": "p.jpg"}
            ],
        )

    sections = out["fields"]["sections"]
    assert sections[1]["url"] == "https://cdn.example/hero.jpg"
    assert "product.jpg" in str(sections[3].get("url") or "")


@pytest.mark.asyncio
async def test_edit_tools_add_and_remove_copy():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="Removed the CTA and added a line under the headline.",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "apply_template_changes",
            {
                "section_operations": [
                    {"op": "remove", "type": "cta", "one_only": True},
                    {
                        "op": "insert",
                        "after_type": "headline",
                        "type": "text",
                        "content": "Members save extra this week.",
                    },
                ]
            },
        )
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Sale",
                "sections": [
                    {"type": "headline", "content": "Sale"},
                    {"type": "text", "content": "Hi"},
                    {"type": "cta", "label": "Buy", "url": "{{campaign_url}}"},
                ],
            },
            instruction="remove the button and add a line under the headline",
            campaign={},
        )

    types = [r["type"] for r in out["fields"]["sections"]]
    assert "cta" not in types
    assert types[1] == "text"
    assert "Members save" in out["fields"]["sections"][1]["content"]


@pytest.mark.asyncio
async def test_edit_tools_handoff_launch():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="Handing this to launch now.",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "handoff_campaign_launch",
            {
                "user_confirmed": True,
                "channels": ["email", "web"],
                "schedule_mode": "later",
                "schedule_at": "2026-09-16T10:00:00+05:30",
                "note": "user asked from edit space",
            },
        )
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={"subject": "Hi"},
            instruction="schedule email and web for tomorrow 10am",
            campaign={},
        )

    assert out["intent"] == "launch"
    assert out["persist_fields"] is False
    assert out["launch_channels"] == ["email", "web"]
    assert out["schedule_mode"] == "later"
    assert "2026-09-16" in str(out["schedule_at"])


@pytest.mark.asyncio
async def test_edit_tools_set_email_theme():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="Background is now soft green with a teal accent.",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "set_email_theme",
            {
                "theme_id": "calm_professional",
                "theme": {"background": "#edf4f1", "accent": "#0f766e"},
            },
        )
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Hi",
                "theme": {"background": "#ffffff", "accent": "#111111"},
                "sections": [{"type": "headline", "content": "Hello"}],
            },
            instruction="make the background soft green",
            campaign={},
        )

    assert out["intent"] == "modify"
    assert out["fields"]["theme"]["background"] == "#edf4f1"
    assert out["fields"]["theme"]["accent"] == "#0f766e"
    assert out["fields"].get("theme_id") == "calm_professional"


@pytest.mark.asyncio
async def test_edit_tools_set_footer_social_links():
    from app.agents.template_library.edit_tools import run_template_edit_tools

    loop = ToolLoopResult(
        content="Added your LinkedIn and privacy link under the email.",
        used_tools=True,
    )

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "set_footer_social_links",
            {
                "social_links": [
                    {
                        "network": "linkedin",
                        "label": "LinkedIn",
                        "url": "https://linkedin.com/company/acme",
                    }
                ],
                "footer_links": [
                    {"label": "Privacy", "url": "https://acme.example/privacy"}
                ],
            },
        )
        return loop

    with patch(
        "app.agents.template_library.edit_tools.run_tool_loop",
        new=fake_loop,
    ):
        out = await run_template_edit_tools(
            channel="email",
            current_fields={
                "subject": "Hi",
                "sections": [
                    {"type": "headline", "content": "Hello"},
                    {"type": "compliance_footer", "content": "Unsub"},
                ],
            },
            instruction="add our LinkedIn and privacy page",
            campaign={},
        )

    assert out["intent"] == "modify"
    assert out["fields"]["social_links"][0]["url"].startswith("https://linkedin.com")
    assert out["fields"]["footer_links"][0]["label"] == "Privacy"
    types = [r["type"] for r in out["fields"]["sections"] if isinstance(r, dict)]
    assert "social_links" in types
    assert types.index("social_links") < types.index("compliance_footer")


@pytest.mark.asyncio
async def test_edit_orchestrator_empty_recent_messages_no_index_error():
    """Regression: memory uses [-8:] slice; empty/short history must not IndexError."""
    from app.agents.template_library.edit_orchestrator import select_template_edit_skill
    from app.runtime.agent import ToolLoopResult

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "select_edit_skill",
            {
                "skill_id": "edit_layout",
                "restated_query": "remove the compliance footer",
            },
        )
        return ToolLoopResult(content="", used_tools=True)

    with patch(
        "app.agents.template_library.edit_orchestrator.run_tool_loop",
        new=fake_loop,
    ):
        out = await select_template_edit_skill(
            instruction="remove the unsubscribe footer text",
            channel="email",
            current_fields={
                "subject": "Hi",
                "sections": [
                    {"type": "compliance_footer", "content": "You are receiving…"}
                ],
            },
            recent_messages=[],
        )
        assert out["mode"] == "modify"
        assert out["skill_id"] == "edit_layout"

        out2 = await select_template_edit_skill(
            instruction="shorten the headline",
            channel="email",
            current_fields={
                "subject": "Hi",
                "sections": [{"type": "headline", "content": "A"}],
            },
            recent_messages=[
                {"role": "user", "kind": "text", "payload": {"text": "hi"}},
                {"role": "assistant", "kind": "text", "payload": {"text": "ok"}},
            ],
        )
        assert out2["skill_id"] == "edit_layout"


@pytest.mark.asyncio
async def test_edit_orchestrator_chat_only_skips_executor_skill():
    """Normal queries: main agent direct_reply, no static skill fallback."""
    from app.agents.template_library.edit_orchestrator import (
        run_template_edit_orchestrated,
        select_template_edit_skill,
    )
    from app.runtime.agent import ToolLoopResult

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "select_edit_skill",
            {"direct_reply": "I can update copy, layout, colours, or images — what should we change?"},
        )
        return ToolLoopResult(content="", used_tools=True)

    with patch(
        "app.agents.template_library.edit_orchestrator.run_tool_loop",
        new=fake_loop,
    ):
        pick = await select_template_edit_skill(
            instruction="hi what can you do?",
            channel="email",
            current_fields={"subject": "Hi", "sections": []},
            recent_messages=[],
        )
        assert pick["mode"] == "chat"
        assert not pick.get("skill_id")

    async def fake_edit_loop(*args, **kwargs):
        return ToolLoopResult(
            content="I can update copy, layout, colours, or images — what should we change?",
            used_tools=False,
        )

    with patch(
        "app.agents.template_edit.runner.run_tool_loop",
        new=fake_edit_loop,
    ):
        out = await run_template_edit_orchestrated(
            channel="email",
            current_fields={"subject": "Hi", "sections": [{"type": "headline", "content": "A"}]},
            instruction="hi what can you do?",
            campaign={},
            recent_messages=[],
        )
        assert out["intent"] == "general"
        assert out["persist_fields"] is False
        assert "copy" in out["reply"].lower() or "layout" in out["reply"].lower()


@pytest.mark.asyncio
async def test_edit_orchestrator_no_skill_stays_chat():
    """No skill_id from LLM → chat path; never invent a skill in Python."""
    from app.agents.template_library.edit_orchestrator import select_template_edit_skill
    from app.runtime.agent import ToolLoopResult

    async def fake_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "select_edit_skill",
            {"direct_reply": "What would you like to change?"},
        )
        return ToolLoopResult(content="", used_tools=True)

    with patch(
        "app.agents.template_library.edit_orchestrator.run_tool_loop",
        new=fake_loop,
    ):
        out = await select_template_edit_skill(
            instruction="remove the footer",
            channel="email",
            current_fields={
                "subject": "Hi",
                "sections": [{"type": "compliance_footer", "content": "Unsub"}],
            },
            recent_messages=[],
        )
        assert out["mode"] == "chat"
        assert out.get("skill_id") == ""
        assert out.get("direct_reply")
