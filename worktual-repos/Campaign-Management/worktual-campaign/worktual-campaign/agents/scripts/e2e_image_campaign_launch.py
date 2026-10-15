#!/usr/bin/env python3
"""E2E: create email campaign with AI hero image and launch to one recipient."""

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
    for key in ("matched_count", "image_url", "template_id", "campaign_id", "contact_id"):
        if result.get(key):
            print(f"  {key}={result[key]}")


async def run(
    *,
    email: str,
    first_name: str,
    user_id: str,
    session_id: str | None,
    explicit_token: str | None = None,
) -> int:
    from app.agents.create_campaign.tool_functions import dispatch_core_tool
    from app.agents.image.tools.handlers import dispatch_tool as image_dispatch

    token = await _auth_token(user_id, explicit_token)
    set_request_token(token)
    sid = session_id or f"e2e-img-{uuid.uuid4().hex[:10]}"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

    print(f"Session: {sid}")
    print(f"Recipient: {email}")
    print(f"User: {user_id}")

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    await save_session(session, token=token)

    # 1) Campaign meta (channels saved separately)
    meta = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "name": f"Image Hero E2E {stamp}",
            "goal": "Test AI hero image and email send",
            "objective": "Deliver one test email with generated header image",
            "change_summary": "E2E meta setup",
        },
    )
    _step("Campaign meta", meta)
    if meta.get("ok") is False:
        return 1

    channels = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "channels": ["email"],
            "channels_confirmed": True,
            "change_summary": "E2E email channel",
        },
    )
    _step("Campaign channels", channels)
    if channels.get("ok") is False:
        return 1

    accept = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "strategy_accepted": True,
            "change_summary": "E2E accept strategy for template build",
        },
    )
    _step("Strategy accepted", accept)

    # 2) Audience — prefer CRM contact (required for launch); temp sheet fallback
    lookup = await dispatch_core_tool(
        "check_contacts",
        sid,
        token,
        {"emails": [email], "change_summary": "E2E audience lookup"},
    )
    _step("Audience lookup", lookup)
    audience_count = int(lookup.get("matched_count") or 0)
    if audience_count <= 0:
        temp = await dispatch_core_tool(
            "upload_temporary_contacts",
            sid,
            token,
            {
                "rows": [{"first_name": first_name, "email": email}],
                "change_summary": "E2E temp audience fallback",
            },
        )
        _step("Temporary audience (fallback)", temp)
        session = await get_or_create_session(sid, token=token, module="create_campaign")
        audience_count = int((session.get("audience") or {}).get("matched_count") or 0)
    if audience_count <= 0:
        print("Audience empty — abort.")
        return 1

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    session["strategy_accepted"] = True
    session["confirmed_create_templates"] = True
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    camp.update(
        {
            "name": f"Image Hero E2E {stamp}",
            "goal": "Test AI hero image and email send",
            "objective": "Deliver one test email with generated header image",
        }
    )
    session["campaign"] = camp
    if not list(session.get("channels") or []):
        session["channels"] = ["email"]
    await save_session(session, token=token)

    # 3) Templates
    build = await dispatch_core_tool(
        "build_campaign",
        sid,
        token,
        {
            "mode": "create",
            "user_confirmed": True,
            "wants_images": True,
            "channels": ["email"],
            "name": f"Image Hero E2E {stamp}",
            "goal": "Test AI hero image and email send",
            "objective": "Deliver one test email with generated header image",
            "change_summary": "E2E build email template",
        },
    )
    _step("Build templates", build)
    if build.get("ok") is False:
        return 1

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    template_id = str(session.get("template_id") or "").strip()
    if not template_id:
        templates = [
            t for t in (session.get("templates") or []) if isinstance(t, dict) and t.get("channel")
        ]
        email_tpl = next(
            (t for t in templates if str(t.get("channel") or "").lower() in ("email",)),
            None,
        )
        template_id = str((email_tpl or {}).get("template_id") or "").strip()
    print(f"\n  email_template_id={template_id or 'MISSING'}")
    if not template_id:
        print("No email template_id — abort.")
        return 1

    # 4) Image — enhance from campaign idea only (no custom pixel prompt)
    enhance = await image_dispatch(
        "ENHANCE_IMAGE_PROMPT",
        sid,
        token,
        {"channel": "email"},
    )
    _step("Enhance image prompt", enhance)
    if not enhance.get("ok"):
        return 1

    enhanced = str(enhance.get("enhanced_prompt") or "").strip()
    if not enhanced:
        print("No enhanced_prompt — abort.")
        return 1

    # Ensure image gate slots persist (create_campaign session + image tool module).
    from app.mas.runtime.task_memory import get_mas_task

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    img_slots = get_mas_task(session).setdefault("slots", {}).setdefault("image", {})
    img_slots["last_enhanced_prompt"] = enhanced
    img_slots["last_enhance_id"] = enhance.get("enhance_id") or img_slots.get("last_enhance_id")
    img_slots["last_user_prompt"] = str(enhance.get("synthesized_prompt") or "campaign-idea hero")
    await save_session(session, token=token)

    gen = await image_dispatch(
        "GENERATE_IMAGE",
        sid,
        token,
        {"enhanced_prompt": enhanced},
    )
    _step("Generate image", gen)
    if not gen.get("ok"):
        return 1

    image_url = str(gen.get("image_url") or "").strip()
    if not image_url:
        print("No image_url — abort.")
        return 1
    if not image_url.startswith("https://"):
        print(f"  WARN: image URL is not HTTPS: {image_url[:120]}")
    try:
        import httpx

        head = httpx.head(image_url, timeout=20.0, follow_redirects=True)
        print(f"\n  image_url_reachable status={head.status_code}")
        if head.status_code >= 400:
            print("  WARN: public image URL not reachable — Gmail may not show the hero.")
    except Exception as exc:
        print(f"  WARN: could not verify image URL: {exc}")

    # 5) Attach to email template header
    attach = await image_dispatch(
        "ATTACH_IMAGE",
        sid,
        token,
        {
            "template_id": template_id,
            "field_key": "header_image",
            "image_url": image_url,
        },
    )
    _step("Attach image to template", attach)
    if not attach.get("ok"):
        print("Attach failed — abort.")
        return 1

    # Verify DB fields still have subject + body + image
    from app.template_store import get_template

    tpl_check = await get_template(template_id, token=token)
    fields = {}
    if isinstance(tpl_check, dict):
        tpl_obj = tpl_check.get("template")
        if isinstance(tpl_obj, dict) and isinstance(tpl_obj.get("fields"), dict):
            fields = tpl_obj["fields"]
    subject = str(fields.get("subject") or "").strip()
    paras = fields.get("paragraphs") or []
    sections = fields.get("sections") or []
    header = str(fields.get("header_image") or fields.get("image_url") or "").strip()
    canonical = __import__(
        "app.agents.template_library.fields", fromlist=["canonicalize_email_fields"]
    ).canonicalize_email_fields(fields)
    canon_sections = canonical.get("sections") or []
    image_sections = [
        row for row in canon_sections
        if isinstance(row, dict) and str(row.get("type") or "").lower() == "image"
    ]
    url_text_rows = [
        row for row in canon_sections
        if isinstance(row, dict)
        and str(row.get("type") or "text").lower() in ("text", "")
        and str(row.get("content") or "").strip().startswith("http")
    ]
    print(f"\n  post_attach subject={subject[:80] or 'MISSING'}")
    print(f"  post_attach paragraphs={len(paras) if isinstance(paras, list) else 0}")
    print(f"  post_attach sections={len(sections) if isinstance(sections, list) else 0}")
    print(f"  post_attach header_image={'yes' if header else 'MISSING'}")
    print(f"  canonical_image_sections={len(image_sections)}")
    print(f"  canonical_url_text_rows={len(url_text_rows)}")
    if url_text_rows:
        print("  WARN: URL-only text sections remain — sent email may show links not images")
    if not image_sections and header:
        print("  WARN: header_image set but no image section after canonicalize")
    if "localhost:5173" in header:
        print("  WARN: image URL uses localhost:5173 — Gmail may not load it")
    has_body = (
        (isinstance(paras, list) and any(str(p or "").strip() for p in paras))
        or (
            isinstance(sections, list)
            and any(
                isinstance(row, dict) and str(row.get("content") or "").strip()
                for row in sections
            )
        )
    )
    if not subject or not has_body or not header:
        print("Template fields incomplete after attach — abort.")
        return 1

    # 6) Launch now
    launch = await dispatch_core_tool(
        "launch_campaign",
        sid,
        token,
        {
            "confirmed": True,
            "schedule_mode": "now",
            "launch_channels": ["email"],
            "change_summary": "E2E launch to test recipient",
        },
    )
    _step("Launch campaign", launch)

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    print("\n=== SUMMARY ===")
    print(f"session_id={sid}")
    print(f"campaign_id={camp.get('id') or camp.get('campaign_id') or launch.get('campaign_id')}")
    print(f"template_id={template_id}")
    print(f"image_url={image_url}")
    print(f"recipient={email}")
    print(f"launch_ok={launch.get('ok')}")
    if launch.get("message"):
        print(f"launch_message={str(launch.get('message'))[:500]}")

    return 0 if launch.get("ok") else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="E2E image campaign launch")
    parser.add_argument(
        "--email",
        default="aravindhselvaraj6235@gmail.com",
        help="Recipient email",
    )
    parser.add_argument("--first-name", default="Aravindh", help="Contact first name")
    parser.add_argument(
        "--user-id",
        default="1027",
        help="JWT sub (QA default matches backend/scripts/qa-wt-launch-aravindh.mjs)",
    )
    parser.add_argument("--session-id", default="", help="Reuse session id")
    parser.add_argument("--token", default="", help="Bearer token (or CAMPAIGN_AUTH_TOKEN env)")
    args = parser.parse_args()
    return asyncio.run(
        run(
            email=args.email.strip(),
            first_name=args.first_name.strip(),
            user_id=args.user_id.strip(),
            session_id=args.session_id.strip() or None,
            explicit_token=args.token.strip() or None,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
