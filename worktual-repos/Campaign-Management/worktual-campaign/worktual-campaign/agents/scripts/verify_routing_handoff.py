#!/usr/bin/env python3
"""Spot-check routing/handoff behavior (manual verification checklist)."""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import jwt

from app.request_context import set_request_token

JWT_SECRET = "change-me-in-production-campaign"
USER_ID = "verify-routing-user"


def _token() -> str:
    return jwt.encode({"sub": USER_ID}, JWT_SECRET, algorithm="HS256")


def _has_navigate(ui_events: list) -> bool:
    return any(
        isinstance(e, dict) and e.get("type") == "navigate" for e in (ui_events or [])
    )


def _nav_module(ui_events: list) -> str:
    for e in ui_events or []:
        if isinstance(e, dict) and e.get("type") == "navigate":
            payload = e.get("payload") or {}
            return str(payload.get("module") or "")
    return ""


async def _run(module_fn, module: str, user_text: str, session_id: str | None = None):
    token = _token()
    set_request_token(token)
    sid = session_id or f"verify-{module}-{uuid.uuid4().hex[:8]}"
    return await module_fn(
        session_id=sid,
        token=token,
        user_text=user_text,
    )


# --- MAS offline checks (WP5 final gate) ---


async def test_mas_native_flags_default_on() -> tuple[bool, str]:
    from app.mas.runtime.flags import (
        is_audience_native_enabled,
        is_content_native_enabled,
        is_create_campaign_native_enabled,
        is_forms_native_enabled,
        is_optimization_native_enabled,
    )

    flags = {
        "audience": is_audience_native_enabled(),
        "create_campaign": is_create_campaign_native_enabled(),
        "optimization": is_optimization_native_enabled(),
        "content": is_content_native_enabled(),
        "forms": is_forms_native_enabled(),
    }
    ok = all(flags.values())
    return ok, f"flags={flags}"


async def test_mas_hub_binding_runs_super() -> tuple[bool, str]:
    """Hub bindings resolve in Super without LLM drift (Super orchestrates)."""
    session: dict = {"session_id": "verify-hub", "module": "contacts"}

    with patch(
        "app.mas.super_agent.runner._llm_choose_domain",
        new_callable=AsyncMock,
    ) as mock_llm, patch(
        "app.mas.domains.audience.runner.get_executor_runner",
    ) as mock_get:
        mock_get.return_value = AsyncMock(
            return_value={
                "ok": True,
                "action_status": "completed",
                "executor_id": "contact",
                "mas_native_audience": True,
            }
        )
        from app.mas.runtime.invoke import mas_invoke

        out = await mas_invoke(
            {
                "entry": "hub",
                "skip_super": False,
                "hub_skill": "create_contact",
                "query": "create contact",
                "session": session,
                "session_id": "verify-hub",
                "token": _token(),
                "task_spec": {"query": "create contact", "hub_skill": "create_contact"},
            }
        )
    route = out.get("route_meta") or {}
    ok = (
        bool(out.get("ok"))
        and route.get("source") == "hub_binding"
        and mock_llm.await_count == 0
        and out.get("domain_id") == "audience"
    )
    return ok, f"source={route.get('source')!r} domain={out.get('domain_id')!r} llm_calls={mock_llm.await_count}"


async def test_mas_forms_socket_bridge() -> tuple[bool, str]:
    from app.mas.socket_bridge import run_forms_turn_via_mas_or_legacy

    with patch(
        "app.mas.socket_bridge.mas_invoke",
        new_callable=AsyncMock,
    ) as mock_invoke:
        mock_invoke.return_value = {
            "ok": True,
            "domain_id": "forms",
            "reply": "Updated theme.",
            "domain_result": {
                "ok": True,
                "executor_id": "form_theme",
                "reply": "Updated theme.",
                "mas_native_forms": True,
            },
        }
        result = await _run(
            lambda **kw: run_forms_turn_via_mas_or_legacy(
                kw["session_id"], kw["token"], kw["user_text"]
            ),
            "forms",
            "make buttons green",
        )
    ok = result.get("mas") is True and (result.get("mas_out") or {}).get("domain_id") == "forms"
    return ok, f"mas={result.get('mas')} domain={(result.get('mas_out') or {}).get('domain_id')!r}"


