#!/usr/bin/env python3
"""
Live QA — Audience MAS (Super → Domain → Executor → CRM tools → panel events).

Usage:
  cd agents && PYTHONPATH=. python scripts/qa_audience_mas.py
  cd agents && PYTHONPATH=. python scripts/qa_audience_mas.py --mock
  cd agents && PYTHONPATH=. python scripts/qa_audience_mas.py --live

--mock   Patches Super/Domain LLM + CRM handlers (no network; validates wiring).
--live   Real LLM + real handlers (default when LLM reachable).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import jwt

from app.request_context import set_request_token

JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production-campaign")
USER_ID = os.environ.get("QA_USER_ID", "qa-audience-mas")


def _token() -> str:
    return jwt.encode({"sub": USER_ID}, JWT_SECRET, algorithm="HS256")


def _draft_create_events(ui_events: list) -> list[dict]:
    out = []
    for e in ui_events or []:
        if not isinstance(e, dict):
            continue
        if e.get("type") != "draft_updated":
            continue
        mode = str((e.get("payload") or {}).get("mode") or "").lower()
        if mode == "create":
            out.append(e)
    return out


async def _run_contacts_turn(user_text: str, session_id: str | None = None) -> dict[str, Any]:
    from app.mas.socket_bridge import run_contacts_turn_via_mas_or_legacy

    token = _token()
    set_request_token(token)
    sid = session_id or f"qa-audience-{uuid.uuid4().hex[:10]}"
    return await run_contacts_turn_via_mas_or_legacy(sid, token, user_text)


async def qa_mas_entry_and_routing_mock() -> tuple[bool, str]:
    """Full chain with mocked LLM — proves Super→Domain→Executor wiring."""
    session: dict = {"session_id": "qa-mock", "module": "contacts"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.audience.runner.llm_pick_audience_executor",
            new_callable=AsyncMock,
        ) as mock_domain, patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_turn:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "creation",
                "restated_query": "add contact",
            }
            mock_domain.return_value = {
                "ok": True,
                "executor_id": "contact",
                "restated_query": "add contact",
            }
            mock_turn.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "What is their first name?",
                "ui_events": [
                    {
                        "type": "draft_updated",
                        "payload": {"mode": "create", "draft_contact": {}},
                    }
                ],
                "state": {"draft_mode": "create", "module": "contacts"},
            }
            from app.mas.runtime.invoke import mas_invoke
            from app.mas.runtime.task_memory import get_mas_task

            out = await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "query": "add a contact",
                    "session": session,
                    "session_id": "qa-mock",
                    "token": _token(),
                    "module_hint": "contacts",
                    "task_spec": {"query": "add a contact", "module": "contacts"},
                }
            )
            task = get_mas_task(session)
            dr = out.get("domain_result") or {}
            ui = list(dr.get("ui_events") or [])
            return out, mock_super, mock_domain, mock_turn, task, ui

    out, mock_super, mock_domain, mock_turn, task, ui = await asyncio.wait_for(run(), 120)
    ok = (
        out.get("ok")
        and task.get("active_domain") == "audience"
        and mock_super.await_count >= 1
        and mock_domain.await_count >= 1
        and mock_turn.await_count >= 1
        and len(_draft_create_events(ui)) >= 1
    )
    route = out.get("route_meta") or {}
    detail = (
        f"active_domain={task.get('active_domain')!r} "
        f"route_source={route.get('source')!r} "
        f"super_correction={route.get('super_correction')!r} "
        f"draft_events={len(_draft_create_events(ui))} "
        f"reply={(out.get('reply') or '')[:120]!r}"
    )
    return ok, detail


async def qa_create_panel_mock() -> tuple[bool, str]:
    """Socket bridge create — panel draft_updated via mocked executor."""
    async def run():
        with patch(
            "app.mas.socket_bridge.mas_invoke",
            new_callable=AsyncMock,
        ) as mock_invoke:
            mock_invoke.return_value = {
                "ok": True,
                "domain_id": "audience",
                "reply": "Let's add a contact. What is their first name?",
                "domain_result": {
                    "ok": True,
                    "executor_id": "contact",
                    "reply": "Let's add a contact. What is their first name?",
                    "ui_events": [
                        {
                            "type": "draft_updated",
                            "payload": {"mode": "create"},
                        }
                    ],
                    "state": {"draft_mode": "create", "module": "contacts"},
                },
            }
            return await _run_contacts_turn("add a contact")

    result = await asyncio.wait_for(run(), 60)
    ui = result.get("ui_events") or []
    ok = result.get("mas") is True and len(_draft_create_events(ui)) >= 1
    return ok, f"mas={result.get('mas')} draft_events={len(_draft_create_events(ui))}"


async def qa_tool_dispatch_create() -> tuple[bool, str]:
    """Handler layer — CREATE_CONTACT allowlisted dispatch (CRM adapter)."""
    with patch(
        "app.agents.contacts.tools.handlers.dispatch_tool",
        new_callable=AsyncMock,
    ) as mock_dispatch:
        mock_dispatch.return_value = {
            "ok": True,
            "message": "Contact created",
            "contact_id": "c-qa-1",
            "contact": {"id": "c-qa-1", "first_name": "Ada"},
            "ui_event": {"type": "draft_updated", "payload": {"mode": "create"}},
        }
        from app.mas.runtime.tool_adapters import dispatch_executor_tool

        out = await dispatch_executor_tool(
            "contact",
            "CREATE_CONTACT",
            {
                "first_name": "Ada",
                "email": "ada@example.com",
                "user_confirmed": True,
            },
            session_id="qa-tool",
            token=_token(),
        )
    ok = bool(out.get("ok")) and out.get("contact_id") == "c-qa-1"
    return ok, f"tool_ok={out.get('ok')} contact_id={out.get('contact_id')}"


async def qa_tool_dispatch_update() -> tuple[bool, str]:
    with patch(
        "app.agents.contacts.tools.handlers.dispatch_tool",
        new_callable=AsyncMock,
    ) as mock_dispatch:
        mock_dispatch.return_value = {
            "ok": True,
            "message": "Contact updated",
            "ui_event": {"type": "draft_updated", "payload": {"mode": "update"}},
        }
        from app.mas.runtime.tool_adapters import dispatch_executor_tool

        out = await dispatch_executor_tool(
            "contact",
            "UPDATE_SINGLE_CONTACT",
            {
                "contact_id": "c-qa-1",
                "phone": "+15551234567",
                "user_confirmed": True,
            },
            session_id="qa-tool",
            token=_token(),
        )
    ok = bool(out.get("ok")) and (out.get("ui_event") or {}).get("type") == "draft_updated"
    return ok, f"tool_ok={out.get('ok')} ui={(out.get('ui_event') or {}).get('type')}"


async def qa_live_create_turn() -> tuple[bool, str]:
    """Real LLM + handlers — add a contact (needs LLM + optional CRM)."""
    try:
        result = await asyncio.wait_for(_run_contacts_turn("add a contact"), 180)
    except asyncio.TimeoutError:
        return False, "timeout (>180s)"
    except Exception as exc:  # noqa: BLE001
        return False, f"error: {exc}"

    ui = result.get("ui_events") or []
    reply = str(result.get("reply") or "").strip()
    state = result.get("state") if isinstance(result.get("state"), dict) else {}
    mas_out = result.get("mas_out") if isinstance(result.get("mas_out"), dict) else {}
    domain_id = mas_out.get("domain_id") or (mas_out.get("domain_result") or {}).get("domain_id")
    ok = (
        result.get("mas") is True
        and (domain_id == "audience" or domain_id is None)
        and (
            len(_draft_create_events(ui)) >= 1
            or state.get("draft_mode") == "create"
            or any(w in reply.lower() for w in ("first name", "name", "email", "contact"))
        )
    )
    return ok, (
        f"mas={result.get('mas')} domain_id={domain_id!r} "
        f"draft_mode={state.get('draft_mode')!r} "
        f"draft_events={len(_draft_create_events(ui))} reply={reply[:160]!r}"
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description="Audience MAS live QA")
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Mock LLM + handlers only (offline wiring check)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Include real LLM turn (default unless --mock only)",
    )
    args = parser.parse_args()
    live = args.live or not args.mock

    tests: list[tuple[str, Any]] = [
        ("MAS routing + Super contacts correction (mock)", qa_mas_entry_and_routing_mock),
        ("Socket create + draft_updated (mock invoke)", qa_create_panel_mock),
        ("Tool dispatch CREATE_CONTACT", qa_tool_dispatch_create),
        ("Tool dispatch UPDATE_SINGLE_CONTACT", qa_tool_dispatch_update),
    ]
    if live and not args.mock:
        tests.append(("Live LLM create turn", qa_live_create_turn))
    elif live and args.mock:
        tests.append(("Live LLM create turn", qa_live_create_turn))

    failed = 0
    print("Audience MAS QA\n")
    for label, fn in tests:
        try:
            ok, detail = await asyncio.wait_for(fn(), timeout=200)
        except asyncio.TimeoutError:
            ok, detail = False, "timeout"
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"error: {exc}"
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {label}\n       {detail}\n")
        if not ok:
            failed += 1
    print(f"Summary: {len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
