"""Session + chat state for agents.

- create_campaign drafts → process memory first; DB hydrate on miss;
  DB persist in background after local update
- contacts (Audience) → process memory only (analyze mid-chat); never campaign Drafts DB
- monitoring / hub → in-process memory only

Agents never connect to Postgres. Audience stores contact UUID refs only (create-campaign).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.memory_session_store import (
    memory_delete,
    memory_get,
    memory_has,
    memory_put,
)
from app.request_context import get_request_token
from app.text_cleanup import strip_html_tags


def _pin_session_id(session: dict[str, Any], session_id: str) -> dict[str, Any]:
    """Keep in-memory + API session key aligned with the id callers use."""
    sid = str(session_id or "").strip()
    if sid:
        session["session_id"] = sid
    return session

logger = logging.getLogger(__name__)

EPHEMERAL_MODULES = frozenset(
    {
        "contacts",  # Audience chat — memory for analysis; never Drafts list / durable draft
        "monitoring",
        "recommendations",
        "forms",
        "reports",
        "events_report",
        "whatsapp_approved",
        "whatsapp_rejected",
    }
)

DURABLE_MODULES = frozenset(
    {"create_campaign", "recommendation_run", "library_run"}
)

# Serialize background DB puts per create-campaign session.
_persist_locks: dict[str, asyncio.Lock] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_ephemeral_module(module: str | None) -> bool:
    return str(module or "").strip().lower() in EPHEMERAL_MODULES


def is_durable_module(module: str | None) -> bool:
    return str(module or "").strip().lower() in DURABLE_MODULES


def empty_session(
    session_id: str,
    user_id: str | None = None,
    *,
    module: str = "create_campaign",
) -> dict[str, Any]:
    now = _now()
    if module == "contacts":
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": "contacts",
            "stage": "idle",
            "focus_contact_id": None,
            "draft_contact": {
                "first_name": "",
                "last_name": "",
                "email": "",
                "phone": "",
                "company_name": "",
                "city": "",
                "app_push_token": "",
                "app_push_platform": "",
                "app_push_asked": "",
                "web_push_endpoint": "",
                "web_push_p256dh": "",
                "web_push_auth": "",
                "web_push_asked": "",
            },
            "candidates": [],
            "pending_delete_id": None,
            "last_action": None,
            "messages": [],
            # Jun30-style LLM transcript: user / assistant / tool_calls / tool results.
            "llm_memory": [],
            "module_skills": {},
            "chat_memory_note": "",
            "draft_mode": None,
            "created_at": now,
            "updated_at": now,
        }
    if module == "monitoring":
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": "monitoring",
            "stage": "idle",
            "focus_campaign_id": None,
            "focus_campaign_name": None,
            "monitor_bucket": "live",
            "last_report": None,
            "last_action": None,
            "pending_route": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
    if module == "reports":
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": "reports",
            "stage": "idle",
            "focus_campaign_id": None,
            "focus_campaign_name": None,
            "monitor_bucket": "live",
            "last_report": None,
            "last_action": None,
            "reports_topic": None,
            "events_snapshot": None,
            "dashboard_period": None,
            "pending_route": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
    if module == "events_report":
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": "events_report",
            "stage": "idle",
            "events_snapshot": None,
            "last_action": None,
            "pending_route": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
    if module == "recommendations":
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": "recommendations",
            "stage": "idle",
            "recommendations": [],
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
    if module == "forms":
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": "forms",
            "stage": "idle",
            "form_event_id": None,
            "form_design": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
    if module in ("whatsapp_approved", "whatsapp_rejected"):
        return {
            "session_id": session_id,
            "user_id": user_id,
            "organization_id": None,
            "branch_id": None,
            "module": module,
            "stage": "idle",
            "whatsapp_template_snapshot": {},
            "whatsapp_audience": {"phones": [], "contact_ids": []},
            "last_action": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
    return {
        "session_id": session_id,
        "user_id": user_id,
        "organization_id": None,
        "branch_id": None,
        "module": "create_campaign",
        "stage": "intake",
        "campaign": {
            "name": "",
            "goal": "",
            "objective": "",
        },
        "audience": {
            "filters": {},
            "matched_count": 0,
            "sample_names": [],
            "description": "",
            # Campaign-scoped only (finance). Never a main-contact field.
            "scores": None,
        },
        "channels": [],
        "channel_plans": [],
        "confirmed_create_templates": False,
        "templates": [],
        "active_edit_channel": None,
        "launch_plan": None,
        "launch_confirmed": False,
        "strategy_summary": "",
        "strategy_accepted": False,
        "whatsapp_retry": None,
        "templates_finalized": False,
        "summary_presented": False,
        "campaign_id": None,
        "selected_library_templates": [],
        "selected_gallery_images": [],
        "recommendations_snapshot": [],
        "hub_mode": False,
        "templates_snapshot": [],
        "drafts_snapshot": [],
        "messages": [],
        # Jun30-style LLM transcript: user / assistant / tool_calls / tool results.
        "llm_memory": [],
        "created_at": now,
        "updated_at": now,
    }


def is_recommendation_session_id(session_id: str | None) -> bool:
    sid = str(session_id or "").strip()
    return sid == "recommendations-main" or sid.startswith("recommendations-")


def is_forms_session_id(session_id: str | None) -> bool:
    sid = str(session_id or "").strip()
    return sid.startswith("forms-event-") or sid.startswith("forms-")


def is_whatsapp_template_session_id(session_id: str | None) -> bool:
    sid = str(session_id or "").strip()
    return sid.startswith("wa-approved-") or sid.startswith("wa-rejected-")


def is_hub_session_id(session_id: str | None) -> bool:
    """Create-campaign hub chat (picker helper) — memory only, not a draft."""
    return str(session_id or "").strip().startswith("hub-")


def resolve_module(module: str | None, session_id: str | None = None) -> str:
    """Normalize module; ephemeral session ids never use create_campaign API."""
    if is_recommendation_session_id(session_id):
        return "recommendations"
    if is_forms_session_id(session_id):
        return "forms"
    # Hub keeps create_campaign module + hub_mode flag (special prompt/tools).
    sid = str(session_id or "").strip()
    if sid.startswith("wa-approved-"):
        return "whatsapp_approved"
    if sid.startswith("wa-rejected-"):
        return "whatsapp_rejected"
    mod = str(module or "").strip().lower()
    if mod in EPHEMERAL_MODULES or mod in DURABLE_MODULES:
        return mod
    return "create_campaign"


def _headers(token: str | None = None) -> dict[str, str]:
    tok = (token or get_request_token()).strip()
    return {"Authorization": f"Bearer {tok}"}


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def drop_ephemeral_session(session_id: str) -> bool:
    """Remove contacts/monitoring chat state when the socket session is killed."""
    return memory_delete(session_id)


async def load_session(
    session_id: str, *, token: str | None = None
) -> dict[str, Any] | None:
    if memory_has(session_id):
        return memory_get(session_id)
    # Recommendation / forms / hub / other ephemeral ids are never stored in campaign_db.
    if (
        is_recommendation_session_id(session_id)
        or is_forms_session_id(session_id)
        or is_hub_session_id(session_id)
    ):
        return None
    url = f"{_base()}/agent-sessions/{session_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(url, headers=_headers(token))
        if res.status_code == 404:
            return None
        res.raise_for_status()
        body = res.json()
    session = body.get("session")
    if isinstance(session, dict) and session.get("session_id"):
        return memory_put(_pin_session_id(session, session_id))
    return session


async def _put_agent_session_db(
    session: dict[str, Any], *, token: str | None = None
) -> dict[str, Any]:
    """Durable PUT to campaign API for create-campaign drafts only (never contacts)."""
    from app.http_retry import with_http_retry

    session_id = str(session.get("session_id") or "").strip()
    mod = str(session.get("module") or "").strip().lower()
    if mod == "contacts" or is_ephemeral_module(mod):
        return session
    url = f"{_base()}/agent-sessions/{session_id}"

    async def _once() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.put(
                url,
                headers=_headers(token),
                json={"session": session},
            )
            res.raise_for_status()
            body = res.json()
        return body.get("session") or session

    return await with_http_retry(f"put_session:{session_id}", _once)


def _schedule_agent_db_persist(session_id: str, token: str | None) -> None:
    """Persist latest in-memory agent session to DB without blocking the turn."""
    sid = str(session_id or "").strip()
    if not sid:
        return
    tok = (token or get_request_token() or "").strip() or None

    async def _run() -> None:
        lock = _persist_locks.setdefault(sid, asyncio.Lock())
        async with lock:
            latest = memory_get(sid)
            if not latest:
                return
            mod = str(latest.get("module") or "").strip().lower()
            if mod == "contacts" or is_ephemeral_module(mod):
                return
            try:
                await _put_agent_session_db(latest, token=tok)
            except Exception:  # noqa: BLE001
                # Memory stays authoritative; next save_session will retry.
                logger.warning(
                    "background agent-session persist failed sid=%s (will retry later)",
                    sid,
                    exc_info=True,
                )

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_run())


def _is_memory_only_session(session_id: str, mod: str) -> bool:
    return (
        is_ephemeral_module(mod)
        or is_recommendation_session_id(session_id)
        or is_forms_session_id(session_id)
        or is_hub_session_id(session_id)
    )


def _is_contacts_audience_session(session: dict[str, Any], session_id: str) -> bool:
    mod = str(session.get("module") or "").strip().lower()
    if mod == "contacts":
        return True
    from app.mas.runtime.task_memory import get_mas_task

    if get_mas_task(session).get("active_domain") == "audience":
        return True
    if memory_has(session_id):
        prior = memory_get(session_id) or {}
        if str(prior.get("module") or "").strip().lower() == "contacts":
            return True
        if get_mas_task(prior).get("active_domain") == "audience":
            return True
    return False


async def save_session(
    session: dict[str, Any],
    *,
    token: str | None = None,
    sync_db: bool = False,
) -> dict[str, Any]:
    """Update process memory immediately; durable create drafts persist to DB async."""
    session = deepcopy(session)
    session_id = str(session.get("session_id") or "").strip()
    if not session_id:
        raise ValueError("session_id required")
    session["updated_at"] = _now()
    mod = resolve_module(session.get("module"), session_id)
    if not is_ephemeral_module(mod):
        from app.mas.runtime.task_memory import get_mas_task

        if get_mas_task(session).get("active_domain") == "audience":
            mod = "contacts"
    session["module"] = mod

    if (
        _is_contacts_audience_session(session, session_id)
        and not session.pop("draft_reset", None)
        and memory_has(session_id)
    ):
        prior = memory_get(session_id) or {}
        prior_draft = (
            prior.get("draft_contact") if isinstance(prior.get("draft_contact"), dict) else {}
        )
        incoming_draft = (
            session.get("draft_contact")
            if isinstance(session.get("draft_contact"), dict)
            else {}
        )
        identity_keys = (
            "first_name",
            "last_name",
            "email",
            "phone",
            "company_name",
            "city",
        )
        merged_draft = dict(incoming_draft)
        for key in identity_keys:
            prior_val = str(prior_draft.get(key) or "").strip()
            incoming_val = str(incoming_draft.get(key) or "").strip()
            if prior_val and not incoming_val:
                merged_draft[key] = prior_val
        if incoming_draft.get("pack_fields_skipped"):
            merged_draft["pack_fields_skipped"] = incoming_draft.get("pack_fields_skipped")
        elif prior_draft.get("pack_fields_skipped") and not incoming_draft.get(
            "pack_fields_skipped"
        ):
            merged_draft["pack_fields_skipped"] = prior_draft.get("pack_fields_skipped")
        if merged_draft != incoming_draft or not session.get("draft_contact"):
            from app.agents.contacts.draft_ingest import empty_draft

            session["draft_contact"] = {**empty_draft(), **merged_draft}
        if not session.get("draft_mode") and prior.get("draft_mode"):
            session["draft_mode"] = prior.get("draft_mode")
        prior_mode = str(prior.get("draft_mode") or session.get("draft_mode") or "").lower()
        if prior.get("focus_contact_id") and not session.get("focus_contact_id"):
            if prior_mode == "update":
                session["focus_contact_id"] = prior.get("focus_contact_id")
        if prior.get("update_baseline") and not session.get("update_baseline"):
            if prior_mode == "update":
                session["update_baseline"] = prior.get("update_baseline")
        if not session.get("focus_contact_id"):
            from app.mas.skills import CONTACTS_MODULE

            skills = prior.get("module_skills") or {}
            active = (skills.get(CONTACTS_MODULE) or {}).get("active") or {}
            snap = active.get("snapshot") if isinstance(active.get("snapshot"), dict) else {}
            if snap.get("focus_contact_id") and str(
                snap.get("draft_mode") or prior.get("draft_mode") or ""
            ).lower() == "update":
                session["focus_contact_id"] = snap.get("focus_contact_id")
                if not session.get("draft_mode"):
                    session["draft_mode"] = "update"
                if snap.get("update_baseline") and not session.get("update_baseline"):
                    session["update_baseline"] = snap.get("update_baseline")

    # Preserve FE timeline pins when agent turns omit ui / send thinner ui.
    if not is_ephemeral_module(mod) and memory_has(session_id):
        prior_for_ui = memory_get(session_id) or {}
        merged_ui = _merge_session_ui(
            prior_for_ui.get("ui") if isinstance(prior_for_ui.get("ui"), dict) else None,
            session.get("ui") if isinstance(session.get("ui"), dict) else None,
        )
        if merged_ui is not None:
            session["ui"] = merged_ui

    # Always warm local cache first (LLM + same-process turns read this).
    stored = memory_put(session)

    if _is_memory_only_session(session_id, mod):
        return stored

    # Durable create-campaign draft.
    if sync_db:
        try:
            return await _put_agent_session_db(stored, token=token)
        except Exception:  # noqa: BLE001
            logger.exception("sync agent-session persist failed sid=%s", session_id)
            return stored
    _schedule_agent_db_persist(session_id, token)
    return stored


async def get_or_create_session(
    session_id: str,
    user_id: str | None = None,
    *,
    token: str | None = None,
    module: str | None = None,
) -> dict[str, Any]:
    mod = resolve_module(module, session_id)

    # Existing ephemeral chat (contacts tools often omit module).
    if memory_has(session_id):
        session = memory_get(session_id) or empty_session(
            session_id, user_id=user_id, module=mod
        )
        if user_id and not session.get("user_id"):
            session["user_id"] = user_id
            return await save_session(session, token=token)
        if (
            is_ephemeral_module(mod)
            and session.get("module") != mod
            and not (session.get("messages") or [])
        ):
            reshaped = empty_session(
                session_id, user_id=user_id or session.get("user_id"), module=mod
            )
            reshaped["created_at"] = session.get("created_at") or reshaped["created_at"]
            return await save_session(reshaped, token=token)
        return session

    # New contacts / monitoring / recommendations / forms / hub / wa templates — memory only.
    # contacts stays in process memory for Audience analysis; never campaign Drafts.
    if (
        is_ephemeral_module(mod)
        or is_recommendation_session_id(session_id)
        or is_forms_session_id(session_id)
        or is_whatsapp_template_session_id(session_id)
        or is_hub_session_id(session_id)
    ):
        if is_recommendation_session_id(session_id):
            create_mod = "recommendations"
        elif is_forms_session_id(session_id):
            create_mod = "forms"
        elif str(session_id).startswith("wa-approved-"):
            create_mod = "whatsapp_approved"
        elif str(session_id).startswith("wa-rejected-"):
            create_mod = "whatsapp_rejected"
        elif is_hub_session_id(session_id):
            create_mod = "create_campaign"
        else:
            create_mod = mod
        session = empty_session(
            session_id,
            user_id=user_id,
            module=create_mod,
        )
        if is_hub_session_id(session_id):
            session["hub_mode"] = True
        return await save_session(session, token=token)

    # Durable create-campaign (and library/recommendation run) path — session ids must be UUIDs.
    # contacts is ephemeral (memory only) and never hydrates/creates Drafts DB rows here.
    db_mod = mod if is_durable_module(mod) else "create_campaign"
    url = f"{_base()}/agent-sessions/{session_id}"
    params = {"module": db_mod}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url, headers=_headers(token), params=params)
            res.raise_for_status()
            body = res.json()
        session = body.get("session") or empty_session(
            session_id, user_id=user_id, module=db_mod
        )
    except Exception:  # noqa: BLE001
        # Campaign API / DB down — keep turns alive in process memory
        # (Finance sandbox and local demos rely on this).
        if memory_has(session_id):
            session = memory_get(session_id) or empty_session(
                session_id, user_id=user_id, module=db_mod
            )
        else:
            session = empty_session(session_id, user_id=user_id, module=db_mod)
        return memory_put(_pin_session_id(session, session_id))
    if user_id and not session.get("user_id"):
        session["user_id"] = user_id
    if (
        module
        and session.get("module") != module
        and not (session.get("messages") or [])
        and module in DURABLE_MODULES
    ):
        reshaped = empty_session(
            session_id, user_id=user_id or session.get("user_id"), module=module
        )
        reshaped["organization_id"] = session.get("organization_id") or session.get("tenant_id")
        reshaped["branch_id"] = session.get("branch_id")
        reshaped["created_at"] = session.get("created_at") or reshaped["created_at"]
        return await save_session(reshaped, token=token)
    if db_mod == "create_campaign":
        session = await hydrate_session_audience(
            _pin_session_id(session, session_id), session_id, token=token
        )
    else:
        session = _pin_session_id(session, session_id)
    # Warm process memory so the next turn skips DB GET.
    return memory_put(session)


async def append_message(
    session_id: str,
    role: str,
    text: str,
    *,
    meta: dict[str, Any] | None = None,
    token: str | None = None,
    module: str | None = None,
    image_url: str | None = None,
    image_filename: str | None = None,
    image_urls: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from app.request_context import is_mas_transcript_managed

    if is_mas_transcript_managed() and role in ("user", "assistant"):
        return {
            "session_id": session_id,
            "messages": [],
        }

    session = await get_or_create_session(
        session_id, token=token, module=module
    )
    msgs = session.setdefault("messages", [])
    if (
        role == "assistant"
        and msgs
        and isinstance(msgs[-1], dict)
        and str(msgs[-1].get("role") or "") == "assistant"
        and str(msgs[-1].get("text") or "").strip() == str(text or "").strip()
    ):
        return session
    msg: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "role": role,
        "text": text,
        "created_at": _now(),
    }
    if meta:
        msg["meta"] = meta
    cleaned_urls: list[dict[str, str]] = []
    if isinstance(image_urls, list):
        for row in image_urls:
            if not isinstance(row, dict):
                continue
            u = str(row.get("url") or "").strip()
            if not u:
                continue
            item: dict[str, str] = {"url": u[:4096]}
            fn = str(row.get("filename") or "").strip()
            if fn:
                item["filename"] = fn[:240]
            cleaned_urls.append(item)
    if cleaned_urls:
        msg["image_urls"] = cleaned_urls[:12]
        msg["image_url"] = cleaned_urls[0]["url"]
        if cleaned_urls[0].get("filename"):
            msg["image_filename"] = cleaned_urls[0]["filename"]
    else:
        url = str(image_url or "").strip()
        if url:
            msg["image_url"] = url[:4096]
            fn = str(image_filename or "").strip()
            if fn:
                msg["image_filename"] = fn[:240]
    msgs.append(msg)
    return await save_session(session, token=token)


def compact_recommendations_snapshot(raw: Any) -> list[dict[str, Any]]:
    """FE recommendation cards for create-campaign LLM context (compact)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:12]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        channels = row.get("channels") or []
        if isinstance(channels, list):
            channels = [str(c).strip() for c in channels if str(c).strip()]
        else:
            channels = []
        filters = (
            row.get("audience_filters")
            or row.get("audienceFilters")
            or None
        )
        if filters is not None and not isinstance(filters, dict):
            filters = None
        matched = row.get("matched_count")
        if matched is None:
            matched = row.get("matchedCount")
        out.append(
            {
                "id": str(row.get("id") or "").strip(),
                "title": title,
                "goal": str(row.get("goal") or "").strip(),
                "objective": str(row.get("objective") or "").strip(),
                "channels": channels,
                "audience": str(row.get("audience") or "").strip(),
                "matched_count": matched
                if isinstance(matched, (int, float))
                else None,
                "audience_filters": filters,
                "why_created": str(
                    row.get("why_created")
                    or row.get("whyCreated")
                    or row.get("why")
                    or ""
                ).strip(),
                "intended_use": str(
                    row.get("intended_use") or row.get("intendedUse") or ""
                ).strip(),
                "confidence": row.get("confidence"),
                "timing_label": str(
                    row.get("timing_label") or row.get("timingLabel") or ""
                ).strip(),
            }
        )
    return out


