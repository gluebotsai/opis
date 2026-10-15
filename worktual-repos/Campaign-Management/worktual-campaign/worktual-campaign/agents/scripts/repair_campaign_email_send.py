#!/usr/bin/env python3
"""Repair a launched campaign whose email channel points at a library template id."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlunparse

import jwt
import psycopg2

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings
from app.request_context import set_request_token
from app.template_store import create_templates_batch


def _stable_db_id(raw: str) -> int:
    s = str(raw or "").strip()
    if s.isdigit():
        return int(s)
    hexdig = hashlib.sha256(f"campaign-id:{s}".encode()).hexdigest()[:15]
    return int(hexdig, 16)


def _db_connect():
    env_path = _ROOT.parent / "backend" / ".env"
    env: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    u = urlparse(env["DATABASE_URL"])
    schema = parse_qs(u.query).get("schema", ["public"])[0]
    clean = urlunparse((u.scheme, u.netloc, u.path, u.params, "", u.fragment))
    conn = psycopg2.connect(clean)
    cur = conn.cursor()
    cur.execute(f"SET search_path TO {schema}")
    return conn, cur, schema


async def _create_session_template(
    session_id: str,
    *,
    token: str,
    fields: dict,
) -> str:
    set_request_token(token)
    persisted = await create_templates_batch(
        session_id,
        [
            {
                "channel": "email",
                "how_it_works": "email touch from library (repair)",
                "fields": fields,
            }
        ],
        token=token,
    )
    saved = list(persisted.get("templates") or [])
    if not saved:
        raise RuntimeError("create_templates_batch returned no templates")
    tid = str(saved[0].get("template_id") or "").strip()
    if not tid:
        raise RuntimeError("saved template missing template_id")
    return tid


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--campaign-id", type=int, required=True)
    parser.add_argument("--user-id", default="1027")
    args = parser.parse_args()

    settings = get_settings()
    token = jwt.encode({"sub": args.user_id}, settings.jwt_secret, algorithm="HS256")

    conn, cur, _schema = _db_connect()
    sid_num = _stable_db_id(args.session_id)

    cur.execute("SELECT payload FROM campaign_agent_sessions WHERE id=%s", (sid_num,))
    row = cur.fetchone()
    if not row:
        print("session not found", sid_num)
        return 1
    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    templates = payload.get("templates") or []
    email_tpl = next(
        (t for t in templates if isinstance(t, dict) and str(t.get("channel") or "").lower() == "email"),
        None,
    )
    if not email_tpl or not isinstance(email_tpl.get("fields"), dict):
        print("no email template fields in session payload")
        return 1

    new_tid = asyncio.run(
        _create_session_template(
            args.session_id,
            token=token,
            fields=email_tpl["fields"],
        )
    )
    print("created channel template", new_tid)

    cur.execute(
        """
        UPDATE campaign_channels
        SET template_id = %s, updated_at = NOW()
        WHERE campaign_id = %s AND channel = 'email'
        """,
        (int(new_tid), args.campaign_id),
    )
    print("updated campaign_channels rows", cur.rowcount)

    cur.execute(
        """
        UPDATE campaign_send_batches
        SET status = 'queued_accounts', updated_at = NOW()
        WHERE campaign_id = %s AND channel = 'email' AND status = 'failed'
        """,
        (args.campaign_id,),
    )
    print("reset batches", cur.rowcount)

    cur.execute(
        """
        UPDATE campaign_send_recipients
        SET status = 'pending',
            attempt_count = 0,
            skip_fail_reason = NULL,
            provider_message_id = NULL,
            updated_at = NOW()
        WHERE campaign_id = %s AND status = 'failed'
        """,
        (args.campaign_id,),
    )
    print("reset recipients", cur.rowcount)

    cur.execute(
        """
        UPDATE campaigns
        SET status = 'live', updated_at = NOW()
        WHERE id = %s
        """,
        (args.campaign_id,),
    )
    print("campaign status -> live", cur.rowcount)

    conn.commit()
    conn.close()
    print("repair queued — email worker should send within ~15s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
