#!/usr/bin/env python3
"""Smoke: create-campaign agent understands varied post-template phrasing (real LLM).

Does not launch/send. Requires JWT_SECRET from agents/.env.
Run: cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/smoke_create_agent_phrasing.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

import jwt

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _token(user_id: str = "1027") -> str:
    from app.config import get_settings

    return jwt.encode(
        {"sub": user_id},
        get_settings().jwt_secret,
        algorithm="HS256",
    )


async def _turn(session_id: str, token: str, text: str) -> dict:
    from app.mas.socket_bridge import run_create_campaign_turn_via_mas_or_legacy
    from app.request_context import set_request_token

    set_request_token(token)
    return await run_create_campaign_turn_via_mas_or_legacy(
        session_id,
        token,
        text,
        event_callback=None,
        persist_chat=True,
    )


async def main() -> int:
    from app.request_context import set_request_token
    from app.session_store import get_or_create_session, save_session

    token = _token()
    set_request_token(token)
    session_id = f"smoke-create-{uuid.uuid4().hex[:10]}"
    session = await get_or_create_session(
        session_id, token=token, module="create_campaign"
    )
    # Seed as if templates already exist — post-generate main-chat behaviour.
    session["campaign"] = {
        "name": "Diwali Re-engagement",
        "goal": "Drive festive purchases",
        "objective": "Email engagement",
        "meta_complete": True,
    }
    session["channels"] = ["email"]
    session["templates"] = [
        {
            "template_id": str(uuid.uuid4()),
            "channel": "email",
            "fields": {"subject": "Celebrate Diwali", "sections": []},
        }
    ]
    session = await save_session(session, token=token)

    cases = [
        ("casual_meta", "wanna run a festive email thing for our customers", None),
        (
            "post_template_edit_ask",
            "can you make the subject punchier",
            ("view/edit", "edit", "channel card", "open"),
        ),
        (
            "post_template_image_ask",
            "add a nice banner somehow",
            ("view/edit", "edit", "generate", "upload"),
        ),
        ("channels_typo", "email only plz", None),
    ]
    results = []
    for label, text, must_any in cases:
        print(f"\n=== {label} ===\nuser: {text}")
        try:
            out = await _turn(session_id, token, text)
            reply = str(out.get("reply") or "")
            ok = bool(reply.strip())
            notes: list[str] = []
            if must_any and ok:
                low = reply.lower()
                if not any(m in low for m in must_any):
                    ok = False
                    notes.append(f"reply missing any of {must_any!r}")
            # Main chat must not invent rewrite lists or pretend it edited the template.
            low = reply.lower()
            if label == "post_template_edit_ask":
                bad_lists = (
                    "here are a few",
                    "here are three",
                    "subject options",
                    "punchier subject options",
                )
                if any(p in low for p in bad_lists):
                    ok = False
                    notes.append("invented subject options in main chat")
                if "view/edit" not in low and "view / edit" not in low:
                    # Accept "open … edit" phrasing
                    if "edit" not in low or "open" not in low:
                        ok = False
                        notes.append("missing View/edit handoff")
            if label == "post_template_image_ask":
                claimed = any(
                    p in low
                    for p in (
                        "queued a",
                        "i've queued",
                        "i've added",
                        "attached automatically",
                        "banner to be generated and added",
                    )
                )
                handed = "view/edit" in low or ("edit" in low and "open" in low) or (
                    "generate" in low and "upload" in low
                )
                if claimed and not handed:
                    ok = False
                    notes.append("claimed banner change without View/edit handoff")
                if not handed:
                    ok = False
                    notes.append("missing View/edit or generate-vs-upload handoff")
            row = {
                "label": label,
                "ok": ok,
                "reply": reply[:240],
                "notes": notes,
            }
        except Exception as exc:  # noqa: BLE001
            row = {"label": label, "ok": False, "reply": str(exc), "notes": []}
        results.append(row)
        print(json.dumps(row, ensure_ascii=False, indent=2))

    failed = [r for r in results if not r.get("ok")]
    print(f"\n{len(results) - len(failed)}/{len(results)} ok")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
