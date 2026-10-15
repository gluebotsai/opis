"""Approved WhatsApp agent tools — audience + direct regulated send."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.agents.contacts.validation import parse_and_validate_phone
from app.config import get_settings
from app.session_store import get_or_create_session, save_session

MODULE = "whatsapp_approved"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def _digits_phone(raw: str) -> str | None:
    """Normalize to digits with country code (collapses double CC via parser)."""
    text = str(raw or "").strip()
    if not text:
        return None
    parsed = parse_and_validate_phone(text)
    if parsed.get("ok"):
        return re.sub(r"\D", "", str(parsed["e164"]))
    return None


def _audience(session: dict[str, Any]) -> dict[str, Any]:
    raw = session.get("whatsapp_audience")
    if isinstance(raw, dict):
        return {
            "phones": [str(p) for p in (raw.get("phones") or []) if p],
            "contact_ids": [str(c) for c in (raw.get("contact_ids") or []) if c],
        }
    return {"phones": [], "contact_ids": []}


async def handle_set_audience(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(
        session_id, token=token, module=MODULE
    )
    prior = _audience(session)
    mode = str(args.get("mode") or "replace").lower()
    phones_in = [
        p
        for p in (_digits_phone(x) for x in (args.get("phones") or []))
        if p
    ]
    ids_in = [
        str(x).strip()
        for x in (args.get("contact_ids") or [])
        if str(x).strip()
    ]

    if mode == "add":
        phones = list(dict.fromkeys([*prior["phones"], *phones_in]))
        contact_ids = list(dict.fromkeys([*prior["contact_ids"], *ids_in]))
    else:
        phones = list(dict.fromkeys(phones_in)) if phones_in else (
            [] if ids_in else prior["phones"]
        )
        contact_ids = list(dict.fromkeys(ids_in)) if ids_in else (
            [] if phones_in else prior["contact_ids"]
        )
        if phones_in and not ids_in:
            contact_ids = []
        if ids_in and not phones_in:
            phones = []

    if not phones and not contact_ids:
        return {
            "ok": False,
            "error": "Provide at least one phone (with country code) or contact_id.",
        }

    session["whatsapp_audience"] = {
        "phones": phones[:500],
        "contact_ids": contact_ids[:500],
        "contacts_sample": list(args.get("contacts_sample") or [])[:10],
    }
    session["last_action"] = "set_audience"
    from app.agents.whatsapp_approved.launch_helpers import sync_audience_panel_from_whatsapp

    sync_audience_panel_from_whatsapp(
        session,
        matched_count=len(phones) + len(contact_ids),
        description=str(args.get("change_summary") or "").strip() or None,
    )
    if contact_ids:
        from app.session_store import save_audience_ids

        try:
            await save_audience_ids(session_id, contact_ids[:500], token=token)
        except Exception:  # noqa: BLE001
            pass
    await save_session(session, token=token)
    if session.get("whatsapp_approved_run"):
        from app.agents.whatsapp_approved.launch_helpers import (
            finalize_whatsapp_approved_audience,
            wa_audience_tool_suffix,
        )

        await finalize_whatsapp_approved_audience(session_id, token)
        session = await get_or_create_session(session_id, token=token, module=MODULE)
    summary = args.get("change_summary") or "Audience updated."
    msg = summary
    if session.get("whatsapp_approved_run"):
        from app.agents.whatsapp_approved.launch_helpers import wa_audience_tool_suffix

        msg += wa_audience_tool_suffix(session)
    return {
        "ok": True,
        "message": msg,
        "phone_count": len(phones),
        "contact_id_count": len(contact_ids),
        "phones_sample": phones[:5],
        "contacts_sample": list(
            (session.get("whatsapp_audience") or {}).get("contacts_sample") or []
        )[:5],
        "ui_event": {
            "type": "whatsapp_audience_updated",
            "payload": {
                "phone_count": len(phones),
                "contact_id_count": len(contact_ids),
            },
        },
    }


async def handle_filter_contacts(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    filters: dict[str, Any] = {}
    if args.get("search"):
        filters["search"] = str(args["search"]).strip()
    if args.get("emails"):
        filters["emails"] = [str(e).strip() for e in args["emails"] if e]
    phone_digits = [
        p
        for p in (_digits_phone(x) for x in (args.get("phones") or []))
        if p
    ]
    if phone_digits:
        filters["phones"] = phone_digits
    if args.get("city"):
        filters["city"] = str(args["city"]).strip()
    company = args.get("company_name") or args.get("company")
    if company:
        filters["company"] = str(company).strip()
    # Prefer WhatsApp-capable contacts when segmenting for send
    filters["has_phone"] = True

    if not any(
        filters.get(k)
        for k in ("search", "emails", "city", "company")
    ) and not phone_digits:
        return {
            "ok": False,
            "error": "Provide search, emails, phones, city, or company_name.",
        }

    # If user only passed phones, store them directly (more reliable than search)
    if phone_digits and not any(
        filters.get(k) for k in ("emails", "city", "company")
    ) and (
        not args.get("search")
        or str(args.get("search") or "").strip() in phone_digits
    ):
        return await handle_set_audience(
            session_id,
            token,
            {
                "phones": phone_digits,
                "mode": args.get("mode") or "replace",
                "change_summary": args.get("change_summary")
                or f"Audience set to {len(phone_digits)} phone(s).",
            },
        )

    session = await get_or_create_session(session_id, token=token)
    url = f"{_base()}/contacts/filter"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                url, json={"filters": filters}, headers=_headers(token)
            )
            res.raise_for_status()
            body = res.json()
    except Exception as err:  # noqa: BLE001
        return {"ok": False, "error": f"Filter failed: {err}"}

    data = body.get("data") if isinstance(body.get("data"), dict) else body
    contact_ids = [str(x) for x in (data.get("contact_ids") or []) if x]
    count = int(data.get("count") or len(contact_ids))
    if not contact_ids:
        return {
            "ok": False,
            "error": "No contacts matched. Try different filters or paste phone numbers.",
            "matched_count": 0,
        }

    # Reuse SET_AUDIENCE storage; attach sample for "show the contact"
    sample = data.get("sample") or []
    sample_rows: list[dict[str, Any]] = []
    sample_phones: list[str] = []
    for row in sample[:10]:
        if not isinstance(row, dict):
            continue
        phone = _digits_phone(
            str(row.get("phone") or row.get("mobile") or "")
        )
        if phone:
            sample_phones.append(phone)
        first = str(row.get("first_name") or "").strip()
        last = str(row.get("last_name") or "").strip()
        name = " ".join(p for p in [first, last] if p).strip()
        sample_rows.append(
            {
                "id": row.get("id"),
                "name": name or None,
                "email": row.get("email"),
                "phone": phone or row.get("phone"),
            }
        )

    set_args: dict[str, Any] = {
        "contact_ids": contact_ids[:500],
        "mode": args.get("mode") or "replace",
        "change_summary": args.get("change_summary")
        or f"Matched {count} contacts.",
        "contacts_sample": sample_rows,
    }
    if sample_phones:
        set_args["phones"] = list(dict.fromkeys(sample_phones))
    result = await handle_set_audience(session_id, token, set_args)
    result["matched_count"] = count
    result["filters"] = filters
    if result.get("ok"):
        session = await get_or_create_session(
            session_id, token=token, module=MODULE
        )
        from app.agents.whatsapp_approved.launch_helpers import (
            finalize_whatsapp_approved_audience,
            sync_audience_panel_from_whatsapp,
        )
        from app.session_store import save_audience_ids

        try:
            await save_audience_ids(session_id, contact_ids[:500], token=token)
        except Exception:  # noqa: BLE001
            pass
        sync_audience_panel_from_whatsapp(session, matched_count=count)
        await save_session(session, token=token)
        fin = await finalize_whatsapp_approved_audience(session_id, token)
        if fin.get("ok"):
            result["message"] = (
                str(result.get("message") or "")
                + " Audience frozen for launch — confirm send timing next."
            )
        elif fin.get("error"):
            result["audience_freeze_warning"] = fin.get("error")
    if sample_rows:
        result["sample"] = sample_rows[:5]
    return result


async def handle_send(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    if not args.get("user_confirmed"):
        return {
            "ok": False,
            "error": "User did not confirm. Ask: Send now to this audience? (yes/no).",
        }

    session = await get_or_create_session(
        session_id, token=token, module=MODULE
    )
    snap = session.get("whatsapp_template_snapshot") or {}
    template_id = str(snap.get("id") or "").strip()
    if not template_id:
        return {
            "ok": False,
            "error": "Missing approved template id in session snapshot.",
        }

    audience = _audience(session)
    phones = [
        p
        for p in (_digits_phone(x) for x in audience["phones"])
        if p
    ]
    contact_ids = audience["contact_ids"]
    if not phones and not contact_ids:
        return {
            "ok": False,
            "error": "No audience yet. Call SET_AUDIENCE or FILTER_CONTACTS first.",
        }

    # Persist cleaned phones so UI / retries don't keep the double-CC form.
    if phones != audience["phones"]:
        session["whatsapp_audience"] = {
            **audience,
            "phones": phones,
        }
        await save_session(session, token=token)

    # Send both when available — backend dedupes phones; phones cover CDP miss.
    payload: dict[str, Any] = {}
    if contact_ids:
        payload["contactIds"] = contact_ids[:500]
    if phones:
        if len(phones) == 1 and not contact_ids:
            payload["to"] = phones[0]
        else:
            payload["tos"] = phones[:500]
    body_params = args.get("body_params")
    if isinstance(body_params, list) and body_params:
        payload["bodyParams"] = [str(x) for x in body_params]

    url = f"{_base()}/templates/regulated/{template_id}/send"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(url, json=payload, headers=_headers(token))
            if res.status_code >= 400:
                try:
                    err_body = res.json()
                    msg = (
                        err_body.get("message")
                        or err_body.get("error")
                        or res.text
                    )
                    if isinstance(msg, dict):
                        msg = msg.get("message") or json.dumps(msg)
                except Exception:  # noqa: BLE001
                    msg = res.text
                err_text = f"Send failed ({res.status_code}): {msg}"
                return {
                    "ok": False,
                    "error": err_text,
                    "message": err_text,
                    "ui_event": {
                        "type": "whatsapp_approved_sent",
                        "payload": {
                            "sent": False,
                            "recipient_count": 0,
                            "failed_count": 1,
                            "error": err_text,
                        },
                    },
                }
            body = res.json()
    except Exception as err:  # noqa: BLE001
        err_text = f"Send request failed: {err}"
        return {
            "ok": False,
            "error": err_text,
            "message": err_text,
            "ui_event": {
                "type": "whatsapp_approved_sent",
                "payload": {
                    "sent": False,
                    "recipient_count": 0,
                    "failed_count": 1,
                    "error": err_text,
                },
            },
        }

    data = body.get("data") if isinstance(body.get("data"), dict) else body
    results = data.get("results") or []
    sent_ok = bool(data.get("sent"))
    recipient_count = int(
        data.get("recipient_count") or len(results) or 0
    )
    failed = [
        r
        for r in results
        if isinstance(r, dict) and r.get("sent") is False
    ]
    session["last_action"] = "send_approved_template"
    session["last_send_result"] = {
        "sent": sent_ok,
        "recipient_count": recipient_count,
        "providerMessageId": data.get("providerMessageId"),
        "languageCode": data.get("languageCode"),
    }
    await save_session(session, token=token)

    if not sent_ok:
        fail_msg = (
            f"Send completed with {len(failed)} failure(s) "
            f"across {recipient_count} recipient(s)."
        )
        return {
            "ok": False,
            "error": fail_msg,
            "message": fail_msg,
            "sent": False,
            "recipient_count": recipient_count,
            "failed_count": len(failed),
            "results_sample": results[:5],
            "ui_event": {
                "type": "whatsapp_approved_sent",
                "payload": {
                    "sent": False,
                    "recipient_count": recipient_count,
                    "failed_count": len(failed),
                    "error": fail_msg,
                    "providerMessageId": data.get("providerMessageId"),
                },
            },
        }

    summary = args.get("change_summary") or (
        f"Sent to {recipient_count} recipient(s)."
    )
    return {
        "ok": True,
        "message": summary,
        "sent": True,
        "recipient_count": recipient_count,
        "failed_count": 0,
        "providerMessageId": data.get("providerMessageId"),
        "languageCode": data.get("languageCode"),
        "results_sample": results[:5],
        "ui_event": {
            "type": "whatsapp_approved_sent",
            "payload": {
                "sent": True,
                "recipient_count": recipient_count,
                "failed_count": 0,
                "providerMessageId": data.get("providerMessageId"),
            },
        },
    }


async def handle_upload_temporary_contacts(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback=None,
) -> dict[str, Any]:
    from app.agents.create_campaign.tool_functions import (
        handle_upload_temporary_contacts as upload_impl,
    )

    result = await upload_impl(
        session_id,
        token,
        args,
        event_callback=event_callback,
    )
    if result.get("ok"):
        session = await get_or_create_session(
            session_id, token=token, module=MODULE
        )
        try:
            from app.session_store import load_audience_ids

            ids = await load_audience_ids(session_id, token=token)
        except Exception:  # noqa: BLE001
            ids = []
        wa = session.get("whatsapp_audience")
        wa_dict = wa if isinstance(wa, dict) else {}
        session["whatsapp_audience"] = {
            **wa_dict,
            "contact_ids": ids[:500],
            "phones": wa_dict.get("phones") or [],
        }
        from app.agents.whatsapp_approved.launch_helpers import (
            sync_audience_panel_from_whatsapp,
        )

        sync_audience_panel_from_whatsapp(
            session,
            matched_count=len(ids) or int(result.get("inserted") or 0),
        )
        await save_session(session, token=token)
        result.setdefault(
            "ui_event",
            {
                "type": "whatsapp_audience_updated",
                "payload": {
                    "phone_count": len(wa_dict.get("phones") or []),
                    "contact_id_count": len(ids),
                },
            },
        )
    return result


async def handle_launch_approved_campaign(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback=None,
) -> dict[str, Any]:
    if not args.get("user_confirmed"):
        return {
            "ok": False,
            "error": "User did not confirm launch. Ask for send now or a schedule time.",
        }

    session = await get_or_create_session(
        session_id, token=token, module=MODULE
    )
    snap = session.get("whatsapp_template_snapshot") or {}
    if not snap.get("name"):
        return {
            "ok": False,
            "error": "Missing approved template snapshot in session.",
        }

    from app.agents.whatsapp_approved.launch_helpers import (
        seed_approved_campaign_session,
        sync_launch_audience,
    )

    session = seed_approved_campaign_session(session, snap)
    ok_aud, aud_err = await sync_launch_audience(session_id, token, session)
    if not ok_aud:
        return {"ok": False, "error": aud_err}

    await save_session(session, token=token)

    from app.agents.create_campaign.tool_functions import handle_launch_campaign

    schedule_mode = str(args.get("schedule_mode") or "now").strip().lower()
    if schedule_mode not in {"now", "scheduled"}:
        schedule_mode = "now"

    launch_result = await handle_launch_campaign(
        session_id,
        token,
        {
            "confirmed": True,
            "user_confirmed": True,
            "schedule_mode": schedule_mode,
            "launch_local_date": args.get("launch_local_date"),
            "launch_local_time": args.get("launch_local_time"),
            "scheduled_at": args.get("scheduled_at"),
            "timezone": args.get("timezone"),
            "launch_channels": ["whatsapp"],
            "change_summary": args.get("change_summary")
            or "Launch approved WhatsApp template campaign",
        },
        event_callback=event_callback,
    )

    if launch_result.get("ok"):
        launch_result.setdefault(
            "ui_event",
            {
                "type": "whatsapp_approved_launched",
                "payload": {
                    "campaign_id": (launch_result.get("campaign") or {}).get("id")
                    or launch_result.get("campaign_id"),
                    "schedule_mode": schedule_mode,
                },
            },
        )
    return launch_result


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    handlers = {
        "SET_AUDIENCE": handle_set_audience,
        "FILTER_CONTACTS": handle_filter_contacts,
        "UPLOAD_TEMPORARY_CONTACTS": handle_upload_temporary_contacts,
        "SEND_APPROVED_TEMPLATE": handle_send,
        "LAUNCH_APPROVED_CAMPAIGN": handle_launch_approved_campaign,
    }
    fn = handlers.get(name)
    if not fn:
        return {"ok": False, "error": f"Unknown tool {name}"}
    if name in {"UPLOAD_TEMPORARY_CONTACTS", "LAUNCH_APPROVED_CAMPAIGN"}:
        result = await fn(
            session_id,
            token,
            args or {},
            event_callback=event_callback,
        )
    else:
        result = await fn(session_id, token, args or {})
    if event_callback and result.get("ui_event"):
        try:
            await event_callback(result["ui_event"])
        except Exception:  # noqa: BLE001
            pass
    return result
