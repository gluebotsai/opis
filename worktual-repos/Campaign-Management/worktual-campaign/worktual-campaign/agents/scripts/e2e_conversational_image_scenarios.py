#!/usr/bin/env python3
"""E2E: conversational create-campaign flow (MAS/socket path) — email + hero image + launch.

Uses natural-language turns via run_create_campaign_turn_via_mas_or_legacy (same as FE),
then verifies agents session, backend template fields, and launch outcome.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

import jwt

_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings
from app.request_context import set_request_token
from app.session_store import get_or_create_session, load_session, save_session


SCENARIOS: dict[str, dict[str, Any]] = {
    "product_launch": {
        "name": "Premium Product Collection Launch",
        "goal": "Announce the new premium product collection and drive discovery",
        "objective": "Warm discovery tone with a clear shop-now CTA",
        "openers": [
            (
                "Create an email campaign named \"Premium Product Collection Launch\". "
                "Goal: announce the new premium product collection and drive discovery. "
                "Objective: warm discovery tone with a clear shop-now CTA. "
                "Recipient: aravindhselvaraj6235@gmail.com. "
                "Email channel only — include an AI hero banner on the template."
            ),
            "Yes, email only. I confirm — proceed with setup and create the templates with a hero image.",
            "Yes — build the email templates now and attach the AI hero banner.",
            "Launch now and send the email.",
        ],
    },
    "webinar": {
        "name": "Leadership Strategy Webinar",
        "goal": "Invite executives to a leadership strategy webinar",
        "objective": "Professional credible tone with register-now CTA",
        "openers": [
            (
                "Create an email campaign named \"Leadership Strategy Webinar\". "
                "Goal: invite executives to a leadership strategy webinar. "
                "Objective: professional credible tone with register-now CTA. "
                "Send to aravindhselvaraj6235@gmail.com. Email only with an AI hero image."
            ),
            (
                "Email channel only. Yes I confirm — save name Leadership Strategy Webinar, "
                "goal invite executives to the webinar, objective register-now CTA, then "
                "create templates with hero image."
            ),
            "Yes — create the email templates with the hero banner image now.",
            "Confirm launch — send it now.",
        ],
    },
    "seasonal_promo": {
        "name": "Seasonal Sale Campaign",
        "goal": "Drive urgency for a limited-time seasonal sale",
        "objective": "Bold promotional framing with shop-now urgency",
        "openers": [
            (
                "Create an email campaign named \"Seasonal Sale Campaign\". "
                "Goal: drive urgency for a limited-time seasonal sale. "
                "Objective: bold promotional framing with shop-now urgency. "
                "Recipient aravindhselvaraj6235@gmail.com. Email only with AI sale banner hero."
            ),
            "Email only. Yes, go ahead.",
            "Create the email templates with the promotional hero image now.",
            "Launch the campaign now and send the email.",
        ],
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


def _tool_names_from_session(session: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for entry in session.get("llm_memory") or []:
        if not isinstance(entry, dict):
            continue
        for tc in entry.get("tool_calls") or []:
            if not isinstance(tc, dict):
                continue
            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
            n = str(fn.get("name") or tc.get("name") or "").strip()
            if n:
                names.append(n)
    return names


def _email_template_id(session: dict[str, Any]) -> str:
    by_ch = session.get("template_ids_by_channel")
    if isinstance(by_ch, dict):
        tid = str(by_ch.get("email") or "").strip()
        if tid:
            return tid
    tid = str(session.get("template_id") or "").strip()
    if tid:
        return tid
    for row in session.get("templates") or []:
        if isinstance(row, dict) and str(row.get("channel") or "").lower() == "email":
            return str(row.get("template_id") or "").strip()
    return ""


def _audience_count(session: dict[str, Any]) -> int:
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    return int(aud.get("matched_count") or 0)


def _campaign_id(session: dict[str, Any]) -> str:
    if str(session.get("campaign_id") or "").strip():
        return str(session.get("campaign_id") or "").strip()
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    return str(camp.get("id") or camp.get("campaign_id") or "").strip()


def _is_launched(session: dict[str, Any]) -> bool:
    stage = str(session.get("stage") or "").lower()
    if stage in {"live", "scheduled", "launched", "completed"}:
        return True
    if bool(session.get("launch_confirmed")) and _campaign_id(session):
        return True
    return False


def _session_email_header(session: dict[str, Any]) -> str:
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("channel") or "").lower() != "email":
            continue
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        return str(fields.get("header_image") or fields.get("image_url") or "").strip()
    return ""


def _mas_executor_steps(session: dict[str, Any]) -> list[str]:
    task = session.get("mas_task") if isinstance(session.get("mas_task"), dict) else {}
    steps = task.get("steps") if isinstance(task.get("steps"), list) else []
    out: list[str] = []
    for row in steps:
        if isinstance(row, dict):
            eid = str(row.get("executor_id") or "").strip()
            if eid:
                out.append(eid)
    return out


def _pick_user_message(
    session: dict[str, Any],
    openers: list[str],
    turn: int,
    *,
    header_image: str = "",
    recipient_email: str = "",
) -> str | None:
    if _is_launched(session):
        return None

    tid = _email_template_id(session)
    if tid:
        header = header_image or _session_email_header(session)
        if not header.startswith("https://"):
            return (
                "Please plan and attach an AI hero banner image to the email template "
                "before we launch."
            )
        if _audience_count(session) <= 0 and recipient_email and turn >= 4:
            return (
                f"Use contact {recipient_email} as the audience and launch the email now."
            )
        return openers[3] if len(openers) > 3 else "Launch now and send the email."

    if turn >= 2:
        return openers[2] if len(openers) > 2 else "Yes create templates with hero image."
    if turn == 1:
        return openers[1] if len(openers) > 1 else "Email only, yes proceed."
    return openers[0]


async def _chat_turn(
    *,
    session_id: str,
    token: str,
    user_text: str,
    ui_events: list[dict[str, Any]],
    chat_backend: str,
) -> dict[str, Any]:
    async def on_event(ev: dict[str, Any]) -> None:
        ui_events.append(ev)

    if chat_backend == "legacy":
        from app.agents.create_campaign.agent import run_create_campaign_turn

        return await run_create_campaign_turn(
            session_id,
            token,
            user_text,
            event_callback=on_event,
        )

    from app.mas.socket_bridge import run_create_campaign_turn_via_mas_or_legacy

    return await run_create_campaign_turn_via_mas_or_legacy(
        session_id,
        token,
        user_text,
        event_callback=on_event,
    )


async def _verify_edit_space(
    *,
    session_id: str,
    token: str,
    template_id: str,
    channel: str = "email",
) -> dict[str, Any]:
    """Edit-space path: copy change + persist (same as template_edit_message core)."""
    from app.agents.template_library.creation_agent import edit_with_channel_agent
    from app.agents.template_library.edit_postprocess import finalize_edit_result
    from app.template_store import get_template, update_template_fields

    detail = await get_template(template_id, token=token)
    match = detail.get("template") if isinstance(detail, dict) else None
    if not isinstance(match, dict):
        return {"ok": False, "error": "template_not_found"}
    current_fields = dict(match.get("fields") or {})
    session = await get_or_create_session(session_id, token=token, module="create_campaign")
    instruction = "Change the email subject to start with EDITED: and keep the rest of the copy."
    raw = await edit_with_channel_agent(
        channel=channel,
        current_fields=current_fields,
        instruction=instruction,
        campaign=session.get("campaign") if isinstance(session.get("campaign"), dict) else {},
        recent_messages=list(detail.get("messages") or []),
    )
    final = finalize_edit_result(
        instruction=instruction,
        channel=channel,
        current_fields=current_fields,
        result=raw,
    )
    display_fields = final.get("display_fields")
    if final.get("persist_fields") and isinstance(display_fields, dict):
        saved = await update_template_fields(template_id, display_fields, token=token)
        tpl = saved.get("template") if isinstance(saved, dict) else {}
        if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
            display_fields = tpl["fields"]
    subject = str((display_fields or {}).get("subject") or "").strip()
    ok = subject.upper().startswith("EDITED:")
    print(f"  edit_space subject={subject[:70] or 'MISSING'} ok={ok}")
    return {"ok": ok, "subject": subject, "intent": final.get("intent")}


async def run_scenario(
    *,
    scenario_key: str,
    email: str,
    user_id: str,
    token: str,
    max_turns: int,
    chat_backend: str,
) -> dict[str, Any]:
    from app.template_store import get_template

    spec = SCENARIOS[scenario_key]
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    sid = str(uuid.uuid4())
    openers = list(spec["openers"])

    print(f"\n{'=' * 72}")
    print(f"SCENARIO: {scenario_key} | session={sid}")
    print(f"{'=' * 72}")

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    await save_session(session, token=token)

    ui_events: list[dict[str, Any]] = []
    turns_log: list[dict[str, Any]] = []
    edit_checked = False

    for turn in range(max_turns):
        session = await get_or_create_session(sid, token=token, module="create_campaign")
        if turn >= 1:
            session["confirmed_create_templates"] = True
            if session.get("channels") or (session.get("campaign") or {}).get("name"):
                session["strategy_accepted"] = True
            await save_session(session, token=token)

        user_msg = _pick_user_message(session, openers, turn)
        if not user_msg:
            print(f"  turn {turn + 1}: done (campaign launched)")
            break

        tid_pre = _email_template_id(session)
        header_pre = ""
        if tid_pre:
            tpl_resp = await get_template(tid_pre, token=token)
            tpl = tpl_resp.get("template") if isinstance(tpl_resp, dict) else {}
            if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
                fields_pre = tpl["fields"]
                header_pre = str(
                    fields_pre.get("header_image") or fields_pre.get("image_url") or ""
                ).strip()
            user_msg = _pick_user_message(
                session, openers, turn, header_image=header_pre, recipient_email=email
            )
            if not user_msg:
                print(f"  turn {turn + 1}: done (campaign launched)")
                break

        print(f"\n  USER [{turn + 1}]: {user_msg[:120]}{'…' if len(user_msg) > 120 else ''}")
        try:
            result = await _chat_turn(
                session_id=sid,
                token=token,
                user_text=user_msg,
                ui_events=ui_events,
                chat_backend=chat_backend,
            )
        except Exception as exc:  # noqa: BLE001
            turns_log.append({"turn": turn + 1, "error": str(exc)})
            print(f"  ERROR turn {turn + 1}: {exc}")
            break

        reply = str(result.get("reply") or "")[:200]
        mas = bool(result.get("mas"))
        print(f"  ASSISTANT: {reply}{'…' if len(str(result.get('reply') or '')) > 200 else ''}")
        print(f"  mas_path={mas} ui_events_this_turn={len(result.get('ui_events') or [])}")

        session = await get_or_create_session(sid, token=token, module="create_campaign")
        if turn == 1:
            reloaded = await load_session(sid, token=token)
            msg_count = len((reloaded or {}).get("messages") or [])
            print(f"  draft_reopen_check messages={msg_count}")
            turns_log.append({"draft_reopen_after_turn2": msg_count})
        tools_so_far = _tool_names_from_session(session)
        turns_log.append(
            {
                "turn": turn + 1,
                "user": user_msg,
                "reply_preview": reply,
                "tools_so_far": tools_so_far[-8:],
                "stage": session.get("stage"),
                "template_count": len(session.get("templates") or []),
            }
        )

        if _is_launched(session):
            break

        tid_now = _email_template_id(session)
        if tid_now and not edit_checked and not _is_launched(session):
            edit_checked = True
            edit_result = await _verify_edit_space(
                session_id=sid, token=token, template_id=tid_now
            )
            turns_log.append({"edit_space": edit_result})

    session = await get_or_create_session(sid, token=token, module="create_campaign")
    all_tools = _tool_names_from_session(session)
    mas_steps = _mas_executor_steps(session)

    tid = _email_template_id(session)
    fields: dict[str, Any] = {}
    if tid:
        tpl_resp = await get_template(tid, token=token)
        tpl = tpl_resp.get("template") if isinstance(tpl_resp, dict) else {}
        if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
            fields = tpl["fields"]

    sections = fields.get("sections") if isinstance(fields.get("sections"), list) else []
    section_types = [
        str(r.get("type") or "").strip().lower()
        for r in sections
        if isinstance(r, dict) and str(r.get("type") or "").strip()
    ]
    header = str(fields.get("header_image") or fields.get("image_url") or "").strip()
    subject = str(fields.get("subject") or "").strip()
    pattern_id = str(fields.get("pattern_id") or "").strip()
    report = (
        session.get("template_generation_report")
        if isinstance(session.get("template_generation_report"), dict)
        else {}
    )
    image_plan = session.get("campaign_image_plan") if isinstance(session.get("campaign_image_plan"), dict) else {}

    ui_types = [str(e.get("type") or e.get("payload", {}).get("type") or "") for e in ui_events]

    launch_ok = _is_launched(session)
    if str(session.get("stage") or "").lower() == "live" and _campaign_id(session):
        launch_ok = True

    edit_ok = False
    for row in turns_log:
        if isinstance(row, dict) and "edit_space" in row:
            edit_ok = bool((row.get("edit_space") or {}).get("ok"))
            break

    ok = bool(
        tid
        and subject
        and len(section_types) >= 3
        and header.startswith("https://")
        and launch_ok
        and edit_ok
    )

    print(f"\n  --- 360 CHECK ---")
    print(f"  tools_called={list(dict.fromkeys(all_tools))}")
    print(f"  mas_executors={mas_steps or '—'}")
    print(f"  template_id={tid or 'MISSING'}")
    print(f"  pattern_id={pattern_id or 'MISSING'}")
    print(f"  sections={section_types or 'MISSING'}")
    print(f"  subject={subject[:80] or 'MISSING'}")
    print(f"  header_image={'yes' if header else 'MISSING'}")
    print(f"  director_layers={list((report.get('layers') or {}).keys())}")
    print(f"  image_plan_mode={image_plan.get('mode') or '—'}")
    print(f"  ui_event_types={list(dict.fromkeys(t for t in ui_types if t))[:12]}")
    print(f"  campaign_id={_campaign_id(session) or 'MISSING'}")
    print(f"  launch_ok={launch_ok}")
    print(f"  edit_ok={edit_ok}")

    return {
        "ok": ok,
        "scenario": scenario_key,
        "session_id": sid,
        "template_id": tid,
        "pattern_id": pattern_id,
        "section_types": section_types,
        "subject": subject,
        "header_image": header[:120],
        "campaign_id": _campaign_id(session),
        "launch_ok": launch_ok,
        "edit_ok": edit_ok,
        "tools_called": list(dict.fromkeys(all_tools)),
        "mas_executors": mas_steps,
        "chat_backend": chat_backend,
        "ui_event_types": list(dict.fromkeys(t for t in ui_types if t)),
        "director_layers": list((report.get("layers") or {}).keys()),
        "turns": turns_log,
    }


async def run(
    *,
    email: str,
    user_id: str,
    explicit_token: str | None,
    scenarios: list[str],
    max_turns: int,
    chat_backend: str,
) -> int:
    token = await _auth_token(user_id, explicit_token)
    set_request_token(token)
    settings = get_settings()

    print(f"Contact: {email} | User: {user_id}")
    print(f"Scenarios: {', '.join(scenarios)}")
    print(f"Chat backend: {chat_backend}")
    print(f"Template director: {settings.template_director_enabled}")
    print(f"Org fingerprints: {settings.template_org_fingerprints_enabled}")
    print(f"Gemini configured: {bool(str(settings.gemini_api_key or '').strip())}")

    results: list[dict] = []
    for key in scenarios:
        if key not in SCENARIOS:
            print(f"Unknown scenario: {key}")
            return 1
        results.append(
            await run_scenario(
                scenario_key=key,
                email=email,
                user_id=user_id,
                token=token,
                max_turns=max_turns,
                chat_backend=chat_backend,
            )
        )

    print(f"\n{'=' * 72}")
    print("SUMMARY")
    print(f"{'=' * 72}")
    for r in results:
        print(
            f"  {r.get('scenario')}: ok={r.get('ok')} "
            f"pattern={r.get('pattern_id')} image={'yes' if r.get('header_image') else 'no'} "
            f"launch={r.get('launch_ok')} campaign={r.get('campaign_id') or '—'}"
        )
        print(f"    tools: {r.get('tools_called')}")

    report_path = _ROOT / "scripts" / "last_convo_image_e2e_report.json"
    report_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nFull trace: {report_path}")

    if all(r.get("ok") for r in results):
        print("PASS: conversational image scenarios built and launched.")
        return 0
    print("FAIL: one or more scenarios missing template sections, hero image, or launch.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Conversational image scenario E2E")
    parser.add_argument("--email", default="aravindhselvaraj6235@gmail.com")
    parser.add_argument("--user-id", default="1027")
    parser.add_argument("--token", default="")
    parser.add_argument(
        "--scenarios",
        default="product_launch,webinar,seasonal_promo",
        help="Comma-separated scenario keys",
    )
    parser.add_argument("--max-turns", type=int, default=10, help="Max chat turns per scenario")
    parser.add_argument(
        "--chat-backend",
        choices=("legacy", "mas"),
        default="mas",
        help="legacy=coordinator tool loop (reliable); mas=full MAS Super→Domain path",
    )
    args = parser.parse_args()
    keys = [k.strip() for k in args.scenarios.split(",") if k.strip()]
    return asyncio.run(
        run(
            email=args.email.strip(),
            user_id=args.user_id.strip(),
            explicit_token=args.token.strip() or None,
            scenarios=keys,
            max_turns=max(4, int(args.max_turns)),
            chat_backend=str(args.chat_backend).strip().lower(),
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
