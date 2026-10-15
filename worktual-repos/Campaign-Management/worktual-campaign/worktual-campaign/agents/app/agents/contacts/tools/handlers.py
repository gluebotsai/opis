"""Tool handlers for contacts agent — call campaign API /contacts/*."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Awaitable, Callable

import httpx

from app.agents.contacts.draft_ingest import (
    empty_draft,
    is_garbage_person_name,
    is_push_skip,
    mark_optional_field_skipped,
    merge_extracted,
    missing_fields,
    next_creation_prompt_field,
    soft_missing_fields,
    split_full_name,
    unmark_optional_field_skipped,
)
from app.agents.contacts.validation import (
    emails_match,
    identity_snapshot,
    is_valid_email,
    parse_and_validate_phone,
    phones_match,
    review_email_address,
    title_case_person_name,
    validate_email_phone,
    validate_update_identity_change,
)
from app.config import get_settings
from app.session_store import get_or_create_session, save_session

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


def _draft_mode(session: dict[str, Any]) -> str | None:
    mode = str(session.get("draft_mode") or "").strip().lower()
    return mode if mode in ("create", "update") else None


def _panel_mode(session: dict[str, Any]) -> str | None:
    mode = str(session.get("draft_mode") or "").strip().lower()
    return mode if mode in ("create", "update", "view") else None


def _is_contact_view_flow(session: dict[str, Any], args: dict[str, Any]) -> bool:
    if str(args.get("_panel_mode") or "").strip().lower() == "view":
        return True
    from app.mas.skills import CONTACTS_MODULE, get_active_skill_id

    return (
        str(get_active_skill_id(session, CONTACTS_MODULE) or "").strip().lower()
        == "contact_view"
    )


def _apply_draft_mode(session: dict[str, Any], mode: str | None) -> str | None:
    """Persist agent-chosen draft panel mode (create | update). No keyword inference."""
    normalized = str(mode or "").strip().lower()
    if normalized in ("create", "update"):
        session["draft_mode"] = normalized
        if normalized == "create":
            session["focus_contact_id"] = None
            session.pop("update_baseline", None)
        return normalized
    # Keep prior agent choice across later SET_DRAFT_FIELDS calls.
    return _draft_mode(session)


def _pin_update_baseline(session: dict[str, Any], contact: dict[str, Any] | None) -> None:
    """Store original email/phone for update immutability checks."""
    if not contact:
        return
    session["update_baseline"] = identity_snapshot(_draft_from_contact(contact))


def _ensure_update_baseline(session: dict[str, Any], draft: dict[str, Any] | None) -> None:
    if session.get("update_baseline"):
        return
    if _draft_mode(session) == "update" and session.get("focus_contact_id"):
        session["update_baseline"] = identity_snapshot(draft or {})


def _sync_contact_skill_snapshot(session: dict[str, Any]) -> None:
    """Keep active contact skill snapshot aligned with panel focus/draft."""
    from app.mas.skills import CONTACTS_MODULE, SkillStateStore, get_module_skill_state

    state = get_module_skill_state(session, CONTACTS_MODULE)
    active = state.get("active")
    if not isinstance(active, dict) or not active.get("skill_id"):
        return
    store = SkillStateStore()
    active = dict(active)
    active["snapshot"] = {
        **(active.get("snapshot") if isinstance(active.get("snapshot"), dict) else {}),
        **store.snapshot_from_session(session),
    }
    state["active"] = active


def _reconcile_contacts_view_session(session_id: str, session: dict[str, Any]) -> None:
    """Keep view panel state when a stale session copy drops mode/candidates mid-turn."""
    from app.memory_session_store import memory_get, memory_has

    if not memory_has(session_id):
        return
    prior = memory_get(session_id) or {}
    prior_mode = str(prior.get("draft_mode") or "").lower()
    if prior_mode != "view" and str(session.get("draft_mode") or "").lower() != "view":
        last = str(prior.get("last_action") or session.get("last_action") or "")
        if last not in ("query_contacts", "search", "lookup", "get"):
            return
        if not (prior.get("candidates") or session.get("candidates")):
            return
    if not str(session.get("draft_mode") or "").lower():
        session["draft_mode"] = "view"
    if prior.get("candidates") and not session.get("candidates"):
        session["candidates"] = prior.get("candidates")
    if prior.get("focus_contact_id") and not session.get("focus_contact_id"):
        session["focus_contact_id"] = prior.get("focus_contact_id")


def _reconcile_contacts_update_session(session_id: str, session: dict[str, Any]) -> None:
    """Keep update focus/baseline when a stale session copy drops them mid-turn."""
    from app.memory_session_store import memory_get, memory_has
    from app.mas.skills import CONTACTS_MODULE

    if not memory_has(session_id):
        return
    prior = memory_get(session_id) or {}
    prior_mode = str(prior.get("draft_mode") or session.get("draft_mode") or "").lower()
    if prior_mode != "update" and _draft_mode(session) != "update":
        snap_focus = None
        skills = prior.get("module_skills") or session.get("module_skills") or {}
        active = (skills.get(CONTACTS_MODULE) or {}).get("active") or {}
        snap = active.get("snapshot") if isinstance(active.get("snapshot"), dict) else {}
        if str(snap.get("draft_mode") or "").lower() == "update":
            prior_mode = "update"
            snap_focus = snap.get("focus_contact_id")
        if prior_mode != "update":
            return
        if snap_focus and not session.get("focus_contact_id"):
            session["focus_contact_id"] = snap_focus
    if not session.get("draft_mode") and prior_mode == "update":
        session["draft_mode"] = "update"
    if _draft_mode(session) == "create":
        return
    if prior.get("focus_contact_id") and not session.get("focus_contact_id"):
        session["focus_contact_id"] = prior.get("focus_contact_id")
    if prior.get("update_baseline") and not session.get("update_baseline"):
        session["update_baseline"] = prior.get("update_baseline")
    if _draft_mode(session) == "update" and session.get("focus_contact_id"):
        draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
        baseline = session.get("update_baseline") if isinstance(session.get("update_baseline"), dict) else {}
        if not baseline.get("email") and str(draft.get("email") or "").strip():
            session["update_baseline"] = identity_snapshot(draft)
        elif not baseline.get("phone") and str(draft.get("phone") or "").strip():
            session["update_baseline"] = identity_snapshot({**baseline, **draft})


def _args_have_identity_values(args: dict[str, Any]) -> bool:
    keys = (
        "first_name",
        "last_name",
        "full_name",
        "fullName",
        "email",
        "phone",
        "company_name",
        "city",
    )
    for k in keys:
        if str(args.get(k) or "").strip():
            return True
    return False



def _draft_ui_payload(
    session: dict[str, Any], **extra: Any
) -> dict[str, Any]:
    from app.agents.contacts.draft_ingest import empty_draft

    draft = {**empty_draft(), **(session.get("draft_contact") or {})}
    payload: dict[str, Any] = {
        "draft_contact": draft,
        "focus_contact_id": session.get("focus_contact_id"),
        "mode": _panel_mode(session) or _draft_mode(session),
    }
    payload.update(extra)
    return payload


_create_locks: dict[str, asyncio.Lock] = {}


def _create_lock(session_id: str) -> asyncio.Lock:
    lock = _create_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _create_locks[session_id] = lock
    return lock


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def _contact_summary(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out = {
        "id": row.get("id"),
        "first_name": row.get("first_name"),
        "last_name": row.get("last_name"),
        "email": row.get("email"),
        "phone": row.get("phone"),
        "company_name": row.get("company_name"),
        "city": row.get("city"),
    }
    cf = row.get("custom_fields") or row.get("customFields")
    if isinstance(cf, dict) and cf:
        out["custom_fields"] = cf
    return out


def _draft_from_contact(row: dict[str, Any]) -> dict[str, Any]:
    draft = empty_draft()
    draft.update(
        {
            "first_name": str(row.get("first_name") or ""),
            "last_name": str(row.get("last_name") or ""),
            "email": str(row.get("email") or ""),
            "phone": str(row.get("phone") or ""),
            "company_name": str(row.get("company_name") or ""),
            "city": str(row.get("city") or ""),
        }
    )
    cf = row.get("custom_fields") or row.get("customFields") or {}
    if isinstance(cf, dict) and cf:
        draft["custom_fields"] = dict(cf)
        draft["extra_fields_asked"] = "1"
    app_rows = row.get("app_push") or []
    if app_rows and isinstance(app_rows, list):
        first = app_rows[0] or {}
        token = str(first.get("endpoint") or "").strip()
        if token:
            draft["app_push_token"] = token
            draft["app_push_platform"] = str(first.get("platform") or "android")
            draft["app_push_asked"] = "1"
    web_rows = row.get("web_push") or []
    if web_rows and isinstance(web_rows, list):
        first = web_rows[0] or {}
        endpoint = str(first.get("endpoint") or "").strip()
        if endpoint:
            draft["web_push_endpoint"] = endpoint
            draft["web_push_asked"] = "1"
            keys = first.get("auth_keys") or {}
            if isinstance(keys, dict):
                draft["web_push_p256dh"] = str(keys.get("p256dh") or "")
                draft["web_push_auth"] = str(keys.get("auth") or "")
    return draft


def _truthy_arg(value: Any) -> bool:
    if value is True:
        return True
    return str(value or "").strip().lower() in ("1", "true", "yes", "skip")


def _drop_mirror_last_name_on_create(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    mode_norm: str,
) -> None:
    """Create flow: last_name must not mirror first_name unless full_name has two parts."""
    draft_mode = str(session.get("draft_mode") or "").lower()
    if mode_norm == "update" or (
        session.get("focus_contact_id") and draft_mode == "update"
    ):
        return
    creating = mode_norm == "create" or draft_mode == "create"
    if not creating:
        return
    fn = str(args.get("first_name") or args.get("firstName") or "").strip()
    ln = str(args.get("last_name") or args.get("lastName") or "").strip()
    if not fn or not ln or fn.lower() != ln.lower():
        return
    full_raw = str(args.get("full_name") or args.get("fullName") or "").strip()
    if full_raw:
        pf, pl = split_full_name(full_raw)
        if pl and pf.lower() != pl.lower():
            return
    args.pop("last_name", None)
    args.pop("lastName", None)


def _merge_draft(current: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    from app.agents.contacts.draft_ingest import _normalize_custom_fields

    next_draft = empty_draft()
    cur = current or {}
    for k in next_draft:
        if k == "custom_fields":
            continue
        next_draft[k] = str(cur.get(k) or "").strip()
    next_draft["custom_fields"] = _normalize_custom_fields(cur.get("custom_fields"))
    mapping = {
        "first_name": "first_name",
        "firstName": "first_name",
        "last_name": "last_name",
        "lastName": "last_name",
        "email": "email",
        "phone": "phone",
        "phoneNumber": "phone",
        "whatsappNumber": "phone",
        "company_name": "company_name",
        "CompanyName": "company_name",
        "companyName": "company_name",
        "city": "city",
        "app_push_token": "app_push_token",
        "appPushToken": "app_push_token",
        "app_push_platform": "app_push_platform",
        "appPushPlatform": "app_push_platform",
        "web_push_endpoint": "web_push_endpoint",
        "webPushEndpoint": "web_push_endpoint",
        "web_push_p256dh": "web_push_p256dh",
        "webPushP256dh": "web_push_p256dh",
        "web_push_auth": "web_push_auth",
        "webPushAuth": "web_push_auth",
    }
    identity_keys = {
        "first_name",
        "last_name",
        "email",
        "phone",
        "company_name",
        "city",
    }
    if _truthy_arg(args.get("clear_city") or args.get("clear_location")):
        next_draft["city"] = ""
    if _truthy_arg(args.get("clear_company") or args.get("clear_company_name")):
        next_draft["company_name"] = ""
    for src, dest in mapping.items():
        if args.get(src) is None:
            continue
        raw_val = args.get(src)
        if str(raw_val).strip() in ("", "__CLEAR__"):
            if str(raw_val).strip() == "__CLEAR__":
                next_draft[dest] = ""
            continue
        val = str(raw_val).strip()
        if dest == "email" and not is_valid_email(val):
            continue
        if dest == "phone":
            parsed = parse_and_validate_phone(val)
            if not parsed.get("ok"):
                continue
            val = str(parsed.get("e164") or val)
        if dest in ("first_name", "last_name"):
            from app.agents.contacts.validation import is_valid_person_name_token

            if not is_valid_person_name_token(val, field=dest):
                continue
            if is_garbage_person_name(val):
                continue
        existing = next_draft[dest]
        # Overwrite placeholder names (e.g. "User") with a real value from the tool.
        if (
            dest in ("first_name", "last_name")
            and existing
            and is_garbage_person_name(existing)
        ):
            next_draft[dest] = val
            continue
        next_draft[dest] = val
        if dest in ("last_name", "company_name", "city", "email", "phone") and val:
            unmark_optional_field_skipped(next_draft, dest)
        if dest == "app_push_token":
            next_draft["app_push_asked"] = "1"
        if dest in ("web_push_endpoint", "web_push_p256dh", "web_push_auth"):
            if (
                next_draft.get("web_push_endpoint")
                and next_draft.get("web_push_p256dh")
                and next_draft.get("web_push_auth")
            ):
                next_draft["web_push_asked"] = "1"
    # Reject create-intent pairs the model may have written as a name (e.g. New + One).
    if is_garbage_person_name(
        str(next_draft.get("first_name") or ""),
        str(next_draft.get("last_name") or ""),
    ):
        next_draft["first_name"] = ""
        next_draft["last_name"] = ""
    if _truthy_arg(args.get("app_push_skip") or args.get("appPushSkip")) or is_push_skip(
        str(args.get("app_push_token") or "")
    ):
        if is_push_skip(str(args.get("app_push_token") or "")):
            next_draft["app_push_token"] = ""
        next_draft["app_push_asked"] = "1"
    if _truthy_arg(args.get("web_push_skip") or args.get("webPushSkip")):
        next_draft["web_push_asked"] = "1"

    cf_patch = args.get("custom_fields")
    if cf_patch is None:
        cf_patch = args.get("customFields")
    merged_cf = {
        **_normalize_custom_fields(next_draft.get("custom_fields")),
        **_normalize_custom_fields(cf_patch),
    }
    if merged_cf:
        next_draft["custom_fields"] = merged_cf
        next_draft["extra_fields_asked"] = "1"
    if _truthy_arg(args.get("extra_fields_skip") or args.get("extraFieldsSkip")):
        next_draft["extra_fields_asked"] = "1"

    # Keep pack_fields_skipped merge for backward-compatible drafts; unused as a queue.
    skip_key = str(
        args.get("pack_field_skip") or args.get("packFieldSkip") or ""
    ).strip()
    if skip_key.startswith("pack:"):
        skip_key = skip_key.split(":", 1)[1].strip()
    if skip_key:
        from app.agents.contacts.draft_ingest import _mark_pack_skipped

        _mark_pack_skipped(next_draft, skip_key)

    # Free-form / industry keys at top level (score, income, age, …) → custom_fields
    reserved = {
        "first_name",
        "last_name",
        "full_name",
        "fullName",
        "email",
        "phone",
        "company_name",
        "city",
        "app_push_token",
        "appPushToken",
        "app_push_platform",
        "appPushPlatform",
        "app_push_skip",
        "appPushSkip",
        "web_push_endpoint",
        "webPushEndpoint",
        "web_push_p256dh",
        "webPushP256dh",
        "web_push_auth",
        "webPushAuth",
        "web_push_skip",
        "webPushSkip",
        "email_skip",
        "emailSkip",
        "phone_skip",
        "phoneSkip",
        "last_name_skip",
        "lastNameSkip",
        "custom_fields",
        "customFields",
        "extra_fields_skip",
        "extraFieldsSkip",
        "pack_field_skip",
        "packFieldSkip",
        "pack_fields_skipped",
        "change_summary",
        "raw_text",
        "user_text",
        "user_confirmed",
        "contact_id",
        "mode",
        "reset_draft",
        "resetDraft",
    }
    free: dict[str, Any] = {}
    for k, v in (args or {}).items():
        if k in reserved or v is None:
            continue
        if str(k).startswith("app_") or str(k).startswith("web_"):
            continue
        if isinstance(v, (dict, list)):
            continue
        sv = str(v).strip()
        if not sv or is_push_skip(sv):
            continue
        free[str(k).strip()] = v
    if free:
        next_draft["custom_fields"] = {
            **_normalize_custom_fields(next_draft.get("custom_fields")),
            **_normalize_custom_fields(free),
        }
        # Do NOT auto-end extras phase — LLM may ask more industry fields.

    return next_draft


def _create_fingerprint(
    *,
    email: str | None,
    phone: str | None,
    first_name: str,
    last_name: str,
) -> str:
    return "|".join(
        [
            (email or "").strip().lower(),
            (phone or "").strip(),
            (first_name or "").strip().lower(),
            (last_name or "").strip().lower(),
        ]
    )


async def _reuse_existing_create(
    session: dict[str, Any],
    token: str,
    existing: dict[str, Any],
    *,
    fingerprint: str,
    already_in_session: bool,
) -> dict[str, Any]:
    session["focus_contact_id"] = existing.get("id")
    session["draft_contact"] = _draft_from_contact(existing)
    session["candidates"] = [_contact_summary(existing)]
    session["create_fingerprint"] = fingerprint
    session["stage"] = "created" if already_in_session else "exists"
    session["last_action"] = "create" if already_in_session else "create_exists"
    session["draft_mode"] = "update" if not already_in_session else None
    await save_session(session, token=token)
    summary = _contact_summary(existing)
    if already_in_session:
        return {
            "ok": True,
            "already_exists": True,
            "contact": summary,
            "message": "Contact already created in this chat. Do not create again.",
            "ui_event": {
                "type": "contact_created",
                "payload": {"contact": summary},
            },
        }
    return {
        "ok": False,
        "already_exists": True,
        "contact": summary,
        "error": "A contact with this email or phone already exists.",
        "message": (
            "This contact already exists. Live details were filled "
            "with the existing record — offer to update instead."
        ),
        "ui_event": {
            "type": "draft_updated",
            "payload": _draft_ui_payload(
                session,
                candidates=[_contact_summary(existing)],
                already_exists=True,
            ),
        },
    }


def _push_payload(draft: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    token = str(draft.get("app_push_token") or "").strip()
    if token and not is_push_skip(token):
        out["appPushToken"] = token
        out["appPushPlatform"] = str(draft.get("app_push_platform") or "android").strip() or "android"
    endpoint = str(draft.get("web_push_endpoint") or "").strip()
    p256 = str(draft.get("web_push_p256dh") or "").strip()
    auth = str(draft.get("web_push_auth") or "").strip()
    if endpoint and p256 and auth:
        out["webPushEndpoint"] = endpoint
        out["webPushP256dh"] = p256
        out["webPushAuth"] = auth
    return out


async def handle_lookup(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    email_raw = (args.get("email") or "").strip() or None
    phone_raw = (args.get("phone") or "").strip() or None
    if email_raw:
        reviewed = review_email_address(email_raw)
        if not reviewed.get("ok"):
            return {
                "ok": False,
                "error": str(reviewed.get("error") or "invalid_email_format"),
                "message": str(
                    reviewed.get("message")
                    or "Enter a valid email address (name@company.com)."
                ),
                "suggested_email": reviewed.get("suggested_email"),
            }
        email_raw = str(reviewed.get("email") or email_raw)
    if phone_raw:
        ph = parse_and_validate_phone(phone_raw)
        if not ph.get("ok"):
            return {
                "ok": False,
                "error": "invalid_phone_format",
                "message": str(
                    ph.get("message")
                    or "Enter a phone with country code (e.g. +91 9876543210)."
                ),
            }
        phone_raw = str(ph.get("e164") or phone_raw)

    payload = {
        "email": email_raw,
        "phone": phone_raw,
        "fullName": (args.get("full_name") or "").strip() or None,
    }
    if not any(payload.values()):
        return {"ok": False, "error": "Provide email, phone, or full_name."}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/contacts/lookup",
                headers=_headers(token),
                json=payload,
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Lookup failed: {exc}", "candidates": []}
    contacts = list(body.get("contacts") or [])
    candidates = [_contact_summary(c) for c in contacts if c]

    if (
        len(candidates) == 0
        and payload.get("fullName")
        and not payload.get("email")
        and not payload.get("phone")
    ):
        search_result = await handle_search(
            session_id,
            token,
            {
                "search": str(payload["fullName"]).strip(),
                "change_summary": args.get("change_summary")
                or f"Search contacts named {payload['fullName']}",
                **(
                    {"_panel_mode": "view"}
                    if str(args.get("_panel_mode") or "").lower() == "view"
                    else {}
                ),
            },
        )
        if search_result.get("ok") and int(search_result.get("matched_count") or 0) > 0:
            return search_result

    session = await get_or_create_session(session_id, token=token)
    _reconcile_contacts_update_session(session_id, session)
    view_flow = _is_contact_view_flow(session, args)
    was_create = str(session.get("draft_mode") or "").strip().lower() == "create"
    session["candidates"] = candidates
    session["stage"] = "lookup"
    session["last_action"] = "lookup"

    prior = dict(session.get("draft_contact") or _empty_draft())
    identity_lookup = bool(payload.get("email") or payload.get("phone"))
    duplicate_during_create = (
        was_create and len(candidates) >= 1 and identity_lookup
    )

    if duplicate_during_create:
        # Keep the in-progress create draft — do not merge duplicate email/phone or switch to update.
        clean_draft = dict(prior)
        if payload.get("email"):
            clean_draft["email"] = ""
        if payload.get("phone"):
            clean_draft["phone"] = ""
        session["draft_contact"] = clean_draft
        session["focus_contact_id"] = None
        session["draft_mode"] = "create"
    else:
        # Merge identity used for lookup into draft (never wipe fields the user already gave).
        identity_bits: dict[str, str] = {}
        if payload.get("email"):
            identity_bits["email"] = str(payload["email"]).strip().lower()
        if payload.get("phone"):
            ph = parse_and_validate_phone(str(payload["phone"]))
            if ph.get("ok"):
                identity_bits["phone"] = str(ph["e164"])
            else:
                identity_bits["phone"] = str(payload["phone"]).strip()
        if payload.get("fullName"):
            fn, ln = split_full_name(str(payload["fullName"]))
            if fn:
                identity_bits["first_name"] = fn
            if ln:
                identity_bits["last_name"] = ln
        prior, _ = merge_extracted(prior, identity_bits)

        # Single match: fill panel from directory; keep any prior fields directory lacks.
        if len(candidates) == 1 and contacts:
            from_row = _draft_from_contact(contacts[0])
            merged = dict(prior)
            for k, v in from_row.items():
                if str(v or "").strip():
                    merged[k] = str(v).strip()
            session["draft_contact"] = merged
            session["focus_contact_id"] = contacts[0].get("id")
            if view_flow:
                session["draft_mode"] = "view"
                session.pop("update_baseline", None)
            else:
                session["draft_mode"] = "update"
                _pin_update_baseline(session, contacts[0])
        else:
            # Zero / multi match: KEEP prior create draft — do not clear the live panel.
            session["draft_contact"] = prior
            session["focus_contact_id"] = None
            if view_flow and candidates:
                session["draft_mode"] = "view"

    await save_session(session, token=token)
    if session.get("focus_contact_id") and str(session.get("draft_mode") or "").lower() in (
        "update",
        "view",
    ):
        _sync_contact_skill_snapshot(session)
        await save_session(session, token=token)
    from app.agents.contacts.memory_note import append_memory_note, note_from_lookup

    during_create = str(session.get("draft_mode") or "").strip().lower() == "create"
    append_memory_note(
        session,
        note_from_lookup(len(candidates), during_create=during_create),
    )
    await save_session(session, token=token)

    from app.mas.skills import CONTACTS_MODULE, get_active_skill_id

    active_skill = str(get_active_skill_id(session, CONTACTS_MODULE) or "").strip().lower()
    update_skill = active_skill == "contact_update"
    view_skill = active_skill == "contact_view" or view_flow
    update_mode = str(session.get("draft_mode") or "").strip().lower() == "update"
    # Create draft wins: unique identity must never use view "not found" wording.
    # Also treat active contact_creation skill as create even if draft_mode briefly drifted.
    create_mode = (
        was_create
        or str(session.get("draft_mode") or "").strip().lower() == "create"
        or active_skill == "contact_creation"
    )

    if duplicate_during_create:
        field = "email" if payload.get("email") else "phone"
        names = []
        for c in candidates[:3]:
            if not isinstance(c, dict):
                continue
            label = " ".join(
                p
                for p in (
                    str(c.get("first_name") or "").strip(),
                    str(c.get("last_name") or "").strip(),
                )
                if p
            ).strip() or str(c.get("email") or c.get("phone") or c.get("id") or "").strip()
            if label:
                names.append(label)
        match_preview = ", ".join(names) if names else "an existing contact"
        draft_now = session.get("draft_contact") or {}
        draft_label = " ".join(
            p
            for p in (
                str(draft_now.get("first_name") or "").strip(),
                str(draft_now.get("last_name") or "").strip(),
            )
            if p
        ).strip() or "the new contact"
        lookup_message = (
            f"duplicate_during_create=true field={field} "
            f"match_count={len(candidates)} matches={match_preview}. "
            f"IMPORTANT: the {field} belongs to existing contact(s) [{match_preview}] — "
            f"NOT to the in-progress create draft [{draft_label}]. "
            "Create draft kept; conflicting identity cleared from draft. "
            "Panel shows clickable EXISTING MATCH. "
            f"Tell the user that {field} is already on {match_preview}, then ask: "
            f"update that existing contact, OR supply a different {field} to continue "
            f"creating {draft_label}."
        )
    elif create_mode and len(candidates) == 0:
        # Identity is free — value stays on the draft. Never use search/not-found wording.
        from app.agents.contacts.draft_ingest import next_creation_prompt_field

        nf = next_creation_prompt_field(
            session.get("draft_contact") or {},
            campaign_profile=session.get("campaign_profile"),
        )
        if nf:
            nf_bit = (
                f" next_field={nf}. ASK_USER_ONLY_FOR={nf.replace('_', ' ')}. "
                "Do not offer menus, search, filters, or what-next option lists."
            )
        else:
            nf_bit = (
                " next_field=null. Required fields ready — ask to confirm save only. "
                "Do not offer menus, search, or filters."
            )
        lookup_message = (
            "directory_check=ok unique=true create_mode=true. "
            "Email/phone is saved on the create draft (still creating — not a search). "
            "Acknowledge briefly in your own words, then ask ONLY for next_field. "
            "Never invent a directory miss, never claim the identity is missing from CRM, "
            "never offer search/filter/capability menus."
            f"{nf_bit}"
        )
    elif len(candidates) == 0:
        if view_skill:
            lookup_message = (
                args.get("change_summary")
                or "No contact matched. Ask the user for another email, phone, or name."
            )
        elif update_skill or update_mode:
            lookup_message = (
                args.get("change_summary")
                or "No contact matched. Ask the user for another email or phone."
            )
        else:
            lookup_message = (
                args.get("change_summary")
                or "No matches in the directory. Ask for another email, phone, or name."
            )
    elif len(candidates) == 1:
        if view_skill:
            lookup_message = (
                args.get("change_summary")
                or "Loaded contact details in the right panel."
            )
        elif update_skill or update_mode:
            lookup_message = (
                args.get("change_summary")
                or "Loaded contact into the update panel. Ask what fields to change."
            )
        else:
            lookup_message = (
                args.get("change_summary")
                or "Found 1 match. Ask whether to update this contact or create another."
            )
    else:
        if view_skill:
            lookup_message = (
                args.get("change_summary")
                or f"Found {len(candidates)} contacts — shown in the panel. User can tap one to view full details."
            )
        else:
            lookup_message = (
                args.get("change_summary")
                or f"Found {len(candidates)} matches. Ask the user which one to use."
            )
    ui_payload: dict[str, Any] = {
        "candidates": candidates,
        "draft_contact": session["draft_contact"],
        "focus_contact_id": session.get("focus_contact_id"),
        "mode": _panel_mode(session) or _draft_mode(session),
    }
    if duplicate_during_create:
        ui_payload["duplicate_during_create"] = True
        ui_payload["already_exists"] = True
        ui_payload["mode"] = "create"
        ui_payload["focus_contact_id"] = None
    return {
        "ok": True,
        "count": len(candidates),
        "candidates": candidates,
        "duplicate_during_create": duplicate_during_create,
        "message": lookup_message,
        "ui_event": {
            "type": "contact_candidates",
            "payload": ui_payload,
        },
    }


async def handle_get(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    contact_id = str(args.get("contact_id") or "").strip()
    if not contact_id:
        return {"ok": False, "error": "contact_id required"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{_base()}/contacts/{contact_id}",
                headers=_headers(token),
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Get contact failed: {exc}"}
    contact = body.get("contact") or {}
    if not contact.get("id"):
        return {"ok": False, "error": "Contact not found."}

    session = await get_or_create_session(session_id, token=token)
    _reconcile_contacts_update_session(session_id, session)
    view_flow = _is_contact_view_flow(session, args)
    session["focus_contact_id"] = contact["id"]
    session["draft_contact"] = _draft_from_contact(contact)
    query_panel = session.get("query_panel_candidates")
    if isinstance(query_panel, list) and len(query_panel) > 1:
        session["candidates"] = list(query_panel)
    else:
        session["candidates"] = [_contact_summary(contact)]
    session["stage"] = "edit"
    session["last_action"] = "get"
    if view_flow:
        session["draft_mode"] = "view"
        session.pop("update_baseline", None)
    else:
        session["draft_mode"] = "update"
        _pin_update_baseline(session, contact)
    _sync_contact_skill_snapshot(session)
    await save_session(session, token=token)
    summary = _contact_summary(contact)
    return {
        "ok": True,
        "contact": summary,
        "message": args.get("change_summary") or "Loaded contact.",
        "ui_event": {
            "type": "draft_updated",
            "payload": _draft_ui_payload(session),
        },
    }


async def handle_search(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    filters = {
        k: args[k]
        for k in ("city", "company", "job_title", "has_email", "has_phone", "search")
        if args.get(k) is not None and args.get(k) != ""
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/contacts/filter",
                headers=_headers(token),
                json={"filters": filters},
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Search failed: {exc}"}

    sample = [_contact_summary(c) for c in (body.get("sample") or []) if c]
    count = int(body.get("count") or 0)
    session = await get_or_create_session(session_id, token=token)
    view_flow = _is_contact_view_flow(session, args)
    if not view_flow:
        from app.mas.skills import CONTACTS_MODULE, get_active_skill_id

        if (
            str(get_active_skill_id(session, CONTACTS_MODULE) or "").strip().lower()
            == "contact_view"
        ):
            view_flow = True
    session["candidates"] = sample
    session["stage"] = "search"
    session["last_action"] = "search"
    if view_flow:
        session["draft_mode"] = "view"
        session["focus_contact_id"] = None
        session.pop("update_baseline", None)
    await save_session(session, token=token)
    if view_flow and sample:
        _sync_contact_skill_snapshot(session)
        await save_session(session, token=token)
    panel_mode = "view" if view_flow else None
    return {
        "ok": True,
        "matched_count": count,
        "sample": sample,
        "active_filters": filters,
        "message": args.get("change_summary") or f"{count} contacts match.",
        "ui_event": {
            "type": "contact_candidates",
            "payload": {
                "candidates": sample,
                "matched_count": count,
                **({"mode": panel_mode} if panel_mode else {}),
            },
        },
    }


def _empty_draft() -> dict[str, str]:
    return empty_draft()


async def _lookup_existing_contact(
    token: str,
    *,
    email: str | None,
    phone: str | None,
) -> dict[str, Any] | None:
    payload: dict[str, Any] = {}
    if email:
        payload["email"] = email
    if phone:
        payload["phone"] = phone
    if not payload:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/contacts/lookup",
                headers=_headers(token),
                json=payload,
            )
            res.raise_for_status()
            contacts = list((res.json() or {}).get("contacts") or [])
            return contacts[0] if contacts else None
    except Exception:  # noqa: BLE001
        return None


async def handle_set_draft(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    args = _normalize_jun30_contact_args(dict(args or {}))
    mode_arg = args.pop("mode", None)
    reset_draft = _truthy_arg(args.pop("reset_draft", None) or args.pop("resetDraft", None))
    skip_field = str(args.pop("skip_field", None) or "").strip().lower() or None
    mark_asked_raw = args.pop("mark_asked", None)
    _ = mark_asked_raw
    session = await get_or_create_session(session_id, token=token, module="contacts")
    _reconcile_contacts_update_session(session_id, session)
    from app.memory_session_store import memory_get, memory_has

    identity_keys = (
        "first_name",
        "last_name",
        "email",
        "phone",
        "company_name",
        "city",
    )
    if memory_has(session_id):
        prior = memory_get(session_id) or {}
        prior_draft = (
            prior.get("draft_contact") if isinstance(prior.get("draft_contact"), dict) else {}
        )
        cur = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
        hydrated = dict(cur)
        for key in identity_keys:
            prior_val = str(prior_draft.get(key) or "").strip()
            cur_val = str(hydrated.get(key) or "").strip()
            if prior_val and not cur_val:
                hydrated[key] = prior_val
        if prior_draft.get("pack_fields_skipped") and not hydrated.get("pack_fields_skipped"):
            hydrated["pack_fields_skipped"] = prior_draft.get("pack_fields_skipped")
        if hydrated != cur or not session.get("draft_contact"):
            session["draft_contact"] = {**empty_draft(), **hydrated}
        if not session.get("draft_mode") and prior.get("draft_mode"):
            session["draft_mode"] = prior.get("draft_mode")
        prior_mode = str(prior.get("draft_mode") or session.get("draft_mode") or "").lower()
        if (
            prior.get("focus_contact_id")
            and not session.get("focus_contact_id")
            and str(session.get("draft_mode") or "").lower() != "create"
        ):
            if prior_mode == "update":
                session["focus_contact_id"] = prior.get("focus_contact_id")
        if prior.get("update_baseline") and not session.get("update_baseline"):
            if prior_mode == "update":
                session["update_baseline"] = prior.get("update_baseline")
    mode_norm = str(mode_arg or "").strip().lower()
    prior_mode = _draft_mode(session)

    draft_snapshot = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
    has_progress = any(
        str(draft_snapshot.get(k) or "").strip()
        for k in ("first_name", "last_name", "email", "phone", "company_name", "city")
    )
    if reset_draft and has_progress and not session.get("focus_contact_id"):
        # Protect in-progress create from accidental empty reset mid-interview.
        if mode_norm != "create":
            reset_draft = False
    # LLM mode=create / reset_draft while a detail contact is open → detach to create.

    # Reset draft when LLM starts create (explicit reset or mode=create from open detail).
    staged_create = False
    leave_detail_for_create = mode_norm == "create" and bool(
        session.get("focus_contact_id")
    )
    if reset_draft or leave_detail_for_create:
        draft0 = empty_draft()
        session["candidates"] = []
        session["focus_contact_id"] = None
        session["create_fingerprint"] = None
        session.pop("contact_create_asked", None)
        session.pop("update_baseline", None)
        session["draft_reset"] = True
        staged_create = True
    else:
        draft0 = session.get("draft_contact") or empty_draft()
        if mode_norm == "create" and prior_mode != "create" and not has_progress:
            staged_create = True

    # Drop empty identity args — LLM often sends last_name="" which must not affect merge.
    for key in (
        "first_name",
        "firstName",
        "last_name",
        "lastName",
        "email",
        "phone",
        "phoneNumber",
        "whatsappNumber",
        "company_name",
        "CompanyName",
        "companyName",
        "city",
    ):
        if key in args and not str(args.get(key) or "").strip():
            args.pop(key, None)

    prior_miss = missing_fields(
        draft0,
        focus_contact_id=session.get("focus_contact_id"),
        campaign_profile=session.get("campaign_profile"),
    )
    prior_phase = prior_miss[:1][0] if prior_miss else ""
    blob = " ".join(
        str(args.get(k) or "")
        for k in ("change_summary", "raw_text", "user_text", "app_push_token", "web_push_endpoint")
    ).strip()
    skip_app = _truthy_arg(args.get("app_push_skip") or args.get("appPushSkip")) or (
        prior_phase == "app_push" and is_push_skip(blob)
    )
    skip_web = _truthy_arg(args.get("web_push_skip") or args.get("webPushSkip")) or (
        prior_phase == "web_push" and is_push_skip(blob)
    )

    notes: list[str] = []
    if skip_field:
        # Optional-field skip from executor — never reinterpret as push-token skip.
        pass
    elif prior_phase == "app_push" and skip_app:
        args = {"app_push_skip": True}
    elif prior_phase == "web_push" and skip_web:
        args = {"web_push_skip": True}
    elif prior_phase == "extra_fields" and (
        skip_app or skip_web or is_push_skip(blob) or _truthy_arg(args.get("extra_fields_skip"))
    ):
        args = {"extra_fields_skip": True}
    else:
        full_name = str(args.pop("full_name", None) or args.pop("fullName", None) or "").strip()
        if full_name and not is_garbage_person_name(full_name):
            name_parts = [p for p in re.split(r"\s+", full_name) if p]
            if len(name_parts) >= 2:
                fn, ln = split_full_name(full_name)
                if fn and not str(args.get("first_name") or "").strip():
                    args["first_name"] = fn
                if ln and not str(args.get("last_name") or "").strip():
                    args["last_name"] = ln
            elif str(session.get("draft_mode") or "").strip().lower() == "create":
                notes.append(
                    "Single-word full_name is not allowed during create. "
                    "Use SET_DRAFT_FIELDS with explicit first_name or last_name."
                )
            else:
                fn, ln = split_full_name(full_name)
                if fn and not str(args.get("first_name") or "").strip():
                    args["first_name"] = fn
                if ln and not str(args.get("last_name") or "").strip():
                    args["last_name"] = ln

        # LLM often puts "Priya Sharma" in first_name — split when last_name empty.
        for fk, lk in (("first_name", "last_name"), ("firstName", "lastName")):
            fn_raw = str(args.get(fk) or "").strip()
            ln_raw = str(args.get(lk) or "").strip()
            if fn_raw and not ln_raw and len(fn_raw.split()) >= 2 and not is_garbage_person_name(fn_raw):
                fn, ln = split_full_name(fn_raw)
                if fn:
                    args[fk] = fn
                if ln and lk not in args:
                    args[lk] = ln

        # Structured tool args only — do not regex-parse change_summary / raw_text / user_text.

        if args.get("email"):
            reviewed = review_email_address(str(args.get("email") or ""))
            if not reviewed.get("ok"):
                return {
                    "ok": False,
                    "error": str(reviewed.get("error") or "invalid_email_format"),
                    "message": str(
                        reviewed.get("message")
                        or "Enter a valid email address (name@company.com)."
                    ),
                    "suggested_email": reviewed.get("suggested_email"),
                    "draft_contact": draft0,
                    "mode": _draft_mode(session) or mode_norm or "create",
                }
            args["email"] = str(reviewed.get("email") or args.get("email")).strip().lower()
        if args.get("phone"):
            ph = parse_and_validate_phone(str(args.get("phone") or ""))
            if not ph.get("ok"):
                return {
                    "ok": False,
                    "error": "invalid_phone_format",
                    "message": str(
                        ph.get("message")
                        or "Enter a phone with country code (e.g. +91 9876543210)."
                    ),
                    "draft_contact": draft0,
                    "mode": _draft_mode(session) or mode_norm or "create",
                }
            args = {**args, "phone": ph["e164"]}

        updating = (
            mode_norm == "update"
            or _draft_mode(session) == "update"
            or bool(session.get("focus_contact_id"))
        )
        if updating:
            _ensure_update_baseline(session, draft0)
            baseline = session.get("update_baseline") or {}
            if args.get("email") is not None:
                chk = validate_update_identity_change(
                    baseline, email=str(args.get("email") or "")
                )
                if not chk.get("ok"):
                    args.pop("email", None)
                    notes.append(str(chk.get("message") or "Email cannot be updated."))
            if args.get("phone") is not None:
                chk = validate_update_identity_change(
                    baseline, phone=str(args.get("phone") or "")
                )
                if not chk.get("ok"):
                    args.pop("phone", None)
                    notes.append(str(chk.get("message") or "Phone cannot be updated."))

        if prior_miss[:1] == ["app_push"] and (
            is_push_skip(blob) or _truthy_arg(args.get("app_push_skip"))
        ):
            args["app_push_skip"] = True
        if prior_miss[:1] == ["web_push"] and (
            is_push_skip(blob) or _truthy_arg(args.get("web_push_skip"))
        ):
            args["web_push_skip"] = True
        if prior_miss[:1] == ["extra_fields"] and (
            is_push_skip(blob) or _truthy_arg(args.get("extra_fields_skip"))
        ):
            args["extra_fields_skip"] = True

    _drop_mirror_last_name_on_create(session, args, mode_norm=mode_norm)
    draft = _merge_draft(draft0, args)
    if skip_field:
        mark_optional_field_skipped(draft, skip_field)
    fields_updated = [
        k
        for k in identity_keys
        if str(draft.get(k) or "").strip() != str(draft0.get(k) or "").strip()
    ]
    # User jumped to email/phone while last_name still empty → defer last_name so
    # next_field advances (they can still SET_DRAFT last_name later to fill it).
    if (
        str(_draft_mode(session) or mode_norm or "").lower() == "create"
        or mode_norm == "create"
    ) and (
        "email" in fields_updated or "phone" in fields_updated
    ):
        from app.agents.contacts.draft_ingest import _pack_skipped_keys

        if (
            not str(draft.get("last_name") or "").strip()
            and "last_name" not in _pack_skipped_keys(draft)
        ):
            mark_optional_field_skipped(draft, "last_name")
            if "skipped:last_name" not in fields_updated:
                fields_updated = [*fields_updated, "skipped:last_name"]
    if skip_field:
        fields_updated = [*fields_updated, f"skipped:{skip_field}"]
    user_field_keys = {
        "first_name",
        "firstName",
        "last_name",
        "lastName",
        "full_name",
        "fullName",
        "email",
        "phone",
        "phoneNumber",
        "whatsappNumber",
        "company_name",
        "CompanyName",
        "companyName",
        "city",
    }
    user_expected_data = any(
        str(args.get(k) or "").strip()
        for k in user_field_keys
        if args.get(k) is not None
    ) or bool(skip_field)
    ok = bool(fields_updated or staged_create or skip_field)
    if user_expected_data and not fields_updated and not staged_create and not skip_field:
        ok = False
        if not notes:
            notes.append(
                "No fields were saved. Use explicit first_name, last_name, email, or phone."
            )

    session["draft_contact"] = draft
    session["stage"] = "draft"
    session["last_action"] = "set_draft"
    # LLM mode=create always starts/continues create (clears focus). Omit mode + focus → update.
    if mode_norm == "create":
        _apply_draft_mode(session, "create")
    elif session.get("focus_contact_id") and mode_norm != "create":
        _apply_draft_mode(session, "update")
    else:
        _apply_draft_mode(session, mode_arg)
    if not _draft_mode(session) and not session.get("focus_contact_id"):
        _apply_draft_mode(session, "create")
    elif session.get("focus_contact_id") and _draft_mode(session) != "create":
        _apply_draft_mode(session, "update")
        _ensure_update_baseline(session, draft)
    await save_session(session, token=token)
    if session.get("focus_contact_id") and _draft_mode(session) == "update":
        _sync_contact_skill_snapshot(session)
        await save_session(session, token=token)
    miss = missing_fields(
        draft,
        focus_contact_id=session.get("focus_contact_id"),
        campaign_profile=session.get("campaign_profile"),
    )
    soft_miss = soft_missing_fields(
        draft, campaign_profile=session.get("campaign_profile")
    )
    if _draft_mode(session) == "update":
        next_field = None
    else:
        next_field = next_creation_prompt_field(
            draft, campaign_profile=session.get("campaign_profile")
        )
    ui_extra: dict[str, Any] = {}
    if staged_create:
        ui_extra["reset"] = True
    from app.agents.contacts.memory_note import (
        append_memory_note,
        note_from_draft_fields,
        note_from_skill_start,
    )

    if ok:
        if staged_create:
            append_memory_note(
                session, note_from_skill_start("contact_creation", action="new_task")
            )
        elif mode_norm == "update" and session.get("focus_contact_id"):
            append_memory_note(
                session, note_from_skill_start("contact_update", action="continue")
            )
        note_line = note_from_draft_fields(draft, mode=_draft_mode(session) or "draft")
        if note_line:
            append_memory_note(session, note_line)
        await save_session(session, token=token)
    prompt = str(args.get("change_summary") or "").strip() or "Draft updated."
    if notes:
        prompt = " ".join(notes) + " " + prompt
    if skip_field and ok:
        if next_field:
            prompt = (
                f"Skipped {skip_field.replace('_', ' ')}. "
                f"Still needed: {next_field.replace('_', ' ')}."
            )
        else:
            prompt = (
                f"Skipped {skip_field.replace('_', ' ')}. "
                "Draft has required fields — ask user to confirm save."
            )
    result: dict[str, Any] = {
        "ok": ok,
        "fields_updated": fields_updated,
        "draft_contact": draft,
        "missing_fields": miss,
        "soft_missing_fields": soft_miss,
        "next_field": next_field,
        "mode": _draft_mode(session),
        "message": prompt,
    }
    chained_lookup: dict[str, Any] | None = None
    extra_ui_events: list[dict[str, Any]] = []
    if ok and str(_draft_mode(session) or "").lower() == "create":
        for field, key in (("email", "email"), ("phone", "phone")):
            if key not in fields_updated:
                continue
            val = str((session.get("draft_contact") or {}).get(key) or "").strip()
            if not val:
                continue
            chained_lookup = await handle_lookup(
                session_id,
                token,
                {
                    field: val,
                    "change_summary": f"Directory check for {key}",
                },
            )
            session = await get_or_create_session(session_id, token=token)
            draft = dict(session.get("draft_contact") or draft)
            session["draft_contact"] = draft
            if chained_lookup.get("ui_event"):
                extra_ui_events.append(chained_lookup["ui_event"])
            if chained_lookup.get("duplicate_during_create"):
                prompt = str(chained_lookup.get("message") or prompt)
                break
            # Unique during create: fold directory result into the tool message so the
            # LLM asks for next_field instead of inventing a "not found" search reply.
            lu_msg = str(chained_lookup.get("message") or "")
            if "unique=true" in lu_msg:
                nf = next_field or next_creation_prompt_field(
                    draft, campaign_profile=session.get("campaign_profile")
                )
                if nf:
                    ask = (
                        f" Ask ONLY for {str(nf).replace('_', ' ')} next "
                        f"(next_field={nf}). No menus, search, or filters."
                    )
                else:
                    ask = (
                        " Required fields are ready — ask to confirm save only. "
                        "No menus, search, or filters."
                    )
                prompt = (
                    f"{prompt} directory_check=ok unique=true create_mode=true. "
                    f"Value kept on the draft.{ask} "
                    "Do not invent a directory miss or claim the identity is missing from CRM."
                )
        if chained_lookup:
            miss = missing_fields(
                draft,
                focus_contact_id=session.get("focus_contact_id"),
                campaign_profile=session.get("campaign_profile"),
            )
            soft_miss = soft_missing_fields(
                draft, campaign_profile=session.get("campaign_profile")
            )
            next_field = next_creation_prompt_field(
                draft, campaign_profile=session.get("campaign_profile")
            )
            result["draft_contact"] = draft
            result["missing_fields"] = miss
            result["soft_missing_fields"] = soft_miss
            result["next_field"] = next_field
            result["message"] = prompt
            if chained_lookup.get("duplicate_during_create"):
                result["duplicate_during_create"] = True
                result["candidates"] = chained_lookup.get("candidates") or []
            elif "unique=true" in str(chained_lookup.get("message") or ""):
                result["directory_unique"] = True

    if ok:
        draft_payload = _draft_ui_payload(session, **ui_extra)
        if chained_lookup and session.get("candidates") is not None:
            draft_payload["candidates"] = list(session.get("candidates") or [])
        if chained_lookup and chained_lookup.get("duplicate_during_create"):
            draft_payload["duplicate_during_create"] = True
            draft_payload["already_exists"] = True
        result["ui_event"] = {
            "type": "draft_updated",
            "payload": draft_payload,
        }
        merged_ui = [result["ui_event"], *extra_ui_events]
        if staged_create and _draft_mode(session) == "create":
            merged_ui.append(
                {
                    "type": "navigate",
                    "payload": {
                        "module": "contacts",
                        "path": "/audience/new",
                        "create": True,
                    },
                },
            )
        if len(merged_ui) > 1 or extra_ui_events:
            result["ui_events"] = merged_ui
    return result


async def handle_verify_focus(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    identity = validate_email_phone(args.get("email"), args.get("phone"))
    if not identity.get("ok"):
        return {"ok": False, "error": identity.get("message") or "Invalid identity."}

    session = await get_or_create_session(session_id, token=token)
    focus_id = str(session.get("focus_contact_id") or "").strip()
    if not focus_id:
        return {
            "ok": True,
            "match": None,
            "focus_contact_id": None,
            "message": "No focused contact — proceed with LOOKUP using email or phone.",
            "email": identity["email"],
            "phone": identity["phone"],
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{_base()}/contacts/{focus_id}",
                headers=_headers(token),
            )
            res.raise_for_status()
            focused = (res.json().get("contact") or {})
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Could not load focused contact: {exc}"}

    email_ok = bool(identity.get("email")) and emails_match(
        identity.get("email"), focused.get("email")
    )
    phone_ok = bool(identity.get("phone")) and phones_match(
        identity.get("phone"), focused.get("phone")
    )
    # Match if any provided identity field matches the focused contact.
    match = bool(email_ok or phone_ok)

    if match:
        session["draft_contact"] = _draft_from_contact(focused)
        session["last_action"] = "verify_match"
        await save_session(session, token=token)
        return {
            "ok": True,
            "match": True,
            "contact_id": focus_id,
            "contact": _contact_summary(focused),
            "email": identity["email"],
            "phone": identity["phone"],
            "message": "Identity matches the opened contact. Proceed with UPDATE_CONTACT.",
            "ui_event": {
                "type": "draft_updated",
                "payload": _draft_ui_payload(session),
            },
        }

    # Mismatch — clear live details; FE may open a fresh chat.
    user_query = str(args.get("user_query") or "").strip()
    session["focus_contact_id"] = None
    session["draft_contact"] = _empty_draft()
    session["candidates"] = []
    session["stage"] = "mismatch"
    session["last_action"] = "verify_mismatch"
    session["draft_mode"] = None
    await save_session(session, token=token)
    return {
        "ok": True,
        "match": False,
        "email": identity["email"],
        "phone": identity["phone"],
        "message": (
            "Identity does not match the opened contact. "
            "Live details were cleared. Ask the user briefly; UI may route to a new chat."
        ),
        "ui_event": {
            "type": "contact_mismatch",
            "payload": {
                "email": identity["email"],
                "phone": identity["phone"],
                "user_query": user_query
                or (
                    "Update contact with "
                    + (
                        f"email {identity['email']}"
                        if identity.get("email")
                        else f"phone {identity['phone']}"
                    )
                ),
                "clear_draft": True,
            },
        },
    }


def _prefer_identity_name(draft_val: Any, arg_val: Any) -> str:
    draft_s = str(draft_val or "").strip()
    arg_s = str(arg_val or "").strip()
    if draft_s and not is_garbage_person_name(draft_s):
        return draft_s
    if arg_s and not is_garbage_person_name(arg_s):
        return arg_s
    return draft_s or ""


async def handle_create(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    if args.get("user_confirmed") is not True:
        return {
            "ok": False,
            "error": (
                "User has not confirmed create yet. Summarize all collected fields and ask "
                "whether to create this contact. Only then call CREATE with user_confirmed=true."
            ),
        }

    session = await get_or_create_session(session_id, token=token)
    if str(session.get("draft_mode") or "").strip().lower() == "create":
        from app.agents.contacts.draft_ingest import missing_fields

        draft = session.get("draft_contact") or {}
        miss = missing_fields(
            draft,
            focus_contact_id=session.get("focus_contact_id"),
            campaign_profile=session.get("campaign_profile"),
        )
        if miss:
            return {
                "ok": False,
                "error": (
                    "Required create fields incomplete — collect first name and email or phone "
                    f"on the draft before create. Still missing: {', '.join(miss)}"
                ),
            }

    async with _create_lock(session_id):
        return await _handle_create_locked(session_id, token, args)


async def _handle_create_locked(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token)
    draft0 = session.get("draft_contact") or {}
    # Prefer explicit tool args; live panel values fill gaps only (no durable draft store).
    identity = validate_email_phone(
        args.get("email") or draft0.get("email"),
        args.get("phone") or draft0.get("phone"),
        require_phone=False,
        require_channel=True,
    )
    if not identity.get("ok"):
        return {"ok": False, "error": identity.get("message") or "Invalid email/phone."}

    draft = _merge_draft(draft0, args)
    if identity.get("email"):
        draft["email"] = str(identity["email"])
    if identity.get("phone"):
        draft["phone"] = str(identity["phone"])

    first_name = _prefer_identity_name(args.get("first_name"), draft0.get("first_name"))
    if not first_name:
        first_name = str(draft.get("first_name") or "").strip()
    last_name = _prefer_identity_name(args.get("last_name"), draft0.get("last_name"))
    if not last_name:
        last_name = str(draft.get("last_name") or "").strip()
    company_name = str(
        args.get("company_name") or draft0.get("company_name") or draft.get("company_name") or ""
    ).strip()
    city = str(args.get("city") or draft0.get("city") or draft.get("city") or "").strip()
    email = identity.get("email") or str(args.get("email") or draft0.get("email") or draft.get("email") or "").strip() or None
    phone = identity.get("phone") or str(args.get("phone") or draft0.get("phone") or draft.get("phone") or "").strip() or None
    draft["first_name"] = first_name
    draft["last_name"] = last_name
    draft["company_name"] = company_name
    draft["city"] = city
    if email:
        draft["email"] = email
    if phone:
        draft["phone"] = phone

    if not first_name or is_garbage_person_name(first_name, last_name):
        return {
            "ok": False,
            "error": (
                "Create blocked: first name is required. "
                "Pass first_name on CREATE_SINGLE_CONTACT (or via SET_DRAFT_FIELDS first)."
            ),
        }

    missing = missing_fields(
        draft,
        include_push=False,
        campaign_profile=session.get("campaign_profile"),
    )
    if missing:
        label = missing[0]
        return {
            "ok": False,
            "error": (
                "Required create fields are incomplete. "
                f"Missing: {', '.join(missing)}. Ask only for {label} next. "
                "Hard gate: first_name + (email or phone). "
                "Last name, city, and company are optional — do not chase them. "
                "Do not ask App push, Web push, or extras unless the user offers them."
            ),
        }

    if not email and not phone:
        return {
            "ok": False,
            "error": (
                "Create blocked: at least one of email or phone is required. "
                "Ask for email or phone, SET_DRAFT_FIELDS, then create after confirm."
            ),
        }

    fingerprint = _create_fingerprint(
        email=email,
        phone=phone,
        first_name=first_name,
        last_name=last_name,
    )
    prior_fp = str(session.get("create_fingerprint") or "")
    prior_id = str(session.get("focus_contact_id") or "").strip()
    stage = str(session.get("stage") or "")
    if prior_id and stage in ("created", "exists"):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.get(
                    f"{_base()}/contacts/{prior_id}",
                    headers=_headers(token),
                )
                res.raise_for_status()
                existing = (res.json() or {}).get("contact") or {}
            if existing.get("id"):
                return await _reuse_existing_create(
                    session,
                    token,
                    existing,
                    fingerprint=fingerprint or prior_fp,
                    already_in_session=True,
                )
        except Exception:  # noqa: BLE001
            pass
    if prior_fp == fingerprint and prior_id:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.get(
                    f"{_base()}/contacts/{prior_id}",
                    headers=_headers(token),
                )
                res.raise_for_status()
                existing = (res.json() or {}).get("contact") or {}
            if existing.get("id"):
                return await _reuse_existing_create(
                    session,
                    token,
                    existing,
                    fingerprint=fingerprint,
                    already_in_session=True,
                )
        except Exception:  # noqa: BLE001
            pass

    existing = await _lookup_existing_contact(token, email=email, phone=phone)
    if existing:
        same_session = str(existing.get("id") or "") == prior_id or prior_fp == fingerprint
        return await _reuse_existing_create(
            session,
            token,
            existing,
            fingerprint=fingerprint,
            already_in_session=same_session,
        )

    payload = {
        "firstName": title_case_person_name(first_name),
        "lastName": title_case_person_name(last_name) or last_name,
        "email": email,
        "phone": phone,
        "companyName": company_name,
        "city": city,
        **_push_payload(draft),
    }
    from app.agents.contacts.draft_ingest import _normalize_custom_fields

    custom_fields = _normalize_custom_fields(draft.get("custom_fields"))
    if custom_fields:
        payload["customFields"] = custom_fields

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/contacts",
                headers=_headers(token),
                json=payload,
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                # Duplicate identity — load existing into the live panel.
                existing = await _lookup_existing_contact(
                    token,
                    email=payload.get("email"),
                    phone=payload.get("phone"),
                )
                if existing:
                    session = await get_or_create_session(session_id, token=token)
                    session["focus_contact_id"] = existing.get("id")
                    session["draft_contact"] = _draft_from_contact(existing)
                    session["candidates"] = [_contact_summary(existing)]
                    session["stage"] = "exists"
                    session["last_action"] = "create_exists"
                    session["draft_mode"] = "update"
                    await save_session(session, token=token)
                    return {
                        "ok": False,
                        "already_exists": True,
                        "contact": _contact_summary(existing),
                        "error": detail.get("message")
                        or "A contact with this email or phone already exists.",
                        "message": (
                            "This contact already exists. Live details were filled "
                            "with the existing record — offer to update instead."
                        ),
                        "ui_event": {
                            "type": "draft_updated",
                            "payload": _draft_ui_payload(
                                session,
                                candidates=[_contact_summary(existing)],
                                already_exists=True,
                            ),
                        },
                    }
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Create failed",
                }
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Create failed: {exc}"}

    contact = body.get("contact") or {}
    saved = _draft_from_contact(contact) if contact else empty_draft()
    saved["first_name"] = first_name
    saved["last_name"] = last_name
    saved["company_name"] = company_name
    saved["city"] = city
    if email:
        saved["email"] = email
    if phone:
        saved["phone"] = phone
    for k in (
        "app_push_token",
        "app_push_platform",
        "app_push_asked",
        "web_push_endpoint",
        "web_push_p256dh",
        "web_push_auth",
        "web_push_asked",
    ):
        if str(draft.get(k) or "").strip() and not str(saved.get(k) or "").strip():
            saved[k] = str(draft.get(k) or "")
    session["focus_contact_id"] = contact.get("id")
    session["draft_contact"] = saved
    session["candidates"] = [_contact_summary({**contact, **{
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "company_name": company_name,
        "city": city,
    }})] if contact else []
    session["create_fingerprint"] = fingerprint
    session["stage"] = "created"
    session["last_action"] = "create"
    session["draft_mode"] = None
    from app.agents.contacts.memory_note import append_memory_note, note_from_create_complete
    from app.mas.skills import CONTACTS_MODULE, apply_skill_pick

    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_creation",
        skill_action="complete",
    )
    session.pop("contact_create_asked", None)

    cite = email or phone or first_name
    append_memory_note(
        session,
        note_from_create_complete(str(contact.get("id") or ""), cite=cite),
    )
    await save_session(session, token=token)
    created_summary = _contact_summary(
        {
            **(contact or {}),
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "phone": phone,
            "company_name": company_name,
            "city": city,
        }
    )
    return {
        "ok": True,
        "contact": created_summary,
        "message": args.get("change_summary") or body.get("message") or "Contact created.",
        "ui_event": {
            "type": "contact_created",
            "payload": {"contact": created_summary},
        },
    }


async def handle_update(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    if args.get("user_confirmed") is not True:
        return {
            "ok": False,
            "error": (
                "User has not confirmed update yet. Summarize the changes and ask "
                "Update this contact? (yes/no). Only then call UPDATE_CONTACT with "
                "user_confirmed=true."
            ),
        }

    contact_id = str(args.get("contact_id") or "").strip()
    if not contact_id:
        return {"ok": False, "error": "contact_id required"}

    provided_email = str(args.get("email") or "").strip()
    provided_phone = str(args.get("phone") or "").strip()
    identity = validate_email_phone(args.get("email"), args.get("phone"))
    session = await get_or_create_session(session_id, token=token)
    _reconcile_contacts_update_session(session_id, session)
    baseline = session.get("update_baseline") or {}
    if baseline:
        if provided_email:
            chk = validate_update_identity_change(baseline, email=provided_email)
            if not chk.get("ok"):
                return {"ok": False, "error": chk.get("message")}
        if provided_phone:
            chk = validate_update_identity_change(baseline, phone=provided_phone)
            if not chk.get("ok"):
                return {"ok": False, "error": chk.get("message")}
    if not identity.get("ok"):
        if provided_email or provided_phone:
            return {
                "ok": False,
                "error": identity.get("message")
                or "Enter a valid email or a phone number with country code.",
            }
        # Field-only updates: reuse draft / existing contact identity.
        draft0 = session.get("draft_contact") or {}
        if draft0.get("email") or draft0.get("phone"):
            identity = {
                "ok": True,
                "email": (draft0.get("email") or "").strip().lower() or None,
                "phone": (draft0.get("phone") or "").strip() or None,
            }
            if identity["phone"]:
                parsed = parse_and_validate_phone(identity["phone"])
                if parsed.get("ok"):
                    identity["phone"] = parsed["e164"]
        else:
            return {
                "ok": False,
                "error": identity.get("message")
                or "Provide email or phone, or load the contact first.",
            }
    draft = _merge_draft(session.get("draft_contact") or {}, args)
    if identity.get("email"):
        draft["email"] = identity["email"]
    if identity.get("phone"):
        draft["phone"] = identity["phone"]

    if not draft.get("first_name") or not (
        str(draft.get("email") or "").strip() or str(draft.get("phone") or "").strip()
    ):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.get(
                    f"{_base()}/contacts/{contact_id}",
                    headers=_headers(token),
                )
                res.raise_for_status()
                current = res.json().get("contact") or {}
                draft = _merge_draft(_draft_from_contact(current), {
                    **args,
                    **(
                        {"email": identity["email"]}
                        if identity.get("email")
                        else {}
                    ),
                    **(
                        {"phone": identity["phone"]}
                        if identity.get("phone")
                        else {}
                    ),
                })
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"Could not load contact for update: {exc}"}

    email_raw = str(draft.get("email") or "").strip()
    phone_raw = str(draft.get("phone") or "").strip()
    if phone_raw:
        phone_check = parse_and_validate_phone(phone_raw)
        if not phone_check.get("ok"):
            return {
                "ok": False,
                "error": str(
                    phone_check.get("message")
                    or "Phone must include a country code (e.g. +91 9876543210)."
                ),
            }
        draft["phone"] = phone_check["e164"]
    if email_raw:
        reviewed = review_email_address(email_raw)
        if not reviewed.get("ok"):
            msg = str(reviewed.get("message") or "Enter a valid email address.")
            if reviewed.get("suggested_email"):
                msg = (
                    f"{msg} Confirm {reviewed['suggested_email']} before saving."
                )
            return {"ok": False, "error": msg}
        draft["email"] = str(reviewed.get("email") or email_raw)
    if not email_raw and not phone_raw:
        return {
            "ok": False,
            "error": "Contact needs a valid email or a phone with country code.",
        }

    payload = {
        "firstName": title_case_person_name(str(draft.get("first_name") or "")),
        "lastName": title_case_person_name(str(draft.get("last_name") or "")) or None,
        "email": draft.get("email") or None,
        "phone": draft.get("phone") or None,
        "companyName": draft["company_name"] or None,
        "city": draft["city"] or None,
        **_push_payload(draft),
    }
    from app.agents.contacts.draft_ingest import _normalize_custom_fields

    custom_fields = _normalize_custom_fields(draft.get("custom_fields"))
    if custom_fields:
        payload["customFields"] = custom_fields
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.put(
                f"{_base()}/contacts/{contact_id}",
                headers=_headers(token),
                json=payload,
            )
            if res.status_code >= 400:
                detail = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Update failed",
                }
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Update failed: {exc}"}

    contact = body.get("contact") or {}
    session["focus_contact_id"] = contact.get("id") or contact_id
    session["draft_contact"] = _draft_from_contact(contact) if contact else draft
    session["stage"] = "updated"
    session["last_action"] = "update"
    await save_session(session, token=token)
    return {
        "ok": True,
        "contact": _contact_summary(contact),
        "message": args.get("change_summary") or body.get("message") or "Contact updated.",
        "ui_event": {
            "type": "contact_updated",
            "payload": {"contact": _contact_summary(contact)},
        },
    }


async def handle_request_delete(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    contact_id = str(args.get("contact_id") or "").strip()
    if not contact_id:
        return {"ok": False, "error": "contact_id required"}
    session = await get_or_create_session(session_id, token=token)
    session["pending_delete_id"] = contact_id
    session["stage"] = "confirm_delete"
    session["last_action"] = "request_delete"
    await save_session(session, token=token)
    return {
        "ok": True,
        "pending_delete_id": contact_id,
        "message": args.get("change_summary")
        or "Ask the user to confirm delete with an explicit yes.",
        "ui_event": {
            "type": "delete_pending",
            "payload": {"contact_id": contact_id},
        },
    }


async def handle_confirm_delete(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token)
    confirmed = bool(args.get("confirmed"))
    contact_id = str(session.get("pending_delete_id") or "").strip()
    if not confirmed:
        session["pending_delete_id"] = None
        session["stage"] = "idle"
        session["last_action"] = "delete_cancelled"
        await save_session(session, token=token)
        return {
            "ok": True,
            "deleted": False,
            "message": args.get("change_summary") or "Delete cancelled.",
        }
    if not contact_id:
        return {"ok": False, "error": "No pending delete. Call REQUEST_DELETE first."}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.delete(
                f"{_base()}/contacts/{contact_id}",
                headers=_headers(token),
            )
            if res.status_code >= 400:
                detail = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Delete failed",
                }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Delete failed: {exc}"}

    session["pending_delete_id"] = None
    if session.get("focus_contact_id") == contact_id:
        session["focus_contact_id"] = None
        session["draft_contact"] = empty_draft()
    session["stage"] = "deleted"
    session["last_action"] = "delete"
    await save_session(session, token=token)
    return {
        "ok": True,
        "deleted": True,
        "contact_id": contact_id,
        "message": args.get("change_summary") or "Contact deleted.",
        "ui_event": {
            "type": "contact_deleted",
            "payload": {"contact_id": contact_id},
        },
    }


async def handle_import(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    raw_rows = args.get("rows") or []
    if not isinstance(raw_rows, list) or not raw_rows:
        return {"ok": False, "error": "Provide rows[] from the user's list/CSV."}
    if len(raw_rows) > 500:
        return {
            "ok": False,
            "error": (
                "Agent import is limited to 500 rows. "
                "Use Audience → Import for larger files."
            ),
        }

    mapped: list[dict[str, Any]] = []
    for r in raw_rows:
        if not isinstance(r, dict):
            continue
        mapped.append(
            {
                "firstName": (
                    str(r.get("first_name") or r.get("firstName") or "").strip()
                    or None
                ),
                "lastName": (
                    str(r.get("last_name") or r.get("lastName") or "").strip()
                    or None
                ),
                "email": str(r.get("email") or "").strip() or None,
                "phone": str(r.get("phone") or "").strip() or None,
                "companyName": (
                    str(
                        r.get("company_name") or r.get("companyName") or ""
                    ).strip()
                    or None
                ),
                "city": str(r.get("city") or "").strip() or None,
                "name": str(r.get("name") or "").strip() or None,
            }
        )
    if not mapped:
        return {"ok": False, "error": "No valid rows to import."}

    payload = {
        "rows": mapped,
        "dryRun": bool(args.get("dry_run")),
        "upsert": bool(args.get("upsert")),
        "consentSource": (
            str(args.get("consent_source") or "unknown").strip() or "unknown"
        ),
        "complianceAcknowledged": bool(args.get("compliance_acknowledged")),
        "sourceLabel": "contacts_agent",
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                f"{_base()}/contacts/import",
                headers=_headers(token),
                json=payload,
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Import failed",
                }
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Import failed: {exc}"}

    imp = body.get("import") or {}
    summary = imp.get("summary") or {}
    status = imp.get("status")
    msg = (
        f"Import {status}: total={summary.get('total', 0)}, "
        f"created={summary.get('created', 0)}, "
        f"updated={summary.get('updated', 0)}, "
        f"skipped={summary.get('skipped', 0)}, "
        f"failed={summary.get('failed', 0)}. "
        f"Quality score={imp.get('quality_score', 0)}."
    )
    if status == "held_for_review":
        msg += (
            " Held for compliance — ask the user to confirm review, then retry "
            "with compliance_acknowledged=true."
        )
    return {
        "ok": True,
        "message": args.get("change_summary") or msg,
        "import": {
            "status": status,
            "summary": summary,
            "quality_score": imp.get("quality_score"),
            "consent_weak": imp.get("consent_weak"),
            "error_sample": (imp.get("errors") or [])[:10],
        },
        "ui_event": {
            "type": "contacts_imported",
            "payload": {"status": status, "summary": summary},
        },
    }


async def _apply_pack_to_session(
    session: dict[str, Any],
    pack_body: Any,
    token: str,
) -> dict[str, Any]:
    from app.industry_packs.tenant_pack import normalize_company_pack

    pack = normalize_company_pack(pack_body)
    if pack:
        session["company_pack"] = pack
        await save_session(session, token=token)
    return session


async def handle_get_company_pack(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module="contacts")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                f"{_base()}/industry-pack",
                headers=_headers(token),
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Pack fetch failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Pack fetch failed: {exc}"}

    pack_row = body.get("pack") or body
    await _apply_pack_to_session(session, pack_row, token)
    payload = (pack_row or {}).get("payload") or {}
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "fields": payload.get("fields") or [],
        "rules": payload.get("rules") or [],
        "message": args.get("change_summary") or "Company pack loaded.",
    }


async def handle_add_company_rule(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    text = str(args.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "Rule text is required."}
    session = await get_or_create_session(session_id, token=token, module="contacts")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                f"{_base()}/industry-pack/rules",
                headers=_headers(token),
                json={"text": text, "source": "agent"},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Add rule failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Add rule failed: {exc}"}

    await _apply_pack_to_session(session, body.get("pack") or body, token)
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "message": args.get("change_summary") or "Company rule added.",
    }


async def handle_update_company_rule(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    rule_id = str(args.get("rule_id") or "").strip()
    text = str(args.get("text") or "").strip()
    if not rule_id or not text:
        return {"ok": False, "error": "rule_id and text are required."}
    session = await get_or_create_session(session_id, token=token, module="contacts")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.patch(
                f"{_base()}/industry-pack/rules/{rule_id}",
                headers=_headers(token),
                json={"text": text},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Update rule failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Update rule failed: {exc}"}

    await _apply_pack_to_session(session, body.get("pack") or body, token)
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "message": args.get("change_summary") or "Company rule updated.",
    }


async def handle_delete_company_rule(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    rule_id = str(args.get("rule_id") or "").strip()
    if not rule_id:
        return {"ok": False, "error": "rule_id is required."}
    session = await get_or_create_session(session_id, token=token, module="contacts")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.delete(
                f"{_base()}/industry-pack/rules/{rule_id}",
                headers=_headers(token),
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Delete rule failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Delete rule failed: {exc}"}

    await _apply_pack_to_session(session, body.get("pack") or body, token)
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "message": args.get("change_summary") or "Company rule deleted.",
    }


async def handle_upsert_pack_field(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    key = str(args.get("key") or "").strip()
    if not key:
        return {"ok": False, "error": "Field key is required."}
    session = await get_or_create_session(session_id, token=token, module="contacts")
    payload = {
        "key": key,
        "label": str(args.get("label") or "").strip() or None,
        "type": "number" if str(args.get("type") or "") == "number" else "string",
        "ask": (
            "recommended"
            if str(args.get("ask") or "") == "recommended"
            else "optional"
        ),
        "status": "active",
        "source": "user",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                f"{_base()}/industry-pack/fields",
                headers=_headers(token),
                json={k: v for k, v in payload.items() if v is not None},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Upsert field failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Upsert field failed: {exc}"}

    await _apply_pack_to_session(session, body.get("pack") or body, token)
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "message": args.get("change_summary") or "Pack field saved.",
    }


async def handle_confirm_pack_field(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    key = str(args.get("key") or "").strip()
    if not key:
        return {"ok": False, "error": "Field key is required."}
    session = await get_or_create_session(session_id, token=token, module="contacts")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.patch(
                f"{_base()}/industry-pack/fields/{key}",
                headers=_headers(token),
                json={"status": "active"},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Confirm field failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Confirm field failed: {exc}"}

    await _apply_pack_to_session(session, body.get("pack") or body, token)
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "message": args.get("change_summary") or f"Confirmed pack field “{key}”.",
    }


async def handle_delete_pack_field(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    key = str(args.get("key") or "").strip()
    if not key:
        return {"ok": False, "error": "Field key is required."}
    session = await get_or_create_session(session_id, token=token, module="contacts")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.delete(
                f"{_base()}/industry-pack/fields/{key}",
                headers=_headers(token),
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Delete field failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Delete field failed: {exc}"}

    await _apply_pack_to_session(session, body.get("pack") or body, token)
    return {
        "ok": True,
        "pack": session.get("company_pack"),
        "message": args.get("change_summary") or f"Removed pack field “{key}”.",
    }


async def handle_route_to_module(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.agents.routing import route_to_module_result

    _ = session_id, token
    # LLM must pass create=true explicitly — do not infer from query wording.
    return route_to_module_result(
        module=str(args.get("module") or ""),
        query=str(args.get("query") or ""),
        create=_truthy_arg(args.get("create")),
        change_summary=str(args.get("change_summary") or ""),
    )


def _normalize_jun30_contact_args(args: dict[str, Any] | None) -> dict[str, Any]:
    """Map Jun30 camelCase contact tool args onto rebuild handler shapes."""
    a = dict(args or {})
    aliases = {
        "firstName": "first_name",
        "lastName": "last_name",
        "phoneNumber": "phone",
        "whatsappNumber": "phone",
        "CompanyName": "company_name",
        "companyName": "company_name",
        "postCode": "post_code",
        "JobTitle": "job_title",
        "fileUrl": "file_url",
        "isTemp": "is_temp",
        "id": "contact_id",
    }
    for src, dest in aliases.items():
        if a.get(src) is not None and (a.get(dest) is None or a.get(dest) == ""):
            a[dest] = a.get(src)
    # Fold known extras into custom_fields.
    extras: dict[str, Any] = {}
    for k in (
        "Age",
        "customertag",
        "Gender",
        "Language",
        "TimeZone",
        "IndustryType",
        "JobTitle",
        "job_title",
        "Department",
        "company_size",
        "company_type",
        "company_email_domain",
        "address",
        "state",
        "country",
        "postCode",
        "post_code",
        "lifeCycleStage",
    ):
        if a.get(k) is not None and str(a.get(k) or "").strip():
            extras[str(k)] = a.get(k)
    if extras:
        from app.agents.contacts.draft_ingest import _normalize_custom_fields

        a["custom_fields"] = {
            **_normalize_custom_fields(a.get("custom_fields")),
            **_normalize_custom_fields(extras),
        }
    if not str(a.get("change_summary") or "").strip():
        a["change_summary"] = "Contact tool"
    return a


async def handle_query_contacts(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Natural-language contact view — internal read-only SQL agent (3-try retry)."""
    user_request = str(
        args.get("user_request") or args.get("query") or args.get("search") or ""
    ).strip()
    change_summary = str(args.get("change_summary") or "Query contacts").strip()
    if not user_request:
        return {"ok": False, "error": "user_request required for QUERY_CONTACTS."}

    from app.agents.contacts.draft_ingest import EMAIL_FIND_RE
    from app.agents.contacts.validation import looks_like_email_attempt

    # Single malformed email must not run SQL/filter (e.g. pujitha123gmail.co).
    if looks_like_email_attempt(user_request):
        found = EMAIL_FIND_RE.search(user_request)
        check_raw = found.group(0) if found else user_request.strip()
        reviewed = review_email_address(check_raw)
        if not reviewed.get("ok"):
            return {
                "ok": False,
                "error": str(reviewed.get("error") or "invalid_email_format"),
                "message": str(
                    reviewed.get("message")
                    or "Enter a valid email address (name@company.com) before searching."
                ),
                "suggested_email": reviewed.get("suggested_email"),
            }

    from app.agents.contacts.contact_query_memory import build_contact_query_memory
    from app.agents.contacts.contact_sql_agent import (
        run_contact_sql_query,
        run_contact_sql_query_via_filter_api,
    )
    from app.agents.contacts.memory_note import append_memory_note, get_memory_note
    from app.agents.reports.org_context import resolve_organization_id
    from app.config import get_settings

    session = await get_or_create_session(session_id, token=token)
    explicit_request = str(args.get("user_request") or "").strip()
    memory = build_contact_query_memory(session, user_text=explicit_request)
    if not explicit_request:
        memory = build_contact_query_memory(session, user_text=user_request)

    sql_result: dict[str, Any] | None = None
    filter_result: dict[str, Any] | None = None

    if get_settings().account_database_url.strip():
        org_id = await resolve_organization_id(session, token)
        if not org_id:
            return {"ok": False, "error": "Could not resolve organization for SQL query."}
        sql_result = await run_contact_sql_query(
            user_request=user_request,
            org_id=org_id,
            memory=memory,
        )

    filter_result = await run_contact_sql_query_via_filter_api(
        token=token,
        user_request=user_request,
        memory=memory,
    )

    sql_ok = bool(sql_result and sql_result.get("ok"))
    sql_count = int(sql_result.get("count") or 0) if sql_ok else 0
    filter_ok = bool(filter_result and filter_result.get("ok"))
    filter_count = int(filter_result.get("count") or 0) if filter_ok else 0

    if filter_ok and (not sql_ok or filter_count > sql_count):
        sql_result = filter_result
    elif sql_ok:
        pass
    elif filter_ok:
        sql_result = filter_result
    else:
        sql_result = sql_result or filter_result or {
            "ok": False,
            "error": "Contact query failed.",
        }

    if not sql_result.get("ok"):
        return {
            "ok": False,
            "error": sql_result.get("error") or "Contact query failed.",
            "attempts": sql_result.get("attempts"),
            "message": sql_result.get("error") or "Contact query failed.",
        }

    from app.agents.contacts.contact_sql_agent import QUERY_PANEL_MAX

    rows = list(sql_result.get("rows") or [])
    count = int(sql_result.get("count") or len(rows))
    panel_rows = rows[:QUERY_PANEL_MAX]
    sample = [_contact_summary(r) for r in panel_rows if _contact_summary(r)]

    view_flow = True
    session["candidates"] = sample
    session["query_panel_candidates"] = sample
    session["query_panel_count"] = count
    session["stage"] = "search"
    session["last_action"] = "query_contacts"
    if view_flow:
        session["draft_mode"] = "view"
        session.pop("update_baseline", None)
        if len(sample) == 1 and sample[0].get("id"):
            session["focus_contact_id"] = sample[0]["id"]
            session["draft_contact"] = _draft_from_contact(
                {**sample[0], "custom_fields": sample[0].get("custom_fields") or {}}
            )
        else:
            session["focus_contact_id"] = None
    await save_session(session, token=token)
    if view_flow and sample:
        _sync_contact_skill_snapshot(session)
        await save_session(session, token=token)

    msg = (
        change_summary
        or sql_result.get("message")
        or f"{count} contacts match."
    )
    if count == 0:
        msg = change_summary or "No contacts matched that request."
    elif count > len(sample):
        msg = (
            f"{count} contacts match. Showing {len(sample)} in the panel — "
            "scroll the list or ask to narrow the filter."
        )

    ui_payload: dict[str, Any] = {
        "candidates": sample,
        "matched_count": count,
        "draft_contact": session.get("draft_contact"),
        "focus_contact_id": session.get("focus_contact_id"),
        "mode": "view",
        "list_query": True,
    }

    note = f"Query: {count} match(es) for {user_request[:120]}"
    append_memory_note(session, note)
    await save_session(session, token=token)

    return {
        "ok": True,
        "matched_count": count,
        "count": count,
        "sample": sample,
        "source": sql_result.get("source") or "sql",
        "sql": sql_result.get("sql"),
        "message": msg,
        "ui_event": {
            "type": "contact_candidates",
            "payload": ui_payload,
        },
    }


