#!/usr/bin/env python3
"""Smoke: email-only Template Director + email channel agent (one end-to-end pass).

Prints enhancer output, creative brief, design plan, final email fields, and
flags built-in placeholder copy. No images (wants_images=false).

Requires LLM env (agents/.env or deploy/server/agents.env).

Run:
  cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/smoke_email_director_once.py
  cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/smoke_email_director_once.py --json
  cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/smoke_email_director_once.py --allow-placeholders
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

DEFAULT_CAMPAIGN = {
    "name": "Diwali Sale Blast",
    "goal": "Diwali sales — drive sales during the Diwali festival season",
    "objective": "Increase purchases during Diwali",
}
DEFAULT_AUDIENCE = {"description": "Existing retail customers", "matched_count": 1200}
DEFAULT_USER_REQUEST = "Yes create the campaign — Diwali sale blast on email"
DEFAULT_CHAT_SUMMARY = "User wants a Diwali festival season sales email blast."


def _placeholder_hits(fields: dict[str, Any], campaign: dict[str, Any]) -> list[str]:
    from app.agents.template_generation_director.schemas import (
        email_fields_contain_builtin_placeholders,
    )

    if email_fields_contain_builtin_placeholders(fields, campaign):
        return ["email_fields_contain_builtin_placeholders"]
    return []


def _section_summary(fields: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in fields.get("sections") or []:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("type") or "")
        entry: dict[str, Any] = {"type": kind}
        if row.get("content"):
            entry["content"] = str(row["content"])[:400]
        if row.get("items"):
            entry["items"] = list(row["items"])[:6]
        if kind == "cta":
            entry["label"] = row.get("label")
            entry["url"] = row.get("url")
        out.append(entry)
    return out


async def run_smoke(
    *,
    campaign: dict[str, Any],
    audience: dict[str, Any],
    user_request: str,
    chat_summary: str,
    skip_kb: bool,
) -> dict[str, Any]:
    from app.agents.template_generation_director.information_enhancer import (
        is_default_enhancer_narrative,
    )
    from app.agents.template_generation_director.workflow import plan_generation
    from app.agents.template_library.channels.email import agent
    from app.knowledge_base import fetch_campaign_knowledge

    report: dict[str, Any] = {"ok": False, "timings_s": {}, "steps": {}}

    t0 = time.perf_counter()
    knowledge = "" if skip_kb else await fetch_campaign_knowledge(campaign)
    report["timings_s"]["knowledge"] = round(time.perf_counter() - t0, 3)
    report["steps"]["knowledge"] = {"chars": len(knowledge)}

    t1 = time.perf_counter()
    brief, plans, gen_report = await plan_generation(
        campaign=campaign,
        audience=audience,
        channels=["email"],
        channel_plans=[
            {
                "channel": "email",
                "how_it_works": "Festive email for campaign launch",
            }
        ],
        knowledge=knowledge,
        user_request=user_request,
        chat_summary=chat_summary,
        wants_images=False,
        confirmed_chat_images=[],
    )
    report["timings_s"]["plan_generation"] = round(time.perf_counter() - t1, 3)

    enh = (
        gen_report.get("information_enhancer")
        if isinstance(gen_report.get("information_enhancer"), dict)
        else {}
    )
    email_plan = next(
        (p for p in plans if str(p.get("channel") or "").lower() == "email"),
        plans[0] if plans else {},
    )
    design = (
        email_plan.get("design_plan")
        if isinstance(email_plan.get("design_plan"), dict)
        else {}
    )

    report["steps"]["information_enhancer"] = {
        k: enh.get(k)
        for k in (
            "narrative",
            "visual_design_intent",
            "must_include",
            "must_avoid",
            "verified_facts",
            "missing_facts",
            "user_design_preferences",
        )
        if enh.get(k)
    }
    report["steps"]["creative_brief"] = {
        "campaign_intent": brief.get("campaign_intent"),
        "narrative": brief.get("narrative"),
        "must_include": brief.get("must_include"),
        "must_avoid": brief.get("must_avoid"),
    }
    report["steps"]["design_plan"] = {
        "pattern_id": design.get("pattern_id"),
        "theme_id": design.get("theme_id"),
        "sections": design.get("sections"),
        "image_slot_specs": design.get("image_slot_specs"),
        "theme_keys": list((design.get("theme") or {}).keys())
        if isinstance(design.get("theme"), dict)
        else [],
    }

    t2 = time.perf_counter()
    fields = await agent.generate(
        campaign=campaign,
        audience_summary=audience,
        plan=email_plan,
        knowledge=knowledge,
    )
    report["timings_s"]["email_generate"] = round(time.perf_counter() - t2, 3)
    report["timings_s"]["total"] = round(time.perf_counter() - t0, 3)

    placeholders = _placeholder_hits(fields, campaign)
    report["steps"]["email_fields"] = {
        "subject": fields.get("subject"),
        "pattern_id": fields.get("pattern_id"),
        "theme_id": fields.get("theme_id"),
        "sections": _section_summary(fields),
    }
    narrative = str(
        (report.get("steps", {}).get("information_enhancer") or {}).get("narrative")
        or enh.get("narrative")
        or ""
    )
    report["enhancer_used_default_narrative"] = is_default_enhancer_narrative(narrative)
    report["placeholder_hits"] = placeholders
    report["used_builtin_placeholders"] = bool(placeholders)
    report["ok"] = not placeholders and not report["enhancer_used_default_narrative"]
    return report


def _print_human(report: dict[str, Any]) -> None:
    print("=== smoke_email_director_once ===")
    print("timings_s:", json.dumps(report.get("timings_s") or {}, indent=2))

    enh = report.get("steps", {}).get("information_enhancer") or {}
    print("\n--- Information enhancer ---")
    for key in (
        "narrative",
        "visual_design_intent",
        "must_include",
        "must_avoid",
        "missing_facts",
    ):
        if enh.get(key):
            val = enh[key]
            if isinstance(val, str):
                print(f"{key}: {val[:700]}{'…' if len(val) > 700 else ''}")
            else:
                print(f"{key}: {json.dumps(val, ensure_ascii=False)[:500]}")

    brief = report.get("steps", {}).get("creative_brief") or {}
    print("\n--- Creative brief ---")
    print("campaign_intent:", brief.get("campaign_intent"))
    if brief.get("narrative"):
        n = str(brief["narrative"])
        print("narrative:", n[:700] + ("…" if len(n) > 700 else ""))

    dp = report.get("steps", {}).get("design_plan") or {}
    print("\n--- Design plan ---")
    print("pattern_id:", dp.get("pattern_id"), "theme_id:", dp.get("theme_id"))
    print("sections:", dp.get("sections"))

    ef = report.get("steps", {}).get("email_fields") or {}
    print("\n--- Email output ---")
    print("subject:", ef.get("subject"))
    print(json.dumps(ef.get("sections") or [], indent=2, ensure_ascii=False))

    ph = report.get("placeholder_hits") or []
    print("\n--- Placeholder check ---")
    if ph:
        print("FAIL: built-in placeholder copy detected:")
        for line in ph:
            print(" ", line)
    else:
        print("PASS: no exact _customer_facing_fallbacks strings.")
    if report.get("enhancer_used_default_narrative"):
        print("WARN: information enhancer used default internal-brief narrative.")

    print("\nSMOKE_OK" if report.get("ok") else "SMOKE_ISSUES")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full report JSON only (for CI/logs).",
    )
    parser.add_argument(
        "--allow-placeholders",
        action="store_true",
        help="Exit 0 even when placeholder copy or default enhancer narrative is detected.",
    )
    parser.add_argument("--skip-kb", action="store_true", help="Skip knowledge retrieve.")
    parser.add_argument("--user-request", default=DEFAULT_USER_REQUEST)
    parser.add_argument("--chat-summary", default=DEFAULT_CHAT_SUMMARY)
    args = parser.parse_args()

    report = asyncio.run(
        run_smoke(
            campaign=dict(DEFAULT_CAMPAIGN),
            audience=dict(DEFAULT_AUDIENCE),
            user_request=str(args.user_request or "").strip(),
            chat_summary=str(args.chat_summary or "").strip(),
            skip_kb=bool(args.skip_kb),
        )
    )

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_human(report)

    if report.get("ok") or args.allow_placeholders:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
