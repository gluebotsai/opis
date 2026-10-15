"""Edit-space uploads must not pollute create chat transcript or pending bucket."""

from __future__ import annotations

import pytest

from app.agents.image.user_assets import (
    ingest_pending_chat_images,
    ingest_pending_edit_chat_images,
    list_pending_chat_images,
    peek_turn_chat_image_uploads,
)
from app.mas.runtime.turn import MasTurn, should_manage_transcript


@pytest.mark.asyncio
async def test_record_user_turn_uses_turn_uploads_not_stale_pending(monkeypatch):
    from app.mas.runtime import transcript as tr

    saved: list[dict] = []

    async def fake_get_or_create(session_id, *, token=None, module=None):
        return saved[-1] if saved else {}

    async def fake_append(session_id, role, text, **kwargs):
        sess = saved[-1] if saved else {"messages": []}
        msgs = list(sess.get("messages") or [])
        msgs.append(
            {
                "role": role,
                "text": text,
                "image_url": kwargs.get("image_url") or "",
                "image_filename": kwargs.get("image_filename") or "",
            }
        )
        sess["messages"] = msgs
        saved.append(sess)
        return sess

    async def fake_save(session, *, token=None):
        saved.append(dict(session))
        return session

    monkeypatch.setattr(tr, "get_or_create_session", fake_get_or_create)
    monkeypatch.setattr(tr, "append_message", fake_append)
    monkeypatch.setattr(tr, "save_session", fake_save)
    monkeypatch.setattr(tr, "get_llm_memory", lambda _s: [])
    monkeypatch.setattr(tr, "append_llm_memory", lambda s, _m: s)

    session = {
        "messages": [],
        "pending_chat_images": [
            {
                "id": "stale",
                "image_url": "https://cdn.example/edit-leak.png",
                "filename": "edit.png",
            }
        ],
        "_turn_chat_image_uploads": [],
    }
    saved.append(session)

    turn = MasTurn(
        verbatim_user_text="send now",
        session_id="sess-1",
        token="tok",
        module="create_campaign",
        entry="interactive",
    )
    await tr.record_user_turn(turn)

    msgs = saved[-1].get("messages") or []
    assert len(msgs) == 1
    assert msgs[0]["text"] == "send now"
    assert not str(msgs[0].get("image_url") or "").strip()


@pytest.mark.asyncio
async def test_record_user_turn_attaches_image_for_this_turn_only(monkeypatch):
    from app.mas.runtime import transcript as tr

    saved: list[dict] = []

    async def fake_get_or_create(session_id, *, token=None, module=None):
        return saved[-1] if saved else {}

    async def fake_append(session_id, role, text, **kwargs):
        sess = saved[-1] if saved else {"messages": []}
        msgs = list(sess.get("messages") or [])
        msgs.append(
            {
                "role": role,
                "text": text,
                "image_url": kwargs.get("image_url") or "",
            }
        )
        sess["messages"] = msgs
        saved.append(sess)
        return sess

    async def fake_save(session, *, token=None):
        saved.append(dict(session))
        return session

    monkeypatch.setattr(tr, "get_or_create_session", fake_get_or_create)
    monkeypatch.setattr(tr, "append_message", fake_append)
    monkeypatch.setattr(tr, "save_session", fake_save)
    monkeypatch.setattr(tr, "get_llm_memory", lambda _s: [])
    monkeypatch.setattr(tr, "append_llm_memory", lambda s, _m: s)

    session = {
        "messages": [],
        "_turn_chat_image_uploads": [
            {
                "id": "u1",
                "image_url": "https://cdn.example/this-turn.png",
                "filename": "hero.png",
            }
        ],
    }
    saved.append(session)

    turn = MasTurn(
        verbatim_user_text="use this image",
        session_id="sess-1",
        token="tok",
        module="create_campaign",
        entry="interactive",
    )
    await tr.record_user_turn(turn)

    msgs = saved[-1].get("messages") or []
    assert len(msgs) == 1
    assert "this-turn.png" in str(msgs[0].get("image_url") or "")


def test_edit_ingest_does_not_touch_create_pending():
    session: dict = {"channels": ["email"]}
    ingest_pending_edit_chat_images(
        session,
        [{"image_url": "https://cdn.example/edit-only.png", "filename": "e.png"}],
    )
    assert not list_pending_chat_images(session)
    assert len(session.get("pending_edit_chat_images") or []) == 1


def test_create_ingest_does_not_touch_edit_pending():
    session: dict = {"channels": ["email"]}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/create.png", "filename": "c.png"}],
    )
    assert len(list_pending_chat_images(session)) == 1
    assert not session.get("pending_edit_chat_images")


def test_should_manage_transcript_image_only_when_turn_uploads():
    turn = MasTurn(
        verbatim_user_text="",
        session_id="s",
        token="t",
        module="create_campaign",
        entry="interactive",
    )
    assert not should_manage_transcript(
        turn, {"pending_chat_images": [{"image_url": "https://x/y.png"}]}
    )
    assert should_manage_transcript(
        turn,
        {
            "_turn_chat_image_uploads": [
                {"image_url": "https://x/y.png", "filename": "y.png"}
            ]
        },
    )
    assert peek_turn_chat_image_uploads(
        {"_turn_chat_image_uploads": [{"image_url": "https://x/y.png"}]}
    )


def test_session_image_library_edit_ignores_create_pending():
    from app.agents.image.user_assets import session_image_library

    session: dict = {"channels": ["email"]}
    ingest_pending_chat_images(
        session,
        [{"image_url": "https://cdn.example/create-pending.png", "filename": "c.png"}],
    )
    ingest_pending_edit_chat_images(
        session,
        [{"image_url": "https://cdn.example/edit-pending.png", "filename": "e.png"}],
    )
    lib = session_image_library(session, turn_uploads=[], edit_space=True)
    urls = {r["image_url"] for r in lib}
    assert "https://cdn.example/edit-pending.png" in urls
    assert "https://cdn.example/create-pending.png" not in urls
