#!/usr/bin/env python3
"""
E2E create-campaign **chat tool path** (same as Socket coordinator → dispatch_core_tool).

Mirrors what the UI chat does when the LLM calls tools, without browser:
  update_campaign_setup → check_contacts → build_campaign → launch_campaign

Usage:
  cd agents && PYTHONPATH=. python3 scripts/e2e_whatsapp_chat_launch_flow.py \\
    --user-id 1054 --phone 919346765884
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone

import jwt

_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings
from app.request_context import set_request_token
from app.session_store import get_or_create_session, save_session


def _token(user_id: str) -> str:
    return jwt.encode({"sub": user_id}, get_settings().jwt_secret, algorithm="HS256")


async def _auth(user_id: str, explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    import os

    env_tok = os.environ.get("CAMPAIGN_AUTH_TOKEN", "").strip()
    return env_tok or _token(user_id)


def _print_step(name: str, out: dict) -> None:
    print(f"\n=== {name} ===")
    print("ok:", out.get("ok", True))
    if out.get("error"):
        print("error:", str(out.get("error"))[:500])
    if out.get("message"):
        print("message:", str(out.get("message"))[:500])
    for k in (
        "matched_count",
        "campaign_id",
        "whatsapp_meta_status",
        "whatsapp_send_warning",
        "launch_outcomes",
    ):
        if k in out and out[k] is not None:
            print(f"{k}:", out[k])


async def main_async(args: argparse.Namespace) -> int:
    from app.agents.create_campaign.tool_functions import dispatch_core_tool

    token = await _auth(args.user_id.strip(), args.token)
    set_request_token(token)
    sid = args.session_id.strip() or f"e2e-wa-chat-{uuid.uuid4().hex[:10]}"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

    print("session_id:", sid)
    print("user_id:", args.user_id)
    print("phone:", args.phone)

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    await save_session(session, token=token)

    setup = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "name": f"Chat WA E2E {stamp}",
            "goal": "Notify customer with a WhatsApp update",
            "objective": "Send WhatsApp to selected contact via chat launch flow",
            "strategy_accepted": True,
            "change_summary": "E2E chat-flow meta",
        },
    )
    _print_step("update_campaign_setup (meta)", setup)
    if setup.get("ok") is False:
        return 1

    ch = await dispatch_core_tool(
        "set_channels",
        sid,
        token,
        {
            "channels": ["whatsapp"],
            "channels_confirmed": True,
            "change_summary": "E2E WhatsApp channel",
        },
    )
    _print_step("set_channels", ch)
    if ch.get("ok") is False:
        return 1

    lookup = await dispatch_core_tool(
        "check_contacts",
        sid,
        token,
        {
            "phones": [args.phone.strip()],
            "change_summary": "E2E audience by phone",
        },
    )
    _print_step("check_contacts", lookup)
    if int(lookup.get("matched_count") or 0) < 1:
        print("FAIL: no contact matched phone", args.phone)
        return 1

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    session["strategy_accepted"] = True
    session["confirmed_create_templates"] = True
    session["templates_finalized"] = False
    await save_session(session, token=token)

    build = await dispatch_core_tool(
        "build_campaign",
        sid,
        token,
        {
            "mode": "create",
            "user_confirmed": True,
            "channels": ["whatsapp"],
            "change_summary": "E2E chat-flow build WhatsApp template",
        },
    )
    _print_step("build_campaign", build)
    if build.get("ok") is False:
        return 1

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    wa_tid = ""
    for row in session.get("templates") or []:
        if isinstance(row, dict) and str(row.get("channel") or "").lower() == "whatsapp":
            wa_tid = str(row.get("template_id") or "").strip()
    if not wa_tid:
        by_ch = session.get("template_ids_by_channel") or {}
        wa_tid = str(by_ch.get("whatsapp") or "").strip()
    print("whatsapp_template_id:", wa_tid or "MISSING")
    if not wa_tid:
        return 1

    launch = await dispatch_core_tool(
        "launch_campaign",
        sid,
        token,
        {
            "confirmed": True,
            "schedule_mode": "now",
            "launch_channels": ["whatsapp"],
            "user_text": "launch now",
            "change_summary": "E2E chat-flow confirm launch",
        },
    )
    _print_step("launch_campaign", launch)

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    outcomes = session.get("launch_outcomes") or {}
    wa_approval = session.get("whatsapp_approval") or {}
    print("\n=== session after launch ===")
    print("campaign_id:", session.get("campaign_id"))
    print("stage:", session.get("stage"))
    print("launch_outcomes:", outcomes)
    print("whatsapp_approval:", wa_approval)

    ok = bool(launch.get("ok", True)) and bool(session.get("campaign_id"))
    wa_st = str(
        launch.get("whatsapp_meta_status")
        or wa_approval.get("status")
        or outcomes.get("whatsapp")
        or ""
    ).lower()
    if wa_st == "rejected":
        print("\nVERDICT: Chat launch path OK; Meta REJECTED template (copy/format).")
        return 0
    if wa_st in ("pending", "approved"):
        print("\nVERDICT: Chat launch path OK; Meta", wa_st.upper())
        return 0
    if launch.get("whatsapp_send_warning"):
        print("\nVERDICT: Launch saved with warning:", launch.get("whatsapp_send_warning"))
        return 0 if ok else 1
    print("\nVERDICT:", "OK" if ok else "FAIL")
    return 0 if ok else 1


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--user-id", default="1054", help="Booxoo setup_users id")
    p.add_argument("--phone", default="919346765884")
    p.add_argument("--token", default="")
    p.add_argument("--session-id", default="")
    raise SystemExit(asyncio.run(main_async(p.parse_args())))


if __name__ == "__main__":
    main()