async def test_mas_whatsapp_approved_socket_bridge() -> tuple[bool, str]:
    from app.mas.socket_bridge import run_whatsapp_approved_turn_via_mas_or_legacy

    with patch(
        "app.mas.socket_bridge.mas_invoke",
        new_callable=AsyncMock,
    ) as mock_invoke:
        mock_invoke.return_value = {
            "ok": True,
            "domain_id": "content",
            "reply": "Who should receive it?",
            "domain_result": {
                "ok": True,
                "executor_id": "whatsapp_approved_send",
                "reply": "Who should receive it?",
                "mas_native_content": True,
            },
        }
        result = await _run(
            lambda **kw: run_whatsapp_approved_turn_via_mas_or_legacy(
                kw["session_id"], kw["token"], kw["user_text"]
            ),
            "whatsapp_approved",
            "send to Priya",
        )
    ok = result.get("mas") is True
    dr = (result.get("mas_out") or {}).get("domain_result") or {}
    return ok, f"mas={result.get('mas')} native={dr.get('mas_native_content')}"


async def test_mas_monitoring_module_hint_skips_domain_llm() -> tuple[bool, str]:
    session: dict = {"session_id": "verify-mon", "module": "monitoring"}

    with patch(
        "app.mas.domains.optimization.runner.get_executor_runner",
    ) as mock_get, patch(
        "app.mas.domains.optimization.runner.llm_pick_optimization_executor",
        new_callable=AsyncMock,
    ) as mock_domain:
        mock_runner = AsyncMock(
            return_value={
                "ok": True,
                "executor_id": "monitoring",
                "mas_native_optimization": True,
            }
        )
        mock_get.return_value = mock_runner
        from app.mas.domains.optimization.runner import run_optimization_domain

        out = await run_optimization_domain(
            {
                "session": session,
                "entry": "interactive",
                "query": "list live campaigns",
                "module_hint": "monitoring",
                "task_spec": {"query": "list live campaigns", "module": "monitoring"},
                "token": _token(),
                "session_id": "verify-mon",
            }
        )
    ok = out.get("executor_id") == "monitoring" and mock_domain.await_count == 0
    return ok, f"executor={out.get('executor_id')!r} domain_llm_calls={mock_domain.await_count}"


async def test_mas_content_whatsapp_rejected_forced() -> tuple[bool, str]:
    session: dict = {"session_id": "verify-wr", "module": "whatsapp_rejected"}

    with patch(
        "app.mas.domains.content.runner.get_executor_runner",
    ) as mock_get:
        mock_runner = AsyncMock(
            return_value={
                "ok": True,
                "executor_id": "content_verification",
                "mas_native_content": True,
            }
        )
        mock_get.return_value = mock_runner
        from app.mas.domains.content.runner import run_content_domain

        out = await run_content_domain(
            {
                "session": session,
                "entry": "interactive",
                "query": "fix body copy",
                "module_hint": "whatsapp_rejected",
                "task_spec": {"query": "fix body copy", "module": "whatsapp_rejected"},
                "token": _token(),
                "session_id": "verify-wr",
            }
        )
    ok = out.get("executor_id") == "content_verification"
    return ok, f"executor={out.get('executor_id')!r}"


