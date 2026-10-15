#!/usr/bin/env python3
"""E2E: Template Director — email-only campaigns with different scenarios, same contact."""

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


SCENARIOS = {
    "professional": {
        "name_prefix": "Director E2E Professional",
        "goal": "Invite executives to a leadership strategy webinar",
        "objective": (
            "Position the session as a credible, practical briefing on operational "
            "excellence — professional tone, no hype, clear registration CTA"
        ),
    },
    "festival": {
        "name_prefix": "Director E2E Festival Offer",
        "goal": "Promote a seasonal festival collection launch",
        "objective": (
            "Celebrate the festive season with a warm, vibrant invitation to explore "
            "limited-edition products — emotional hook and discovery CTA"
        ),
    },
    "discount": {
        "name_prefix": "Director E2E Discount Sale",
        "goal": "Drive conversions for a limited-time discount event",
        "objective": (
            "Clear promotional message with offer hierarchy and urgency only from "
            "verified facts — bold sale framing and shop-now CTA"
        ),
    },
}


def _token(user_id: str) -> str:
    return jwt.encode({"sub": user_id}, get_settings().jwt_secret, algorithm="HS256")


async def _auth_token(user_id: str, explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    env_tok = __import__("os").environ.get("CAMPAIGN_AUTH_TOKEN", "").strip()
    if env_tok:
        return env_tok
    return _token(user_id)


def _section_types(fields: dict) -> list[str]:
    sections = fields.get("sections") if isinstance(fields.get("sections"), list) else []
    return [
        str(row.get("type") or "").strip().lower()
        for row in sections
        if isinstance(row, dict) and str(row.get("type") or "").strip()
    ]


async def run_scenario(
    *,
    scenario_key: str,
    email: str,
    first_name: str,
    user_id: str,
    token: str,
    launch_email: bool = False,
) -> dict:
    from app.agents.create_campaign.tool_functions import dispatch_core_tool
    from app.template_store import get_template

    spec = SCENARIOS[scenario_key]
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    sid = f"e2e-tdir-{scenario_key}-{uuid.uuid4().hex[:8]}"
    print(f"\n========== SCENARIO: {scenario_key} session={sid} ==========")

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    await save_session(session, token=token)

    setup = await dispatch_core_tool(
        "update_campaign_setup",
        sid,
        token,
        {
            "name": f"{spec['name_prefix']} {stamp}",
            "goal": spec["goal"],
            "objective": spec["objective"],
            "channels": ["email"],
            "strategy_accepted": True,
            "change_summary": f"E2E template director — {scenario_key}",
        },
    )
    print(f"  setup ok={setup.get('ok')}")
    if setup.get("ok") is False:
        return {"ok": False, "scenario": scenario_key, "error": setup.get("error")}

    lookup = await dispatch_core_tool(
        "check_contacts",
        sid,
        token,
        {"emails": [email], "change_summary": "E2E audience"},
    )
    audience_count = int(lookup.get("matched_count") or 0)
    if audience_count <= 0:
        temp = await dispatch_core_tool(
            "upload_temporary_contacts",
            sid,
            token,
            {"rows": [{"first_name": first_name, "email": email}], "change_summary": "E2E temp"},
        )
        print(f"  temp audience ok={temp.get('ok')}")
        session = await get_or_create_session(sid, token=token, module="create_campaign")
        audience_count = int((session.get("audience") or {}).get("matched_count") or 0)
    if audience_count <= 0:
        return {"ok": False, "scenario": scenario_key, "error": "No audience"}

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
            "channels": ["email"],
            "change_summary": f"E2E build email template ({scenario_key})",
        },
    )
    print(f"  build ok={build.get('ok')}")
    if build.get("ok") is False:
        return {"ok": False, "scenario": scenario_key, "error": build.get("error")}

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    report = session.get("template_generation_report") if isinstance(session.get("template_generation_report"), dict) else {}
    design_plans = session.get("template_design_plans") if isinstance(session.get("template_design_plans"), list) else []
    tid = str(session.get("template_id") or "").strip()
    if not tid:
        for row in session.get("templates") or []:
            if isinstance(row, dict) and str(row.get("channel") or "").lower() == "email":
                tid = str(row.get("template_id") or "").strip()
                break

    fields: dict = {}
    if tid:
        tpl_resp = await get_template(tid, token=token)
        tpl = tpl_resp.get("template") if isinstance(tpl_resp, dict) else {}
        if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
            fields = tpl["fields"]

    pattern_id = str(fields.get("pattern_id") or "").strip()
    theme_id = str(fields.get("theme_id") or "").strip()
    section_types = _section_types(fields)
    fingerprint = fields.get("creative_fingerprint") if isinstance(fields.get("creative_fingerprint"), dict) else {}
    has_sections = len(section_types) >= 3
    subject = str(fields.get("subject") or "").strip()

    print(f"  template_id={tid or 'MISSING'}")
    print(f"  pattern_id={pattern_id or 'MISSING'}")
    print(f"  theme_id={theme_id or 'MISSING'}")
    print(f"  sections={section_types or 'MISSING'}")
    print(f"  subject={subject[:80] or 'MISSING'}")
    print(f"  director_layers={list((report.get('layers') or {}).keys())}")
    print(f"  design_plans_count={len(design_plans)}")
    print(f"  fingerprint={fingerprint.get('pattern_id') or fingerprint}")

    ok = bool(tid and subject and has_sections and pattern_id)
    launch_ok = None
    campaign_id = ""
    if ok and launch_email:
        launch = await dispatch_core_tool(
            "launch_campaign",
            sid,
            token,
            {
                "confirmed": True,
                "schedule_mode": "now",
                "launch_channels": ["email"],
                "change_summary": f"E2E launch email ({scenario_key})",
            },
        )
        launch_ok = bool(launch.get("ok"))
        print(f"  launch ok={launch_ok}")
        if not launch_ok:
            err = launch.get("error") or launch.get("message") or ""
            print(f"  launch error={str(err)[:300]}")
        session = await get_or_create_session(sid, token=token, module="create_campaign")
        camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
        campaign_id = str(
            camp.get("id") or camp.get("campaign_id") or launch.get("campaign_id") or ""
        ).strip()
        if campaign_id:
            print(f"  campaign_id={campaign_id}")
        ok = ok and launch_ok

    return {
        "ok": ok,
        "scenario": scenario_key,
        "session_id": sid,
        "template_id": tid,
        "pattern_id": pattern_id,
        "theme_id": theme_id,
        "section_types": section_types,
        "fingerprint": fingerprint,
        "report": report,
        "launch_ok": launch_ok,
        "campaign_id": campaign_id,
    }


