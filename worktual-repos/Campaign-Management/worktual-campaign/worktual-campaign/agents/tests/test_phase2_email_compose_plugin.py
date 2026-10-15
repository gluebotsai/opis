"""Phase 2 email compose plugin — this-turn query + chat_summary on task_spec."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.create_campaign.tool_functions import _email_template_has_director_shape
from app.mas.phase2_compose.plugin import (
    _build_query,
    email_card_from_compose_result,
    ensure_campaign_url_cta,
    ensure_unsubscribe,
    use_phase2_email_compose,
)


def test_use_phase2_off_by_default() -> None:
    with patch(
        "app.mas.phase2_compose.plugin.get_settings",
    ) as gs:
        gs.return_value.phase2_email_compose_enabled = False
        assert use_phase2_email_compose(None) is False


def test_use_phase2_when_flag_on_includes_regenerate() -> None:
    with patch(
        "app.mas.phase2_compose.plugin.get_settings",
    ) as gs:
        gs.return_value.phase2_email_compose_enabled = True
        assert use_phase2_email_compose(None) is True
        assert use_phase2_email_compose({}) is True
        existing = {
            "template_id": "tid-1",
            "fields": {"subject": "Hello", "sections": [{"type": "headline"}]},
        }
        assert use_phase2_email_compose(existing) is True
        composed = {
            "template_id": "tid-2",
            "fields": {"compiled_html": "<p>Hi</p>", "pipeline": "compose"},
        }
        assert use_phase2_email_compose(composed) is True


def test_email_card_maps_compiled_html() -> None:
    out = {
        "ok": True,
        "fields": {
            "subject": "Welcome",
            "preheader": "Hello",
            "compiled_html": "<html><body><p>Hello there</p></body></html>",
            "plan": {"subject": "Welcome", "email_kind": "marketing"},
            "image_assets": [
                {"role": "hero", "url": "https://example.com/hero.png", "width_px": 600}
            ],
            "pipeline": "compose",
        },
    }
    card = email_card_from_compose_result(
        out, plan={"how_it_works": "Email touch"}, launch_at="2026-09-23T00:00:00Z"
    )
    assert card["channel"] == "email"
    fields = card["fields"]
    assert fields["pipeline"] == "compose"
    assert fields["subject"] == "Welcome"
    assert "Hello there" in fields["compiled_html"]
    assert "{{unsubscribe_url}}" in fields["compiled_html"]
    assert "{{first_name}}" in fields["compiled_html"]
    assert "https://example.com/hero.png" in fields["compiled_html"]
    assert fields["header_image"] == "https://example.com/hero.png"
    assert card["_generation_report"]["mas_trace"]["orchestrator"] == "phase2_compose"
    assert _email_template_has_director_shape(card) is True


def test_email_card_rewrites_hash_cta_when_dest_present() -> None:
    out = {
        "ok": True,
        "fields": {
            "subject": "Deadline Drop",
            "compiled_html": (
                '<html><body><a href="#" class="cta-button">'
                "Complete Your Purchase Now</a></body></html>"
            ),
        },
    }
    card = email_card_from_compose_result(
        out, dest_url="https://shop.example.com/flash"
    )
    html = card["fields"]["compiled_html"]
    assert 'href="https://shop.example.com/flash"' in html
    assert 'href="#"' not in html
    assert "{{campaign_url}}" not in html
    assert "{{unsubscribe_url}}" in html


def test_email_card_unwraps_hash_cta_without_dest() -> None:
    out = {
        "ok": True,
        "fields": {
            "subject": "Deadline Drop",
            "compiled_html": (
                '<html><body><a href="#" class="cta-button">'
                "Complete Your Purchase Now</a></body></html>"
            ),
        },
    }
    card = email_card_from_compose_result(out)
    html = card["fields"]["compiled_html"]
    assert "{{campaign_url}}" not in html
    assert 'href="#"' not in html
    assert "Complete Your Purchase Now" in html
    assert "{{unsubscribe_url}}" in html


def test_ensure_campaign_url_cta_skips_unsubscribe() -> None:
    html = (
        '<a href="#">Shop</a>'
        '<a href="{{unsubscribe_url}}">Unsubscribe</a>'
    )
    out = ensure_campaign_url_cta(html, dest="https://shop.example.com")
    assert 'href="https://shop.example.com">Shop' in out
    assert 'href="{{unsubscribe_url}}">Unsubscribe' in out


def test_ensure_first_name_greeting_inserts_once() -> None:
    from app.mas.phase2_compose.plugin import ensure_first_name_greeting

    html = "<html><body><p>Meet Lola.</p></body></html>"
    once = ensure_first_name_greeting(html)
    twice = ensure_first_name_greeting(once)
    assert once.count("{{first_name}}") == 1
    assert twice == once
    assert once.startswith("<html><body><p>Hi {{first_name}},</p>")


def test_ensure_campaign_url_cta_does_not_invent_button() -> None:
    html = (
        "<html><body><p>Meet Lola, our new voice assistant.</p>"
        '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p></body></html>'
    )
    out = ensure_campaign_url_cta(html)
    assert "{{campaign_url}}" not in out
    assert html == out


def test_knowledge_has_landing_url_ignores_media_and_images() -> None:
    from app.mas.phase2_compose.plugin import knowledge_has_landing_url

    assert knowledge_has_landing_url({"kb_snippets": ["ZIFO builds software"]}) is False
    assert knowledge_has_landing_url(
        {"logo": "https://cdn.example.com/logo.png"}
    ) is False
    assert knowledge_has_landing_url(
        {"url": "https://rebuild-campaign-api.worktual.com/api/media/abc"}
    ) is False
    assert knowledge_has_landing_url(
        {"site": "https://www.zifo.com/products"}
    ) is True


def test_cta_constraint_blocks_button_when_kb_has_no_url() -> None:
    from app.mas.phase2_compose.plugin import cta_constraint_for_compose
    from app.mas.phase2_compose.llm import PLAN_SYSTEM, TEMPLATE_COMPOSE_SYSTEM

    line = cta_constraint_for_compose(knowledge={"company": "ZIFO"}, query="launch Lola")
    assert "Do not add a marketing button" in line
    with_url = cta_constraint_for_compose(
        knowledge={"site": "https://www.zifo.com/lola"},
        query="launch Lola",
    )
    assert "URL is present" in with_url
    assert "unless the user asked for a click action" in TEMPLATE_COMPOSE_SYSTEM
    assert "Knowledge with no links is not a reason to invent" in TEMPLATE_COMPOSE_SYSTEM
    assert "primary button href MUST be" not in TEMPLATE_COMPOSE_SYSTEM
    assert "If knowledge has no links" in PLAN_SYSTEM
    assert "{{first_name}}" in TEMPLATE_COMPOSE_SYSTEM
    assert "{{first_name}}" in PLAN_SYSTEM


def test_email_card_prose_only_stays_without_campaign_url() -> None:
    out = {
        "ok": True,
        "fields": {
            "subject": "Meet Lola",
            "compiled_html": (
                "<html><body><p>Introducing Lola, your new voice bot.</p></body></html>"
            ),
        },
    }
    card = email_card_from_compose_result(out)
    html = card["fields"]["compiled_html"]
    assert "{{unsubscribe_url}}" in html
    assert "{{campaign_url}}" not in html
    assert "{{first_name}}" in html
    assert "Hi {{first_name}}," in html


def test_email_card_fills_subject_from_campaign_when_missing() -> None:
    out = {
        "ok": True,
        "fields": {
            "compiled_html": (
                "<html><body><p>Hello there friends this is a long email</p></body></html>"
            ),
            "plan": {},
        },
    }
    card = email_card_from_compose_result(out, campaign={"name": "Deadline Drop"})
    assert card["fields"]["subject"] == "Deadline Drop"


def test_email_card_fills_subject_from_h1_when_missing() -> None:
    out = {
        "ok": True,
        "fields": {
            "compiled_html": (
                "<html><body><h1>Autumn Sale</h1><p>Hello there friends</p></body></html>"
            ),
        },
    }
    card = email_card_from_compose_result(out)
    assert card["fields"]["subject"] == "Autumn Sale"


def test_email_card_drops_gstatic_stock_images() -> None:
    gstatic = (
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTkD61fzt1j7Kr7nEt9OuCYl3TrjnJDytFlr_SsvoBrTA&s=10"
    )
    out = {
        "ok": True,
        "fields": {
            "subject": "Sale",
            "compiled_html": f'<html><body><img src="{gstatic}" alt="hero"/><p>Hi</p></body></html>',
            "plan": {"subject": "Sale"},
            "image_assets": [{"role": "hero", "url": gstatic, "width_px": 600}],
            "pipeline": "compose",
        },
    }
    card = email_card_from_compose_result(out)
    html = card["fields"]["compiled_html"]
    assert "gstatic.com" not in html
    assert card["fields"]["image_assets"] == []
    assert not card["fields"].get("header_image")


def test_build_query_this_turn_plus_earlier_idea() -> None:
    idea = (
        "i needed a diwali sale, discount for 10% for all product, "
        "clothing industry, not needed to be professional, "
        "add more images and make a long mail not too short"
    )
    q = _build_query(
        campaign={
            "name": "Diwali Festive Sale – 10% Off Everything",
            "goal": "Drive all-product sales during Diwali with a 10% sitewide discount",
            "objective": "10% off on all clothing products for Diwali sale",
        },
        user_request="regenerate the template again",
        chat_summary=(
            f"user: {idea}\n"
            "assistant: Saved your setup.\n"
            "user: generate the template\n"
            "assistant: OK"
        ),
        knowledge="ignore this kb dump",
    )
    assert q.lower().startswith("regenerate the template again")
    assert "long mail" in q.lower()
    assert "more images" in q.lower()
    assert "clothing" in q.lower()
    assert "ignore this kb dump" not in q
    assert q.strip().lower() != "generate the template"


def test_build_query_keeps_shorter_change_request() -> None:
    idea = (
        "i needed to give a diwali sale for 25% the content in mail "
        "should be larger and only to aravindhselvaraj6235@gmail.com"
    )
    change = "i needed a longer mail content and image blocks in it"
    q = _build_query(
        campaign={
            "name": "Diwali Glow Sale – 25% Off",
            "goal": "Drive sales during Diwali with a 25% discount offer",
            "objective": "Send a Diwali sale email with 25% off",
        },
        user_request=change,
        chat_summary=(
            f"user: {idea}\n"
            "assistant: Template ready.\n"
            f"user: {change}"
        ),
    )
    assert "longer mail content" in q.lower()
    assert "image blocks" in q.lower()
    assert "25%" in q
    assert q.lower().index("longer mail") < q.lower().index("campaign idea")


def test_build_query_falls_back_to_panel_when_chat_has_no_idea() -> None:
    q = _build_query(
        campaign={
            "name": "Gandhi Jayanti 8% Off",
            "goal": "Product or Service Launch",
            "objective": "Celebrate Gandhi Jayanti with 8% discount on all products",
        },
        user_request="generate",
        chat_summary="user: generate\nassistant: done",
        knowledge="",
    )
    assert "Celebrate Gandhi Jayanti" in q
    assert "Gandhi Jayanti 8% Off" in q
    assert len(q) < 500


@pytest.mark.asyncio
async def test_phase2_invoke_query_includes_chat_idea() -> None:
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    captured: dict = {}
    idea = (
        "Diwali clothing sale 10% off everything, warm festive tone, "
        "add more images and make a long mail not too short"
    )

    class FakeDomain:
        async def invoke(self, ctx):
            captured["query"] = ctx.get("query")
            captured["task_query"] = (ctx.get("task_spec") or {}).get("query")
            captured["chat_summary"] = (ctx.get("task_spec") or {}).get("chat_summary")
            return {
                "ok": True,
                "fields": {
                    "subject": "Hi",
                    "compiled_html": "<html><body><p>Idea only</p></body></html>",
                    "pipeline": "compose",
                },
            }

    with patch(
        "app.mas.phase2_compose.plugin.TemplateDomain",
        return_value=FakeDomain(),
    ):
        await run_phase2_email_create(
            campaign={
                "name": "Diwali Sale",
                "goal": "Launch",
                "objective": "10% off clothing",
            },
            plan={},
            user_request="generate the template",
            chat_summary=f"user: {idea}\nassistant: Saved.",
        )
    assert captured["query"] == captured["task_query"]
    assert "long mail" in captured["query"]
    assert "more images" in captured["query"]
    assert captured.get("chat_summary")
    assert "Diwali clothing sale" in str(captured.get("chat_summary") or "")


def test_director_shape_still_requires_sections_without_compose() -> None:
    assert (
        _email_template_has_director_shape({"fields": {"subject": "Hi"}}) is False
    )
    assert (
        _email_template_has_director_shape(
            {"fields": {"sections": [{"type": "headline"}]}}
        )
        is True
    )


@pytest.mark.asyncio
async def test_phase2_regenerate_mints_new_template_id() -> None:
    """Regenerate must not reuse prior template_id — FE timeline dedupes by id."""
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    prior_id = "d13bb5f3-2af8-4c3b-876a-7ac4744d9a91"
    domain_out = {
        "ok": True,
        "fields": {
            "subject": "Fresh",
            "preheader": "",
            "compiled_html": "<html><body><p>New copy</p></body></html>",
            "plan": {"subject": "Fresh"},
            "image_assets": [],
            "pipeline": "compose",
        },
    }
    with patch(
        "app.mas.phase2_compose.plugin.TemplateDomain"
    ) as Domain:
        Domain.return_value.invoke = AsyncMock(return_value=domain_out)
        card = await run_phase2_email_create(
            campaign={"name": "Launch", "goal": "G", "objective": "O"},
            plan={"how_it_works": "Email"},
            user_request="regenerate the template again",
            prior_template={"template_id": prior_id, "fields": {"subject": "Old"}},
        )
    assert card["template_id"] != prior_id
    assert card["prior_template_id"] == prior_id
    assert "New copy" in card["fields"]["compiled_html"]


def test_ensure_unsubscribe_idempotent() -> None:
    html = "<p>Hi</p>"
    once = ensure_unsubscribe(html)
    twice = ensure_unsubscribe(once)
    assert twice.count("{{unsubscribe_url}}") == 1
    assert '<a href="{{unsubscribe_url}}"' in once
    assert "Unsubscribe" in once


def test_ensure_unsubscribe_wraps_bare_merge_tag() -> None:
    html = "<html><body><p>Opt out: {{unsubscribe_url}}</p></body></html>"
    out = ensure_unsubscribe(html)
    assert out.count("{{unsubscribe_url}}") == 1
    assert '<a href="{{unsubscribe_url}}"' in out
    assert "Unsubscribe</a>" in out


def test_ensure_unsubscribe_keeps_existing_anchor() -> None:
    html = (
        '<html><body><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>'
        "</body></html>"
    )
    assert ensure_unsubscribe(html) == html


def test_ensure_unsubscribe_rewrites_invented_footer_not_append() -> None:
    html = (
        "<html><body><p>Offer inside.</p>"
        '<p style="color:#888">You are receiving this email because you are a valued customer.</p>'
        '<p><a href="#opt-out">Unsubscribe</a> | <a href="#privacy">Privacy Policy</a></p>'
        "</body></html>"
    )
    out = ensure_unsubscribe(html)
    assert out.count("{{unsubscribe_url}}") == 1
    assert out.count("Unsubscribe</a>") == 1
    assert 'href="{{unsubscribe_url}}"' in out
    assert "Privacy Policy" in out
    assert out.count('<a href="{{unsubscribe_url}}"') == 1


def test_ensure_unsubscribe_drops_second_injected_footer() -> None:
    html = (
        "<html><body><p>Offer inside.</p>"
        '<p><a href="#opt-out">Unsubscribe</a> | <a href="#privacy">Privacy Policy</a></p>'
        '<p style="margin-top:16px;font-size:12px;color:#666;text-align:center">'
        '<a href="{{unsubscribe_url}}" style="color:#666;text-decoration:underline">'
        "Unsubscribe</a></p>"
        "</body></html>"
    )
    out = ensure_unsubscribe(html)
    assert out.count("{{unsubscribe_url}}") == 1
    assert out.count("Unsubscribe</a>") == 1
    assert "Privacy Policy" in out


def test_ensure_unsubscribe_wraps_plain_unsubscribe_word() -> None:
    html = (
        "<html><body><p>Thanks.</p>"
        "<p>Unsubscribe | Privacy Policy</p>"
        "</body></html>"
    )
    out = ensure_unsubscribe(html)
    assert out.count("{{unsubscribe_url}}") == 1
    assert '<a href="{{unsubscribe_url}}"' in out
    assert "Privacy Policy" in out
    assert "Unsubscribe | Privacy Policy" not in out


@pytest.mark.asyncio
async def test_run_channel_agent_email_uses_phase2() -> None:
    from app.agents.template_library.creation_agent import _run_channel_agent

    fake = {
        "template_id": "tid-p2",
        "channel": "email",
        "logo": "email",
        "launch_at": "2026-09-23T00:00:00Z",
        "fields": {
            "subject": "Hi",
            "compiled_html": "<p>Plugin</p>",
            "pipeline": "compose",
        },
        "how_it_works": "",
        "_generation_report": {"layers": {"compose": "completed"}},
    }
    with (
        patch(
            "app.mas.phase2_compose.plugin.run_phase2_email_create",
            AsyncMock(return_value=fake),
        ) as run_p2,
        patch(
            "app.agents.template_library.creation_agent._run_email_designer",
            AsyncMock(side_effect=AssertionError("director must not run")),
        ),
    ):
        out = await _run_channel_agent(
            "email",
            {"channel": "email", "how_it_works": "n"},
            {"name": "N", "goal": "G", "objective": "O"},
            {},
            knowledge="",
            prior_template=None,
        )
    assert out["fields"]["pipeline"] == "compose"
    assert out["fields"]["compiled_html"] == "<p>Plugin</p>"
    run_p2.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_channel_agent_email_skips_old_director_even_if_flag_off() -> None:
    """Old email director/content path is commented; Phase 2 always runs for email."""
    from app.agents.template_library.creation_agent import _run_channel_agent

    fake = {
        "template_id": "tid-p2b",
        "channel": "email",
        "logo": "email",
        "launch_at": "2026-09-23T00:00:00Z",
        "fields": {
            "subject": "Phase2",
            "compiled_html": "<p>Always</p>",
            "pipeline": "compose",
        },
        "how_it_works": "",
    }
    with (
        patch(
            "app.mas.phase2_compose.plugin.use_phase2_email_compose",
            return_value=False,
        ),
        patch(
            "app.mas.phase2_compose.plugin.run_phase2_email_create",
            AsyncMock(return_value=fake),
        ) as run_p2,
        patch(
            "app.agents.template_library.creation_agent._run_email_designer",
            AsyncMock(side_effect=AssertionError("director must not run")),
        ),
        patch(
            "app.agents.template_library.creation_agent.get_settings",
        ) as gs,
    ):
        gs.return_value.template_director_enabled = True
        gs.return_value.phase2_email_compose_enabled = False
        out = await _run_channel_agent(
            "email",
            {"channel": "email"},
            {"name": "N", "goal": "G", "objective": "O"},
            {},
            prior_template=None,
        )
    assert out["fields"]["compiled_html"] == "<p>Always</p>"
    run_p2.assert_awaited_once()


@pytest.mark.asyncio
async def test_phase2_progress_includes_generation_batch_id() -> None:
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    domain_out = {
        "ok": True,
        "fields": {
            "subject": "Hi",
            "compiled_html": "<html><body><p>Hi</p></body></html>",
            "plan": {},
            "image_assets": [],
            "pipeline": "compose",
        },
    }
    events: list[dict] = []

    async def on_event(event: dict) -> None:
        events.append(event)

    with patch("app.mas.phase2_compose.plugin.TemplateDomain") as Domain:
        Domain.return_value.invoke = AsyncMock(return_value=domain_out)
        card = await run_phase2_email_create(
            campaign={"name": "Launch", "goal": "G", "objective": "O"},
            plan={},
            user_request="create email",
            event_callback=on_event,
            generation_batch_id="batch-55",
        )
    assert card["generation_batch_id"] == "batch-55"
    progress = [e for e in events if e.get("type") == "template_progress"]
    assert progress
    assert all(
        e.get("payload", {}).get("generation_batch_id") == "batch-55"
        for e in progress
    )