async def test_mas_cron_skips_super() -> tuple[bool, str]:
    session: dict = {"session_id": "verify-cron", "module": "content"}

    with patch(
        "app.mas.super_agent.runner.run_super",
        new_callable=AsyncMock,
    ) as mock_super, patch(
        "app.mas.executors.registry.get_executor_runner",
    ) as mock_get:
        mock_runner = AsyncMock(
            return_value={
                "ok": True,
                "action_status": "completed",
                "message": "stub",
            }
        )
        mock_get.return_value = mock_runner
        from app.mas.runtime.invoke import mas_invoke

        out = await mas_invoke(
            {
                "entry": "cron",
                "cron_event": "template_compliance_scan",
                "session": session,
                "session_id": "verify-cron",
                "token": _token(),
                "task_spec": {},
            }
        )
    ok = bool(out.get("ok")) and mock_super.await_count == 0
    return ok, f"super_calls={mock_super.await_count} ok={out.get('ok')}"


MAS_TESTS = [
    ("M1 Native flags default on", test_mas_native_flags_default_on),
    ("M2 Hub binding uses Super hub_binding path", test_mas_hub_binding_runs_super),
    ("M3 Forms socket MAS bridge", test_mas_forms_socket_bridge),
    ("M4 WhatsApp approved socket MAS bridge", test_mas_whatsapp_approved_socket_bridge),
    ("M5 Monitoring module_hint → monitoring executor", test_mas_monitoring_module_hint_skips_domain_llm),
    ("M6 WhatsApp rejected → content_verification", test_mas_content_whatsapp_rejected_forced),
    ("M7 Cron skips Super", test_mas_cron_skips_super),
]


# --- Legacy routing / handoff checks ---


async def test_dashboard_create_clarifies() -> tuple[bool, str]:
    from app.agents.reports.graph import run_coordinator

    result = await _run(run_coordinator, "reports", "create")
    reply = str(result.get("reply") or "").strip()
    nav = _has_navigate(result.get("ui_events") or [])
    ok = not nav and len(reply) > 5
    if ok and not any(w in reply.lower() for w in ("create", "campaign", "form", "contact", "?")):
        ok = False
    return ok, f"navigate={nav} reply={reply[:240]!r}"


async def test_dashboard_create_campaign_routes() -> tuple[bool, str]:
    from app.agents.reports.graph import run_coordinator

    for phrase in ("create a campaign", "create a campaign for Diwali"):
        result = await _run(run_coordinator, "reports", phrase)
        ui = result.get("ui_events") or []
        mod = _nav_module(ui)
        if _has_navigate(ui) and mod == "create_campaign":
            reply = str(result.get("reply") or "").strip()
            return True, f"phrase={phrase!r} module={mod!r} reply={reply[:200]!r}"
    return False, "neither bare nor Diwali phrase routed to create_campaign"


async def test_create_webpush_routes_to_channels_not_audience() -> tuple[bool, str]:
    """Tool-arg channel ids normalize; chat intent is LLM-only (no text parse)."""
    from app.agents.create_campaign.channels import normalize_channels

    channels = normalize_channels(["webpush", "email"])
    ok = channels == ["web", "email"]
    return ok, f"channels={channels}"



async def test_create_for_aravindh_audience_tool() -> tuple[bool, str]:
    """Named person turns should use select_audience via coordinator (LLM)."""
    from app.agents.create_campaign.graph import run_coordinator

    token = _token()
    set_request_token(token)
    sid = f"verify-create-{uuid.uuid4().hex[:8]}"
    result = await run_coordinator(session_id=sid, token=token, user_text="for Aravindh")
    reply = str(result.get("reply") or "").strip()
    ui = result.get("ui_events") or []
    ok = (
        len(reply) > 8
        and not _has_navigate(ui)
        and ("aravindh" in reply.lower() or "audience" in reply.lower() or "contact" in reply.lower())
    )
    return ok, f"reply={reply[:240]!r}"


async def test_contacts_add_contact() -> tuple[bool, str]:
    from app.mas.socket_bridge import run_contacts_turn_via_mas_or_legacy

    result = await _run(run_contacts_turn_via_mas_or_legacy, "contacts", "add a contact")
    ui = result.get("ui_events") or []
    reply = str(result.get("reply") or "").strip()
    mas = result.get("mas") is True
    draft_events = [
        e
        for e in ui
        if isinstance(e, dict)
        and e.get("type") == "draft_updated"
        and str((e.get("payload") or {}).get("mode") or "").lower() == "create"
    ]
    ok = mas and (
        bool(draft_events)
        or any(w in reply.lower() for w in ("first name", "name", "contact", "create", "email"))
    )
    return ok, f"mas={mas} draft_create_events={len(draft_events)} reply={reply[:240]!r}"


