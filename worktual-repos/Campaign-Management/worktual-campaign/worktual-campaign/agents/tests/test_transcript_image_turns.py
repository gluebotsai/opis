"""Image-only chat turns must not collapse across uploads."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from app.mas.runtime.turn import MasTurn, should_manage_transcript


def test_should_manage_transcript_for_pending_images() -> None:
    turn = MasTurn(
        verbatim_user_text="",
        session_id="s1",
        token="t",
        module="create_campaign",
        entry="interactive",
    )
    assert turn.manages_transcript is False
    assert should_manage_transcript(turn, {}) is False
    assert (
        should_manage_transcript(
            turn,
            {
                "pending_chat_images": [
                    {
                        "image_url": "https://rebuild-campaign-api.worktual.com/api/media/aaa",
                        "filename": "a.jpeg",
                    }
                ]
            },
        )
        is True
    )


def test_record_user_turn_appends_distinct_image_only_uploads() -> None:
    from app.mas.runtime import transcript as tr

    session: dict = {
        "messages": [
            {
                "id": "u1",
                "role": "user",
                "text": "",
                "image_url": "https://rebuild-campaign-api.worktual.com/api/media/aaa",
            }
        ],
        "pending_chat_images": [
            {
                "image_url": "https://rebuild-campaign-api.worktual.com/api/media/bbb",
                "filename": "two.jpeg",
            }
        ],
        "llm_memory": [],
    }
    appended: list[dict] = []

    async def _append(session_id, role, text, **kwargs):
        row = {
            "id": "u2",
            "role": role,
            "text": text,
            "image_url": kwargs.get("image_url"),
            "image_filename": kwargs.get("image_filename"),
        }
        appended.append(row)
        session["messages"] = list(session["messages"]) + [row]
        return session

    async def _get_or_create(session_id, token=None, module=None):
        return session

    async def _save(session, token=None):
        return session

    turn = MasTurn(
        verbatim_user_text="",
        session_id="s1",
        token="t",
        module="create_campaign",
        entry="interactive",
    )

    with (
        patch.object(tr, "get_or_create_session", side_effect=_get_or_create),
        patch.object(tr, "append_message", side_effect=_append),
        patch.object(tr, "save_session", side_effect=_save),
        patch.object(tr, "get_llm_memory", return_value=[]),
        patch.object(tr, "append_llm_memory"),
        patch(
            "app.agents.image.media_upload.chat_store_media_url",
            side_effect=lambda u: u,
        ),
        patch(
            "app.agents.image.media_upload.absolutize_media_url",
            side_effect=lambda u: u,
        ),
    ):
        asyncio.run(tr.record_user_turn(turn))

    assert len(appended) == 1
    assert appended[0]["image_url"].endswith("/bbb")
    assert len(session["messages"]) == 2
    assert session["messages"][0]["image_url"].endswith("/aaa")
    assert session["messages"][1]["image_url"].endswith("/bbb")


def test_normalize_carry_keeps_image_only_rows() -> None:
    from app.carry_messages import normalize_carry_message_rows

    rows = normalize_carry_message_rows(
        [
            {
                "role": "user",
                "text": "",
                "image_url": "https://example.com/api/media/x1",
                "image_filename": "a.jpeg",
            },
            {
                "role": "assistant",
                "text": "Got it — want this on the email?",
            },
            {
                "role": "user",
                "text": "",
                "imageUrl": "https://example.com/api/media/x2",
            },
        ]
    )
    assert len(rows) == 3
    assert rows[0]["image_url"].endswith("/x1")
    assert rows[2]["image_url"].endswith("/x2")
