"""Unified edit-space specialist: tools, memory, snapshot — no chat-intent regex."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.template_edit.definition import load_canvas_specialist, load_specialist
from app.agents.template_edit.memory import (
    clear_undo,
    get_working,
    push_undo,
    redo_fields,
    undo_fields,
)
from app.agents.template_edit.snapshot import compact_live_snapshot
from app.agents.template_edit.tools.handlers import dispatch_edit_tool
from app.mas.phase2_compose.html_images import insert_image_before_body_close
from app.runtime.agent import ToolLoopResult

_HTML = (
    "<html><body><p>Festival sale copy that is long enough for compose.</p>"
    "</body></html>"
)


def _compose_fields() -> dict:
    return {
        "pipeline": "compose",
        "subject": "Dussehra offers",
        "compiled_html": _HTML,
    }


def _ctx(
    *,
    channel: str = "email",
    working: dict | None = None,
    library: list | None = None,
    session: dict | None = None,
    template_id: str = "tpl-1",
    canvas: bool = False,
) -> dict:
    spec = load_canvas_specialist(channel) if canvas else load_specialist(channel)
    fields = working if isinstance(working, dict) else _compose_fields()
    sess = session if isinstance(session, dict) else {}
    ctx: dict = {
        "allowed": set(spec.tool_names),
        "channel": spec.channel,
        "working": dict(fields),
        "current": dict(fields),
        "campaign": {"name": "Festive"},
        "session": sess,
        "library": list(library or []),
        "template_id": template_id,
        "token": "",
        "state": {
            "intent": "general",
            "persist_fields": False,
            "emit_template": False,
            "image_url": "",
            "last_note": "",
        },
        "event_callback": None,
        "working_row": get_working(sess, template_id),
        "push_undo": lambda: None,
    }

    def _push() -> None:
        ctx["working_row"] = push_undo(sess, template_id, dict(ctx["working"]))

    ctx["push_undo"] = _push
    return ctx


def test_compact_snapshot_is_not_full_html() -> None:
    fields = {
        **_compose_fields(),
        "compiled_html": "<html><body>" + ("<p>Hello team</p>" * 80) + "</body></html>",
        "header_image": "https://cdn.example/hero.png",
    }
    snap = compact_live_snapshot(channel="email", fields=fields)
    assert "compiled_html" not in snap
    assert snap["hero_url"] == "https://cdn.example/hero.png"
    assert "<html" not in str(snap.get("outline") or "")
    assert len(str(snap.get("outline") or "")) <= 1700


def test_insert_image_before_body_close() -> None:
    html = insert_image_before_body_close(_HTML, "https://cdn.example/bottom.png")
    assert html.lower().index("https://cdn.example/bottom.png") < html.lower().rfind(
        "</body>"
    )


@pytest.mark.asyncio
async def test_add_cta_refuses_without_url() -> None:
    ctx = _ctx(canvas=True)
    out = await dispatch_edit_tool("add_cta", {"label": "Shop now"}, ctx=ctx)
    assert out["ok"] is False
    assert "url" in str(out.get("error") or "").lower()
    assert ctx["working"]["compiled_html"] == _HTML
    assert ctx["state"]["persist_fields"] is False


@pytest.mark.asyncio
async def test_add_cta_writes_user_https_link() -> None:
    ctx = _ctx(canvas=True)
    out = await dispatch_edit_tool(
        "add_cta",
        {"label": "Shop now", "url": "https://brand.example/sale"},
        ctx=ctx,
    )
    assert out["ok"] is True
    html = str(ctx["working"]["compiled_html"])
    assert "https://brand.example/sale" in html
    assert "Shop now" in html


@pytest.mark.asyncio
async def test_attach_reuses_prior_session_image() -> None:
    old = {
        "id": "old1",
        "image_url": "https://cdn.example/prior.png",
        "filename": "prior.png",
        "status": "confirmed",
        "source": "chat_upload",
    }
    ctx = _ctx(library=[old], canvas=True)
    with patch(
        "app.agents.image.media_upload.ensure_public_media_url",
        new=AsyncMock(return_value=("https://cdn.example/prior.png", "")),
    ):
        out = await dispatch_edit_tool(
            "attach_uploaded_image",
            {"image_id": "old1", "placement": "bottom"},
            ctx=ctx,
        )
    assert out["ok"] is True
    html = str(ctx["working"]["compiled_html"])
    assert "https://cdn.example/prior.png" in html
    assert html.lower().index("https://cdn.example/prior.png") < html.lower().rfind(
        "</body>"
    )


@pytest.mark.asyncio
async def test_attach_email_fails_closed_on_unreachable_url() -> None:
    ctx = _ctx(
        library=[
            {
                "id": "bad1",
                "image_url": "https://cdn.example/404.png",
                "status": "this_turn",
            }
        ],
        canvas=True,
    )
    with patch(
        "app.agents.image.media_upload.ensure_public_media_url",
        new=AsyncMock(return_value=("", "Image URL returned HTTP 404.")),
    ):
        out = await dispatch_edit_tool(
            "attach_uploaded_image",
            {"image_id": "bad1", "placement": "hero"},
            ctx=ctx,
        )
    assert out["ok"] is False
    assert "404" in str(out.get("error") or "")
    assert ctx["working"]["compiled_html"] == _HTML


def test_undo_redo_python_stacks() -> None:
    session: dict = {}
    tid = "tpl-1"
    v1 = {"subject": "one", "compiled_html": "<p>one</p>"}
    v2 = {"subject": "two", "compiled_html": "<p>two</p>"}
    push_undo(session, tid, v1)
    restored, note = undo_fields(session, tid, v2)
    assert restored == v1
    assert "previous" in note.lower()
    redone, _ = redo_fields(session, tid, restored or {})
    assert redone == v2
    clear_undo(session, tid)
    gone, msg = undo_fields(session, tid, v2)
    assert gone is None
    assert "undo" in msg.lower()


def test_industry_runtime_block_compact() -> None:
    from app.agents.template_edit.definition import industry_runtime_block

    block = industry_runtime_block(
        {
            "campaign_profile": {
                "mode": "b2c",
                "industry_type": "clothing",
            },
            "company_pack": {"brand": {"logo_url": "https://cdn.example/logo.png"}},
        }
    )
    assert "clothing" in block
    assert "https://cdn.example/logo.png" in block
    assert "<html" not in block


def test_specialists_load_without_chat_parsers() -> None:
    email = load_specialist("email")
    wa = load_specialist("whatsapp")
    web = load_specialist("web")
    push = load_specialist("app_push")
    assert email.channel == "email"
    assert "request_template_change" in email.tool_names
    assert "edit_email_html" not in email.tool_names
    canvas = load_canvas_specialist("email")
    assert "edit_email_html" in canvas.tool_names
    assert "edit_email_html" not in wa.tool_names
    assert web.channel == "web"
    assert push.channel == "push"
    root = Path(__file__).resolve().parents[1] / "app" / "agents" / "template_edit"
    for path in root.rglob("*"):
        if path.suffix not in {".py", ".md"}:
            continue
        text = path.read_text(encoding="utf-8")
        assert "select_compose_action" not in text, path
        for line in text.splitlines():
            stripped = line.strip()
            if stripped == "import re" or stripped.startswith("import re,"):
                raise AssertionError(f"{path} imports re")
            if "re.search(" in line or "re.match(" in line or "re.compile(" in line:
                raise AssertionError(f"{path} uses regex: {line}")


@pytest.mark.asyncio
async def test_orchestrator_flag_skips_compose_router() -> None:
    from app.agents.template_library.edit_orchestrator import (
        run_template_edit_orchestrated,
    )

    async def fake_agent(**kwargs):
        assert kwargs["channel"] == "email"
        return {
            "intent": "general",
            "fields": None,
            "reply": "Happy to help with this email.",
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
            "ui_events": [],
            "used_stub": False,
            "image_url": "",
            "used_tools": False,
            "skill_id": "email_edit",
        }

    with (
        patch(
            "app.agents.template_edit.runner.run_template_edit_agent",
            new=fake_agent,
        ),
        patch(
            "app.mas.phase2_compose.compose_edit.run_compose_html_edit",
            new=AsyncMock(side_effect=AssertionError("legacy compose_edit must not run")),
        ),
    ):
        out = await run_template_edit_orchestrated(
            channel="email",
            current_fields=_compose_fields(),
            instruction="make the headline warmer",
            campaign={"name": "Festive"},
        )
    assert out["reply"] == "Happy to help with this email."
    assert out["skill_id"] == "email_edit"


@pytest.mark.asyncio
async def test_runner_mocked_llm_attaches_library_image_and_keeps_undo() -> None:
    from app.agents.template_edit.runner import run_template_edit_agent

    session = {
        "confirmed_chat_images": [
            {
                "id": "old1",
                "image_url": "https://cdn.example/prior.png",
                "filename": "prior.png",
                "include_in_templates": True,
            }
        ]
    }
    captured: dict = {}

    async def fake_loop(*args, **kwargs):
        captured["timeout_retries"] = kwargs.get("timeout_retries")
        captured["empty_content_retries"] = kwargs.get("empty_content_retries")
        messages = kwargs.get("messages") or args[1]
        captured["system_text"] = messages[0]["content"]
        dispatch = kwargs["dispatch"]
        await dispatch(
            "request_template_change",
            {
                "explanation": "Place the earlier photo near the footer.",
                "image_id": "old1",
                "placement": "bottom",
            },
        )
        return ToolLoopResult(
            content="I put the earlier photo near the footer. Want it as the hero instead?",
            used_tools=True,
        )

    async def fake_canvas_loop(*args, **kwargs):
        dispatch = kwargs["dispatch"]
        await dispatch(
            "attach_uploaded_image",
            {"image_id": "old1", "placement": "bottom"},
        )
        return ToolLoopResult(
            content="Placed prior.png before the footer.",
            used_tools=True,
        )

    with (
        patch("app.agents.template_edit.runner.run_tool_loop", new=fake_loop),
        patch(
            "app.agents.template_edit.canvas_runner.run_tool_loop",
            new=fake_canvas_loop,
        ),
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(return_value=("https://cdn.example/prior.png", "")),
        ),
    ):
        out = await run_template_edit_agent(
            channel="email",
            current_fields=_compose_fields(),
            instruction="use the photo I uploaded earlier, at the bottom",
            campaign={"name": "Festive"},
            session=session,
            template_id="tpl-1",
        )

    assert captured["timeout_retries"] == 1
    assert captured["empty_content_retries"] == 2
    assert "https://cdn.example/prior.png" in str(captured["system_text"])
    assert "compiled_html" not in captured["system_text"]
    assert "<html" not in captured["system_text"]
    assert out["persist_fields"] is True
    assert "https://cdn.example/prior.png" in str(out["fields"].get("compiled_html") or "")
    assert out["reply"].startswith("I put the earlier photo")
    past = get_working(session, "tpl-1")["past"]
    assert past, "undo snapshot should be stored on the session"
    assert past[0]["compiled_html"] == _HTML


@pytest.mark.asyncio
async def test_runner_does_not_auto_attach_this_turn_upload() -> None:
    from app.agents.template_edit.runner import run_template_edit_agent

    html = (
        "<html><body><p>[Image: Wide retail display]</p>"
        "<p>Hi {{first_name}}</p></body></html>"
    )
    media = "https://rebuild.example/api/media/hero.png"

    async def fake_loop(*args, **kwargs):
        return ToolLoopResult(
            content="Got your photo. Say if you want it as the hero.",
            used_tools=False,
        )

    with patch("app.agents.template_edit.runner.run_tool_loop", new=fake_loop):
        out = await run_template_edit_agent(
            channel="email",
            current_fields={
                "pipeline": "compose",
                "subject": "New stock",
                "compiled_html": html,
            },
            instruction="add this to the template",
            campaign={"name": "Visit"},
            session={},
            template_id="tpl-hero",
            pending_image_uploads=[
                {
                    "image_url": media,
                    "status": "this_turn",
                    "filename": "duseraimages.jpeg",
                }
            ],
        )

    assert out["persist_fields"] is False
    assert out["fields"] is None
    assert out["used_tools"] is False


_HERO_HTML = (
    '<html><body>'
    '<img src="https://cdn.example/top.png" alt="hero" width="600"/>'
    "<p>Happy Birthday sale copy that is long enough for compose.</p>"
    "</body></html>"
)
_GEN_URL = "https://rebuild.example/api/media/new-bottom.png"


def _hero_fields() -> dict:
    return {
        "pipeline": "compose",
        "subject": "Happy Birthday",
        "compiled_html": _HERO_HTML,
        "header_image": "https://cdn.example/top.png",
        "image_url": "https://cdn.example/top.png",
        "image_assets": [
            {"role": "hero", "url": "https://cdn.example/top.png", "width_px": 600}
        ],
    }


@pytest.mark.asyncio
async def test_generate_image_stores_url_without_placing() -> None:
    ctx = _ctx(working=_hero_fields())
    with (
        patch(
            "app.mas.phase2_compose.executors.image.generate_compose_image_url",
            new=AsyncMock(
                return_value={"ok": True, "url": _GEN_URL, "role": "footer"}
            ),
        ),
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(return_value=(_GEN_URL, "")),
        ),
    ):
        out = await dispatch_edit_tool(
            "generate_image",
            {"brief": "festive gift flat lay"},
            ctx=ctx,
        )
    assert out["ok"] is True
    assert out["changed"] is False
    assert out["image_url"] == _GEN_URL
    assert ctx["working"]["compiled_html"] == _HERO_HTML
    assert ctx["state"]["persist_fields"] is False


@pytest.mark.asyncio
async def test_canvas_attach_bottom_keeps_existing_hero() -> None:
    ctx = _ctx(working=_hero_fields(), canvas=True)
    with patch(
        "app.agents.image.media_upload.ensure_public_media_url",
        new=AsyncMock(return_value=(_GEN_URL, "")),
    ):
        out = await dispatch_edit_tool(
            "attach_uploaded_image",
            {"image_url": _GEN_URL, "placement": "bottom"},
            ctx=ctx,
        )
    assert out["ok"] is True
    html = str(ctx["working"]["compiled_html"])
    assert "https://cdn.example/top.png" in html
    assert _GEN_URL in html
    assert html.index("https://cdn.example/top.png") < html.index(_GEN_URL)
    assert html.lower().index(_GEN_URL) < html.lower().rfind("</body>")
    assert ctx["working"]["header_image"] == "https://cdn.example/top.png"


@pytest.mark.asyncio
async def test_request_template_change_places_job_urls_without_canvas_tools() -> None:
    html = (
        "<html><body><p>[Image: Wide retail display]</p>"
        "<p>Hi {{first_name}}</p></body></html>"
    )
    media = "https://rebuild.example/api/media/hero.png"
    ctx = _ctx(
        working={
            "pipeline": "compose",
            "subject": "New stock",
            "compiled_html": html,
        }
    )

    async def fake_canvas(*args, **kwargs):
        return ToolLoopResult(content="Hero photo is on the canvas.", used_tools=False)

    with (
        patch(
            "app.agents.template_edit.canvas_runner.run_tool_loop",
            new=fake_canvas,
        ),
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(return_value=(media, "")),
        ),
    ):
        out = await dispatch_edit_tool(
            "request_template_change",
            {
                "explanation": "Put this photo as the hero.",
                "image_urls": [media],
                "placement": "hero",
            },
            ctx=ctx,
        )
    assert out["ok"] is True
    compiled = str(ctx["working"].get("compiled_html") or "")
    assert media in compiled
    assert "[Image:" not in compiled


@pytest.mark.asyncio
async def test_canvas_attach_hero_replaces_top() -> None:
    ctx = _ctx(working=_hero_fields(), canvas=True)
    with patch(
        "app.agents.image.media_upload.ensure_public_media_url",
        new=AsyncMock(return_value=(_GEN_URL, "")),
    ):
        out = await dispatch_edit_tool(
            "attach_uploaded_image",
            {"image_url": _GEN_URL, "placement": "hero"},
            ctx=ctx,
        )
    assert out["ok"] is True
    html = str(ctx["working"]["compiled_html"])
    assert _GEN_URL in html
    assert "https://cdn.example/top.png" not in html
    assert ctx["working"]["header_image"] == _GEN_URL


@pytest.mark.asyncio
async def test_runner_ideas_only_does_not_mutate_canvas() -> None:
    from app.agents.template_edit.runner import run_template_edit_agent

    async def fake_loop(*args, **kwargs):
        # Ideas-only: the model must not call mutation tools.
        return ToolLoopResult(
            content=(
                "A few ideas for a footer photo: a gift-box flat lay, a customer "
                "holding a Booxoo bag, or a coffee-and-shopping-bag treat-yourself "
                "scene. Want me to generate one?"
            ),
            used_tools=False,
        )

    with patch("app.agents.template_edit.runner.run_tool_loop", new=fake_loop):
        out = await run_template_edit_agent(
            channel="email",
            current_fields=_hero_fields(),
            instruction="can u add a image in the bottom , for that suggest a idea",
            campaign={"name": "Birthday"},
            session={},
            template_id="tpl-1",
        )

    assert out["used_tools"] is False
    assert out["persist_fields"] is False
    assert out["emit_template"] is False
    assert out["fields"] is None
    assert "ideas" in out["reply"].lower()


def test_email_prompt_and_generate_schema_handoff_not_place() -> None:
    from app.agents.template_edit.tools.schemas import GENERATE_IMAGE, REQUEST_TEMPLATE_CHANGE

    email = load_specialist("email")
    prompt = email.system_prompt("runtime").lower()
    assert "request_template_change" in prompt
    assert "generate_image" in prompt
    desc = str(GENERATE_IMAGE["function"]["description"]).lower()
    assert "does not" in desc
    req = str(REQUEST_TEMPLATE_CHANGE["function"]["description"]).lower()
    assert "explanation" in req