async def test_forms_handoff_no_canned_opener() -> tuple[bool, str]:
    """Seed path: create draft has no FE canned assistant template."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    fe_file = root / "frontend" / "src" / "lib" / "start-campaign-from-form.ts"
    editor = root / "frontend" / "src" / "components" / "campaigns" / "CreateEventEditorWorkspace.tsx"
    fe_text = fe_file.read_text(encoding="utf-8")
    editor_text = editor.read_text(encoding="utf-8")
    text = fe_text + editor_text
    banned = [
        "What's the campaign name?",
        "Your form",
        "is ready.",
        "I'll help you create a campaign",
        "Reply yes to continue",
    ]
    hits = [b for b in banned if b in text]
    ok = not hits and "messages: []," in fe_text
    return ok, f"banned_phrases={hits or 'none'}"


async def test_forms_confirmation_no_reply_yes() -> tuple[bool, str]:
    """Forms handoff confirmation must not use canned 'Reply yes' template."""
    from app.agents.forms.intake import queue_campaign_handoff

    session: dict = {
        "form_design": {
            "title": "Signup",
            "fields": [{"label": "Email"}],
            "public_url": "https://example.com/f/signup",
        }
    }
    result = queue_campaign_handoff(session, campaign_goal="Drive signups")
    msg = str(result.get("message") or "")
    ok = "Reply yes" not in msg and len(msg.strip()) > 10
    return ok, f"message={msg[:200]!r}"


async def test_monitoring_create_campaign_routes() -> tuple[bool, str]:
    from app.agents.monitoring.graph import run_coordinator

    for phrase in ("start a new campaign", "launch a campaign for summer sale"):
        result = await _run(run_coordinator, "monitoring", phrase)
        ui = result.get("ui_events") or []
        mod = _nav_module(ui)
        if _has_navigate(ui) and mod == "create_campaign":
            reply = str(result.get("reply") or "").strip()
            return True, f"phrase={phrase!r} module={mod!r} reply={reply[:200]!r}"
    return False, "monitoring paraphrases did not route to create_campaign"


async def test_events_report_create_form_routes() -> tuple[bool, str]:
    from app.agents.events_report.graph import run_coordinator

    for phrase in ("build a signup page", "I need a lead capture form"):
        result = await _run(run_coordinator, "events_report", phrase)
        ui = result.get("ui_events") or []
        mod = _nav_module(ui)
        payload = next(
            (e.get("payload") for e in ui if isinstance(e, dict) and e.get("type") == "navigate"),
            {},
        )
        create = bool((payload or {}).get("create"))
        if _has_navigate(ui) and mod == "forms" and create:
            reply = str(result.get("reply") or "").strip()
            return True, f"phrase={phrase!r} module={mod!r} create={create} reply={reply[:200]!r}"
    return False, "events_report paraphrases did not route to forms with create=true"


async def test_recommendations_create_campaign_routes() -> tuple[bool, str]:
    from app.agents.recommendations.graph import run_coordinator

    for phrase in ("help me launch a campaign", "I want to start a new campaign"):
        result = await _run(run_coordinator, "recommendations", phrase)
        ui = result.get("ui_events") or []
        mod = _nav_module(ui)
        if _has_navigate(ui) and mod == "create_campaign":
            reply = str(result.get("reply") or "").strip()
            return True, f"phrase={phrase!r} module={mod!r} reply={reply[:200]!r}"
    return False, "recommendations paraphrases did not route to create_campaign"


async def test_whatsapp_approved_llm_reply() -> tuple[bool, str]:
    """WhatsApp approved uses run_tool_loop — no regex preflight skip."""
    from app.agents.whatsapp_approved.graph import run_coordinator

    result = await _run(run_coordinator, "whatsapp_approved", "send to Priya")
    reply = str(result.get("reply") or "").strip()
    ok = len(reply) > 8
    return ok, f"reply={reply[:240]!r}"


async def test_fe_handoff_carry_query_wiring() -> tuple[bool, str]:
    """Static check: FE handoff writes carry_query via handoffJoinPayload."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    handoff = root / "frontend" / "src" / "lib" / "chat-handoff.ts"
    workspace = root / "frontend" / "src" / "components" / "campaigns" / "CreateCampaignChatWorkspace.tsx"
    text = handoff.read_text(encoding="utf-8") + workspace.read_text(encoding="utf-8")
    required = [
        "writeChatHandoff",
        "readChatHandoff",
        "handoffJoinPayload",
        "carry_query",
        "seedUserOnJoin",
    ]
    banned = ["kick_intake", "buildCreateSeed", "hubHandoff"]
    missing = [r for r in required if r not in text]
    hits = [b for b in banned if b in text]
    ok = not missing and not hits
    return ok, f"missing={missing or 'none'} banned={hits or 'none'}"