async def handle_view_contact(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Unified read-only contact view — identity lookup, filters, or contact_id."""
    args = dict(args or {})
    change_summary = str(args.get("change_summary") or "View contact").strip()
    contact_id = str(args.get("contact_id") or "").strip()

    filter_args: dict[str, Any] = {}
    for key in ("city", "company", "job_title", "search"):
        val = str(args.get(key) or "").strip()
        if val:
            filter_args[key] = val
    for key in ("has_email", "has_phone"):
        if args.get(key) is not None and args.get(key) != "":
            filter_args[key] = args[key]

    email = str(args.get("email") or "").strip()
    phone = str(args.get("phone") or "").strip()
    full_name = str(args.get("full_name") or args.get("fullName") or "").strip()

    view_ctx = {"_panel_mode": "view", "change_summary": change_summary}

    if contact_id:
        return await handle_get(
            session_id,
            token,
            {**view_ctx, "contact_id": contact_id},
        )

    if filter_args:
        return await handle_search(session_id, token, {**view_ctx, **filter_args})

    if email:
        reviewed = review_email_address(email)
        if not reviewed.get("ok"):
            return {
                "ok": False,
                "error": str(reviewed.get("error") or "invalid_email_format"),
                "message": str(
                    reviewed.get("message")
                    or "Enter a valid email address (name@company.com)."
                ),
                "suggested_email": reviewed.get("suggested_email"),
            }
        email = str(reviewed.get("email") or email)

    if phone:
        ph = parse_and_validate_phone(phone)
        if not ph.get("ok"):
            return {
                "ok": False,
                "error": "invalid_phone_format",
                "message": str(
                    ph.get("message")
                    or "Enter a phone with country code (e.g. +91 9876543210)."
                ),
            }
        phone = str(ph.get("e164") or phone)

    if email or phone or full_name:
        lookup_args = {**view_ctx}
        if email:
            lookup_args["email"] = email
        if phone:
            lookup_args["phone"] = phone
        if full_name:
            lookup_args["full_name"] = full_name
        return await handle_lookup(session_id, token, lookup_args)

    return {
        "ok": False,
        "error": (
            "Provide contact_id, email, phone, full_name, or filters "
            "(city, company, job_title, search)."
        ),
    }


async def handle_get_contact_detail(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Jun30 GET_CONTACT_DETAIL — lookup by email / phone / name in input_field."""
    raw = str(args.get("input_field") or args.get("inputField") or "").strip()
    if not raw:
        return {"ok": False, "error": "input_field required (email, phone, or name)."}
    lookup_args: dict[str, Any] = {
        "change_summary": args.get("change_summary") or f"Lookup {raw}",
    }
    if "@" in raw:
        lookup_args["email"] = raw
    elif any(ch.isdigit() for ch in raw):
        lookup_args["phone"] = raw
    else:
        lookup_args["full_name"] = raw
    return await handle_lookup(session_id, token, lookup_args)


async def handle_contact_view_and_download(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Jun30 CONTACT_VIEW_AND_DOWNLOAD → search/view contacts."""
    query = str(args.get("query") or "").strip()
    return await handle_search(
        session_id,
        token,
        {
            "search": query,
            "change_summary": args.get("change_summary")
            or (f"View contacts: {query}" if query else "View contacts"),
        },
    )


async def handle_create_single_contact(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Jun30 CREATE_SINGLE_CONTACT — after interview complete + user confirmation."""
    normalized = _normalize_jun30_contact_args(args)
    if normalized.get("user_confirmed") is not True:
        return {
            "ok": False,
            "error": (
                "Pass user_confirmed=true only after the user clearly agreed to create "
                "following your summary."
            ),
        }
    return await handle_create(session_id, token, normalized)


async def handle_update_single_contact(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Jun30 UPDATE_SINGLE_CONTACT — called after collecting update fields."""
    normalized = _normalize_jun30_contact_args(args)
    normalized["user_confirmed"] = True
    if not str(normalized.get("contact_id") or "").strip():
        session = await get_or_create_session(session_id, token=token)
        focus = str(session.get("focus_contact_id") or "").strip()
        if focus:
            normalized["contact_id"] = focus
    return await handle_update(session_id, token, normalized)


async def handle_create_bulk_contact(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Jun30 CREATE_BULK_CONTACT — permanent import (isTemp=0)."""
    normalized = _normalize_jun30_contact_args(args)
    rows = normalized.get("rows")
    if isinstance(rows, list) and rows:
        return await handle_import(
            session_id,
            token,
            {
                **normalized,
                "upsert": False,
                "dry_run": bool(normalized.get("dry_run")),
                "change_summary": normalized.get("change_summary")
                or "Bulk create contacts from sheet",
            },
        )
    file_url = str(normalized.get("file_url") or "").strip()
    if file_url:
        session = await get_or_create_session(session_id, token=token)
        session["upload_url"] = file_url
        await save_session(session, token=token)
        return {
            "ok": False,
            "error": (
                "Sheet URL saved. Ask the user to attach/paste the CSV rows in chat "
                "or use Audience Import, then call CREATE_BULK_CONTACT with rows[], "
                "or confirm the file was parsed by the UI."
            ),
            "file_url": file_url,
        }
    return {
        "ok": False,
        "error": "Provide rows[] from the sheet, or fileUrl after the user uploads.",
    }


async def handle_update_bulk_contact(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Jun30 UPDATE_BULK_CONTACT — upsert import from sheet."""
    normalized = _normalize_jun30_contact_args(args)
    rows = normalized.get("rows")
    if isinstance(rows, list) and rows:
        return await handle_import(
            session_id,
            token,
            {
                **normalized,
                "upsert": True,
                "dry_run": bool(normalized.get("dry_run")),
                "change_summary": normalized.get("change_summary")
                or "Bulk update contacts from sheet",
            },
        )
    file_url = str(normalized.get("file_url") or "").strip()
    if file_url:
        session = await get_or_create_session(session_id, token=token)
        session["upload_url"] = file_url
        await save_session(session, token=token)
        return {
            "ok": False,
            "error": (
                "Sheet URL saved. Provide rows[] for UPDATE_BULK_CONTACT "
                "(or use Audience Import upsert)."
            ),
            "file_url": file_url,
        }
    return {
        "ok": False,
        "error": "Provide rows[] from the sheet, or fileUrl after the user uploads.",
    }


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    handlers = {
        # Jun30-facing tools (Audience)
        "GET_CONTACT_DETAIL": handle_get_contact_detail,
        "VIEW_CONTACT": handle_view_contact,
        "QUERY_CONTACTS": handle_query_contacts,
        "CONTACT_VIEW_AND_DOWNLOAD": handle_contact_view_and_download,
        "CREATE_SINGLE_CONTACT": handle_create_single_contact,
        "CREATE_BULK_CONTACT": handle_create_bulk_contact,
        "UPDATE_SINGLE_CONTACT": handle_update_single_contact,
        "UPDATE_BULK_CONTACT": handle_update_bulk_contact,
        "SET_DRAFT_FIELDS": handle_set_draft,
        # Legacy aliases (tests / older sessions)
        "LOOKUP_CONTACT": handle_lookup,
        "GET_CONTACT": handle_get,
        "SEARCH_CONTACTS": handle_search,
        "VERIFY_FOCUS_IDENTITY": handle_verify_focus,
        "CREATE_CONTACT": handle_create,
        "UPDATE_CONTACT": handle_update,
        "IMPORT_CONTACTS": handle_import,
        "GET_COMPANY_PACK": handle_get_company_pack,
        "ADD_COMPANY_RULE": handle_add_company_rule,
        "UPDATE_COMPANY_RULE": handle_update_company_rule,
        "DELETE_COMPANY_RULE": handle_delete_company_rule,
        "UPSERT_PACK_FIELD": handle_upsert_pack_field,
        "CONFIRM_PACK_FIELD": handle_confirm_pack_field,
        "DELETE_PACK_FIELD": handle_delete_pack_field,
        "ROUTE_TO_MODULE": handle_route_to_module,
    }
    handler = handlers.get(name)
    if not handler:
        return {"ok": False, "error": f"Unknown tool: {name}"}
    result = await handler(session_id, token, args)
    ui = result.get("ui_event")
    if (
        isinstance(ui, dict)
        and ui.get("type") == "contact_candidates"
        and isinstance(ui.get("payload"), dict)
    ):
        payload = ui["payload"]
        if payload.get("candidates") and not payload.get("mode"):
            payload["mode"] = "view"
    if event_callback and result.get("ui_event"):
        await event_callback(result["ui_event"])
    if event_callback:
        primary = result.get("ui_event")
        for ev in result.get("ui_events") or []:
            if not isinstance(ev, dict) or not ev.get("type"):
                continue
            if primary is not None and ev is primary:
                continue
            if primary is not None and ev == primary:
                continue
            await event_callback(ev)
    return result
