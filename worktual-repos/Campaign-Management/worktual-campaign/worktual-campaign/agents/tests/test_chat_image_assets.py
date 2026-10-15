"""Chat upload → confirm → preferred URLs for generate/attach."""

from __future__ import annotations

from app.agents.image.user_assets import (
    confirm_chat_images,
    ingest_pending_chat_images,
    preferred_urls_by_channel,
    session_images_for_edit,
)


def test_ingest_and_confirm_prefers_upload_over_ai():
    session: dict = {
        "channels": ["email", "whatsapp"],
        "messages": [],
    }
    ingested = ingest_pending_chat_images(
        session,
        [
            {
                "image_url": "https://cdn.example/hero.png",
                "media_id": "m1",
                "filename": "hero.png",
            }
        ],
    )
    assert len(ingested) == 1
    assert len(session["pending_chat_images"]) == 1

    out = confirm_chat_images(
        session,
        include_in_templates=True,
        channels=["email", "whatsapp"],
    )
    assert out["ok"] is True
    assert out["include_in_templates"] is True
    assert not session.get("pending_chat_images")
    assert len(session["confirmed_chat_images"]) == 1

    preferred = preferred_urls_by_channel(
        session, channels=["email", "whatsapp"], mode="shared"
    )
    assert preferred == {
        "email": "https://cdn.example/hero.png",
        "whatsapp": "https://cdn.example/hero.png",
    }


def test_latest_confirm_wins_per_channel():
    session: dict = {
        "channels": ["email"],
        "messages": [],
    }
    ingest_pending_chat_images(
        session,
        [{"id": "a1", "image_url": "https://cdn.example/first.png", "filename": "first.png"}],
    )
    confirm_chat_images(session, include_in_templates=True, channels=["email"])
    ingest_pending_chat_images(
        session,
        [{"id": "a2", "image_url": "https://cdn.example/second.png", "filename": "second.png"}],
    )
    confirm_chat_images(session, include_in_templates=True, channels=["email"])
    preferred = preferred_urls_by_channel(session, channels=["email"])
    assert preferred["email"] == "https://cdn.example/second.png"
    assert len(session["confirmed_chat_images"]) == 1


def test_decline_clears_pending_without_confirming():
    session: dict = {"channels": ["email"]}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/skip.png", "filename": "skip.png"}],
    )
    out = confirm_chat_images(session, include_in_templates=False)
    assert out["ok"] is True
    assert out["include_in_templates"] is False
    assert not session.get("pending_chat_images")
    assert not session.get("confirmed_chat_images")
    assert preferred_urls_by_channel(session, channels=["email"]) == {}


def test_gallery_selection_used_when_no_confirmed_chat():
    session = {
        "channels": ["email", "web"],
        "selected_gallery_images": [
            {"id": "g1", "image_url": "https://cdn.example/gallery.jpg"}
        ],
    }
    preferred = preferred_urls_by_channel(
        session, channels=["email", "web"], mode="shared"
    )
    assert preferred["email"] == "https://cdn.example/gallery.jpg"
    assert preferred["web"] == "https://cdn.example/gallery.jpg"


def test_session_images_for_edit_this_turn_only():
    session: dict = {"channels": ["email"], "messages": []}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/main.png", "filename": "main.png"}],
    )
    confirm_chat_images(session, include_in_templates=True, channels=["email"])
    merged = session_images_for_edit(
        session,
        turn_uploads=[
            {"image_url": "https://cdn.example/edit.png", "filename": "edit.png"}
        ],
    )
    urls = [r["image_url"] for r in merged]
    assert urls == ["https://cdn.example/edit.png"]
    assert merged[0]["status"] == "this_turn"


