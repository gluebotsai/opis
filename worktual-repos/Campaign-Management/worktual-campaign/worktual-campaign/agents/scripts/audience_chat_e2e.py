#!/usr/bin/env python3
"""
Real Audience chat E2E — same Socket.IO path as the frontend (no handler mocks).

Requires a valid Campaign JWT:
  export CAMPAIGN_AUTH_TOKEN="$(curl -s -X POST http://127.0.0.1:5173/api/auth/login \\
    -H 'Content-Type: application/json' \\
    -d '{\"email\":\"YOUR_EMAIL\",\"password\":\"YOUR_PASSWORD\"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"token\"])')"

Usage:
  cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/audience_chat_e2e.py
  cd agents && PYTHONPATH=. .venv/bin/python3.14 scripts/audience_chat_e2e.py --dry-update
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
import socketio

API_BASE = os.environ.get("CAMPAIGN_API_BASE", "http://127.0.0.1:3001/api").rstrip("/")
FE_ORIGIN = os.environ.get("CAMPAIGN_FE_ORIGIN", "http://127.0.0.1:5173").rstrip("/")
SOCKET_URL = os.environ.get("CAMPAIGN_SOCKET_URL", FE_ORIGIN).rstrip("/")
SOCKET_PATH = os.environ.get("CAMPAIGN_SOCKET_PATH", "/agents-socket")


@dataclass
class TurnCapture:
    session_ready: dict | None = None
    agent_messages: list[str] = field(default_factory=list)
    state_updates: list[dict] = field(default_factory=list)
    ui_events: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    typing_seen: bool = False


def _token_from_env() -> str:
    tok = (
        os.environ.get("CAMPAIGN_AUTH_TOKEN")
        or os.environ.get("CAMPAIGN_TEST_TOKEN")
        or ""
    ).strip()
    if tok:
        return tok
    email = os.environ.get("CAMPAIGN_TEST_EMAIL", "").strip()
    password = os.environ.get("CAMPAIGN_TEST_PASSWORD", "").strip()
    if not email or not password:
        return ""
    try:
        res = httpx.post(
            f"{FE_ORIGIN}/api/auth/login",
            json={"email": email, "password": password, "remember": True},
            timeout=30.0,
        )
        res.raise_for_status()
        body = res.json()
        return str(body.get("token") or "").strip()
    except Exception as exc:
        print(f"Login failed: {exc}", file=sys.stderr)
        return ""


async def _fetch_sample_contact(token: str) -> dict | None:
    try:
        res = httpx.get(
            f"{API_BASE}/contacts",
            headers={"Authorization": f"Bearer {token}"},
            params={"page": 1, "limit": 10},
            timeout=30.0,
        )
        if res.status_code != 200:
            return None
        body = res.json() or {}
        rows = body.get("getContactDetails") or body.get("contacts") or []
        for row in rows:
            em = str(row.get("email") or "").strip()
            if em and "@" in em:
                return row
    except Exception:
        return None
    return None


class AudienceChatClient:
    def __init__(self, token: str, session_id: str | None = None) -> None:
        self.token = token
        self.session_id = session_id or str(uuid.uuid4())
        self.capture = TurnCapture()
        self._turn_done = asyncio.Event()
        self._sio = socketio.AsyncClient(
            reconnection=False,
            logger=False,
            engineio_logger=False,
        )
        self._register_handlers()

    def _register_handlers(self) -> None:
        @self._sio.event
        async def connect():
            pass

        @self._sio.on("session_ready")
        async def on_ready(data):
            self.capture.session_ready = data if isinstance(data, dict) else {}

        @self._sio.on("agent_message")
        async def on_agent_message(data):
            if isinstance(data, dict):
                text = str(data.get("text") or "").strip()
                if text:
                    self.capture.agent_messages.append(text)
            self._turn_done.set()

        @self._sio.on("agent_typing")
        async def on_typing(data):
            if isinstance(data, dict) and data.get("typing"):
                self.capture.typing_seen = True

        @self._sio.on("state_update")
        async def on_state(data):
            if isinstance(data, dict):
                self.capture.state_updates.append(data)

        @self._sio.on("ui_event")
        async def on_ui(data):
            if isinstance(data, dict):
                self.capture.ui_events.append(data)

        @self._sio.on("error")
        async def on_error(data):
            msg = str((data or {}).get("message") or data)
            self.capture.errors.append(msg)
            self._turn_done.set()

        @self._sio.on("agent_error")
        async def on_agent_error(data):
            msg = str((data or {}).get("message") or data)
            self.capture.errors.append(msg)
            self._turn_done.set()

    async def connect_and_join(self) -> None:
        await self._sio.connect(
            SOCKET_URL,
            socketio_path=SOCKET_PATH,
            transports=["polling", "websocket"],
            auth={"token": self.token},
            wait_timeout=30,
        )
        await self._sio.emit(
            "join_session",
            {
                "session_id": self.session_id,
                "token": self.token,
                "module": "contacts",
                "skip_welcome": False,
                "campaign_profile": {"mode": "b2b", "industry": "generic-b2b"},
                "audience_contact_count": 0,
            },
        )
        await asyncio.sleep(2.0)

    async def send(self, text: str, *, timeout: float = 180.0) -> TurnCapture:
        self.capture = TurnCapture()
        self._turn_done.clear()
        await self._sio.emit(
            "user_message",
            {
                "session_id": self.session_id,
                "token": self.token,
                "module": "contacts",
                "text": text,
            },
        )
        try:
            await asyncio.wait_for(self._turn_done.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            self.capture.errors.append("timeout waiting for agent_message")
        await asyncio.sleep(0.5)
        return self.capture

    async def close(self) -> None:
        if self._sio.connected:
            await self._sio.disconnect()


def _last_state(cap: TurnCapture) -> dict:
    for row in reversed(cap.state_updates):
        st = row.get("state")
        if isinstance(st, dict):
            return st
    return {}


def _skill_active(st: dict, skill_id: str) -> bool:
    skills = st.get("module_skills") or {}
    active = skills.get("active") or {}
    return str(active.get("skill_id") or "").lower() == skill_id.lower()


def _has_update_panel(cap: TurnCapture) -> bool:
    st = _last_state(cap)
    if str(st.get("mode") or "").lower() == "update" and st.get("focus_contact_id"):
        return True
    for ev in cap.ui_events:
        p = (ev or {}).get("payload") or {}
        if str(p.get("mode") or "").lower() == "update" and p.get("focus_contact_id"):
            return True
        if ev.get("type") == "contact_candidates" and p.get("focus_contact_id"):
            if str(p.get("mode") or "").lower() == "update":
                return True
    return False


async def scenario_greeting(client: AudienceChatClient) -> tuple[bool, str]:
    cap = await client.send("hey there!")
    reply = " ".join(cap.agent_messages).lower()
    if cap.errors:
        return False, f"errors={cap.errors}"
    if not reply:
        return False, "no assistant reply"
    if any(w in reply for w in ("didn't catch", "did not understand", "not sure what")):
        return False, f"bad greeting reply: {cap.agent_messages[-1][:120]!r}"
    return True, cap.agent_messages[-1][:140]


async def scenario_update_find_and_city(
    client: AudienceChatClient, contact: dict, *, dry_update: bool
) -> tuple[bool, str]:
    email = str(contact.get("email") or "").strip()
    name = str(contact.get("first_name") or "contact").strip()
    turns = [
        f"need to edit {name}'s profile — email is {email}",
        "change the city to Bengaluru",
    ]
    if not dry_update:
        turns.append("yes please save that")
    log: list[str] = []
    for i, text in enumerate(turns, 1):
        cap = await client.send(text)
        st = _last_state(cap)
        log.append(
            f"T{i} mode={st.get('mode')!r} focus={st.get('focus_contact_id')!r} "
            f"city={(st.get('draft_contact') or {}).get('city')!r} "
            f"reply={(cap.agent_messages[-1] if cap.agent_messages else '')[:80]!r}"
        )
        if cap.errors:
            return False, f"turn {i} errors={cap.errors}; {'; '.join(log)}"
        if i == 1 and not _has_update_panel(cap):
            return False, f"turn 1: update panel not opened; {'; '.join(log)}"
    st = _last_state(cap)
    city = str((st.get("draft_contact") or {}).get("city") or "")
    if "bengaluru" not in city.lower() and "bangalore" not in city.lower():
        return False, f"city not updated on draft; {'; '.join(log)}"
    skills = st.get("module_skills") or {}
    skill_hint = str((skills.get("active") or {}).get("skill_id") or "")
    return True, f"skill={skill_hint}; {'; '.join(log)}"


async def scenario_block_phone(
    token: str, contact: dict
) -> tuple[bool, str]:
    phone = str(contact.get("phone") or "").strip()
    if not phone:
        return True, "skipped — contact has no phone"
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send(f"update contact with phone {phone}")
    if not _has_update_panel(cap):
        await client.close()
        return False, "update panel not opened"
    st_load = _last_state(cap)
    loaded_phone = str((st_load.get("draft_contact") or {}).get("phone") or "").strip()
    if not loaded_phone:
        await client.close()
        return True, "skipped — phone not on draft after load"
    cap2 = await client.send("change phone to +15551234567")
    reply = " ".join(cap2.agent_messages).lower()
    st = _last_state(cap2)
    draft_phone = str((st.get("draft_contact") or {}).get("phone") or "")
    await client.close()
    if "+15551234567" in draft_phone.replace(" ", ""):
        return False, f"draft phone changed: {draft_phone}"
    if any(
        p in reply
        for p in ("cannot be changed", "can't change", "already has", "cannot change")
    ):
        return True, cap2.agent_messages[-1][:160]
    return True, f"phone unchanged on draft; reply={cap2.agent_messages[-1][:120]!r}"


async def scenario_update_company(
    token: str, contact: dict, *, dry_update: bool
) -> tuple[bool, str]:
    email = str(contact.get("email") or "").strip()
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send(f"edit contact {email}")
    if not _has_update_panel(cap):
        await client.close()
        return False, "update panel not opened"
    cap2 = await client.send("set company to Worktual Labs")
    st = _last_state(cap2)
    company = str((st.get("draft_contact") or {}).get("company_name") or "").lower()
    focus = st.get("focus_contact_id")
    await client.close()
    if "worktual" not in company:
        return False, f"company not updated: {company!r}; focus={focus!r}"
    if not focus and not _has_update_panel(cap2):
        return False, f"update panel lost after company change; company={company!r}"
    return True, f"company={company!r}; focus={focus!r}; panel={_has_update_panel(cap2)}"


async def scenario_no_match_lookup(token: str) -> tuple[bool, str]:
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send("update contact nobody.exists.ever@invalid-domain.test")
    reply = " ".join(cap.agent_messages).lower()
    st = _last_state(cap)
    await client.close()
    if _has_update_panel(cap):
        return False, "update panel opened for nonexistent contact"
    if str(st.get("mode") or "").lower() == "update" and st.get("focus_contact_id"):
        return False, "focus set for no-match lookup"
    if any(
        p in reply
        for p in ("couldn't find", "could not find", "no contact", "not find", "try another", "different email")
    ):
        return True, cap.agent_messages[-1][:160]
    return True, f"no panel; reply={cap.agent_messages[-1][:120]!r}"


async def scenario_block_email(
    token: str, contact: dict
) -> tuple[bool, str]:
    email = str(contact.get("email") or "").strip()
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send(f"update contact {email}")
    if not _has_update_panel(cap):
        await client.close()
        return False, "update panel not opened"
    cap2 = await client.send("change email to totally.new.person@example.com")
    reply = " ".join(cap2.agent_messages).lower()
    st = _last_state(cap2)
    draft_email = str((st.get("draft_contact") or {}).get("email") or "").lower()
    await client.close()
    if "totally.new" in draft_email:
        return False, f"draft email changed: {draft_email}"
    if any(
        p in reply
        for p in ("cannot be changed", "can't change", "already has an email", "cannot change")
    ):
        return True, cap2.agent_messages[-1][:160]
    return True, f"no email on draft; reply={cap2.agent_messages[-1][:120]!r}"


def _has_view_panel(cap: TurnCapture) -> bool:
    st = _last_state(cap)
    if str(st.get("mode") or "").lower() == "view":
        if st.get("focus_contact_id"):
            return True
        if st.get("candidates"):
            return True
    for ev in cap.ui_events:
        p = (ev or {}).get("payload") or {}
        if str(p.get("mode") or "").lower() == "view":
            if p.get("focus_contact_id") or p.get("candidates"):
                return True
        if ev.get("type") == "contact_candidates" and str(p.get("mode") or "").lower() == "view":
            return True
    return False


async def scenario_view_by_email(
    token: str, contact: dict
) -> tuple[bool, str]:
    email = str(contact.get("email") or "").strip()
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send(f"show me the contact with email {email}")
    st = _last_state(cap)
    skills = st.get("module_skills") or {}
    active = (skills.get("active") or {}).get("skill_id") or ""
    mode = str(st.get("mode") or "").lower()
    focus = st.get("focus_contact_id")
    has_panel = _has_view_panel(cap)
    await client.close()
    if cap.errors:
        return False, f"errors={cap.errors}"
    if not has_panel:
        return False, f"view panel not opened; mode={mode!r} focus={focus!r} skill={active!r}"
    return True, f"mode={mode!r} focus={focus!r}; reply={cap.agent_messages[-1][:100]!r}"


async def scenario_view_ask_then_email(
    token: str, contact: dict
) -> tuple[bool, str]:
    email = str(contact.get("email") or "").strip()
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap1 = await client.send("I want to view a contact")
    cap2 = await client.send(email)
    st = _last_state(cap2)
    mode = str(st.get("mode") or "").lower()
    focus = st.get("focus_contact_id")
    await client.close()
    if cap2.errors:
        return False, f"errors={cap2.errors}"
    if not _has_view_panel(cap2) and not focus:
        return False, f"no view after email; mode={mode!r} focus={focus!r}"
    return True, f"T1={(cap1.agent_messages[-1] if cap1.agent_messages else '')[:60]!r}; mode={mode!r}"


async def scenario_query_contacts_with_email(token: str) -> tuple[bool, str]:
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send("show me contacts who have an email address")
    st = _last_state(cap)
    has_panel = _has_view_panel(cap)
    candidates = st.get("candidates") or []
    mode = str(st.get("mode") or "").lower()
    reply = (cap.agent_messages[-1] if cap.agent_messages else "")[:120]
    await client.close()
    if cap.errors:
        return False, f"errors={cap.errors}"
    if not has_panel and not candidates:
        return False, f"no view panel; mode={mode!r}; reply={reply!r}"
    return True, f"mode={mode!r} candidates={len(candidates)}; reply={reply!r}"


async def scenario_query_contacts_with_phone(token: str) -> tuple[bool, str]:
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send("list contacts that have a phone number")
    st = _last_state(cap)
    has_panel = _has_view_panel(cap)
    reply = (cap.agent_messages[-1] if cap.agent_messages else "")[:120]
    await client.close()
    if cap.errors:
        return False, f"errors={cap.errors}"
    if not has_panel:
        return False, f"no view panel; reply={reply!r}"
    return True, f"panel ok; reply={reply!r}"


async def scenario_query_contacts_by_city(
    token: str, contact: dict
) -> tuple[bool, str]:
    city = str(contact.get("city") or "").strip()
    if not city:
        return True, "skipped — sample contact has no city"
    client = AudienceChatClient(token)
    await client.connect_and_join()
    cap = await client.send(f"show me all contacts from {city}")
    st = _last_state(cap)
    has_panel = _has_view_panel(cap)
    reply = (cap.agent_messages[-1] if cap.agent_messages else "")[:120]
    await client.close()
    if cap.errors:
        return False, f"errors={cap.errors}"
    if not has_panel and not (st.get("candidates") or []):
        return False, f"no view panel for city={city!r}; reply={reply!r}"
    return True, f"city={city!r}; reply={reply!r}"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-update",
        action="store_true",
        help="Stop before save confirm (no UPDATE/CRM write)",
    )
    args = parser.parse_args()

    token = _token_from_env()
    if not token:
        print(
            "Set CAMPAIGN_AUTH_TOKEN or CAMPAIGN_TEST_EMAIL + CAMPAIGN_TEST_PASSWORD",
            file=sys.stderr,
        )
        return 2

    contact = await _fetch_sample_contact(token)
    if not contact:
        print("No contacts in CRM — seed contacts or log in with a tenant that has data.", file=sys.stderr)
        return 2

    client = AudienceChatClient(token)
    await client.connect_and_join()

    tests = [
        ("Greeting (domain plain text)", scenario_greeting),
        (
            "Update: find → city"
            + (" (dry)" if args.dry_update else " → confirm"),
            lambda c: scenario_update_find_and_city(c, contact, dry_update=args.dry_update),
        ),
    ]

    failed = 0
    print(f"Audience chat E2E (socket {SOCKET_URL}{SOCKET_PATH})\n")
    for label, fn in tests:
        try:
            ok, detail = await fn(client)
        except Exception as exc:
            ok, detail = False, str(exc)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {label}\n       {detail}\n")
        if not ok:
            failed += 1

    # Fresh-session scenarios
    fresh_tests = [
        ("Block email change in chat", lambda: scenario_block_email(token, contact)),
        ("Block phone change in chat", lambda: scenario_block_phone(token, contact)),
        (
            "Update: company field"
            + (" (dry)" if args.dry_update else ""),
            lambda: scenario_update_company(token, contact, dry_update=args.dry_update),
        ),
        ("No-match lookup", lambda: scenario_no_match_lookup(token)),
        ("View: show by email", lambda: scenario_view_by_email(token, contact)),
        ("View: ask then email", lambda: scenario_view_ask_then_email(token, contact)),
        ("Query: contacts with email", lambda: scenario_query_contacts_with_email(token)),
        ("Query: contacts with phone", lambda: scenario_query_contacts_with_phone(token)),
        (
            "Query: contacts by city",
            lambda: scenario_query_contacts_by_city(token, contact),
        ),
    ]
    for label, fn in fresh_tests:
        try:
            ok, detail = await fn()
        except Exception as exc:
            ok, detail = False, str(exc)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {label}\n       {detail}\n")
        if not ok:
            failed += 1

    await client.close()
    total = len(tests) + len(fresh_tests)
    print(f"Summary: {total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
