#!/usr/bin/env python3
"""Smoke: edit agent understands varied phrasing via real LLM + tools (no regex intent).

Run: cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/smoke_edit_agent_phrasing.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


SAMPLE_FIELDS = {
    "subject": "Celebrate Diwali with Worktual",
    "header_image": "https://cdn.example/hero.jpg",
    "sections": [
        {"type": "headline", "content": "Brighten Your Business This Diwali"},
        {
            "type": "image",
            "url": "https://cdn.example/hero.jpg",
            "purpose": "hero",
        },
        {"type": "text", "content": "Hi {{first_name}}, unlock festive offers."},
        {"type": "benefits", "items": ["Free shipping", "Extra 10% off"]},
        {"type": "cta", "label": "Shop now", "url": "{{campaign_url}}"},
        {"type": "compliance_footer", "content": "Unsubscribe anytime"},
    ],
}

CAMPAIGN = {
    "name": "Diwali Re-engagement",
    "goal": "Drive festive purchases",
    "objective": "Email engagement",
}


async def _run_case(label: str, instruction: str, expect: dict) -> dict:
    from app.agents.template_library.edit_tools import run_template_edit_tools

    out = await run_template_edit_tools(
        channel="email",
        current_fields=SAMPLE_FIELDS,
        instruction=instruction,
        campaign=CAMPAIGN,
        pending_image_uploads=expect.get("pending_uploads"),
    )
    fields = out.get("fields") if isinstance(out.get("fields"), dict) else {}
    sections = fields.get("sections") if isinstance(fields.get("sections"), list) else []
    types = [
        str(r.get("type") or "")
        for r in sections
        if isinstance(r, dict)
    ]
    ok = True
    notes: list[str] = []
    if expect.get("intent"):
        if str(out.get("intent") or "") != expect["intent"]:
            ok = False
            notes.append(f"intent={out.get('intent')!r} want {expect['intent']!r}")
    if expect.get("no_cta"):
        if "cta" in types:
            ok = False
            notes.append("cta still present")
    if expect.get("no_image"):
        hero = str(fields.get("header_image") or "").strip()
        if hero or "image" in types:
            ok = False
            notes.append("image still present")
    if expect.get("image_first"):
        if not types or types[0] != "image":
            ok = False
            notes.append(f"first section={types[:2]!r}")
    if expect.get("no_benefits"):
        if "benefits" in types:
            ok = False
            notes.append("benefits still present")
    if expect.get("has_text_after_headline"):
        try:
            hi = types.index("headline")
            if hi + 1 >= len(types) or types[hi + 1] != "text":
                ok = False
                notes.append(f"no text under headline; types={types!r}")
        except ValueError:
            ok = False
            notes.append("no headline")
    if expect.get("subject_changed"):
        if str(fields.get("subject") or "") == SAMPLE_FIELDS["subject"]:
            ok = False
            notes.append("subject unchanged")
    if expect.get("used_tools") is True and not out.get("used_tools"):
        # used_tools may not always be exposed; check persist/intent modify
        if not out.get("persist_fields") and str(out.get("intent")) not in {
            "modify",
            "launch",
            "save",
            "show",
        }:
            ok = False
            notes.append("no mutation")
    reply = str(out.get("reply") or "")
    return {
        "label": label,
        "ok": ok,
        "intent": out.get("intent"),
        "persist": out.get("persist_fields"),
        "reply": reply[:180],
        "types": types,
        "subject": fields.get("subject"),
        "header_image": fields.get("header_image"),
        "notes": notes,
    }


async def main() -> int:
    cases = [
        (
            "remove_cta_casual",
            "can u drop that shop button pls",
            {"intent": "modify", "no_cta": True},
        ),
        (
            "remove_image_indirect",
            "i dont want the photo on top anymore",
            {"intent": "modify", "no_image": True},
        ),
        (
            "move_banner_top",
            "put the banner at the very top above the headline",
            {"intent": "modify", "image_first": True},
        ),
        (
            "change_subject_typo",
            "chang teh subject to Festive Savings Inside",
            {"intent": "modify", "subject_changed": True},
        ),
        (
            "attach_upload_casual",
            "yeah use that pic i just sent",
            {
                "intent": "modify",
                "pending_uploads": [
                    {
                        "image_url": "https://cdn.example/user-upload.jpg",
                        "filename": "shot.jpg",
                        "status": "this_turn",
                    }
                ],
            },
        ),
        (
            "insert_line_under_headline",
            "stick a short line under the headline saying Limited festive stock",
            {"intent": "modify", "has_text_after_headline": True},
        ),
        (
            "redesign_vague",
            "make the whole email feel fresher and more premium",
            {"intent": "modify"},
        ),
        (
            "remove_benefits_slang",
            "kill those bullet perks, they feel spammy",
            {"intent": "modify", "no_benefits": True},
        ),
    ]
    results = []
    for label, instruction, expect in cases:
        print(f"\n=== {label} ===\nuser: {instruction}")
        try:
            row = await _run_case(label, instruction, expect)
        except Exception as exc:  # noqa: BLE001
            row = {"label": label, "ok": False, "notes": [str(exc)], "reply": ""}
        results.append(row)
        print(json.dumps(row, ensure_ascii=False, indent=2))

    failed = [r for r in results if not r.get("ok")]
    print(f"\n{len(results) - len(failed)}/{len(results)} ok")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
