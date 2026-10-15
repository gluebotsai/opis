"""Compact session template extract + Phase 2 keep/plan_new honor agent modes."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.create_campaign.template_extract import (
    compact_template_extract,
    pick_session_template,
)
from app.agents.create_campaign.tools import MAS_EXECUTOR_TOOL_NAMES, _TOOL_INDEX


_MEDIA = "https://rebuild-campaign-api.worktual.com/api/media/hero-old"
_NEW_MEDIA = "https://rebuild-campaign-api.worktual.com/api/media/hero-new"
_PRIOR_HTML = (
    f'<html><body><img src="{_MEDIA}" alt="hero"/><p>Keep this copy as-is</p></body></html>'
)


def _prior_card() -> dict:
    return {
        "template_id": "tid-old",
        "channel": "email",
        "prior_template_id": "tid-parent",
        "fields": {
            "subject": "Old subject",
            "preheader": "Old pre",
            "compiled_html": _PRIOR_HTML,
            "header_image": _MEDIA,
            "image_url": _MEDIA,
            "image_assets": [{"role": "hero", "url": _MEDIA, "width_px": 600}],
            "pipeline": "compose",
        },
    }


def test_inspect_tool_is_on_campaign_content() -> None:
    assert "inspect_session_template" in MAS_EXECUTOR_TOOL_NAMES["campaign_content"]
    assert "inspect_session_template" in _TOOL_INDEX


def test_compact_extract_has_no_html() -> None:
    extract = compact_template_extract(_prior_card())
    assert "compiled_html" not in extract
    assert extract["template_id"] == "tid-old"
    assert extract["subject"] == "Old subject"
    assert "Keep this copy" in extract["body_plain"]
    assert extract["hero_url"] == _MEDIA
    assert _MEDIA in extract["image_urls"]
    assert extract["prior_template_id"] == "tid-parent"
    assert "<img" not in extract["body_plain"]


def test_pick_session_template_latest_email() -> None:
    session = {
        "templates": [
            {"template_id": "a", "channel": "email", "fields": {"subject": "A"}},
            {"template_id": "wa", "channel": "whatsapp", "fields": {"body": "hi"}},
            {"template_id": "b", "channel": "email", "fields": {"subject": "B"}},
        ]
    }
    latest = pick_session_template(session)
    assert latest is not None
    assert latest["template_id"] == "b"
    named = pick_session_template(session, template_id="a")
    assert named is not None
    assert named["template_id"] == "a"


@pytest.mark.asyncio
async def test_phase2_keep_copy_and_hero_skips_compose() -> None:
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    with patch("app.mas.phase2_compose.plugin.TemplateDomain") as Domain:
        Domain.return_value.invoke = AsyncMock(side_effect=AssertionError("compose should skip"))
        card = await run_phase2_email_create(
            campaign={"name": "Launch", "goal": "G", "objective": "O"},
            plan={
                "how_it_works": "Email",
                "creative_policy": {"content_mode": "keep", "image_mode": "keep"},
            },
            user_request="add image text but do not change copy",
            prior_template=_prior_card(),
        )
    assert card["template_id"] != "tid-old"
    assert card["prior_template_id"] == "tid-old"
    html = card["fields"]["compiled_html"]
    assert "Keep this copy as-is" in html
    assert _MEDIA in html
    assert card["fields"]["subject"] == "Old subject"


@pytest.mark.asyncio
async def test_phase2_keep_copy_plan_new_uses_this_turn_hero() -> None:
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    with patch("app.mas.phase2_compose.plugin.TemplateDomain") as Domain:
        Domain.return_value.invoke = AsyncMock(side_effect=AssertionError("compose should skip"))
        card = await run_phase2_email_create(
            campaign={"name": "Launch", "goal": "G", "objective": "O"},
            plan={
                "how_it_works": "Email",
                "ready_image_url": _NEW_MEDIA,
                "creative_policy": {"content_mode": "keep", "image_mode": "plan_new"},
            },
            user_request="new image with text, keep copy",
            prior_template=_prior_card(),
        )
    html = card["fields"]["compiled_html"]
    assert "Keep this copy as-is" in html
    assert _NEW_MEDIA in html
    assert _MEDIA not in html
    assert card["fields"]["header_image"] == _NEW_MEDIA


@pytest.mark.asyncio
async def test_phase2_rewrite_keep_image_passes_prior_hero() -> None:
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    domain_out = {
        "ok": True,
        "fields": {
            "subject": "Longer",
            "compiled_html": (
                f'<html><body><img src="{_MEDIA}" alt=""/><p>Much longer copy here</p></body></html>'
            ),
            "plan": {"subject": "Longer"},
            "image_assets": [{"role": "hero", "url": _MEDIA, "width_px": 600}],
            "pipeline": "compose",
        },
    }
    with patch("app.mas.phase2_compose.plugin.TemplateDomain") as Domain:
        Domain.return_value.invoke = AsyncMock(return_value=domain_out)
        card = await run_phase2_email_create(
            campaign={"name": "Launch", "goal": "G", "objective": "O"},
            plan={
                "how_it_works": "Email",
                "creative_policy": {"content_mode": "rewrite", "image_mode": "keep"},
            },
            user_request="give a length content",
            prior_template=_prior_card(),
        )
    invoke_ctx = Domain.return_value.invoke.await_args.args[0]
    assert invoke_ctx["ready_image_url"] == _MEDIA
    assert invoke_ctx["task_spec"]["image_mode"] == "keep"
    assert invoke_ctx["task_spec"]["prior_extract"]["hero_url"] == _MEDIA
    assert "compiled_html" not in invoke_ctx["task_spec"]["prior_extract"]
    assert "Much longer copy" in card["fields"]["compiled_html"]
    assert _MEDIA in card["fields"]["compiled_html"]


@pytest.mark.asyncio
async def test_phase2_plan_new_does_not_copy_prior_hero_as_ready() -> None:
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    domain_out = {
        "ok": True,
        "fields": {
            "subject": "Fresh",
            "compiled_html": (
                f'<html><body><img src="{_NEW_MEDIA}" alt=""/><p>New copy</p></body></html>'
            ),
            "plan": {"subject": "Fresh"},
            "image_assets": [{"role": "hero", "url": _NEW_MEDIA, "width_px": 600}],
            "pipeline": "compose",
        },
    }
    with patch("app.mas.phase2_compose.plugin.TemplateDomain") as Domain:
        Domain.return_value.invoke = AsyncMock(return_value=domain_out)
        await run_phase2_email_create(
            campaign={"name": "Launch", "goal": "G", "objective": "O"},
            plan={
                "how_it_works": "Email",
                "ready_image_url": _NEW_MEDIA,
                "creative_policy": {"content_mode": "rewrite", "image_mode": "plan_new"},
            },
            user_request="new idea and new image",
            prior_template=_prior_card(),
        )
    invoke_ctx = Domain.return_value.invoke.await_args.args[0]
    assert invoke_ctx["ready_image_url"] == _NEW_MEDIA
    assert invoke_ctx["task_spec"]["image_mode"] == "plan_new"