def test_session_image_library_reuses_prior_and_gallery():
    from app.agents.image.user_assets import session_image_library

    session: dict = {
        "channels": ["email"],
        "messages": [],
        "selected_gallery_images": [
            {"id": "g1", "image_url": "https://cdn.example/gallery.jpg", "name": "g.jpg"}
        ],
    }
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/old.png", "filename": "old.png", "id": "old1"}],
    )
    confirm_chat_images(session, include_in_templates=True, channels=["email"])
    lib = session_image_library(
        session,
        turn_uploads=[
            {"image_url": "https://cdn.example/new.png", "filename": "new.png", "id": "new1"}
        ],
        on_template_urls=["https://cdn.example/old.png"],
    )
    urls = [r["image_url"] for r in lib]
    assert "https://cdn.example/new.png" in urls
    assert "https://cdn.example/old.png" in urls
    assert "https://cdn.example/gallery.jpg" in urls
    by_url = {r["image_url"]: r for r in lib}
    assert by_url["https://cdn.example/new.png"]["status"] == "this_turn"
    assert by_url["https://cdn.example/old.png"]["already_on_template"] is True
    assert by_url["https://cdn.example/gallery.jpg"]["source"] == "gallery"


def test_session_image_library_labels_earlier_uploads_in_session():
    from app.agents.image.user_assets import session_image_library

    session: dict = {"channels": ["email"], "messages": []}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/wait.png", "filename": "wait.png"}],
    )
    lib = session_image_library(session, turn_uploads=[])
    by_url = {r["image_url"]: r for r in lib}
    assert by_url["https://cdn.example/wait.png"]["status"] == "in_session"



def test_clear_chat_images_drops_sticky_photos():
    from app.agents.image.user_assets import clear_chat_images

    session: dict = {"channels": ["email"], "messages": []}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/old.png", "filename": "old.png"}],
    )
    confirm_chat_images(session, include_in_templates=True, channels=["email"])
    out = clear_chat_images(session)
    assert out["ok"] is True
    assert not session.get("pending_chat_images")
    assert not session.get("confirmed_chat_images")


def test_sync_image_plan_expands_confirmed_channels():
    from app.agents.image.plan import get_image_plan
    from app.agents.image.user_assets import sync_image_plan_for_confirmed_uploads

    session: dict = {"channels": ["email"], "messages": []}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/dussehra.png", "filename": "d.png"}],
    )
    confirm_chat_images(session, include_in_templates=True, channels=["email"])
    # User later picks all image-capable channels.
    session["channels"] = ["email", "whatsapp", "web", "push"]
    plan = sync_image_plan_for_confirmed_uploads(session)
    assert plan is not None
    assert plan.get("wants_images") is True
    assert set(plan.get("channels") or []) >= {"email", "whatsapp", "web"}
    preferred = preferred_urls_by_channel(
        session, channels=["email", "whatsapp", "web"], mode="shared"
    )
    assert preferred["email"] == "https://cdn.example/dussehra.png"
    assert preferred["whatsapp"] == "https://cdn.example/dussehra.png"
    assert get_image_plan(session).get("auto_after_build") is True


def test_effective_wants_images_from_confirmed_upload():
    from app.agents.template_generation_director.creative_context import (
        effective_wants_images,
    )

    assert effective_wants_images(
        tool_wants_images=False,
        enhancer={},
        image_plan={},
        confirmed_chat_images=[
            {
                "image_url": "https://cdn.example/u.png",
                "include_in_templates": True,
            }
        ],
    )
    assert not effective_wants_images(
        tool_wants_images=False,
        enhancer={},
        image_plan={},
        confirmed_chat_images=[
            {
                "image_url": "https://cdn.example/u.png",
                "include_in_templates": False,
            }
        ],
    )


def test_build_attach_fields_inserts_hero_when_no_image_section():
    from app.agents.image.template_attach import build_attach_fields

    existing = {
        "subject": "Launch",
        "sections": [
            {"type": "headline", "content": "New Launch"},
            {"type": "text", "content": "Body"},
            {"type": "cta", "label": "Learn more"},
        ],
    }
    patch = build_attach_fields(
        existing,
        image_url="https://cdn.example.com/dussehra.png",
    )
    assert patch.get("header_image") == "https://cdn.example.com/dussehra.png"
    types = [str(r.get("type")) for r in (patch.get("sections") or [])]
    assert "image" in types
    assert types.index("image") == 1  # after headline
