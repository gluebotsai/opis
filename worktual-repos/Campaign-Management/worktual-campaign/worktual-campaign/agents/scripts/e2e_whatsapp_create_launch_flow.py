#!/usr/bin/env python3
"""Live E2E: create-campaign WhatsApp body → backend submit path (optional).

Requires running campaign API + valid CAMPAIGN_AUTH_TOKEN (or login env).
Does not drive browser chat; validates agent sanitize → components → optional submit.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.agents.template_library.channels.whatsapp.meta_rules import (
    build_meta_submit_components,
    sanitize_whatsapp_fields,
    validate_whatsapp_fields,
)

_WA_BODY = (
    "Hi {{first_name}}, your Worktual daily report is ready for review. "
    "Open the link below to see metrics and follow up with your team when "
    "you have a moment today."
)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--submit", action="store_true", help="POST submit-approval via backend regulated route")
    parser.add_argument("--template-id", default="", help="Regulated template id for --submit")
    args = parser.parse_args()

    raw = {
        "name": f"wa_e2e_{int(__import__('time').time())}",
        "language": "en",
        "category": "UTILITY",
        "body": _WA_BODY,
        "footer": "Worktual",
        "buttons": [
            {"type": "QUICK_REPLY", "text": "Help"},
            {"type": "URL", "text": "Open", "url": "{{campaign_url}}"},
        ],
    }
    ok, errors = validate_whatsapp_fields(raw, strict=True)
    print("validate:", ok, errors)
    if not ok:
        return 1

    fields = sanitize_whatsapp_fields(raw, campaign={"product_url": "https://app.worktual.com/x"})
    meta = build_meta_submit_components(fields)
    print("components:", __import__("json").dumps(meta["components"], indent=2)[:1200])

    if not args.submit:
        print("OK (dry run). Use --submit with --template-id for live CCaaS.")
        return 0

    token = os.environ.get("CAMPAIGN_AUTH_TOKEN", "").strip()
    if not token:
        print("Set CAMPAIGN_AUTH_TOKEN for --submit")
        return 1
    tid = str(args.template_id or "").strip()
    if not tid:
        print("--template-id required for --submit")
        return 1

    import httpx
    from app.config import get_settings

    base = get_settings().campaign_api_base.rstrip("/")
    res = httpx.post(
        f"{base}/templates/regulated/{tid}/submit-approval",
        headers={"Authorization": f"Bearer {token}"},
        json={},
        timeout=60.0,
    )
    print("submit status:", res.status_code, res.text[:500])
    return 0 if res.status_code < 400 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