def compact_templates_snapshot(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:40]:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "id": str(row.get("id") or "").strip(),
                "name": name,
                "channel": str(
                    row.get("channel") or row.get("primaryChannel") or ""
                ).strip(),
                "approval_status": str(
                    row.get("approval_status") or row.get("approvalStatus") or ""
                ).strip(),
                "used_count": row.get("used_count")
                if row.get("used_count") is not None
                else row.get("usedCount"),
            }
        )
    return out


def compact_selected_gallery_images(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:24]:
        if not isinstance(row, dict):
            continue
        url = str(row.get("image_url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "id": str(row.get("id") or "").strip(),
                "media_id": str(row.get("media_id") or "").strip(),
                "image_url": url[:4096],
                "short_description": str(row.get("short_description") or "").strip()[
                    :500
                ],
            }
        )
    return out


def compact_drafts_snapshot(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:20]:
        if not isinstance(row, dict):
            continue
        did = str(row.get("id") or "").strip()
        if not did or did.startswith("hub-"):
            continue
        out.append(
            {
                "id": did,
                "name": str(row.get("name") or "").strip() or "Untitled draft",
                "status": str(row.get("status") or "").strip(),
                "updated_at": str(
                    row.get("updated_at") or row.get("updatedAt") or ""
                ).strip(),
            }
        )
    return out


