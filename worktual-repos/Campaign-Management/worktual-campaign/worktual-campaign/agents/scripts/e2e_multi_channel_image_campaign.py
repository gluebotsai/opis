#!/usr/bin/env python3
"""E2E: email + WhatsApp campaign with shared or per-channel AI images."""

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
    secret = get_settings().jwt_secret
    return jwt.encode({"sub": user_id}, secret, algorithm="HS256")


async def _auth_token(user_id: str, explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    env_tok = __import__("os").environ.get("CAMPAIGN_AUTH_TOKEN", "").strip()
    if env_tok:
        return env_tok
    return _token(user_id)


def _step(label: str, result: dict) -> None:
    ok = result.get("ok")
    err = result.get("error") or result.get("message") or ""
    print(f"\n--- {label} ---")
    print(f"  ok={ok}")
    if err and not ok:
        print(f"  error={str(err)[:400]}")
    for key in (
        "matched_count",
        "image_url",
        "template_id",
        "campaign_id",
        "attached_count",
        "mode",
    ):
        if result.get(key) is not None:
            print(f"  {key}={result[key]}")


async def _template_fields(template_id: str, token: str) -> dict:
    from app.template_store import get_template

    tpl_check = await get_template(template_id, token=token)
    if not isinstance(tpl_check, dict):
        return {}
    tpl_obj = tpl_check.get("template")
    if isinstance(tpl_obj, dict) and isinstance(tpl_obj.get("fields"), dict):
        return tpl_obj["fields"]
    return {}


async def run(
    *,
    email: str,
    phone: str,
    first_name: str,
    user_id: str,
    session_id: str | None,
    explicit_token: str | None,
    image_mode: str,
    launch_email: bool,
) -> int:
    from app.agents.create_campaign.tool_functions import dispatch_core_tool
    from app.agents.image.tools.handlers import dispatch_tool as image_dispatch

    token = await _auth_token(user_id, explicit_token)
    set_request_token(token)
    sid = session_id or f"e2e-mc-img-{uuid.uuid4().hex[:10]}"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    mode = image_mode if image_mode in ("shared", "per_channel") else "shared"

    print(f"Session: {sid}")
    print(f"Recipient email: {email}")
    if phone:
        print(f"Recipient phone: {phone}")
    print(f"User: {user_id}")
    print(f"Image mode: {mode}")

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    await save_session(session, token=token)

    meta = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "name": f"Multi-Channel Image E2E {stamp}",
            "goal": "Test shared AI images on email and WhatsApp",
            "objective": "Verify batch image plan, generate, attach on both channels",
            "channels": ["email", "whatsapp"],
            "strategy_accepted": True,
            "change_summary": "E2E multi-channel setup",
        },
    )
    _step("Campaign setup", meta)
    if meta.get("ok") is False:
        return 1

    lookup = await dispatch_core_tool(
        "check_contacts",
        sid,
        token,
        {"emails": [email], "change_summary": "E2E audience lookup"},
    )
    _step("Audience lookup", lookup)
    audience_count = int(lookup.get("matched_count") or 0)
    if audience_count <= 0:
        row = {"first_name": first_name, "email": email}
        if phone:
            row["phone"] = phone
        temp = await dispatch_core_tool(
            "upload_temporary_contacts",
            sid,
            token,
            {"rows": [row], "change_summary": "E2E temp audience"},
        )
        _step("Temporary audience", temp)
        session = await get_or_create_session(sid, token=token, module="create_campaign")
        audience_count = int((session.get("audience") or {}).get("matched_count") or 0)
    if audience_count <= 0:
        print("Audience empty — abort.")
        return 1

    plan = await dispatch_core_tool(
        "plan_campaign_images",
        sid,
        token,
        {
            "wants_images": True,
            "mode": mode,
            "scope": "all_eligible",
            "auto_after_build": True,
            "change_summary": f"E2E image plan ({mode})",
        },
    )
    _step("Image plan", plan)
    if plan.get("ok") is False:
        return 1

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    session["strategy_accepted"] = True
    session["confirmed_create_templates"] = True
    await save_session(session, token=token)

    build = await dispatch_core_tool(
        "build_campaign",
        sid,
        token,
        {
            "mode": "create",
            "user_confirmed": True,
            "channels": ["email", "whatsapp"],
            "change_summary": "E2E build email + WhatsApp templates with auto images",
        },
    )
    _step("Build templates (+ auto images)", build)
    if build.get("ok") is False:
        return 1

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    by_ch = session.get("template_ids_by_channel")
    if not isinstance(by_ch, dict):
        by_ch = {}
    email_tid = str(by_ch.get("email") or "").strip()
    wa_tid = str(by_ch.get("whatsapp") or "").strip()
    if not email_tid or not wa_tid:
        for row in session.get("templates") or []:
            if not isinstance(row, dict):
                continue
            ch = str(row.get("channel") or "").lower()
            tid = str(row.get("template_id") or "").strip()
            if ch == "email" and tid:
                email_tid = tid
            if ch == "whatsapp" and tid:
                wa_tid = tid

    print(f"\n  email_template_id={email_tid or 'MISSING'}")
    print(f"  whatsapp_template_id={wa_tid or 'MISSING'}")
    if not email_tid or not wa_tid:
        print("Missing template ids — abort.")
        return 1

    email_fields = await _template_fields(email_tid, token)
    wa_fields = await _template_fields(wa_tid, token)
    email_img = str(
        email_fields.get("header_image") or email_fields.get("image_url") or ""
    ).strip()
    wa_img = str(
        wa_fields.get("header_media_url")
        or wa_fields.get("image_url")
        or wa_fields.get("header_image")
        or ""
    ).strip()
    wa_handle = str(wa_fields.get("header_media_handle") or "").strip()

    print(f"\n  email_header_image={'yes' if email_img else 'MISSING'}")
    print(f"  whatsapp_header_media_url={'yes' if wa_img else 'MISSING'}")
    print(f"  whatsapp_meta_handle={'yes' if wa_handle else 'MISSING (social-service may be offline)'}")

    if not email_img or not wa_img:
        print("Image attach incomplete — running explicit pipeline fallback.")
        pipe = await image_dispatch(
            "RUN_CAMPAIGN_IMAGE_PIPELINE",
            sid,
            token,
            {"mode": mode},
        )
        _step("Image pipeline fallback", pipe)
        if not pipe.get("ok"):
            return 1
        email_fields = await _template_fields(email_tid, token)
        wa_fields = await _template_fields(wa_tid, token)
        email_img = str(
            email_fields.get("header_image") or email_fields.get("image_url") or ""
        ).strip()
        wa_img = str(
            wa_fields.get("header_media_url")
            or wa_fields.get("image_url")
            or wa_fields.get("header_image")
            or ""
        ).strip()
        wa_handle = str(wa_fields.get("header_media_handle") or "").strip()

    if mode == "shared" and email_img and wa_img and email_img != wa_img:
        print(f"  WARN: shared mode but URLs differ\n    email={email_img[:80]}\n    wa={wa_img[:80]}")
    if mode == "per_channel" and email_img and wa_img and email_img == wa_img:
        print("  WARN: per_channel mode but URLs are identical (Gemini may have reused output)")

    subject = str(email_fields.get("subject") or "").strip()
    email_body = email_fields.get("paragraphs") or email_fields.get("sections") or []
    wa_body = str(wa_fields.get("body") or "").strip()
    if not subject or not email_body or not wa_body or not email_img or not wa_img:
        print("Template fields incomplete after image attach — abort.")
        return 1

    launch_ok = None
    if launch_email:
        launch = await dispatch_core_tool(
            "launch_campaign",
            sid,
            token,
            {
                "confirmed": True,
                "schedule_mode": "now",
                "launch_channels": ["email"],
                "change_summary": "E2E launch email leg only",
            },
        )
        _step("Launch email", launch)
        launch_ok = bool(launch.get("ok"))

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    print("\n=== SUMMARY ===")
    print(f"session_id={sid}")
    print(f"campaign_id={camp.get('id') or camp.get('campaign_id')}")
    print(f"email_template_id={email_tid}")
    print(f"whatsapp_template_id={wa_tid}")
    print(f"email_image_url={email_img[:120]}")
    print(f"whatsapp_image_url={wa_img[:120]}")
    print(f"whatsapp_meta_handle={wa_handle or 'none'}")
    print(f"image_mode={mode}")
    if launch_ok is not None:
        print(f"email_launch_ok={launch_ok}")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="E2E multi-channel image campaign")
    parser.add_argument(
        "--email",
        default="aravindhselvaraj6235@gmail.com",
        help="Recipient email",
    )
    parser.add_argument("--phone", default="", help="Optional WhatsApp phone for audience")
    parser.add_argument("--first-name", default="Aravindh", help="Contact first name")
    parser.add_argument("--user-id", default="1027", help="JWT sub")
    parser.add_argument("--session-id", default="", help="Reuse session id")
    parser.add_argument("--token", default="", help="Bearer token (or CAMPAIGN_AUTH_TOKEN env)")
    parser.add_argument(
        "--image-mode",
        default="shared",
        choices=["shared", "per_channel"],
        help="Campaign image batch mode",
    )
    parser.add_argument(
        "--launch-email",
        action="store_true",
        help="Also launch email leg after verify",
    )
    args = parser.parse_args()
    return asyncio.run(
        run(
            email=args.email.strip(),
            phone=args.phone.strip(),
            first_name=args.first_name.strip(),
            user_id=args.user_id.strip(),
            session_id=args.session_id.strip() or None,
            explicit_token=args.token.strip() or None,
            image_mode=args.image_mode.strip(),
            launch_email=bool(args.launch_email),
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
