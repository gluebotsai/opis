"""Contacts coordinator — lookup / create / update / search / import."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from app.agents.contacts.prompts import build_system_prompt, welcome_text
from app.agents.routing import (
    break_after_route_tool,
    filter_route_tool_calls,
    routing_postflight,
)
from app.agents.contacts.tools import ALL_TOOLS, dispatch_tool
from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    CHAT_MAX_TOKENS,
    CHAT_REASONING_EFFORT,
    LLM_UNAVAILABLE_REPLY,
    OpenAILLM,
)
from app.request_context import set_request_token
from app.runtime.agent import CoordinatorGraphRunner, run_tool_loop, strip_internal_nudges
from app.session_store import (
    append_message,
    get_llm_memory,
    get_or_create_session,
    public_state,
    replace_llm_memory,
    save_session,
)
from app.text_cleanup import strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 4
_DRAFT_FIELD_KEYS = (
    "first_name",
    "last_name",
    "email",
    "phone",
    "company_name",
    "city",
)


def _filter_contacts_tool_calls(tool_calls: list) -> list:
    """Route isolation + at most one create tool per LLM round."""
    filtered = filter_route_tool_calls(tool_calls)
    if not filtered:
        return filtered
    seen_create = False
    out: list = []
    for call in filtered:
        name = str((call.get("function") or {}).get("name") or "")
        if name in ("CREATE_CONTACT", "CREATE_SINGLE_CONTACT"):
            if seen_create:
                continue
            seen_create = True
        out.append(call)
    return out


def _create_reply_fallback(tool_result: Any) -> str:
    """Last-resort user text when the LLM adds none after CREATE — prefer tool facts."""
    if not isinstance(tool_result, dict):
        return ""
    msg = str(
        tool_result.get("message")
        or tool_result.get("error")
        or tool_result.get("user_message")
        or ""
    ).strip()
    # Skip internal agent_instruction-style lines; keep short factual tool text.
    if msg and "duplicate_during_create" not in msg and "directory_check=" not in msg:
        if not msg.lower().startswith("tell the user"):
            return msg
    return ""


def _candidate_display_name(c: dict[str, Any]) -> str:
    label = " ".join(
        p
        for p in (
            str(c.get("first_name") or "").strip(),
            str(c.get("last_name") or "").strip(),
        )
        if p
    ).strip()
    return label or str(c.get("email") or c.get("phone") or c.get("id") or "an existing contact").strip()


def _parse_directory_note_matches(note: str) -> tuple[str, list[str]]:
    """Extract field + display names from a duplicate_during_create tool message."""
    msg = str(note or "")
    field = ""
    if "field=phone" in msg:
        field = "phone"
    elif "field=email" in msg:
        field = "email"
    names: list[str] = []
    marker = "matches="
    if marker in msg:
        # "... matches=Aarav Mehta. Create draft kept; ..."
        raw = msg.split(marker, 1)[1]
        raw = raw.split(". ", 1)[0].strip().rstrip(".")
        if raw and raw.lower() != "an existing contact":
            names.extend(n.strip() for n in raw.split(",") if n.strip())
    return field, names


def _directory_check_reply_fallback(
    *,
    ui_events: list,
    tool_results: list,
    session: dict[str, Any] | None = None,
    preflight_note: str = "",
) -> str:
    """User-facing reply when the model returns empty after a create directory check."""
    field = ""
    names: list[str] = []
    candidates: list[dict[str, Any]] = []

    note_field, note_names = _parse_directory_note_matches(preflight_note)
    if note_field:
        field = note_field
    if note_names:
        names.extend(note_names)

    for _name, result in tool_results or []:
        if not isinstance(result, dict):
            continue
        msg = str(result.get("message") or "")
        if result.get("duplicate_during_create") or "duplicate_during_create=true" in msg:
            f2, n2 = _parse_directory_note_matches(msg)
            if f2 and not field:
                field = f2
            for n in n2:
                if n not in names:
                    names.append(n)
            for c in result.get("candidates") or []:
                if isinstance(c, dict):
                    candidates.append(c)
        if "unique=true" in msg.lower() or result.get("directory_unique"):
            return _unique_create_fact_reply(
                tool_results=tool_results,
                session=session,
                preflight_note=preflight_note or msg,
            )

    for ev in ui_events or []:
        if not isinstance(ev, dict):
            continue
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        is_dup = bool(payload.get("duplicate_during_create"))
        if is_dup or ev.get("type") == "contact_candidates":
            for c in payload.get("candidates") or []:
                if isinstance(c, dict):
                    candidates.append(c)
            if not field:
                # Prefer phone when candidate phone is present and draft phone was cleared.
                draft = (session or {}).get("draft_contact") or {}
                if any(str(c.get("phone") or "").strip() for c in candidates) and not str(
                    draft.get("phone") or ""
                ).strip():
                    field = "phone"
                elif any(str(c.get("email") or "").strip() for c in candidates) and not str(
                    draft.get("email") or ""
                ).strip():
                    field = "email"

    if not candidates and isinstance(session, dict):
        for c in session.get("candidates") or []:
            if isinstance(c, dict):
                candidates.append(c)

    if candidates:
        for c in candidates[:2]:
            label = _candidate_display_name(c)
            if label and label not in names:
                names.append(label)

    # Duplicate note without hydrated candidates still needs a user reply.
    if not candidates and not names:
        if preflight_note and "duplicate_during_create" in preflight_note:
            channel = field or "email or phone"
            return (
                f"That {channel} already belongs to someone in your directory — "
                "you can open them from the panel. "
                f"To keep creating this new contact, send a different {channel}."
            )
        if preflight_note and "unique=true" in preflight_note.lower():
            return _unique_create_fact_reply(
                tool_results=tool_results,
                session=session,
                preflight_note=preflight_note,
            )
        return ""

    who = ", ".join(names) if names else "an existing contact"
    channel = field or "email or phone"
    return (
        f"That {channel} already belongs to {who} — you can open them from the panel. "
        f"To keep creating this new contact, send a different {channel}."
    )


async def _reply_after_create(llm, messages: list[dict]) -> str:
    """One tool-free pass so the model confirms the create it just made."""
    ask = list(messages)
    ask.append(
        {
            "role": "system",
            "content": (
                "CREATE_SINGLE_CONTACT (or CREATE_CONTACT) already ran this turn — "
                "its result is the last tool message. Write a friendly, professional "
                "reply in your own words from that result: confirm success with the "
                "contact details, or explain the blocker (including already_exists). "
                "Do not call any tool. Do not use a stock template."
            ),
        }
    )
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                llm.run,
                ask,
                [],
                CHAT_REASONING_EFFORT,
                CHAT_MAX_TOKENS,
            ),
            timeout=CHAT_LLM_TIMEOUT_S,
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        return ""
    return strip_markdown_emphasis((result.get("content") or "").strip())


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    return {
        "role": "system",
        "content": build_system_prompt(session),
    }


def _executor_system_message(session: dict[str, Any], content: str) -> dict[str, str]:
    return {"role": "system", "content": content}


def _pin_contacts_session(session: dict[str, Any]) -> dict[str, Any]:
    session["module"] = "contacts"
    return session


_FALSE_APOLOGY_RE = re.compile(
    r"^(?:I'?m sorry,? )?(?:I )?(?:didn'?t|did not) "
    r"(?:quite )?(?:catch that|catch it|understand(?: that)?|hear that)[.!]?\s*",
    re.I,
)

# Model invents "nothing received" after draft/panel already synced a field.
_FALSE_EMPTY_SYNC_RE = re.compile(
    r"(?:no new information|nothing new|no information|nothing) "
    r"(?:came through|came across|was (?:in|on) (?:your|the) (?:last )?message|"
    r"received|got through)|"
    r"(?:I )?(?:didn'?t|did not|couldn'?t|cannot|can'?t) "
    r"(?:see|get|find|receive|catch) (?:any )?(?:new )?(?:info|information|details|data)|"
    r"(?:your last message )?(?:didn'?t|did not) (?:come through|include|contain)",
    re.I,
)

_FALSE_PHONE_DENIAL_RE = re.compile(
    r"(?:I'?m sorry,? )?(?:I )?(?:do not|don't) see (?:a )?phone number[^.?!]*[.?!]\s*"
    r"|(?:that|the|this) number (?:still )?doesn'?t (?:have|include) (?:a )?country code[^.?!]*[.?!]\s*"
    r"|(?:could you )?(?:add|include|provide) (?:a )?country code[^.?!]*[.?!]\s*",
    re.I,
)
_CREATE_SEARCH_LANGUAGE_RE = re.compile(
    r"(can'?t find|cannot find|couldn'?t find|no contact found|not found in (?:the )?directory|"
    r"isn'?t in (?:the )?directory|doesn'?t (?:appear|show up) in (?:the )?directory|"
    r"double-check the address|try (?:a )?different (?:email|phone|name).*search|"
    r"who would you like to look up|that number alone isn'?t quite enough|"
    r"use it as part of a filter|find and open the contact|"
    r"share a (?:phone number or )?full name instead)",
    re.I,
)


def _reply_looks_like_create_search_mistake(reply: str) -> bool:
    t = (reply or "").strip()
    if not t:
        return True
    return bool(_CREATE_SEARCH_LANGUAGE_RE.search(t))


def _reply_denies_received_field(reply: str) -> bool:
    t = (reply or "").strip()
    if not t:
        return False
    return bool(_FALSE_EMPTY_SYNC_RE.search(t) or _FALSE_APOLOGY_RE.match(t))


def _next_field_ask_from_session(session: dict[str, Any] | None) -> str:
    """Build a short grounded next-step ask from draft (create only)."""
    from app.agents.contacts.draft_ingest import next_creation_prompt_field

    draft = (session or {}).get("draft_contact") if isinstance(session, dict) else {}
    if not isinstance(draft, dict):
        draft = {}
    nf = next_creation_prompt_field(
        draft,
        campaign_profile=(session or {}).get("campaign_profile")
        if isinstance(session, dict)
        else None,
    )
    if nf:
        return f"That's on the form. What's their {str(nf).replace('_', ' ')}?"
    return "Those details are on the form. Want me to save this as a new contact?"


def _unique_create_fact_reply(
    *,
    tool_results: list | None,
    session: dict[str, Any] | None,
    preflight_note: str = "",
) -> str:
    """Always produce a user-facing unique-create reply from tools / draft."""
    note = str(preflight_note or "")
    for _name, result in tool_results or []:
        if not isinstance(result, dict):
            continue
        msg = str(result.get("message") or "")
        if result.get("directory_unique") or "unique=true" in msg.lower():
            nf = str(result.get("next_field") or "").strip()
            if not nf and "next_field=" in msg:
                nf = msg.split("next_field=", 1)[1].split(".", 1)[0].strip()
            if nf:
                return (
                    f"That value is on the draft. What's their "
                    f"{nf.replace('_', ' ')}?"
                )
            if "confirm save" in msg.lower() or "confirm save" in note.lower():
                return (
                    "Those details are on the draft. "
                    "Want me to save this as a new contact?"
                )
            return _next_field_ask_from_session(session)
    if "unique=true" in note.lower():
        nf = ""
        if "next_field=" in note:
            nf = note.split("next_field=", 1)[1].split(".", 1)[0].strip()
        if nf:
            return (
                f"That value is on the draft. What's their "
                f"{nf.replace('_', ' ')}?"
            )
        if "confirm save" in note.lower():
            return (
                "Those details are on the draft. "
                "Want me to save this as a new contact?"
            )
        return _next_field_ask_from_session(session)
    return _next_field_ask_from_session(session)


def _ensure_create_directory_user_reply(
    reply: str,
    *,
    ui_events: list,
    tool_results: list,
    session: dict[str, Any] | None,
    preflight_note: str,
) -> str:
    """Replace invent-search / wrong-name replies after a create directory check."""
    text = (reply or "").strip()
    note = str(preflight_note or "")
    is_dup = "duplicate_during_create" in note or any(
        isinstance(tr, dict) and tr.get("duplicate_during_create")
        for _n, tr in (tool_results or [])
    ) or any(
        isinstance(e, dict)
        and isinstance(e.get("payload"), dict)
        and e["payload"].get("duplicate_during_create")
        for e in (ui_events or [])
    )
    is_unique = "unique=true" in note.lower() or any(
        isinstance(tr, dict)
        and (
            tr.get("directory_unique")
            or "unique=true" in str(tr.get("message") or "").lower()
        )
        for _n, tr in (tool_results or [])
    )

    if is_dup:
        fact = _directory_check_reply_fallback(
            ui_events=ui_events,
            tool_results=tool_results,
            session=session,
            preflight_note=preflight_note,
        )
        if not fact:
            return reply
        _field, match_names = _parse_directory_note_matches(note)
        if not match_names:
            for _n, tr in tool_results or []:
                if isinstance(tr, dict) and tr.get("duplicate_during_create"):
                    _field, match_names = _parse_directory_note_matches(
                        str(tr.get("message") or "")
                    )
                    if match_names:
                        break
        draft = (session or {}).get("draft_contact") or {}
        draft_label = " ".join(
            p
            for p in (
                str(draft.get("first_name") or "").strip(),
                str(draft.get("last_name") or "").strip(),
            )
            if p
        ).strip()
        mentions_match = (
            any(n.lower() in text.lower() for n in match_names) if match_names else False
        )
        wrongly_blames_draft = bool(
            draft_label
            and draft_label.lower() in text.lower()
            and not mentions_match
            and ("already" in text.lower() or "on file" in text.lower())
        )
        if (
            not text
            or _reply_looks_like_create_search_mistake(text)
            or wrongly_blames_draft
            or (match_names and not mentions_match)
        ):
            return fact
        return text

    if is_unique and (
        not text
        or _reply_looks_like_create_search_mistake(text)
        or _reply_denies_received_field(text)
    ):
        return _unique_create_fact_reply(
            tool_results=tool_results,
            session=session,
            preflight_note=preflight_note,
        )
    return text


def _strip_false_apology_after_draft_sync(
    content: str,
    tool_results: list[tuple[str, dict[str, Any]]],
    *,
    preflight_synced: bool = False,
    draft_contact: dict[str, Any] | None = None,
    session: dict[str, Any] | None = None,
) -> str:
    """Drop false 'nothing received' when panel sync already succeeded."""
    from app.agents.contacts.validation import parse_and_validate_phone

    synced = preflight_synced or any(
        name == "SET_DRAFT_FIELDS" and isinstance(tr, dict) and tr.get("ok")
        for name, tr in tool_results
    )
    if not content.strip():
        return content
    out = content.strip()
    if synced:
        out = _FALSE_APOLOGY_RE.sub("", out, count=1) or out
        if _reply_denies_received_field(out):
            return _next_field_ask_from_session(
                session or {"draft_contact": draft_contact}
            )
    phone = str((draft_contact or {}).get("phone") or "").strip()
    if phone and parse_and_validate_phone(phone).get("ok"):
        out = _FALSE_PHONE_DENIAL_RE.sub("", out, count=1).strip() or out
    return out


_INTERNAL_LEAK_RE = re.compile(
    r"(SET_DRAFT_FIELDS|GET_CONTACT_DETAIL|CREATE_SINGLE_CONTACT|VIEW_CONTACT|"
    r"QUERY_CONTACTS|panel sync|lookup tool|contact lookup tool|Active skill|"
    r"sync any new details to the panel|duplicate_during_create|invoke_executor)",
    re.I,
)


def _view_tool_succeeded(tool_results: list[tuple[str, dict[str, Any]]]) -> bool:
    for name, tr in tool_results:
        if name not in ("QUERY_CONTACTS", "VIEW_CONTACT"):
            continue
        if isinstance(tr, dict) and tr.get("ok"):
            return True
    return False


def _has_contact_candidates_ui(ui_events: list) -> bool:
    return any(
        isinstance(e, dict) and e.get("type") == "contact_candidates" for e in ui_events
    )


async def _contact_view_query_postflight(
    *,
    session_id: str,
    token: str,
    user_text: str,
    view_preflight_ok: bool,
    tool_results: list[tuple[str, dict[str, Any]]],
    ui_events: list,
    reply: str,
    event_callback: Any = None,
) -> tuple[str, list]:
    """
    If contact_view finished without a successful view tool, run QUERY_CONTACTS
    with memory-enriched user_request (skill enforcement — not phrase routing).
    """
    if view_preflight_ok or _view_tool_succeeded(tool_results):
        return reply, ui_events
    if _has_contact_candidates_ui(ui_events):
        return reply, ui_events

    from app.agents.contacts.contact_query_memory import build_query_user_request
    from app.agents.contacts.tools.handlers import handle_query_contacts

    session = await get_or_create_session(session_id, token=token, module="contacts")
    user_request = build_query_user_request(session, user_text)
    query_result = await handle_query_contacts(
        session_id,
        token,
        {
            "user_request": user_request,
            "change_summary": "List or filter contacts",
        },
    )
    if not isinstance(query_result, dict):
        return reply, ui_events

    ev = query_result.get("ui_event")
    if isinstance(ev, dict) and ev.get("type"):
        ui_events.append(ev)
        if event_callback:
            try:
                await event_callback(ev)
            except Exception:  # noqa: BLE001
                pass

    if query_result.get("ok"):
        tool_msg = str(query_result.get("message") or "").strip()
        count = int(query_result.get("matched_count") or query_result.get("count") or 0)
        if tool_msg and (not reply.strip() or count == 0):
            return tool_msg, ui_events
    err = str(query_result.get("error") or query_result.get("message") or "").strip()
    if err and not reply.strip():
        return err, ui_events
    return reply, ui_events


def _scrub_internal_leak_from_reply(content: str) -> str:
    """Remove user-visible echoes of tool names, nudges, or internal flow."""
    text = (content or "").strip()
    if not text or not _INTERNAL_LEAK_RE.search(text):
        return text
    parts = re.split(r"(?<=[.!?])\s+", text)
    kept = [p for p in parts if p.strip() and not _INTERNAL_LEAK_RE.search(p)]
    if kept:
        return " ".join(kept).strip()
    return "No problem — tell me what you'd like to do next."


async def run_contacts_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    executor_id: str = "coordinator",
    skill_id: str | None = None,
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Bounded contacts tool loop (MAS executors + legacy coordinator)."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = list(tools or ALL_TOOLS)
    prompt_body = system_content
    active_skill = str(skill_id or "").strip().lower() or None

    session = _pin_contacts_session(
        await get_or_create_session(session_id, token=token, module="contacts")
    )
    if not active_skill:
        from app.mas.skills import CONTACTS_MODULE, get_active_skill_id

        active_skill = get_active_skill_id(session, CONTACTS_MODULE)
    preflight_synced = False
    view_preflight_ok = False
    preflight_directory_note = ""
    if user_text:
        session = await append_message(
            session_id, "user", user_text, token=token, module="contacts"
        )

    mem = strip_internal_nudges(get_llm_memory(session))
    if mem != list(session.get("llm_memory") or []):
        session["llm_memory"] = mem
        session = await save_session(session, token=token)
    if user_text:
        last = mem[-1] if mem else None
        if not (
            isinstance(last, dict)
            and last.get("role") == "user"
            and str(last.get("content") or "").strip() == user_text
        ):
            mem = [*mem, {"role": "user", "content": user_text}]
            session["llm_memory"] = mem
            session = await save_session(session, token=token)

    if user_text:
        from app.agents.contacts.draft_ingest import (
            EMAIL_ASK_RE,
            PHONE_ASK_RE,
            identity_view_args_from_turn,
            sync_draft_from_user_turn,
        )
        from app.mas.skills.state import is_active_contact_creation

        last_assistant = ""
        for msg in reversed(mem):
            if not isinstance(msg, dict):
                continue
            if msg.get("role") != "assistant":
                continue
            text = str(msg.get("content") or "").strip()
            if text:
                last_assistant = text
                break

        draft_now = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
        create_progress = any(
            str((draft_now or {}).get(k) or "").strip()
            for k in ("first_name", "last_name", "email", "phone")
        )
        field_asked = bool(
            EMAIL_ASK_RE.search(last_assistant or "")
            or PHONE_ASK_RE.search(last_assistant or "")
        )
        create_busy = bool(
            is_active_contact_creation(session)
            or (
                str(session.get("draft_mode") or "").strip().lower() == "create"
                and (create_progress or field_asked)
            )
        )
        # Never hijack mid-create field answers (email/phone) into view lookup.
        view_identity = None if create_busy else identity_view_args_from_turn(
            user_text, last_assistant=last_assistant
        )
        if view_identity:
            from app.agents.contacts.tools.handlers import handle_view_contact
            from app.mas.skills import CONTACTS_MODULE
            from app.mas.skills.state import apply_skill_pick

            apply_skill_pick(
                session,
                module=CONTACTS_MODULE,
                executor_id=executor_id or "contact",
                skill_id="contact_view",
                skill_action="switch",
            )
            session = await save_session(session, token=token)
            view_result = await handle_view_contact(
                session_id,
                token,
                {
                    **view_identity,
                    "_panel_mode": "view",
                    "change_summary": "View contact by identity",
                },
            )
            session = _pin_contacts_session(
                await get_or_create_session(session_id, token=token, module="contacts")
            )
            if view_result.get("ok"):
                view_preflight_ok = True
                active_skill = "contact_view"
                for ev in [view_result.get("ui_event"), *(view_result.get("ui_events") or [])]:
                    if isinstance(ev, dict) and ev.get("type"):
                        ui_events.append(ev)
                        if event_callback:
                            try:
                                await event_callback(ev)
                            except Exception:  # noqa: BLE001
                                pass

        prior_draft = dict(session.get("draft_contact") or {})
        pre = sync_draft_from_user_turn(
            session, user_text, last_assistant=last_assistant
        )
        if pre.get("changed"):
            preflight_synced = True
            session = await save_session(session, token=token)
            ui_events.append(
                {
                    "type": "draft_updated",
                    "payload": pre.get("ui_payload") or {},
                }
            )
            if event_callback:
                try:
                    await event_callback(
                        {
                            "type": "draft_updated",
                            "payload": pre.get("ui_payload") or {},
                        }
                    )
                except Exception:  # noqa: BLE001
                    pass
            # After ingest writes email/phone on create, run directory check
            # (same as SET_DRAFT_FIELDS chain) so duplicates are not skipped.
            if str(session.get("draft_mode") or "").lower() == "create":
                from app.agents.contacts.tools.handlers import (
                    _draft_ui_payload,
                    handle_lookup,
                )

                draft_now = session.get("draft_contact") or {}
                for field, key in (("email", "email"), ("phone", "phone")):
                    new_val = str(draft_now.get(key) or "").strip()
                    old_val = str(prior_draft.get(key) or "").strip()
                    if not new_val or new_val == old_val:
                        continue
                    lookup = await handle_lookup(
                        session_id,
                        token,
                        {
                            field: new_val,
                            "change_summary": f"Directory check for {key}",
                        },
                    )
                    session = _pin_contacts_session(
                        await get_or_create_session(
                            session_id, token=token, module="contacts"
                        )
                    )
                    for ev in [
                        lookup.get("ui_event"),
                        *(lookup.get("ui_events") or []),
                    ]:
                        if isinstance(ev, dict) and ev.get("type"):
                            ui_events.append(ev)
                            if event_callback:
                                try:
                                    await event_callback(ev)
                                except Exception:  # noqa: BLE001
                                    pass
                    if lookup.get("duplicate_during_create"):
                        preflight_directory_note = str(lookup.get("message") or "")
                        break
                    if lookup.get("ok") and int(lookup.get("count") or 0) == 0:
                        preflight_directory_note = str(lookup.get("message") or "")
                        payload = _draft_ui_payload(session)
                        ui_events.append({"type": "draft_updated", "payload": payload})
                        if event_callback:
                            try:
                                await event_callback(
                                    {"type": "draft_updated", "payload": payload}
                                )
                            except Exception:  # noqa: BLE001
                                pass
                    break

    if active_skill == "contact_view" and prompt_body:
        from app.agents.contacts.prompts import build_contacts_executor_system_prompt

        prompt_body = build_contacts_executor_system_prompt(
            session,
            executor_id,
            module_hint="contacts",
            skill_id="contact_view",
        )

    llm = _llm()
    if prompt_body:
        messages: list[dict] = [_executor_system_message(session, prompt_body)]
    else:
        messages = [_system_message(session)]
    messages.extend(list(mem))
    if preflight_directory_note:
        messages.append(
            {
                "role": "system",
                "content": (
                    "Directory check already ran this turn before tools. Fact: "
                    f"{preflight_directory_note} "
                    "You MUST write a short user-facing reply from this fact now. "
                    "If duplicate_during_create: name the match, say the panel shows them, "
                    "and ask update that person OR a different email/phone for this new contact. "
                    "If unique=true: acknowledge briefly and ask only for next_field. "
                    "Do not leave the user without a reply. Do not run QUERY_CONTACTS or filters. "
                    "Never say you can't find the contact — unique means the value stays on the create draft."
                ),
            }
        )
    elif preflight_synced:
        messages.append(
            {
                "role": "system",
                "content": (
                    "Panel sync already applied the user's field value(s) this turn "
                    "(see draft_contact in memory). Do NOT say no information came through "
                    "or that you didn't catch their message. Acknowledge briefly from "
                    "draft_contact, then ask only for the next missing create field "
                    "(or confirm save when required fields are ready). "
                    "Call SET_DRAFT_FIELDS only if draft_contact still lacks a value they just gave."
                ),
            }
        )

    create_result: dict[str, Any] | None = None
    panel_nudged = False

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        nonlocal session
        if name == "CREATE_CONTACT":
            draft = session.get("draft_contact") or {}
            for k in _DRAFT_FIELD_KEYS:
                val = str(draft.get(k) or "").strip()
                if val:
                    args[k] = val
        try:
            tool_result = await dispatch_tool(
                name,
                session_id,
                token,
                args,
                event_callback=event_callback,
            )
        except Exception as exc:  # noqa: BLE001
            tool_result = {"ok": False, "error": f"{name} failed: {exc}"}
        session = _pin_contacts_session(
            await get_or_create_session(session_id, token=token, module="contacts")
        )
        return tool_result

    async def after_each_tool(
        name: str,
        _tool_result: dict[str, Any],
        msgs: list[dict],
    ) -> None:
        nonlocal session, prompt_body
        session = _pin_contacts_session(
            await get_or_create_session(session_id, token=token, module="contacts")
        )
        if prompt_body and active_skill:
            from app.agents.contacts.prompts import build_contacts_executor_system_prompt

            prompt_body = build_contacts_executor_system_prompt(
                session,
                executor_id,
                module_hint="contacts",
                skill_id=active_skill,
            )
            msgs[0] = _executor_system_message(session, prompt_body)

    def break_after_tools(
        round_calls: list[tuple[str, dict[str, Any]]],
        content: str,
    ) -> str | None:
        nonlocal create_result
        route_reply = break_after_route_tool(round_calls, content)
        if route_reply:
            return route_reply
        for tool_name, tool_result in round_calls:
            if tool_name in ("CREATE_CONTACT", "CREATE_SINGLE_CONTACT"):
                create_result = tool_result
                return content or "."
        return None

    def after_no_tools(_round_i: int, _content: str) -> str | None:
        nonlocal panel_nudged
        if panel_nudged or executor_id not in ("contact", "coordinator"):
            return None
        if any(isinstance(e, dict) and e.get("type") == "navigate" for e in ui_events):
            return None
        # Preflight / panel may already show EXISTING MATCH — still require a chat reply.
        # Check this BEFORE skipping on contact_candidates (that UI event is the duplicate).
        if preflight_directory_note and "duplicate_during_create" in preflight_directory_note:
            panel_nudged = True
            return (
                "Directory check found a duplicate during create. Reply to the user now: "
                "name the matched contact, mention they can open them from the panel, "
                "and ask whether to update that contact or provide a different email/phone "
                "for this new contact. Do not call QUERY_CONTACTS."
            )
        if any(
            isinstance(e, dict)
            and e.get("type") == "contact_candidates"
            and isinstance(e.get("payload"), dict)
            and e["payload"].get("duplicate_during_create")
            for e in ui_events
        ):
            panel_nudged = True
            return (
                "The panel already shows an EXISTING MATCH for this create. Reply now: "
                "name the matched person, say that email or phone is already theirs, "
                "and ask update that contact OR a different email/phone for the new contact. "
                "Do not call QUERY_CONTACTS."
            )
        if any(
            isinstance(e, dict) and e.get("type") == "contact_candidates"
            for e in ui_events
        ):
            return None
        if preflight_directory_note and "unique=true" in preflight_directory_note:
            panel_nudged = True
            return (
                "Directory check passed (unique). Reply briefly that the value is on the "
                "draft and ask ONLY for next_field from the tool/note (or confirm save). "
                "Do not say no contact found. Do not offer menus, search, filters, or "
                "what-would-you-like-to-do-next option lists."
            )
        if active_skill == "contact_view" and user_text.strip():
            panel_nudged = True
            return (
                "Active skill is contact view. One identity (email/phone/name/id) → "
                "VIEW_CONTACT after format checks. Two or more criteria or any list/filter "
                "→ QUERY_CONTACTS with a complete user_request (latest message + memory). "
                "Do not tell the user how many matches until a view tool succeeds."
            )
        if active_skill == "contact_creation" and user_text.strip():
            draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
            has_name = bool(str((draft or {}).get("first_name") or "").strip())
            mode = str(session.get("draft_mode") or "").strip().lower()
            if not has_name or mode != "create":
                panel_nudged = True
                return (
                    "User wants to create a contact (any natural add/create wording — not a "
                    "person name). Call SET_DRAFT_FIELDS with mode=create "
                    "(reset_draft=true if a profile/update draft is open) to open Contact Setup, "
                    "then ask for the first missing field. Do not say you didn't understand."
                )
        if any(
            isinstance(e, dict) and e.get("type") == "draft_updated"
            for e in ui_events
        ):
            return None
        if active_skill and user_text.strip():
            panel_nudged = True
            return (
                "The user sent data or a decision this turn. Read the active skill instruction "
                "and shared memory, then call the appropriate skill tool before your reply. "
                "Do not mention tools, panels, or internal steps to the user."
            )
        return None

    loop_result = await run_tool_loop(
        llm,
        messages,
        active_tools,
        dispatch=dispatch,
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        filter_tool_calls=_filter_contacts_tool_calls,
        break_after_tools=break_after_tools,
        after_each_tool=after_each_tool,
        after_no_tools=after_no_tools,
        disable_thinking=True,
        require_content_after_tools=True,
        empty_content_retries=2,
    )
    ui_events = loop_result.ui_events
    final_content = loop_result.content

    if create_result is not None:
        final_content = await _reply_after_create(llm, messages) or final_content

    if not final_content or final_content == LLM_UNAVAILABLE_REPLY:
        final_content = (
            _create_reply_fallback(create_result)
            or _directory_check_reply_fallback(
                ui_events=ui_events,
                tool_results=list(loop_result.round_tool_results or []),
                session=session,
                preflight_note=preflight_directory_note,
            )
            or final_content
            or LLM_UNAVAILABLE_REPLY
        )

    final_content = strip_markdown_emphasis(final_content)
    session = _pin_contacts_session(
        await get_or_create_session(session_id, token=token, module="contacts")
    )
    final_content = _strip_false_apology_after_draft_sync(
        final_content,
        loop_result.round_tool_results,
        preflight_synced=preflight_synced,
        draft_contact=session.get("draft_contact"),
        session=session,
    )
    final_content = _ensure_create_directory_user_reply(
        final_content,
        ui_events=ui_events,
        tool_results=list(loop_result.round_tool_results or []),
        session=session,
        preflight_note=preflight_directory_note,
    )
    final_content = _scrub_internal_leak_from_reply(final_content)
    if user_text and str(active_skill or "").lower() == "contact_view":
        final_content, ui_events = await _contact_view_query_postflight(
            session_id=session_id,
            token=token,
            user_text=user_text,
            view_preflight_ok=view_preflight_ok,
            tool_results=loop_result.round_tool_results,
            ui_events=ui_events,
            reply=final_content,
            event_callback=event_callback,
        )
        session = _pin_contacts_session(
            await get_or_create_session(session_id, token=token, module="contacts")
        )
    if user_text:
        final_content = await routing_postflight(
            session,
            user_text,
            final_content,
            ui_events=ui_events,
            event_callback=event_callback,
        )
        await save_session(session, token=token)

    transcript = strip_internal_nudges(
        [m for m in messages if isinstance(m, dict) and m.get("role") != "system"]
    )
    if final_content:
        last = transcript[-1] if transcript else None
        if not (
            isinstance(last, dict)
            and last.get("role") == "assistant"
            and not last.get("tool_calls")
            and str(last.get("content") or "").strip() == final_content
        ):
            transcript.append({"role": "assistant", "content": final_content})
    session = _pin_contacts_session(
        await get_or_create_session(session_id, token=token, module="contacts")
    )
    replace_llm_memory(session, transcript)
    await save_session(session, token=token)

    await append_message(
        session_id, "assistant", final_content, token=token, module="contacts"
    )
    session = _pin_contacts_session(
        await get_or_create_session(session_id, token=token, module="contacts")
    )
    await save_session(session, token=token)

    from app.mas.skills.harness import evaluate_skill_outcome

    skill_outcome = evaluate_skill_outcome(
        active_skill or "",
        tool_results=loop_result.round_tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )

    return {
        "reply": final_content,
        "ui_events": ui_events,
        "state": public_state(session),
        "tool_results": loop_result.round_tool_results,
        "skill_outcome": skill_outcome,
    }


async def run_coordinator(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    result = await run_contacts_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        tools=ALL_TOOLS,
        system_content=None,
        executor_id="coordinator",
        ui_events=ui_events,
        event_callback=event_callback,
    )
    return {"reply": result.get("reply") or "", "ui_events": result.get("ui_events") or []}


_RUNNER: CoordinatorGraphRunner | None = None


def get_graph() -> CoordinatorGraphRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = CoordinatorGraphRunner(run_coordinator)
    return _RUNNER


build_contacts_graph = get_graph


async def run_contacts_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
) -> dict[str, Any]:
    set_request_token(token)
    result = await run_coordinator(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
    )
    session = _pin_contacts_session(
        await get_or_create_session(session_id, token=token, module="contacts")
    )
    return {
        "reply": result.get("reply") or "",
        "ui_events": result.get("ui_events") or [],
        "state": public_state(session),
        "messages": session.get("messages") or [],
    }


__all__ = [
    "run_coordinator",
    "run_contacts_executor_turn",
    "run_contacts_turn",
    "welcome_text",
    "get_graph",
    "build_contacts_graph",
]