def _org_fingerprints_note() -> None:
    if get_settings().template_org_fingerprints_enabled:
        print("Org fingerprints: enabled (requires /channel-templates/recent)")
    else:
        print("Org fingerprints: skipped (session-only prior templates)")


async def run(
    *,
    email: str,
    first_name: str,
    user_id: str,
    explicit_token: str | None,
    scenarios: list[str],
    launch_email: bool = False,
) -> int:
    token = await _auth_token(user_id, explicit_token)
    set_request_token(token)
    print(f"Contact: {email} | User: {user_id}")
    print(f"Scenarios: {', '.join(scenarios)}")
    print(f"Launch email: {launch_email}")
    _org_fingerprints_note()

    results: list[dict] = []
    for key in scenarios:
        if key not in SCENARIOS:
            print(f"Unknown scenario: {key}")
            return 1
        results.append(
            await run_scenario(
                scenario_key=key,
                email=email,
                first_name=first_name,
                user_id=user_id,
                token=token,
                launch_email=launch_email,
            )
        )

    patterns = [str(r.get("pattern_id") or "") for r in results if r.get("pattern_id")]
    unique_patterns = len(set(p for p in patterns if p))
    print("\n=== SUMMARY ===")
    for r in results:
        launch_note = ""
        if r.get("launch_ok") is not None:
            launch_note = f" launch={r.get('launch_ok')} campaign={r.get('campaign_id') or '—'}"
        print(
            f"  {r.get('scenario')}: ok={r.get('ok')} pattern={r.get('pattern_id')} "
            f"sections={r.get('section_types')}{launch_note}"
        )
    print(f"  unique_patterns={unique_patterns}/{len(patterns)}")

    all_ok = all(r.get("ok") for r in results)
    variety_ok = unique_patterns >= min(2, len(patterns)) if len(patterns) >= 2 else True
    if not all_ok:
        if launch_email:
            print("FAIL: one or more scenarios failed template build or email launch.")
        else:
            print("FAIL: one or more scenarios did not produce valid section-based email.")
        return 1
    if not variety_ok:
        print("WARN: scenarios produced identical pattern_id — fingerprint rotation may need more history.")
    if launch_email:
        print("PASS: template director email scenarios built and launched.")
    else:
        print("PASS: template director email scenarios completed (build only — use --launch-email to send).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="E2E template director email scenarios")
    parser.add_argument("--email", default="aravindhselvaraj6235@gmail.com")
    parser.add_argument("--first-name", default="Aravindh")
    parser.add_argument("--user-id", default="1027")
    parser.add_argument("--token", default="")
    parser.add_argument(
        "--scenarios",
        default="professional,festival,discount",
        help="Comma-separated: professional,festival,discount",
    )
    parser.add_argument(
        "--launch-email",
        action="store_true",
        help="Launch each scenario campaign to the contact after template build",
    )
    args = parser.parse_args()
    keys = [k.strip() for k in args.scenarios.split(",") if k.strip()]
    return asyncio.run(
        run(
            email=args.email.strip(),
            first_name=args.first_name.strip(),
            user_id=args.user_id.strip(),
            explicit_token=args.token.strip() or None,
            scenarios=keys,
            launch_email=bool(args.launch_email),
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