def public_state(session: dict[str, Any]) -> dict[str, Any]:
    """State safe to send to FE / LLM (no contact id lists for campaign audience)."""
    if session.get("module") == "contacts":
        from app.agents.contacts.draft_ingest import (
            empty_draft,
            missing_fields,
        )

        draft = {**empty_draft(), **(session.get("draft_contact") or {})}
        miss = missing_fields(
            draft,
            focus_contact_id=session.get("focus_contact_id"),
            campaign_profile=session.get("campaign_profile"),
        )
        from app.mas.skills import CONTACTS_MODULE, SkillStateStore

        skill_store = SkillStateStore()
        from app.mas.runtime.contacts_setup_snapshot import live_session_facts

        focus_id = session.get("focus_contact_id")
        if not focus_id and str(session.get("draft_mode") or "").lower() == "update":
            skills = session.get("module_skills") or {}
            active = (skills.get(CONTACTS_MODULE) or {}).get("active") or {}
            snap = active.get("snapshot") if isinstance(active.get("snapshot"), dict) else {}
            focus_id = snap.get("focus_contact_id") or focus_id

        out = {
            "session_id": session["session_id"],
            "module": "contacts",
            "stage": session.get("stage"),
            "focus_contact_id": focus_id,
            "draft_contact": draft,
            "mode": session.get("draft_mode") or None,
            "missing_fields": miss,
            "candidates": session.get("candidates") or [],
            "pending_delete_id": session.get("pending_delete_id"),
            "last_action": session.get("last_action"),
            "module_skills": session.get("module_skills") or {},
            "skill_state": skill_store.summary_for_prompt(session, CONTACTS_MODULE),
            "live_session_facts": live_session_facts(session),
            "campaign_profile": session.get("campaign_profile")
            or {"mode": "b2b", "industry": "generic-b2b"},
            "company_pack": session.get("company_pack"),
        }
        note = str(session.get("chat_memory_note") or "").strip()
        if note:
            out["chat_memory_note"] = note
        return out
    if session.get("module") == "monitoring":
        return {
            "session_id": session["session_id"],
            "module": "monitoring",
            "stage": session.get("stage"),
            "focus_campaign_id": session.get("focus_campaign_id"),
            "focus_campaign_name": session.get("focus_campaign_name"),
            "monitor_bucket": session.get("monitor_bucket") or "live",
            "last_report": session.get("last_report"),
            "last_action": session.get("last_action"),
            "campaign_profile": session.get("campaign_profile")
            or {"mode": "b2b", "industry": "generic-b2b"},
        }
    if session.get("module") == "reports":
        snap = session.get("events_snapshot") or {}
        return {
            "session_id": session["session_id"],
            "module": "reports",
            "stage": session.get("stage"),
            "focus_campaign_id": session.get("focus_campaign_id"),
            "focus_campaign_name": session.get("focus_campaign_name"),
            "monitor_bucket": session.get("monitor_bucket") or "live",
            "last_report": session.get("last_report"),
            "last_action": session.get("last_action"),
            "reports_topic": session.get("reports_topic"),
            "dashboard_period": session.get("dashboard_period"),
            "events_snapshot_meta": {
                "launched": len(snap.get("launched") or []),
                "drafts": len(snap.get("drafts") or []),
                "submissions": len(snap.get("submissions") or []),
            },
            "campaign_profile": session.get("campaign_profile")
            or {"mode": "b2b", "industry": "generic-b2b"},
        }
    if session.get("module") == "recommendations":
        return {
            "session_id": session["session_id"],
            "module": "recommendations",
            "stage": session.get("stage"),
            "recommendations": session.get("recommendations") or [],
            "past_has_history": bool(session.get("past_has_history")),
            "past_campaigns": session.get("past_campaigns") or [],
            "campaign_profile": session.get("campaign_profile")
            or {"mode": "b2b", "industry": "generic-b2b"},
        }
    if session.get("module") == "forms":
        return {
            "session_id": session["session_id"],
            "module": "forms",
            "stage": session.get("stage"),
            "form_event_id": session.get("form_event_id"),
            "form_design": session.get("form_design"),
            "campaign_profile": session.get("campaign_profile")
            or {"mode": "b2b", "industry": "generic-b2b"},
        }
    if session.get("module") in ("whatsapp_approved", "whatsapp_rejected"):
        # Approved template *run* mirrors create-campaign overview (audience, launch, etc.).
        if not (
            session.get("module") == "whatsapp_approved"
            and session.get("whatsapp_approved_run")
        ):
            return {
                "session_id": session["session_id"],
                "module": session.get("module"),
                "stage": session.get("stage"),
                "whatsapp_template_snapshot": session.get("whatsapp_template_snapshot")
                or {},
                "whatsapp_audience": session.get("whatsapp_audience")
                or {"phones": [], "contact_ids": []},
                "last_action": session.get("last_action"),
            }
    return {
        "session_id": session["session_id"],
        "module": session.get("module") or "create_campaign",
        "stage": session.get("stage"),
        "campaign": session.get("campaign") or {},
        "audience": {
            "filters": (session.get("audience") or {}).get("filters") or {},
            "matched_count": (session.get("audience") or {}).get("matched_count")
            or 0,
            "sample_names": (session.get("audience") or {}).get("sample_names")
            or [],
            "description": (session.get("audience") or {}).get("description")
            or "",
            "soft_warnings": (session.get("audience") or {}).get("soft_warnings")
            or [],
            "consent": (session.get("audience") or {}).get("consent") or {},
            "quality": (session.get("audience") or {}).get("quality") or {},
            # Top ranked only — campaign-scoped scores, not CRM contact payload.
            "scores": (session.get("audience") or {}).get("scores"),
        },
        "channels": session.get("channels") or [],
        "available_channels": session.get("available_channels") or [],
        "campaign_profile": session.get("campaign_profile")
        or {"mode": "b2b", "industry": "generic-b2b"},
        "channel_plans": session.get("channel_plans") or [],
        "confirmed_create_templates": bool(
            session.get("confirmed_create_templates")
        ),
        "templates": session.get("templates") or [],
        "active_edit_channel": session.get("active_edit_channel"),
        "launch_plan": session.get("launch_plan"),
        "launch_questions_asked": bool(session.get("launch_questions_asked")),
        "launch_confirmed": bool(session.get("launch_confirmed")),
        "strategy_summary": session.get("strategy_summary") or "",
        "strategy_accepted": bool(session.get("strategy_accepted")),
        "whatsapp_retry": session.get("whatsapp_retry"),
        "templates_finalized": bool(session.get("templates_finalized")),
        "summary_presented": bool(session.get("summary_presented")),
        "launch_outcomes": session.get("launch_outcomes"),
        "campaign_id": session.get("campaign_id"),
        "selected_library_templates": session.get("selected_library_templates")
        or [],
        "selected_gallery_images": compact_selected_gallery_images(
            session.get("selected_gallery_images")
        ),
        "clone_mode": bool(session.get("clone_mode")),
        "recommendation_run": bool(session.get("recommendation_run")),
        "recommendation_why": str(session.get("recommendation_why") or "")[:240],
        "library_run": bool(session.get("library_run")),
        "library_baseline": session.get("library_baseline")
        if isinstance(session.get("library_baseline"), dict)
        else None,
        "form_launch": session.get("form_launch")
        if isinstance(session.get("form_launch"), dict)
        else None,
        "form_url": session.get("form_url"),
        "recommendations_snapshot": compact_recommendations_snapshot(
            session.get("recommendations_snapshot")
        ),
        "hub_mode": bool(session.get("hub_mode")),
        "templates_snapshot": compact_templates_snapshot(
            session.get("templates_snapshot")
        ),
        "drafts_snapshot": compact_drafts_snapshot(session.get("drafts_snapshot")),
        # Cross-device chat pins — FE draft timeline lives on session.ui.
        "ui": _public_create_ui(session),
    }