async def test_validate_campaign_details_session_guard() -> tuple[bool, str]:
    from app.agents.create_campaign.meta_helpers import validate_campaign_details

    session = {"audience": {"sample_names": ["Aravindh"]}, "messages": []}
    err = validate_campaign_details({"name": "Aravindh"}, "", session=session)
    ok = err is not None and "Aravindh" in err
    return ok, f"guard_err={err[:120] if err else None!r}"


LEGACY_TESTS = [
    ("1 Dashboard → create (clarify, no route)", test_dashboard_create_clarifies),
    ("2 Dashboard → create a campaign (route)", test_dashboard_create_campaign_routes),
    ("3 Forms handoff (no canned FE opener)", test_forms_handoff_no_canned_opener),
    ("4 Create → webpush alone is channel not audience", test_create_webpush_routes_to_channels_not_audience),
    ("5 Create chat → for Aravindh (select_audience)", test_create_for_aravindh_audience_tool),
    ("6 Contacts → add a contact", test_contacts_add_contact),
    ("7 Forms confirmation (no Reply yes)", test_forms_confirmation_no_reply_yes),
    ("8 Monitoring → start/launch campaign (route)", test_monitoring_create_campaign_routes),
    ("9 Events report → build form (route)", test_events_report_create_form_routes),
    ("10 Recommendations → launch campaign (route)", test_recommendations_create_campaign_routes),
    ("11 WhatsApp approved → LLM reply", test_whatsapp_approved_llm_reply),
    ("12 FE handoff carry_query wiring", test_fe_handoff_carry_query_wiring),
    ("13 validate_campaign_details session guard", test_validate_campaign_details_session_guard),
]


async def _run_suite(tests: list[tuple[str, Any]]) -> int:
    failed = 0
    for label, fn in tests:
        try:
            ok, detail = await asyncio.wait_for(fn(), timeout=120.0)
        except asyncio.TimeoutError:
            ok, detail = False, "timeout (>120s)"
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"error: {exc}"
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {label}\n       {detail}\n")
        if not ok:
            failed += 1
    print(f"Summary: {len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


async def main() -> int:
    parser = argparse.ArgumentParser(description="Routing / handoff verification")
    parser.add_argument(
        "--mas-only",
        action="store_true",
        help="Run MAS offline checks only (WP5 gate)",
    )
    parser.add_argument(
        "--legacy-only",
        action="store_true",
        help="Run legacy routing checks only (skip MAS section)",
    )
    args = parser.parse_args()

    if args.mas_only:
        return await _run_suite(MAS_TESTS)
    if args.legacy_only:
        return await _run_suite(LEGACY_TESTS)
    return await _run_suite(MAS_TESTS + LEGACY_TESTS)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
