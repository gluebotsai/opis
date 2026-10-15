#!/usr/bin/env python3
"""E2E: approved WhatsApp template run — audience + launch now / +5 min schedule."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt

_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings
from app.request_context import set_request_token
from app.session_store import get_or_create_session, save_session
from app.agents.whatsapp_approved.launch_helpers import seed_approved_campaign_session


def _token(user_id: str, explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    env_tok = os.environ.get("CAMPAIGN_AUTH_TOKEN", "").strip()
    if env_tok:
        return env_tok
    return jwt.encode({"sub": user_id}, get_settings().jwt_secret, algorithm="HS256")


async def _login(email: str, password: str, fe: str) -> str:
    res = httpx.post(
        f"{fe.rstrip('/')}/api/auth/login",
        json={"email": email, "password": password, "remember": True},
        timeout=30.0,
    )
    res.raise_for_status()
    return str(res.json().get("token") or "").strip()


async def _fetch_regulated_template(token: str, template_id: str) -> dict | None:
    base = get_settings().campaign_api_base.rstrip("/")
    tid = str(template_id or "").strip()
    try:
        res = httpx.get(
            f"{base}/templates/regulated",
            headers={"Authorization": f"Bearer {token}"},
            params={"channel": "whatsapp"},
            timeout=30.0,
        )
        if res.status_code != 200:
            return None
        body = res.json()
        if not isinstance(body, dict):
            return None
        rows = body.get("templates") or body.get("data") or []
        if isinstance(rows, dict):
            rows = rows.get("templates") or rows.get("items") or []
        for row in rows:
            if isinstance(row, dict) and str(row.get("id") or "").strip() == tid:
                return row
    except Exception:
        return None
    return None


def _snapshot_from_template(row: dict, *, fallback_id: str) -> dict:
    tid = str(row.get("id") or fallback_id).strip()
    return {
        "id": tid,
        "name": row.get("name") or row.get("template_name") or "wa_template",
        "body": row.get("body") or row.get("content") or "",
        "status": str(row.get("status") or "approved").lower(),
        "language": row.get("language") or "en",
        "category": row.get("category") or "MARKETING",
        "provider_template_id": row.get("providerTemplateId")
        or row.get("provider_template_id")
        or row.get("externalId")
        or row.get("meta_template_id"),
        "header": row.get("header") or "",
        "footer": row.get("footer") or "",
        "buttons": row.get("buttons") or "",
        "campaign_name": row.get("campaignName") or row.get("campaign_name") or "",
        "goal": row.get("goal") or "",
        "objective": row.get("objective") or "",
    }


def _minimal_snapshot(template_id: str) -> dict:
    return {
        "id": template_id,
        "name": f"worktual_help_{template_id}",
        "body": "Thanks for contacting Worktual. How can we help you today?",
        "status": "approved",
        "language": "en",
        "category": "MARKETING",
        "provider_template_id": f"meta-regulated-{template_id}",
    }


async def _run_flow(
    *,
    token: str,
    template_id: str,
    email: str,
    schedule_mode: str,
    minutes_ahead: int,
) -> int:
    from app.agents.create_campaign.tool_functions import dispatch_core_tool

    set_request_token(token)
    suffix = (
        f"-run-{uuid.uuid4().hex[:8]}"
        if schedule_mode == "now"
        else f"-sched-{uuid.uuid4().hex[:8]}"
    )
    sid = f"wa-approved-{template_id}{suffix}"
    snap_row = await _fetch_regulated_template(token, template_id)
    if not snap_row:
        print(f"WARNING: regulated template {template_id} not in library; using minimal snap")
    snap = _snapshot_from_template(snap_row, fallback_id=template_id) if snap_row else _minimal_snapshot(template_id)
    print(f"snapshot provider_template_id={snap.get('provider_template_id')} name={snap.get('name')}")

    session = await get_or_create_session(
        sid, token=token, module="whatsapp_approved"
    )
    session["whatsapp_approved_run"] = True
    session["whatsapp_template_snapshot"] = snap
    session = seed_approved_campaign_session(session, snap)
    await save_session(session, token=token)

    lookup = await dispatch_core_tool(
        "check_contacts",
        sid,
        token,
        {"emails": [email], "change_summary": "E2E approved WA audience"},
    )
    print(f"\n=== lookup template={template_id} mode={schedule_mode} ===")
    print("lookup ok:", lookup.get("ok"), "matched:", lookup.get("matched_count"))
    if lookup.get("ok") is False and lookup.get("error"):
        print("lookup error:", str(lookup.get("error"))[:300])
        return 1

    launch_args: dict = {
        "confirmed": True,
        "launch_channels": ["whatsapp"],
        "schedule_mode": schedule_mode,
        "user_text": "launch now" if schedule_mode == "now" else "schedule in 5 minutes",
        "change_summary": f"E2E approved WA {schedule_mode}",
    }
    if schedule_mode != "now":
        when = datetime.now(timezone.utc) + timedelta(minutes=minutes_ahead)
        launch_args["scheduled_at"] = when.isoformat()
        launch_args["schedule_mode"] = "scheduled"

    launch = await dispatch_core_tool("launch_campaign", sid, token, launch_args)
    print("launch ok:", launch.get("ok"))
    if launch.get("error"):
        print("launch error:", str(launch.get("error"))[:400])
    if launch.get("message"):
        print("launch message:", str(launch.get("message"))[:400])
    print("campaign_id:", launch.get("campaign_id"))

    session = await get_or_create_session(sid, token=token)
    plan = session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {}
    if plan:
        print("scheduled_at:", plan.get("scheduled_at"))
        print("approved_template_poll_30m:", plan.get("approved_template_poll_30m"))

    return 0 if launch.get("ok") else 1


async def main_async(args: argparse.Namespace) -> int:
    fe = os.environ.get("CAMPAIGN_FE_ORIGIN", "http://127.0.0.1:5173").strip()
    token = args.token.strip()
    if not token and args.email and args.password:
        token = await _login(args.email.strip(), args.password.strip(), fe)
    if not token:
        token = _token(args.user_id.strip(), None)
    if not token:
        print("Need CAMPAIGN_AUTH_TOKEN or --email/--password", file=sys.stderr)
        return 2

    rc = 0
    rc |= await _run_flow(
        token=token,
        template_id=args.template_now.strip(),
        email=args.recipient.strip(),
        schedule_mode="now",
        minutes_ahead=0,
    )
    if str(args.template_scheduled or "").strip():
        rc |= await _run_flow(
            token=token,
            template_id=args.template_scheduled.strip(),
            email=args.recipient.strip(),
            schedule_mode="scheduled",
            minutes_ahead=max(1, int(args.minutes_ahead)),
        )
    return rc


def main() -> int:
    parser = argparse.ArgumentParser(description="E2E approved WhatsApp launch")
    parser.add_argument(
        "--recipient",
        default=os.environ.get(
            "WA_APPROVED_TEST_EMAIL", "pujithapaleti1234@gmail.com"
        ),
    )
    parser.add_argument("--template-now", default="1060")
    parser.add_argument("--template-scheduled", default="1060")
    parser.add_argument("--minutes-ahead", type=int, default=5)
    parser.add_argument("--user-id", default="1027")
    parser.add_argument("--token", default="")
    parser.add_argument("--email", default=os.environ.get("CAMPAIGN_TEST_EMAIL", ""))
    parser.add_argument("--password", default=os.environ.get("CAMPAIGN_TEST_PASSWORD", ""))
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