def _public_create_ui(session: dict[str, Any]) -> dict[str, Any]:
    """FE draft chrome: status + pinned template timeline for exact chat restore."""
    ui = session.get("ui") if isinstance(session.get("ui"), dict) else {}
    timeline = ui.get("timelineTemplates")
    out: dict[str, Any] = {}
    if ui.get("status") is not None:
        out["status"] = ui.get("status")
    if "committed" in ui:
        out["committed"] = bool(ui.get("committed"))
    if "dirty" in ui:
        out["dirty"] = bool(ui.get("dirty"))
    if isinstance(timeline, list):
        out["timelineTemplates"] = timeline
    for key in (
        "cloneSourceName",
        "clone_mode",
        "formEventId",
        "formPublicUrl",
        "formTitle",
        "name_suggestions",
        "name_suggestions_offered",
        "name_suggestions_based_on",
    ):
        if key in ui and ui.get(key) is not None:
            out[key] = ui.get(key)
    return out


def _merge_session_ui(
    prior: dict[str, Any] | None,
    incoming: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Keep the richer timeline when agent saves omit ui.timelineTemplates."""
    ex = prior if isinstance(prior, dict) else {}
    inn = incoming if isinstance(incoming, dict) else {}
    if not ex and not inn:
        return None
    ex_tl = ex.get("timelineTemplates") if isinstance(ex.get("timelineTemplates"), list) else []
    in_tl = inn.get("timelineTemplates") if isinstance(inn.get("timelineTemplates"), list) else []

    def _timeline_card_ids(timeline: list) -> set[str]:
        ids: set[str] = set()
        for moment in timeline:
            if not isinstance(moment, dict):
                continue
            for card in moment.get("cards") or []:
                if not isinstance(card, dict):
                    continue
                tid = str(card.get("template_id") or "").strip()
                if tid:
                    ids.add(tid)
        return ids

    ex_ids = _timeline_card_ids(ex_tl)
    in_ids = _timeline_card_ids(in_tl)
    if len(ex_ids) > len(in_ids) or (
        len(ex_ids) == len(in_ids) and len(ex_tl) > len(in_tl)
    ):
        merged = {**ex, **inn}
        merged["timelineTemplates"] = ex_tl
        merged["committed"] = bool(inn.get("committed") or ex.get("committed") or ex_tl)
        return merged
    if ex or inn:
        merged = {**ex, **inn}
        if in_tl:
            merged["timelineTemplates"] = in_tl
        elif ex_tl:
            merged["timelineTemplates"] = ex_tl
        merged["committed"] = bool(
            inn.get("committed") or ex.get("committed") or in_tl or ex_tl
        )
        return merged
    return None


def _template_card_summary(row: dict[str, Any]) -> dict[str, Any]:
    """Drop heavy fields/HTML from template cards for LLM context."""
    return {
        "template_id": row.get("template_id") or row.get("id"),
        "channel": row.get("channel"),
        "logo": row.get("logo"),
        "generation_batch_id": row.get("generation_batch_id"),
        "has_fields": bool(row.get("fields")),
    }


def llm_session_snapshot(session: dict[str, Any]) -> dict[str, Any]:
    """Compact session view for LLM system prompts (avoid huge template bodies)."""
    state = public_state(session)
    if state.get("module") in (
        "contacts",
        "monitoring",
        "reports",
        "recommendations",
        "forms",
    ):
        return state
    templates = state.get("templates") or []
    state["templates"] = [
        _template_card_summary(t) for t in templates if isinstance(t, dict)
    ]
    state["template_count"] = len(state["templates"])
    state["templates_exist"] = bool(state["template_count"])
    audience_count = int((state.get("audience") or {}).get("matched_count") or 0)
    state["launch_ready"] = bool(
        state["template_count"]
        and not state.get("launch_confirmed")
        and audience_count > 0
    )
    plans = []
    for plan in state.get("channel_plans") or []:
        if not isinstance(plan, dict):
            continue
        plans.append(
            {
                "channel": plan.get("channel"),
                "how_it_works": plan.get("how_it_works"),
                "suggested_launch_at": plan.get("suggested_launch_at"),
            }
        )
    state["channel_plans"] = plans
    selected_lib = []
    for row in session.get("selected_library_templates") or []:
        if not isinstance(row, dict):
            continue
        selected_lib.append(
            {
                "channel": row.get("channel"),
                "name": row.get("name"),
                "description": row.get("description"),
                "body_preview": row.get("body_preview") or row.get("bodyPreview"),
                "format_notes": row.get("format_notes"),
            }
        )
    state["selected_library_templates"] = selected_lib
    state["selected_gallery_images"] = compact_selected_gallery_images(
        session.get("selected_gallery_images")
    )
    if session.get("hub_mode") or is_hub_session_id(session.get("session_id")):
        state["hub_mode"] = True
        # Hub chats have no campaign intake — drop heavy create fields for clarity.
        state.pop("templates", None)
        state.pop("channel_plans", None)
        state.pop("audience", None)
        state["templates_snapshot"] = compact_templates_snapshot(
            session.get("templates_snapshot")
        )
        state["drafts_snapshot"] = compact_drafts_snapshot(
            session.get("drafts_snapshot")
        )
    return state


async def _ensure_agent_session_shell(
    session_id: str,
    *,
    token: str | None = None,
    module: str = "create_campaign",
) -> bool:
    """WhatsApp approved/rejected chats are memory-first but audience + templates need a DB row."""
    sid = str(session_id or "").strip()
    if not sid or not is_whatsapp_template_session_id(sid):
        return True
    url = f"{_base()}/agent-sessions/{sid}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                url,
                headers=_headers(token),
                params={"module": module},
            )
            if res.is_success:
                return True
            logger.warning(
                "ensure agent session shell failed sid=%s status=%s",
                sid,
                res.status_code,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("ensure agent session shell error sid=%s: %s", sid, exc)
    return False


async def save_audience_ids(
    session_id: str, contact_ids: list[str], *, token: str | None = None
) -> None:
    await _ensure_agent_session_shell(session_id, token=token)
    url = f"{_base()}/agent-sessions/{session_id}/audience"
    # Backend expects string contact ids (numeric, UUID, or opaque CDP ids).
    ids = [str(cid).strip() for cid in (contact_ids or []) if str(cid).strip()]
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.put(
            url,
            headers=_headers(token),
            json={"contact_ids": ids},
        )
        if res.is_error:
            detail = (res.text or "").strip().replace("\n", " ")[:240]
            raise httpx.HTTPStatusError(
                f"{res.status_code} saving audience refs: {detail}",
                request=res.request,
                response=res,
            )


async def load_audience_ids(
    session_id: str, *, token: str | None = None
) -> list[str]:
    from app.http_retry import with_http_retry

    await _ensure_agent_session_shell(session_id, token=token)
    url = f"{_base()}/agent-sessions/{session_id}/audience"

    async def _once() -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url, headers=_headers(token))
            if res.status_code == 404:
                return []
            res.raise_for_status()
            body = res.json()
        return list(body.get("contact_ids") or [])

    return await with_http_retry(f"load_audience_ids:{session_id}", _once)


async def save_temp_contacts(
    session_id: str,
    rows: list[dict[str, Any]],
    *,
    token: str | None = None,
) -> dict[str, Any]:
    """Validate + replace temporary contacts for this create-campaign session."""
    url = f"{_base()}/agent-sessions/{session_id}/temp-contacts"
    payload_rows: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        payload_rows.append(row)
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.put(
            url,
            headers=_headers(token),
            json={"rows": payload_rows, "replace": True},
        )
        if res.is_error:
            detail = (res.text or "").strip().replace("\n", " ")[:240]
            raise httpx.HTTPStatusError(
                f"{res.status_code} saving temp contacts: {detail}",
                request=res.request,
                response=res,
            )
        body = res.json() if res.content else {}
    return body if isinstance(body, dict) else {}


async def load_temp_contacts(
    session_id: str, *, token: str | None = None
) -> dict[str, Any]:
    from app.http_retry import with_http_retry

    url = f"{_base()}/agent-sessions/{session_id}/temp-contacts"

    async def _once() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url, headers=_headers(token))
            res.raise_for_status()
            body = res.json()
        return body if isinstance(body, dict) else {}

    return await with_http_retry(f"load_temp_contacts:{session_id}", _once)


async def hydrate_session_audience(
    session: dict[str, Any],
    session_id: str,
    *,
    token: str | None = None,
) -> dict[str, Any]:
    """Restore matched_count from audience refs when payload was wiped by FE autosave."""
    if is_ephemeral_module(session.get("module")) or is_hub_session_id(session_id):
        return session
    aud = session.setdefault("audience", {})
    count = int(aud.get("matched_count") or 0)
    if count > 0:
        return session
    try:
        ids = await load_audience_ids(session_id, token=token)
        if ids:
            aud["matched_count"] = len(ids)
            session["audience"] = aud
    except Exception:  # noqa: BLE001
        pass
    return session


def chat_history_for_llm(
    session: dict[str, Any],
    limit: int | None = 10,
    *,
    max_assistant_chars: int = 1600,
) -> list[dict]:
    """Recent chat for the model — plain text (UI/DB keep full HTML).

    limit=None or limit<=0 → all stored user/assistant messages.
    Assistant messages longer than max_assistant_chars keep head + tail so ending
    content (e.g. numbered campaign name lists) is not dropped.
    """
    rows = session.get("messages") or []
    if limit is None or int(limit) <= 0:
        trimmed = list(rows)
    else:
        trimmed = rows[-int(limit) :]
    out: list[dict] = []
    for m in trimmed:
        role = m.get("role")
        if role not in ("user", "assistant", "system"):
            continue
        text = str(m.get("text") or "")
        if role == "assistant":
            text = strip_html_tags(text)
            if max_assistant_chars > 0 and len(text) > max_assistant_chars:
                # Keep start (context) and end (names / next ask) — do not
                # truncate only from the front.
                head = max(200, max_assistant_chars // 2)
                tail = max_assistant_chars - head - 5
                if tail < 200:
                    tail = 200
                    head = max_assistant_chars - tail - 5
                text = text[:head].rstrip() + "\n…\n" + text[-tail:].lstrip()
        out.append({"role": role, "content": text})
    return out


# Cap individual tool payloads in llm_memory (never store full template bodies).
_LLM_MEMORY_TOOL_CHARS = 2500
_LLM_MEMORY_DROP_KEYS = frozenset(
    {
        "ui_event",
        "templates",
        "payload",
        "html",
        "body",
        "content_html",
        "content",
        "blocks",
        "raw",
        "image_url",
        "logo",
    }
)


def _slim_tool_obj_for_memory(obj: Any, *, depth: int = 0) -> Any:
    """Keep tool facts for the model; drop template bodies / UI payloads."""
    if depth > 4:
        return None
    if isinstance(obj, dict):
        # Prefer a compact summary when this looks like a template-create result.
        if "created_count" in obj or (
            obj.get("ok") is True and isinstance(obj.get("channels"), list)
        ):
            slim: dict[str, Any] = {
                "ok": obj.get("ok"),
                "created_count": obj.get("created_count"),
                "channels": obj.get("channels"),
                "audience_count": obj.get("audience_count"),
                "campaign_name": obj.get("campaign_name"),
                "message": obj.get("message"),
                "error": obj.get("error"),
                "persist_warning": obj.get("persist_warning"),
                "campaign_id": obj.get("campaign_id"),
            }
            cards = obj.get("cards")
            if isinstance(cards, list):
                slim["cards"] = [
                    {
                        "channel": c.get("channel"),
                        "template_id": c.get("template_id"),
                    }
                    for c in cards
                    if isinstance(c, dict)
                ][:12]
            return {k: v for k, v in slim.items() if v is not None}
        out: dict[str, Any] = {}
        for k, v in obj.items():
            key = str(k)
            if key in _LLM_MEMORY_DROP_KEYS:
                continue
            if key == "cards" and isinstance(v, list):
                out[key] = [
                    {
                        "channel": c.get("channel"),
                        "template_id": c.get("template_id"),
                    }
                    for c in v
                    if isinstance(c, dict)
                ][:12]
                continue
            slim_v = _slim_tool_obj_for_memory(v, depth=depth + 1)
            if slim_v is not None:
                out[key] = slim_v
        return out
    if isinstance(obj, list):
        return [_slim_tool_obj_for_memory(x, depth=depth + 1) for x in obj[:20]]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        if isinstance(obj, str) and len(obj) > 400:
            return obj[:397] + "…"
        return obj
    return str(obj)[:200]


def _compact_tool_content(raw: Any) -> str:
    """JSON-serialize tool result for memory; never keep full template HTML."""
    import json

    parsed: Any = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:  # noqa: BLE001
            parsed = raw
    if isinstance(parsed, (dict, list)):
        parsed = _slim_tool_obj_for_memory(parsed)
    try:
        text = (
            parsed
            if isinstance(parsed, str)
            else json.dumps(parsed, default=str, ensure_ascii=False)
        )
    except Exception:  # noqa: BLE001
        text = str(parsed)
    if len(text) <= _LLM_MEMORY_TOOL_CHARS:
        return text
    return text[: _LLM_MEMORY_TOOL_CHARS - 20] + "…[truncated]"


def seed_llm_memory_from_messages(session: dict[str, Any]) -> list[dict[str, Any]]:
    """Bootstrap llm_memory from UI chat when the Jun30 transcript is empty."""
    seeded = chat_history_for_llm(session, limit=None, max_assistant_chars=0)
    session["llm_memory"] = seeded
    return seeded


def get_llm_memory(session: dict[str, Any]) -> list[dict[str, Any]]:
    """Full create-campaign LLM transcript (user/assistant/tool), Jun30-style."""
    mem = session.get("llm_memory")
    if isinstance(mem, list) and mem:
        return list(mem)
    return seed_llm_memory_from_messages(session)


def append_llm_memory(session: dict[str, Any], *entries: dict[str, Any]) -> None:
    """Append one or more OpenAI-format messages into session llm_memory."""
    mem = session.setdefault("llm_memory", [])
    if not isinstance(mem, list):
        mem = []
        session["llm_memory"] = mem
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("role"):
            continue
        row = dict(entry)
        if row.get("role") == "tool":
            row["content"] = _compact_tool_content(row.get("content"))
        mem.append(row)


def replace_llm_memory(session: dict[str, Any], entries: list[dict[str, Any]]) -> None:
    """Replace llm_memory with a cleaned copy of the in-turn transcript (no system)."""
    from app.runtime.agent import strip_internal_nudges

    cleaned: list[dict[str, Any]] = []
    for entry in strip_internal_nudges(list(entries or [])):
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        if role == "system":
            continue
        if role == "tool":
            cleaned.append(
                {
                    "role": "tool",
                    "tool_call_id": entry.get("tool_call_id") or entry.get("name") or "",
                    "name": entry.get("name") or "",
                    "content": _compact_tool_content(entry.get("content")),
                }
            )
        elif role == "assistant":
            row: dict[str, Any] = {
                "role": "assistant",
                "content": entry.get("content") if entry.get("content") is not None else "",
            }
            if entry.get("tool_calls"):
                row["tool_calls"] = entry["tool_calls"]
            cleaned.append(row)
        elif role == "user":
            cleaned.append({"role": "user", "content": entry.get("content")})
    session["llm_memory"] = cleaned
