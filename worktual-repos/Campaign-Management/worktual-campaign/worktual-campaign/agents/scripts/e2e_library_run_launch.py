#!/usr/bin/env python3
"""E2E: library_run adopt (keep) + launch email to one recipient."""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlunparse

import httpx
import jwt
import psycopg2

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings
from app.request_context import set_request_token
from app.session_store import get_or_create_session, save_session
from app.template_store import list_session_templates


def _token(user_id: str) -> str:
    return jwt.encode({"sub": user_id}, get_settings().jwt_secret, algorithm="HS256")


def _step(label: str, result: dict) -> None:
    ok = result.get("ok")
    err = result.get("error") or result.get("message") or ""
    print(f"\n--- {label} ---")
    print(f"  ok={ok}")
    if err and not ok:
        print(f"  error={str(err)[:400]}")
    for key in ("template_id", "template_ids", "campaign_id", "matched_count", "adopted"):
        if result.get(key) is not None:
            print(f"  {key}={result[key]}")


async def _fetch_library_template(token: str, library_id: str) -> dict:
    base = get_settings().campaign_api_base.rstrip("/")
    url = f"{base}/templates/library/{library_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        res.raise_for_status()
        body = res.json()
    if not isinstance(body, dict):
        raise RuntimeError(f"Unexpected library template response: {body!r}")
    data = body.get("template") or body.get("data") or body
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected library template payload: {body!r}")
    fields = data.get("fields")
    if not isinstance(fields, dict):
        raise RuntimeError(f"Library template {library_id} has no fields")
    return data


def _poll_send_status(campaign_id: int, *, timeout_s: int = 90) -> dict:
    env_path = _ROOT.parent / "backend" / ".env"
    env: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    u = urlparse(env["DATABASE_URL"])
    schema = parse_qs(u.query).get("schema", ["campaign"])[0]
    clean = urlunparse((u.scheme, u.netloc, u.path, u.params, "", u.fragment))
    deadline = time.time() + timeout_s
    last: dict = {}
    while time.time() < deadline:
        conn = psycopg2.connect(clean)
        cur = conn.cursor()
        cur.execute(f"SET search_path TO {schema}")
        cur.execute(
            """
            SELECT r.status, r.skip_fail_reason, r.provider_message_id,
                   c.template_id, b.status
            FROM campaign_send_recipients r
            JOIN campaign_send_batches b ON b.id = r.batch_id
            JOIN campaign_channels c ON c.campaign_id = r.campaign_id AND c.channel = 'email'
            WHERE r.campaign_id = %s
            ORDER BY r.id DESC LIMIT 1
            """,
            (campaign_id,),
        )
        row = cur.fetchone()
        conn.close()
        if row:
            last = {
                "recipient_status": row[0],
                "skip_fail_reason": row[1],
                "provider_message_id": row[2],
                "channel_template_id": row[3],
                "batch_status": row[4],
            }
            if row[0] == "sent":
                return last
            if row[0] == "failed" and row[1]:
                return last
        time.sleep(3)
    return last


