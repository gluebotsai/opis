"""Prepare session + audience for Monitoring campaign launch (approved WA template)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

import httpx

from app.config import get_settings
from app.session_store import (
    get_or_create_session,
    load_audience_ids,
    save_audience_ids,
    save_session,
    save_temp_contacts,
)

logger = logging.getLogger(__name__)

_WA_AUDIENCE_READY_NOTE = (
    "Approved WA: audience frozen — confirm recipient(s), then launch now or schedule."
)


def seed_approved_campaign_session(
    session: dict[str, Any],
    snap: dict[str, Any],
) -> dict[str, Any]:
    """Map regulated template snapshot → create-campaign session shape for launch."""
    tpl_name = str(snap.get("name") or "wa_template").strip()
    campaign_name = (
        str(snap.get("campaign_name") or snap.get("campaignName") or "").strip()
        or f"WhatsApp · {tpl_name}"
    )
    goal = str(snap.get("goal") or "").strip() or "Send approved WhatsApp template"
    objective = (
        str(snap.get("objective") or "").strip()
        or "Deliver Meta-approved message to selected audience"
    )
    session["campaign"] = {
        "name": campaign_name[:200],
        "goal": goal[:500],
        "objective": objective[:500],
    }
    session["channels"] = ["whatsapp"]
    session["primary_channel"] = "whatsapp"

    provider_id = str(
        snap.get("provider_template_id")
        or snap.get("providerTemplateId")
        or snap.get("meta_template_id")
        or ""
    ).strip()
    regulated_id = str(snap.get("id") or "").strip()
    status = str(snap.get("status") or "approved").strip().lower()
    if status not in {"approved", "pending", "rejected"}:
        status = "approved"

    fields: dict[str, Any] = {
        "name": tpl_name,
        "language": str(snap.get("language") or "en").strip() or "en",
        "category": str(snap.get("category") or "MARKETING").strip().upper()
        or "MARKETING",
        "header": str(snap.get("header") or ""),
        "body": str(snap.get("body") or ""),
        "footer": str(snap.get("footer") or ""),
        "buttons": snap.get("buttons") if isinstance(snap.get("buttons"), list) else [],
    }
    if isinstance(snap.get("buttons"), str) and snap.get("buttons"):
        # Library stores button labels as newline string.
        fields["buttons"] = [
            {"type": "URL", "text": line.strip()[:25]}
            for line in str(snap.get("buttons")).split("\n")
            if line.strip()
        ][:3]

    fields["approval"] = {
        "submitted": True,
        "status": status if status == "approved" else "approved",
        "provider_template_id": provider_id or regulated_id or None,
        "submitted_at": None,
        "error": None,
        "message": "Pre-approved Meta template from library.",
    }
    fields["meta_approved"] = True

    template_id = (
        regulated_id
        or str(snap.get("template_id") or "").strip()
        or str(uuid.uuid4())
    )
    session["templates"] = [
        {
            "template_id": template_id,
            "channel": "whatsapp",
            "logo": "whatsapp",
            "launch_at": None,
            "fields": fields,
            "how_it_works": "Approved Meta WhatsApp template (library).",
        }
    ]
    session["templates_finalized"] = True
    session["channel_plans"] = [
        {
            "channel": "whatsapp",
            "how_it_works": "Send approved WhatsApp template to audience.",
        }
    ]
    return session


def sync_audience_panel_from_whatsapp(
    session: dict[str, Any],
    *,
    matched_count: int | None = None,
    description: str | None = None,
) -> None:
    """Mirror whatsapp_audience into create-campaign overview fields (public_state.audience)."""
    wa = session.get("whatsapp_audience")
    wa_dict = wa if isinstance(wa, dict) else {}
    phones = [str(p) for p in (wa_dict.get("phones") or []) if p]
    cids = [str(c) for c in (wa_dict.get("contact_ids") or []) if c]
    n = matched_count
    if n is None:
        n = len(phones) + len(cids)
        temp_n = int(session.get("temporary_contact_count") or 0)
        if temp_n > 0:
            n = max(n, temp_n)
    aud = session.setdefault("audience", {})
    if not isinstance(aud, dict):
        aud = {}
        session["audience"] = aud
    if n > 0:
        aud["matched_count"] = int(n)
    desc = (description or "").strip()
    if not desc and n > 0:
        temp_summary = str(session.get("temporary_contact_summary") or "").strip()
        if temp_summary:
            desc = temp_summary
        elif cids and phones:
            desc = f"{len(cids)} CRM contact(s), {len(phones)} phone(s)"
        elif cids:
            desc = f"{len(cids)} CRM contact(s)"
        elif phones:
            desc = f"{len(phones)} phone number(s)"
        else:
            desc = f"{n} recipient(s)"
    if desc:
        aud["description"] = desc[:500]


def mirror_campaign_audience_to_whatsapp(
    session: dict[str, Any],
    contact_ids: list[str],
) -> None:
    """Keep whatsapp_audience aligned with frozen CRM/temp ids for launch helpers."""
    ids = [str(c).strip() for c in contact_ids if str(c).strip()]
    wa = session.setdefault(
        "whatsapp_audience",
        {"phones": [], "contact_ids": [], "contacts_sample": []},
    )
    if not isinstance(wa, dict):
        wa = {"phones": [], "contact_ids": [], "contacts_sample": []}
        session["whatsapp_audience"] = wa
    wa["contact_ids"] = ids[:500]
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    filters = aud.get("filters") if isinstance(aud.get("filters"), dict) else {}
    phones = filters.get("phones") if isinstance(filters.get("phones"), list) else []
    if phones:
        wa["phones"] = [str(p) for p in phones if str(p).strip()][:500]
    samples = aud.get("sample_names") if isinstance(aud.get("sample_names"), list) else []
    if samples:
        wa["contacts_sample"] = [
            {"name": str(n).strip()} for n in samples[:10] if str(n).strip()
        ]


async def _post_filter_api(
    token: str,
    filters: dict[str, Any],
) -> dict[str, Any]:
    url = f"{get_settings().campaign_api_base.rstrip('/')}/contacts/filter"
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(url, json={"filters": filters}, headers=headers)
        res.raise_for_status()
        return res.json()


def _pending_contact_ids(session: dict[str, Any]) -> list[str]:
    pending = session.get("pending_contact_update")
    if not isinstance(pending, dict):
        return []
    out: list[str] = []
    for cid in pending.get("contact_ids") or []:
        s = str(cid or "").strip()
        if s:
            out.append(s)
    one = str(pending.get("contact_id") or "").strip()
    if one and one not in out:
        out.insert(0, one)
    return out


async def ensure_approved_audience_frozen(
    session_id: str,
    token: str,
    session: dict[str, Any],
) -> tuple[bool, str]:
    """Persist contact ids for launch — CRM filter, pending lookup, or temp phones."""
    ids = await load_audience_ids(session_id, token=token)
    if ids:
        mirror_campaign_audience_to_whatsapp(session, ids)
        aud = session.setdefault("audience", {})
        if isinstance(aud, dict):
            aud["matched_count"] = len(ids)
        session["audience_launch_ready"] = True
        return True, ""

    pending_ids = _pending_contact_ids(session)
    if pending_ids:
        try:
            await save_audience_ids(session_id, pending_ids[:500], token=token)
        except Exception as exc:  # noqa: BLE001
            logger.warning("save_audience_ids from pending failed: %s", exc)
        else:
            ids = await load_audience_ids(session_id, token=token)
            if ids:
                mirror_campaign_audience_to_whatsapp(session, ids)
                aud = session.setdefault("audience", {})
                if isinstance(aud, dict):
                    aud["matched_count"] = len(ids)
                session["audience_launch_ready"] = True
                return True, ""

    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    filters = aud.get("filters") if isinstance(aud.get("filters"), dict) else {}
    if filters:
        try:
            body = await _post_filter_api(token, filters)
            refrozen = [
                str(cid).strip()
                for cid in (body.get("contact_ids") or [])
                if str(cid).strip()
            ]
            if refrozen:
                await save_audience_ids(session_id, refrozen[:500], token=token)
                mirror_campaign_audience_to_whatsapp(session, refrozen)
                if isinstance(aud, dict):
                    aud["matched_count"] = len(refrozen)
                    session["audience"] = aud
                session["audience_launch_ready"] = True
                return True, ""
        except Exception as exc:  # noqa: BLE001
            logger.warning("re-filter for approved WA launch failed: %s", exc)
            return False, f"Could not freeze audience from filters: {exc}"

    wa_aud = session.get("whatsapp_audience")
    wa = wa_aud if isinstance(wa_aud, dict) else {}
    contact_ids = [str(c).strip() for c in (wa.get("contact_ids") or []) if c]
    if contact_ids:
        try:
            await save_audience_ids(session_id, contact_ids[:500], token=token)
        except Exception as exc:  # noqa: BLE001
            return False, f"Could not save CRM audience ids: {exc}"
        mirror_campaign_audience_to_whatsapp(session, contact_ids)
        if isinstance(aud, dict):
            aud["matched_count"] = len(contact_ids)
            aud["description"] = aud.get("description") or f"{len(contact_ids)} CRM contact(s)"
            aud["source"] = "crm_filter"
            session["audience"] = aud
        session["audience_launch_ready"] = True
        return True, ""

    phones = [str(p).strip() for p in (wa.get("phones") or []) if str(p).strip()]
    if phones:
        rows = [{"phone": p} for p in phones[:500]]
        try:
            body = await save_temp_contacts(session_id, rows, token=token)
        except Exception as exc:  # noqa: BLE001
            return False, f"Could not save phone audience: {exc}"
        summary = str(body.get("temporary_contact_summary") or "").strip()
        inserted = int((body.get("summary") or {}).get("inserted") or 0)
        if inserted <= 0:
            return False, "No valid phone numbers for launch audience."
        ids = await load_audience_ids(session_id, token=token)
        if not ids:
            return False, "Audience phones saved but no contact ids returned."
        mirror_campaign_audience_to_whatsapp(session, ids)
        aud = session.setdefault("audience", {})
        if not isinstance(aud, dict):
            aud = {}
            session["audience"] = aud
        aud["matched_count"] = len(ids)
        aud["source"] = "temporary_upload"
        aud["description"] = summary or f"{len(ids)} recipient(s)"
        session["temporary_contact_summary"] = summary
        session["temporary_contact_count"] = inserted
        session["audience_launch_ready"] = True
        return True, ""

    matched = int(aud.get("matched_count") or 0)
    if matched > 0:
        return False, (
            "Audience count is set but contact ids are missing — "
            "re-run check_contacts or upload a sheet, then try launch again."
        )
    return False, (
        "No audience yet. Add phones, CRM contacts (check_contacts), or upload a temporary CSV."
    )


async def finalize_whatsapp_approved_audience(
    session_id: str,
    token: str,
) -> dict[str, Any]:
    """After check_contacts / filter / upload — freeze ids, memory, stage for MAS + chat."""
    session = await get_or_create_session(session_id, token=token)
    if not session.get("whatsapp_approved_run"):
        return {"ok": True, "skipped": True}

    ok, err = await ensure_approved_audience_frozen(session_id, token, session)
    session = await get_or_create_session(session_id, token=token)
    frozen = await load_audience_ids(session_id, token=token)

    if ok and frozen:
        from app.agents.create_campaign.memory_note import (
            append_memory_note,
            note_from_audience,
        )

        aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
        line = note_from_audience(aud)
        if line:
            append_memory_note(session, line)
        append_memory_note(session, _WA_AUDIENCE_READY_NOTE)
        session["stage"] = "refine"
        session["audience_launch_ready"] = True
    elif not ok and err:
        from app.agents.create_campaign.memory_note import append_memory_note

        append_memory_note(
            session,
            f"Audience matched in chat but not frozen yet: {err[:180]}",
        )
        session["audience_launch_ready"] = False

    await save_session(session, token=token)
    return {
        "ok": ok,
        "error": err or None,
        "frozen_count": len(frozen),
        "audience_launch_ready": bool(session.get("audience_launch_ready")),
    }


def wa_audience_tool_suffix(session: dict[str, Any] | None) -> str:
    """Append to tool messages so the LLM knows the next step on approved WA runs."""
    if not (session or {}).get("whatsapp_approved_run"):
        return ""
    if (session or {}).get("audience_launch_ready"):
        return (
            " | WA_APPROVED_NEXT: Audience is frozen for this run (WhatsApp only). "
            "Confirm recipient(s) briefly. Do NOT ask for phone if CRM already matched "
            "email or phone. Do NOT ask for channels. Ask launch now or a schedule time, "
            "then call launch_campaign with confirmed=true."
        )
    return (
        " | WA_APPROVED: After a successful match, confirm recipients; "
        "do not claim lookup failed if matched_count>0."
    )


async def sync_launch_audience(
    session_id: str,
    token: str,
    session: dict[str, Any],
) -> tuple[bool, str]:
    """Ensure load_audience_ids / matched_count for confirm_launch."""
    return await ensure_approved_audience_frozen(session_id, token, session)


async def persist_approved_whatsapp_templates_for_launch(
    session_id: str,
    token: str,
    session: dict[str, Any],
) -> tuple[dict[str, Any], str | None]:
    """Sync WhatsApp card to campaignChannelTemplate with Meta-approved fields intact.

    Approved runs skip build_campaign; launch still needs a DB agent template row.
    Batch create resets WhatsApp approval to DRAFT unless we patch fields after sync.
    """
    snap = session.get("whatsapp_template_snapshot")
    if not isinstance(snap, dict) or not snap.get("name"):
        return session, "Missing whatsapp_template_snapshot on session."

    session = seed_approved_campaign_session(session, snap)
    cards = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict)
        and str(t.get("channel") or "").strip().lower() == "whatsapp"
    ]
    if not cards:
        return session, "No WhatsApp template card on session after seed."

    source = cards[-1]
    fields = dict(source.get("fields") or {})
    if not str(fields.get("body") or "").strip():
        return session, "WhatsApp template body is empty on session card."

    from app.session_store import _ensure_agent_session_shell
    from app.template_store import sync_session_templates, update_template_fields

    if not await _ensure_agent_session_shell(session_id, token=token):
        return session, "Could not create agent session shell for approved WhatsApp run."

    # Omit template_id so sync creates/repairs session-scoped channel template rows
    # (regulated library ids must not be reused as campaignChannelTemplate PKs).
    persist_payload = [
        {
            "channel": "whatsapp",
            "logo": source.get("logo") or "whatsapp",
            "how_it_works": source.get("how_it_works")
            or "Send approved WhatsApp template to audience.",
            "fields": fields,
        }
    ]
    try:
        synced = await sync_session_templates(
            session_id,
            persist_payload,
            token=token,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("approved WA template sync failed: %s", exc)
        return session, f"Could not sync WhatsApp template to database: {exc}"

    saved = [
        row
        for row in (synced.get("templates") or [])
        if isinstance(row, dict)
        and str(row.get("channel") or "").strip().lower() == "whatsapp"
    ]
    if not saved:
        return session, "Database did not return a WhatsApp channel template for this session."

    wa_row = saved[-1]
    tid = str(wa_row.get("template_id") or "").strip()
    if not tid:
        return session, "Synced WhatsApp template has no template_id."

    try:
        patched = await update_template_fields(tid, fields, token=token)
        tpl = patched.get("template") if isinstance(patched, dict) else None
        if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
            fields = tpl["fields"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("approved WA template field patch failed tid=%s: %s", tid, exc)
        return session, f"Could not persist approved WhatsApp fields: {exc}"

    session["templates"] = [
        {
            **source,
            **wa_row,
            "template_id": tid,
            "channel": "whatsapp",
            "fields": fields,
        }
    ]
    session["templates_finalized"] = True
    session["confirmed_create_templates"] = True
    return session, None