async def run(
    *,
    email: str,
    user_id: str,
    library_id: str,
    session_id: str | None,
    explicit_token: str | None = None,
) -> int:
    from app.agents.create_campaign.tool_functions import dispatch_core_tool

    token = (explicit_token or "").strip() or _token(user_id)
    set_request_token(token)
    sid = session_id or f"lib-e2e-{uuid.uuid4().hex[:10]}"

    lib = await _fetch_library_template(token, library_id)
    lib_name = str(lib.get("name") or "Library template").strip()
    lib_fields = lib["fields"]

    print(f"Session: {sid}")
    print(f"Library template: {library_id} ({lib_name})")
    print(f"Recipient: {email}")

    session = await get_or_create_session(sid, token=token, module="library_run")
    session["library_run"] = True
    session["selected_library_templates"] = [
        {
            "id": library_id,
            "template_id": library_id,
            "channel": "email",
            "name": lib_name,
            "fields": lib_fields,
        }
    ]
    session["templates"] = []
    session["channels"] = ["email"]
    session["strategy_accepted"] = True
    camp = session.setdefault("campaign", {})
    camp.update(
        {
            "name": lib_name,
            "goal": str(lib.get("goal") or "Book a demo").strip(),
            "objective": "Drive website traffic",
        }
    )
    await save_session(session, token=token)

    channels = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "channels": ["email"],
            "channels_confirmed": True,
            "change_summary": "E2E library_run email channel",
        },
    )
    _step("Channels", channels)
    if channels.get("ok") is False:
        return 1

    lookup = await dispatch_core_tool(
        "check_contacts",
        sid,
        token,
        {"emails": [email], "change_summary": "E2E library audience"},
    )
    _step("Audience lookup", lookup)
    if int(lookup.get("matched_count") or 0) <= 0:
        print("No CRM contact matched — abort.")
        return 1

    adopt = await dispatch_core_tool(
        "build_campaign",
        sid,
        token,
        {
            "content_mode": "keep",
            "design_mode": "keep",
            "user_confirmed": True,
            "channels": ["email"],
            "change_summary": "E2E adopt library template as-is",
        },
    )
    _step("Adopt library template", adopt)
    if adopt.get("ok") is False:
        return 1

    session = await get_or_create_session(sid, token=token, module="library_run")
    email_tpl = next(
        (
            t
            for t in (session.get("templates") or [])
            if isinstance(t, dict) and str(t.get("channel") or "").lower() == "email"
        ),
        None,
    )
    channel_tid = str((email_tpl or {}).get("template_id") or "").strip()
    print(f"\n  session_channel_template_id={channel_tid or 'MISSING'}")
    if not channel_tid:
        print("No channel template_id after adopt — abort.")
        return 1
    if channel_tid == library_id:
        print(f"FAIL: template_id still library id {library_id} — not persisted.")
        return 1

    db_cards = await list_session_templates(sid, token=token)
    db_ids = {str(c.get("template_id") or "") for c in db_cards}
    print(f"  db_session_template_ids={sorted(db_ids)}")
    if channel_tid not in db_ids:
        print("FAIL: channel template not found in DB session templates.")
        return 1

    launch = await dispatch_core_tool(
        "launch_campaign",
        sid,
        token,
        {
            "confirmed": True,
            "schedule_mode": "now",
            "launch_channels": ["email"],
            "change_summary": "E2E library_run launch",
        },
    )
    _step("Launch", launch)
    if launch.get("ok") is False:
        return 1

    session = await get_or_create_session(sid, token=token, module="library_run")
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    campaign_id = int(
        camp.get("id") or camp.get("campaign_id") or launch.get("campaign_id") or 0
    )
    if not campaign_id:
        print("No campaign_id after launch — abort.")
        return 1

    print(f"\nWaiting for send (campaign {campaign_id})…")
    send = _poll_send_status(campaign_id)
    print("\n=== SEND RESULT ===")
    for k, v in send.items():
        print(f"  {k}={v}")

    print("\n=== SUMMARY ===")
    print(f"session_id={sid}")
    print(f"campaign_id={campaign_id}")
    print(f"library_template_id={library_id}")
    print(f"channel_template_id={channel_tid}")
    print(f"recipient={email}")
    ok = send.get("recipient_status") == "sent"
    print(f"delivered={ok}")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="E2E library_run adopt + launch")
    parser.add_argument("--email", default="aravindhselvaraj6235@gmail.com")
    parser.add_argument("--user-id", default="1027")
    parser.add_argument("--library-id", default="88")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--token", default="")
    args = parser.parse_args()
    return asyncio.run(
        run(
            email=args.email.strip(),
            user_id=args.user_id.strip(),
            library_id=args.library_id.strip(),
            session_id=args.session_id.strip() or None,
            explicit_token=args.token.strip() or None,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
