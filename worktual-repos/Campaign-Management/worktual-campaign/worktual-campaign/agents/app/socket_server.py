"""Socket.IO + FastAPI health for create-campaign agents."""

from __future__ import annotations

import asyncio
import re

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.contacts import (
    welcome_text as contacts_welcome_text,
)
from app.mas.socket_bridge import (
    run_contacts_turn_via_mas_or_legacy,
    run_create_campaign_turn_via_mas_or_legacy,
    run_events_report_turn_via_mas_or_legacy,
    run_forms_turn_via_mas_or_legacy,
    run_library_run_turn_via_mas_or_legacy,
    run_monitoring_turn_via_mas_or_legacy,
    run_recommendation_run_turn_via_mas_or_legacy,
    run_recommendations_turn_via_mas_or_legacy,
    run_reports_turn_via_mas_or_legacy,
    run_super_entry_via_mas_or_legacy,
    run_whatsapp_approved_turn_via_mas_or_legacy,
    run_whatsapp_rejected_turn_via_mas_or_legacy,
)
from app.agents.contacts.tools.handlers import handle_get
from app.agents.create_campaign import (
    welcome_text as campaign_welcome_text,
)
from app.agents.create_campaign.prompts import (
    form_campaign_welcome_text,
    hub_welcome_text,
    welcome_library_run,
    welcome_recommendation_run,
)
from app.agents.create_campaign.tool_functions import _normalize_channels_arg
from app.agents.monitoring import (
    welcome_text as monitoring_welcome_text,
)
from app.agents.monitoring.tools.handlers import handle_report as monitoring_handle_report
from app.agents.reports import welcome_text as reports_welcome_text
from app.agents.reports.agent import generate_reports_welcome
from app.agents.events_report import (
    welcome_text as events_report_welcome_text,
)
from app.agents.recommendations import (
    welcome_text as recommendations_welcome_text,
)
from app.agents.recommendations.tools.handlers import store_past_campaigns
from app.industry_packs.loader import (
    apply_login_profile_to_session,
    welcome_override,
)
from app.agents.forms import (
    run_forms_turn,
    welcome_text as forms_welcome_text,
)
from app.agents.forms.tools.handlers import default_form_design
from app.agents.whatsapp_approved import (
    run_whatsapp_approved_turn,
    welcome_text as wa_approved_welcome_text,
)
from app.agents.whatsapp_rejected import (
    run_whatsapp_rejected_turn,
    welcome_text as wa_rejected_welcome_text,
)
from app.agents.template_coach import run_template_coach
from app.agents.template_library.edit_postprocess import (
    mark_whatsapp_draft_after_edit,
)
from app.auth import user_id_from_token
from app.config import get_settings
from app.cors_origins import build_cors_origins
from app.request_context import set_request_token
from app.sft_catalog.routes import router as sft_catalog_router
from app.sft_catalog.skill_routes import router as mas_skill_catalog_router
from app.session_store import (
    append_message,
    compact_drafts_snapshot,
    compact_recommendations_snapshot,
    compact_selected_gallery_images,
    compact_templates_snapshot,
    drop_ephemeral_session,
    get_or_create_session,
    is_ephemeral_module,
    is_hub_session_id,
    public_state,
    save_session,
)
from app.carry_messages import (
    merge_carry_into_messages,
    normalize_carry_message_rows,
)
from app.template_store import (
    append_template_messages,
    get_template,
    list_session_templates,
    sync_session_templates,
    update_template_fields,
)

settings = get_settings()

_CORS_ORIGINS = build_cors_origins(settings.cors_origin)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=_CORS_ORIGINS,
    socketio_path="socket-io",
    # Phase 2 compose can take 30–90s; keep heartbeats alive while LLM runs off-loop.
    ping_timeout=120,
    ping_interval=25,
)

api = FastAPI(title="Worktual Create-Campaign Agents", version="0.1.0")
api.add_middleware(
    CORSMiddleware,
    allow_origins=list(_CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api.include_router(sft_catalog_router)
api.include_router(mas_skill_catalog_router)


_KNOWN_MODULES = frozenset(
    {
        "contacts",
        "create_campaign",
        "recommendation_run",
        "library_run",
        "monitoring",
        "reports",
        "events_report",
        "recommendations",
        "forms",
        "whatsapp_approved",
        "whatsapp_rejected",
        "mas",  # Super entry when MAS_ENABLED_DOMAINS is set
    }
)


def _sync_workspace_context(
    session: dict,
    data: dict | None,
    *,
    session_id: str,
    requested_module: str,
) -> bool:
    """Align hub_mode + module with the FE workspace the user is on."""
    data = data or {}
    sid = str(session_id or session.get("session_id") or "").strip()
    changed = False
    hub_by_id = is_hub_session_id(sid)
    fe_hub = data.get("hub_mode")

    if hub_by_id or fe_hub is True:
        if not session.get("hub_mode"):
            session["hub_mode"] = True
            changed = True
    elif fe_hub is False or (requested_module == "create_campaign" and not hub_by_id):
        if session.get("hub_mode"):
            session["hub_mode"] = False
            changed = True

    req = str(requested_module or "").strip().lower()
    if req in _KNOWN_MODULES and req != str(session.get("module") or "").strip().lower():
        if is_ephemeral_module(req) or not (session.get("messages") or []):
            session["module"] = req
            changed = True
        elif req == "create_campaign" and not hub_by_id:
            session["module"] = req
            changed = True
    return changed


async def _seed_carry_messages(
    session_id: str,
    session: dict,
    data: dict | None,
    *,
    token: str,
    module: str,
) -> dict:
    """Import FE/handoff chat into server session without moving placed messages.

    Placement rules:
    - Hub / non-create modules: empty → adopt carry; established → missing users.
    - Create-campaign *draft* (not hub): ignore bulk carry unless this join is an
      explicit handoff; then adopt at most the last user turn. Never copy another
      campaign's user history into a new session id.
    """
    _ = session_id
    raw = (data or {}).get("carry_messages")
    if not isinstance(raw, list) or not raw:
        return session

    carry = normalize_carry_message_rows(raw)
    data = data or {}
    is_hub = bool(
        session.get("hub_mode")
        or data.get("hub_mode")
        or is_hub_session_id(str(session.get("session_id") or session_id or ""))
    )
    explicit_handoff = bool(
        data.get("explicit_handoff")
        or str(data.get("carry_query") or "").strip()
        or str(data.get("carry_from_module") or "").strip()
    )
    existing = [m for m in (session.get("messages") or []) if isinstance(m, dict)]

    if module == "create_campaign" and not is_hub:
        if not existing and not explicit_handoff:
            return session
        merged = merge_carry_into_messages(
            existing,
            carry,
            restrict_to_handoff=True,
            empty_adopt_max_user_turns=1 if explicit_handoff else 0,
        )
    elif is_hub:
        merged = merge_carry_into_messages(
            existing,
            carry,
            allow_missing_user_backfill=True,
        )
    else:
        merged = merge_carry_into_messages(
            existing,
            carry,
            allow_missing_user_backfill=True,
        )
    if merged is None:
        return session
    session["messages"] = merged
    return await save_session(session, token=token)


def _apply_hub_context(session: dict, data: dict | None) -> bool:
    """Persist hub_mode + board snapshots from FE. Returns True if session changed."""
    data = data or {}
    sid = str(session.get("session_id") or "").strip()
    if data.get("hub_mode") is False and not is_hub_session_id(sid):
        changed = False
        if session.get("hub_mode"):
            session["hub_mode"] = False
            changed = True
        return changed
    hub = bool(data.get("hub_mode")) or is_hub_session_id(sid)
    if not hub:
        return False

    changed = False
    if not session.get("hub_mode"):
        session["hub_mode"] = True
        changed = True

    raw_recs = data.get("recommendations_snapshot")
    if isinstance(raw_recs, list):
        session["recommendations_snapshot"] = compact_recommendations_snapshot(
            raw_recs
        )
        changed = True
    raw_tpl = data.get("templates_snapshot")
    if isinstance(raw_tpl, list):
        session["templates_snapshot"] = compact_templates_snapshot(raw_tpl)
        changed = True
    raw_sel = data.get("selected_library_templates")
    if isinstance(raw_sel, list):
        cleaned = []
        for row in raw_sel:
            if not isinstance(row, dict):
                continue
            channel = str(row.get("channel") or "").strip().lower()
            name = str(row.get("name") or "").strip()
            if not channel or not name:
                continue
            cleaned.append(
                {
                    "channel": channel,
                    "name": name,
                    "description": str(row.get("description") or "").strip(),
                    "body_preview": str(
                        row.get("body_preview") or row.get("bodyPreview") or ""
                    ).strip(),
                    "format_notes": str(row.get("format_notes") or "").strip(),
                }
            )
        session["selected_library_templates"] = cleaned
        changed = True
    raw_gallery = data.get("selected_gallery_images")
    if isinstance(raw_gallery, list):
        session["selected_gallery_images"] = compact_selected_gallery_images(
            raw_gallery
        )
        changed = True
    raw_drafts = data.get("drafts_snapshot")
    if isinstance(raw_drafts, list):
        session["drafts_snapshot"] = compact_drafts_snapshot(raw_drafts)
        changed = True
    return changed


@api.get("/health")
async def health():
    return {
        "statusCode": 200,
        "message": "Campaign agents healthy",
        "modules": [
            "create_campaign",
            "contacts",
            "monitoring",
            "reports",
            "recommendations",
            "forms",
            "whatsapp_approved",
            "whatsapp_rejected",
            "template_library",
            "on_demand",
            "hub_super",
            "mas",
            "sft_agent_catalog",
        ],
    }


@api.get("/.well-known/agent.json")
async def hub_agent_card():
    """A2A discovery: Super Agent skills for hub routing."""
    from app.hub_super import agent_card

    return agent_card()


@api.post("/ai/v1/hub/tasks")
async def hub_super_task(payload: dict):
    """Hub Super Agent — sequential multi-skill tasks, no clarification."""
    from app.hub_super import run_hub_task

    body = payload if isinstance(payload, dict) else {}
    result = await run_hub_task(body)
    status_name = str(result.get("status") or "failed")
    http_status = 200 if status_name in {"completed", "partial"} else 400
    return {
        "statusCode": http_status,
        "message": (
            "Hub task completed"
            if status_name == "completed"
            else (
                "Hub task completed with warnings"
                if status_name == "partial"
                else "Hub task failed"
            )
        ),
        **result,
    }


@api.post("/on-demand/prepare")
async def on_demand_prepare(payload: dict):
    """Analyse operator request + generate recipient-facing channel templates."""
    from app.agents.on_demand import prepare_on_demand_send

    body = payload if isinstance(payload, dict) else {}
    result = await prepare_on_demand_send(body)
    status = 200 if result.get("ok") else 400
    return {
        "statusCode": status,
        "message": "On-demand prepare completed"
        if result.get("ok")
        else (result.get("error") or "On-demand prepare failed"),
        **result,
    }


@api.post("/personalised-crm/prepare")
async def personalised_crm_prepare(payload: dict):
    """CRM Personalised CRM: structured people/channels → templates."""
    from app.agents.personalised_crm import prepare_personalised_crm_send

    body = payload if isinstance(payload, dict) else {}
    result = await prepare_personalised_crm_send(body)
    status = 200 if result.get("ok") else 400
    return {
        "statusCode": status,
        "message": "Personalised CRM prepare completed"
        if result.get("ok")
        else (result.get("error") or "Personalised CRM prepare failed"),
        **result,
    }


@api.post("/gallery/bootstrap/chunk")
async def gallery_bootstrap_chunk(payload: dict):
    """Template Gallery bootstrap chunk — ideas or one template variant."""
    from app.gallery.bootstrap import run_gallery_bootstrap_chunk

    body = payload if isinstance(payload, dict) else {}
    result = await run_gallery_bootstrap_chunk(body)
    status = 200 if result.get("ok") else 400
    return {
        "statusCode": status,
        "message": "Gallery bootstrap chunk completed"
        if result.get("ok")
        else (result.get("error") or "Gallery bootstrap chunk failed"),
        **result,
    }


@api.post("/gallery/worker/process-job-chunk")
async def gallery_worker_process_job_chunk(payload: dict):
    """
    Own gallery bootstrap decisions + generation in Python.
    Campaign backend loads Prisma state, posts it here, then applies mutations.
    """
    from app.gallery.worker_chunk import process_gallery_job_chunk

    body = payload if isinstance(payload, dict) else {}
    try:
        result = await process_gallery_job_chunk(body)
    except Exception as exc:  # noqa: BLE001
        return {
            "statusCode": 500,
            "ok": False,
            "message": str(exc) or "Gallery worker chunk failed",
            "error": str(exc),
            "mutations": [],
            "logs": [],
        }
    status = 200 if result.get("ok") else 400
    return {
        "statusCode": status,
        "message": "Gallery worker chunk completed"
        if result.get("ok")
        else (result.get("error") or "Gallery worker chunk failed"),
        **result,
    }


app = socketio.ASGIApp(sio, other_asgi_app=api, socketio_path="socket-io")

paused_sessions: set[str] = set()
active_tasks: dict[str, asyncio.Task] = {}
# Serialize first-join welcome so parallel join_session cannot append two greets.
_welcome_locks: dict[str, asyncio.Lock] = {}


def _welcome_lock_for(session_id: str) -> asyncio.Lock:
    key = str(session_id or "").strip()
    lock = _welcome_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _welcome_locks[key] = lock
    return lock


def _chat_task_key(
    session_id: str,
    *,
    chat_context: str = "create",
    template_id: str | None = None,
) -> str:
    ctx = str(chat_context or "create").strip().lower()
    tid = str(template_id or "").strip()
    if ctx == "edit" and tid:
        return f"{session_id}:edit:{tid}"
    return f"{session_id}:{ctx or 'create'}"


def _create_chat_busy(session_id: str) -> bool:
    return _chat_task_key(session_id, chat_context="create") in active_tasks


def _clear_session_active_tasks(session_id: str) -> None:
    """Cancel in-flight turns for a session (keys are session_id:context…)."""
    prefix = f"{session_id}:"
    for key in list(active_tasks.keys()):
        if not str(key).startswith(prefix):
            continue
        task = active_tasks.pop(key, None)
        if task and not task.done():
            task.cancel()


_CREATE_CHAT_CTX = "create"


async def _emit_create_chat_typing(session_id: str, *, typing: bool) -> None:
    """Create-campaign chat typing — always tagged so FE bridge routes correctly."""
    await _emit_to_session(
        "agent_typing",
        session_id,
        {
            "session_id": session_id,
            "typing": typing,
            "chat_context": _CREATE_CHAT_CTX,
            # When typing stops, always release the client send lock (avoids stale
            # session_ready.agent_busy blocking the next user message).
            "agent_busy": _create_chat_busy(session_id) if typing else False,
        },
    )


def _fallback_create_campaign_reply(result: dict) -> str:
    from app.mas.runtime.create_chat_reply import fallback_create_campaign_reply

    return fallback_create_campaign_reply(result)


async def _finish_create_chat_turn(session_id: str) -> None:
    """Release typing lock and end the client turn (always — success or failure)."""
    await _emit_create_chat_typing(session_id, typing=False)
    await _emit_to_session(
        "turn_complete",
        session_id,
        {
            "session_id": session_id,
            "chat_context": _CREATE_CHAT_CTX,
        },
    )


_DASHBOARD_EMIT_MODULES = frozenset({"reports", "events_report", "monitoring"})


async def _emit_dashboard_agent_message(session_id: str, result: dict) -> None:
    """Reports/monitoring: ui_events first, then user-visible reply only."""
    result = dict(result)
    if not result.get("ui_events"):
        from app.mas.socket_bridge import collect_ui_events

        result["ui_events"] = collect_ui_events(result, result.get("mas_out"))

    for event in result.get("ui_events") or []:
        if not isinstance(event, dict):
            continue
        await _emit_to_session(
            "ui_event",
            session_id,
            {"session_id": session_id, **event},
        )

    payload: dict = {
        "session_id": session_id,
        "text": str(result.get("reply") or "").strip(),
        "role": "assistant",
    }
    if isinstance(result.get("analytics"), dict):
        payload["analytics"] = result["analytics"]
    suggestions = result.get("suggestions")
    if isinstance(suggestions, list) and suggestions:
        payload["suggestions"] = suggestions
    await _emit_to_session("agent_message", session_id, payload)


async def _emit_create_chat_agent_message(session_id: str, result: dict) -> None:
    result = dict(result)
    if not result.get("ui_events"):
        from app.mas.socket_bridge import collect_ui_events

        result["ui_events"] = collect_ui_events(result, result.get("mas_out"))

    for event in result.get("ui_events") or []:
        if not isinstance(event, dict):
            continue
        await _emit_to_session(
            "ui_event",
            session_id,
            {"session_id": session_id, **event},
        )

    text = _fallback_create_campaign_reply(result)
    payload: dict = {
        "session_id": session_id,
        "text": text,
        "role": "assistant",
        "chat_context": _CREATE_CHAT_CTX,
    }
    if isinstance(result.get("analytics"), dict):
        payload["analytics"] = result["analytics"]
    suggestions = result.get("suggestions")
    if isinstance(suggestions, list) and suggestions:
        payload["suggestions"] = suggestions
    await _emit_to_session("agent_message", session_id, payload)


async def _emit_contacts_turn_result(session_id: str, result: dict) -> None:
    """Contacts: panel/state before chat reply."""
    from app.memory_session_store import memory_get, memory_has
    from app.session_store import get_or_create_session, public_state, save_session

    if memory_has(session_id):
        session = memory_get(session_id) or {}
    else:
        session = await get_or_create_session(session_id)
    if str(session.get("module") or "") == "contacts" or session.get("draft_mode") in (
        "update",
        "view",
    ):
        from app.agents.contacts.tools.handlers import (
            _reconcile_contacts_update_session,
            _reconcile_contacts_view_session,
        )

        _reconcile_contacts_update_session(session_id, session)
        _reconcile_contacts_view_session(session_id, session)
        session = await save_session(session, sync_db=False)
    fresh_state = public_state(session)
    result = dict(result)
    result["state"] = fresh_state
    if not result.get("ui_events"):
        from app.mas.socket_bridge import collect_ui_events

        result["ui_events"] = collect_ui_events(result, result.get("mas_out"))

    ui_events = list(result.get("ui_events") or [])
    if str(fresh_state.get("mode") or "").lower() == "view" or str(
        session.get("last_action") or ""
    ) in ("query_contacts", "search", "lookup"):
        patched: list[dict] = []
        for ev in ui_events:
            if not isinstance(ev, dict) or ev.get("type") != "contact_candidates":
                patched.append(ev)
                continue
            payload = dict(ev.get("payload") or {})
            if payload.get("candidates") and not payload.get("mode"):
                payload["mode"] = "view"
            patched.append({**ev, "payload": payload})
        ui_events = patched
        result["ui_events"] = ui_events

    await _emit_to_session(
        "state_update",
        session_id,
        {
            "session_id": session_id,
            "state": fresh_state,
        },
    )
    for event in result.get("ui_events") or []:
        await _emit_to_session(
            "ui_event",
            session_id,
            {"session_id": session_id, **event},
        )
    await _emit_to_session(
        "agent_message",
        session_id,
        {
            "session_id": session_id,
            "text": result["reply"],
            "role": "assistant",
            **(
                {"analytics": result["analytics"]}
                if isinstance(result.get("analytics"), dict)
                else {}
            ),
            **(
                {"suggestions": result["suggestions"]}
                if isinstance(result.get("suggestions"), list)
                and result.get("suggestions")
                else {}
            ),
        },
    )
    for followup in result.get("followups") or []:
        text = str(followup or "").strip()
        if not text:
            continue
        await _emit_to_session(
            "agent_message",
            session_id,
            {
                "session_id": session_id,
                "text": text,
                "role": "assistant",
            },
        )


def _edit_chat_busy(session_id: str, template_id: str | None = None) -> bool:
    tid = str(template_id or "").strip()
    if tid:
        return _chat_task_key(session_id, chat_context="edit", template_id=tid) in active_tasks
    prefix = f"{session_id}:edit:"
    return any(str(k).startswith(prefix) for k in active_tasks)


async def _safe_get_sio_session(sid) -> dict:
    """Engine.IO sid can vanish mid-handler (soft-nav / reconnect)."""
    try:
        sock = await sio.get_session(sid)
        return sock if isinstance(sock, dict) else {}
    except KeyError:
        return {}
    except Exception:  # noqa: BLE001
        return {}


async def _safe_save_sio_session(sid, data: dict) -> bool:
    try:
        await sio.save_session(sid, data)
        return True
    except KeyError:
        return False
    except Exception:  # noqa: BLE001
        return False


async def _emit_to_session(event: str, session_id: str, data: dict) -> None:
    """Broadcast to the session room so remounted chat still receives events."""
    room = f"campaign_session:{session_id}"
    await sio.emit(event, data, room=room)


async def _emit_agent_progress(session_id: str, event: dict) -> None:
    """Route agent callbacks: state_update, thinking_progress, or ui_event."""
    ev_type = str(event.get("type") or "").strip()
    body = {k: v for k, v in event.items() if k != "type"}
    if ev_type == "state_update":
        await _emit_to_session(
            "state_update", session_id, {"session_id": session_id, **body}
        )
    elif ev_type == "thinking_progress":
        await _emit_to_session(
            "thinking_progress", session_id, {"session_id": session_id, **body}
        )
    else:
        # Keep type so FE can branch (template_progress, templates_ready, navigate, …).
        await _emit_to_session(
            "ui_event",
            session_id,
            {"session_id": session_id, "type": ev_type, **body},
        )


async def _emit_edit_progress(
    sid: str,
    session_id: str,
    event: dict,
    *,
    template_id: str = "",
) -> None:
    """Edit-space progress — socket owner only; never pollute main create chat."""
    ev_type = str(event.get("type") or "").strip()
    body = {k: v for k, v in event.items() if k != "type"}
    payload: dict = {
        "session_id": session_id,
        "chat_context": "edit",
        "type": ev_type,
        **body,
    }
    if template_id:
        payload["template_id"] = template_id
    if ev_type == "state_update":
        await sio.emit("state_update", payload, to=sid)
    elif ev_type == "thinking_progress":
        await sio.emit("thinking_progress", payload, to=sid)
    else:
        await sio.emit("ui_event", payload, to=sid)


def _token_from_environ(environ: dict) -> str | None:
    auth = environ.get("HTTP_AUTHORIZATION") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


async def _resolve_auth(sid, data=None) -> tuple[str | None, str | None, str | None]:
    data = data or {}
    sock = await _safe_get_sio_session(sid)
    token = str(
        data.get("token") or sock.get("token") or ""
    ).strip()
    session_id = str(
        data.get("session_id") or sock.get("session_id") or ""
    ).strip()
    user_id = user_id_from_token(token) if token else None
    return token or None, user_id, session_id or None


def _module_from_data(data=None, session: dict | None = None) -> str:
    from app.session_store import is_recommendation_session_id, resolve_module

    raw = str((data or {}).get("module") or "").strip().lower()
    session_id = str(
        (data or {}).get("session_id")
        or (session or {}).get("session_id")
        or ""
    ).strip()
    if raw in _KNOWN_MODULES:
        return raw
    if session:
        persisted = str(session.get("module") or "").strip().lower()
        if persisted in _KNOWN_MODULES:
            return persisted
    return resolve_module(raw or None, session_id)


async def _require_session_access(sid, data=None) -> dict | None:
    """Validate JWT and load owned campaign_db session. Emits error on failure."""
    token, user_id, session_id = await _resolve_auth(sid, data)
    if not session_id:
        await sio.emit("error", {"message": "session_id required"}, to=sid)
        return None
    if not token or not user_id:
        await sio.emit("error", {"message": "Valid JWT token required"}, to=sid)
        return None
    set_request_token(token)
    module = _module_from_data(data)
    try:
        session = await get_or_create_session(
            session_id,
            user_id=user_id,
            token=token,
            module=module,
        )
    except Exception as exc:  # noqa: BLE001
        await sio.emit(
            "error",
            {"message": f"Session access failed: {exc}"},
            to=sid,
        )
        return None
    owner = str(session.get("user_id") or "")
    if owner and owner != user_id:
        await sio.emit(
            "error",
            {
                "session_id": session_id,
                "message": "You do not have access to this campaign session.",
            },
            to=sid,
        )
        return None

    requested = module
    if _sync_workspace_context(
        session,
        data,
        session_id=session_id,
        requested_module=requested,
    ):
        session = await save_session(session, token=token)

    persisted = str(session.get("module") or "").strip().lower()
    has_messages = bool(session.get("messages") or [])
    fe_hub = (data or {}).get("hub_mode")
    # FE module wins on ephemeral workspaces and create-campaign intake (not hub).
    prefer_requested = (
        requested in _KNOWN_MODULES
        and (
            is_ephemeral_module(requested)
            or (
                requested == "create_campaign"
                and not is_hub_session_id(session_id)
                and fe_hub is not True
            )
        )
    )
    if prefer_requested:
        module = requested
    elif has_messages and persisted in _KNOWN_MODULES:
        module = persisted
    elif requested in _KNOWN_MODULES:
        module = requested
    elif persisted in _KNOWN_MODULES:
        module = persisted

    # Audience "+ Add": wipe prior draft/focus/matches so the create panel starts empty.
    clear_contact_draft = bool((data or {}).get("clear_contact_draft"))
    if clear_contact_draft and module == "contacts":
        # Stop any in-flight turn so it cannot re-emit the old draft/matches.
        _clear_session_active_tasks(session_id)
        paused_sessions.discard(session_id)
        session["draft_contact"] = {
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
        }
        session["focus_contact_id"] = None
        session["candidates"] = []
        session.pop("query_panel_candidates", None)
        session.pop("query_panel_count", None)
        session["pending_delete_id"] = None
        session["create_fingerprint"] = None
        session["stage"] = "create_new"
        session["last_action"] = "clear_draft"
        session = await save_session(session, token=token)

    # Optional focus contact for detail-page chats — load live draft panel.
    # join_session and user_message both pass through here, so sending
    # focus_contact_id on each chat turn keeps the agent on the open contact.
    # Create vs update is LLM + SET_DRAFT_FIELDS (mode=create / reset_draft) —
    # never inferred from chat keywords. Skip re-loading focus once create mode
    # is already set on the session by a prior tool call.
    focus_id = str((data or {}).get("focus_contact_id") or "").strip()
    skip_focus = (
        clear_contact_draft
        or str(session.get("draft_mode") or "").lower() == "create"
    )
    if focus_id and module == "contacts" and not skip_focus:
        draft = session.get("draft_contact") or {}
        needs_load = session.get("focus_contact_id") != focus_id or not (
            str(draft.get("email") or "").strip()
            or str(draft.get("phone") or "").strip()
            or str(draft.get("first_name") or "").strip()
        )
        if needs_load:
            try:
                await handle_get(
                    session_id,
                    token,
                    {
                        "contact_id": focus_id,
                        "change_summary": "Load focused contact into live details",
                    },
                )
                session = await get_or_create_session(
                    session_id, token=token, module="contacts"
                )
            except Exception:  # noqa: BLE001
                session["focus_contact_id"] = focus_id
                session = await save_session(session, token=token)

    # Optional focus campaign for monitoring detail chat.
    focus_campaign = str((data or {}).get("focus_campaign_id") or "").strip()
    if focus_campaign and module == "monitoring":
        needs_load = session.get("focus_campaign_id") != focus_campaign or not (
            session.get("last_report")
        )
        if needs_load:
            try:
                await monitoring_handle_report(
                    session_id,
                    token,
                    {
                        "campaign_id": focus_campaign,
                        "change_summary": "Load focused campaign report",
                    },
                )
                session = await get_or_create_session(
                    session_id, token=token, module="monitoring"
                )
            except Exception:  # noqa: BLE001
                session["focus_campaign_id"] = focus_campaign
                session = await save_session(session, token=token)

    # Dashboard Overview period — align agent filters with FE period control.
    if module == "reports":
        raw_period = (data or {}).get("dashboard_period")
        if isinstance(raw_period, dict):
            session["dashboard_period"] = {
                "range": str(raw_period.get("range") or "").strip() or "today",
                "from": str(raw_period.get("from") or "").strip() or None,
                "to": str(raw_period.get("to") or "").strip() or None,
                "label": str(raw_period.get("label") or "").strip() or None,
                "relative": str(raw_period.get("relative") or "").strip() or None,
                "from_date": str(
                    raw_period.get("from_date") or raw_period.get("from") or ""
                ).strip()
                or None,
                "to_date": str(
                    raw_period.get("to_date") or raw_period.get("to") or ""
                ).strip()
                or None,
            }
            session = await save_session(session, token=token)
        raw_snap = (data or {}).get("dashboard_snapshot")
        if isinstance(raw_snap, dict):
            session["dashboard_snapshot"] = raw_snap
            session = await save_session(session, token=token)

    # Soft-nav can drop the Engine.IO sid while we still finish auth/load.
    # Do not crash join/user_message — FE needs error/typing clear, not a hang.
    await _safe_save_sio_session(
        sid,
        {
            "token": token,
            "user_id": user_id,
            "session_id": session_id,
            "module": module,
        },
    )
    return {
        "token": token,
        "user_id": user_id,
        "session_id": session_id,
        "session": session,
        "module": module,
    }


@sio.event
async def connect(sid, environ, auth):
    token = None
    if isinstance(auth, dict):
        token = auth.get("token")
    if not token:
        token = _token_from_environ(environ or {})
    user_id = user_id_from_token(token) if token else None
    if not token or not user_id:
        await sio.emit(
            "error",
            {"message": "Valid JWT token required to connect"},
            to=sid,
        )
        return False
    await _safe_save_sio_session(sid, {"token": token, "user_id": user_id})
    await sio.emit(
        "connected",
        {"ok": True, "service": "create_campaign_agents"},
        to=sid,
    )
    return True


@sio.event
async def disconnect(sid):
    sock = await _safe_get_sio_session(sid)
    session_id = str(sock.get("session_id") or "").strip()
    module = str(sock.get("module") or "").strip().lower()
    if session_id and (
        is_ephemeral_module(module) or is_hub_session_id(session_id)
    ):
        drop_ephemeral_session(session_id)
        paused_sessions.discard(session_id)
        _clear_session_active_tasks(session_id)
    return


def socket_leave_clears_binding(
    bound_session_id: str | None, leaving_session_id: str | None
) -> bool:
    """True when leave_session should clear the Engine.IO session dict.

    Hub unmount often emits leave for hub-* after the draft already joined
    on the same sid. Clearing would drop the draft binding and FE hangs
    waiting for session_ready / send.
    """
    bound = str(bound_session_id or "").strip()
    leaving = str(leaving_session_id or "").strip()
    if not leaving:
        return False
    return not bound or bound == leaving


@sio.on("leave_session")
async def leave_session(sid, data):
    """FE navigates away — drop ephemeral / hub memory."""
    token, user_id, session_id = await _resolve_auth(sid, data)
    if not session_id:
        return
    module = _module_from_data(data)
    sock = await _safe_get_sio_session(sid)
    if not module or module == "create_campaign":
        module = str(sock.get("module") or "").strip().lower() or module
    if is_ephemeral_module(module) or is_hub_session_id(session_id):
        drop_ephemeral_session(session_id)
        paused_sessions.discard(session_id)
        _clear_session_active_tasks(session_id)
    try:
        await sio.leave_room(sid, f"campaign_session:{session_id}")
    except Exception:  # noqa: BLE001
        pass
    bound_id = str(sock.get("session_id") or "").strip()
    if not socket_leave_clears_binding(bound_id, session_id):
        return
    # Keep token/user on the socket; clear bound campaign session.
    await _safe_save_sio_session(
        sid,
        {
            "token": token or sock.get("token"),
            "user_id": user_id or sock.get("user_id"),
        },
    )


@sio.on("update_dashboard_period")
async def update_dashboard_period(sid, data):
    """Sync Overview period filter without session_ready (preserves chat analytics UI)."""
    try:
        access = await _require_session_access(sid, data)
    except Exception as exc:  # noqa: BLE001
        await sio.emit(
            "error",
            {"message": f"Dashboard period update failed: {exc}"},
            to=sid,
        )
        return
    if not access:
        return
    module = access.get("module") or "reports"
    if module != "reports":
        return
    from app.services.portfolio_api import normalize_dashboard_period

    raw_period = (data or {}).get("dashboard_period")
    period = normalize_dashboard_period(raw_period)
    if not period:
        return
    session = access["session"]
    session["dashboard_period"] = period
    raw_snap = (data or {}).get("dashboard_snapshot")
    if isinstance(raw_snap, dict):
        session["dashboard_snapshot"] = raw_snap
    raw_events = (data or {}).get("events_snapshot")
    if isinstance(raw_events, dict):
        session["events_snapshot"] = raw_events
    await save_session(session, token=access["token"])


@sio.on("join_session")
async def join_session(sid, data):
    try:
        access = await _require_session_access(sid, data)
    except Exception as exc:  # noqa: BLE001
        await sio.emit(
            "error",
            {"message": f"Session join failed: {exc}"},
            to=sid,
        )
        return
    if not access:
        return
    session_id = access["session_id"]
    session = access["session"]
    module = access.get("module") or "create_campaign"
    if module == "create_campaign" and (data or {}).get("clear_edit_scope", True):
        session.pop("active_edit_channel", None)
        session.pop("active_edit_template_id", None)
        if str(session.get("stage") or "").strip().lower() == "edit":
            session["stage"] = "templates"
        try:
            session = await save_session(session, token=access["token"])
        except Exception:  # noqa: BLE001
            pass
    clone_cards_to_emit: list[dict] = []
    try:
        await sio.enter_room(sid, f"campaign_session:{session_id}")
    except Exception:  # noqa: BLE001
        await sio.emit(
            "error",
            {
                "session_id": session_id,
                "message": "Could not join campaign session room. Retry shortly.",
            },
            to=sid,
        )
        return

    raw_profile = (data or {}).get("campaign_profile")
    apply_login_profile_to_session(
        session, raw_profile if isinstance(raw_profile, dict) else None
    )
    session = await save_session(session, token=access["token"])

    client_tz = str(
        (data or {}).get("client_timezone") or (data or {}).get("timezone") or ""
    ).strip()
    if client_tz:
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(client_tz)
            session["client_timezone"] = client_tz
            session = await save_session(session, token=access["token"])
        except Exception:  # noqa: BLE001
            pass

    # Soft-nav / embed: unblock FE immediately. Company-pack HTTP can take up to 15s
    # and was causing "Co-worker connection timed out" on Monitor / Events.
    await sio.emit(
        "session_ready",
        {
            "session_id": session_id,
            "state": public_state(session),
            "messages": session.get("messages") or [],
            "module": module,
            "agent_busy": _create_chat_busy(session_id),
            "ready_phase": "initial",
        },
        to=sid,
    )

    # Load/refresh per-company pack (best-effort, bounded).
    try:
        import asyncio

        from app.industry_packs.tenant_pack import refresh_session_company_pack

        session = await asyncio.wait_for(
            refresh_session_company_pack(session, access["token"]),
            timeout=2.5,
        )
        apply_login_profile_to_session(session)
        session = await save_session(session, token=access["token"])
    except Exception:  # noqa: BLE001
        pass

    # Persist create-campaign / recommendation-run library selections for format-following generation.
    if module in ("create_campaign", "recommendation_run", "library_run"):
        raw_selected = (data or {}).get("selected_library_templates")
        if isinstance(raw_selected, list):
            cleaned = []
            for row in raw_selected:
                if not isinstance(row, dict):
                    continue
                channel = str(row.get("channel") or "").strip().lower()
                name = str(row.get("name") or "").strip()
                if not channel or not name:
                    continue
                cleaned.append(
                    {
                        "id": str(row.get("id") or row.get("template_id") or "").strip()
                        or None,
                        "template_id": str(
                            row.get("template_id") or row.get("id") or ""
                        ).strip()
                        or None,
                        "channel": channel,
                        "name": name,
                        "description": str(row.get("description") or "").strip(),
                        "body_preview": str(
                            row.get("body_preview")
                            or row.get("bodyPreview")
                            or ""
                        ).strip(),
                        "format_notes": str(row.get("format_notes") or "").strip(),
                        "fields": row.get("fields")
                        if isinstance(row.get("fields"), dict)
                        else None,
                    }
                )
            session["selected_library_templates"] = cleaned
            session = await save_session(session, token=access["token"])

        raw_gallery = (data or {}).get("selected_gallery_images")
        if isinstance(raw_gallery, list):
            session["selected_gallery_images"] = compact_selected_gallery_images(
                raw_gallery
            )
            session = await save_session(session, token=access["token"])

        # Seed channels from FE draft (e.g. PPC-only chats) when session has none yet.
        raw_channels = (data or {}).get("channels")
        if isinstance(raw_channels, list) and not (session.get("channels") or []):
            channels = _normalize_channels_arg(raw_channels)
            if channels:
                session["channels"] = channels
                session = await save_session(session, token=access["token"])

        # Optional hint of tenant channels — never a gate for templates.
        raw_available = (data or {}).get("available_channels")
        if isinstance(raw_available, list):
            session["available_channels"] = _normalize_channels_arg(raw_available)
            session = await save_session(session, token=access["token"])

        # Recommendation card → run agent: prefill panel, same create/launch tools.
        rec_run = module == "recommendation_run" or bool(
            (data or {}).get("recommendation_run")
        )
        if rec_run:
            session["recommendation_run"] = True
            rec_id = str(
                (data or {}).get("recommendation_id")
                or session.get("source_recommendation_id")
                or ""
            ).strip()
            if rec_id:
                session["source_recommendation_id"] = rec_id
            why = str(
                (data or {}).get("recommendation_why")
                or session.get("recommendation_why")
                or ""
            ).strip()
            if why:
                session["recommendation_why"] = why
            raw_campaign = (data or {}).get("campaign")
            campaign = session.setdefault("campaign", {})
            if isinstance(raw_campaign, dict):
                for key in ("name", "goal", "objective"):
                    val = str(raw_campaign.get(key) or "").strip()
                    if val and not str(campaign.get(key) or "").strip():
                        campaign[key] = val
            hint = str(
                (data or {}).get("audience_hint")
                or (data or {}).get("audience")
                or ""
            ).strip()
            aud = session.setdefault("audience", {})
            if hint and not str(aud.get("description") or "").strip():
                aud["description"] = hint
            timing = str((data or {}).get("timing_label") or "").strip()
            suggested_at = str(
                (data or {}).get("suggested_launch_at") or ""
            ).strip()
            if (timing or suggested_at) and not session.get("launch_plan"):
                session["launch_plan"] = {
                    "schedule_mode": "at" if suggested_at else "now",
                    "scheduled_at": suggested_at or None,
                    "notes": timing or None,
                }
            if not session.get("stage") or session.get("stage") in (
                "intake",
                "idle",
            ):
                session["stage"] = "recommendation_run"
            session = await save_session(session, token=access["token"])

        # Template Library → library_run: baseline creatives, not clone_mode.
        lib_run = module == "library_run" or bool((data or {}).get("library_run"))
        if lib_run:
            session["library_run"] = True
            session["recommendation_run"] = False
            raw_campaign = (data or {}).get("campaign")
            campaign = session.setdefault("campaign", {})
            if isinstance(raw_campaign, dict):
                for key in ("name", "goal", "objective"):
                    val = str(raw_campaign.get(key) or "").strip()
                    if val and not str(campaign.get(key) or "").strip():
                        campaign[key] = val
            raw_seeded = (data or {}).get("seeded_templates")
            seeded: list[dict] = []
            if isinstance(raw_seeded, list):
                for row in raw_seeded:
                    if not isinstance(row, dict):
                        continue
                    tid = str(
                        row.get("template_id") or row.get("id") or ""
                    ).strip()
                    channel_list = _normalize_channels_arg([row.get("channel")])
                    channel = channel_list[0] if channel_list else ""
                    fields = (
                        row.get("fields")
                        if isinstance(row.get("fields"), dict)
                        else {}
                    )
                    if not channel:
                        continue
                    card: dict = {
                        "channel": channel,
                        "logo": row.get("logo"),
                        "launch_at": row.get("launch_at"),
                        "fields": fields,
                        "how_it_works": row.get("how_it_works")
                        or f"{channel} touch from library",
                        "generation_batch_id": row.get("generation_batch_id"),
                    }
                    if tid:
                        card["library_template_id"] = tid
                    seeded.append(card)
            if seeded and not (session.get("templates") or []):
                session["templates"] = seeded
                session["confirmed_create_templates"] = True
                session["stage"] = "templates"
            elif not session.get("stage") or session.get("stage") in (
                "intake",
                "idle",
            ):
                session["stage"] = "library_run"
            sel = [
                row
                for row in (session.get("selected_library_templates") or [])
                if isinstance(row, dict)
            ]
            channels_selected = _normalize_channels_arg(
                [
                    str(r.get("channel") or "").strip().lower()
                    for r in sel
                    if str(r.get("channel") or "").strip()
                ]
                or list(session.get("channels") or [])
            )
            have = {
                str(t.get("channel") or "").strip().lower()
                for t in (session.get("templates") or [])
                if isinstance(t, dict) and str(t.get("channel") or "").strip()
            }
            if session.get("channels"):
                missing = [
                    ch
                    for ch in _normalize_channels_arg(list(session.get("channels") or []))
                    if ch not in have
                ]
            else:
                missing = [ch for ch in channels_selected if ch not in have]
            session["library_baseline"] = {
                "channels_selected": channels_selected
                or _normalize_channels_arg(list(session.get("channels") or [])),
                "channels_missing": missing,
                "templates": [
                    {
                        "id": str(t.get("template_id") or t.get("id") or ""),
                        "channel": str(t.get("channel") or ""),
                        "name": str(
                            (t.get("fields") or {}).get("name")
                            if isinstance(t.get("fields"), dict)
                            else ""
                        )
                        or str(t.get("name") or ""),
                    }
                    for t in (
                        session.get("templates")
                        or session.get("selected_library_templates")
                        or []
                    )
                    if isinstance(t, dict)
                ][:12],
            }
            if channels_selected and not (session.get("channels") or []):
                session["channels"] = channels_selected
            session = await save_session(session, token=access["token"])

        # Form-launch: seed public form URL for template CTAs (not clone_mode).
        raw_form_launch = (data or {}).get("form_launch")
        if isinstance(raw_form_launch, dict):
            event_id = str(
                raw_form_launch.get("event_id")
                or raw_form_launch.get("eventId")
                or ""
            ).strip()
            public_url = str(
                raw_form_launch.get("public_url")
                or raw_form_launch.get("publicUrl")
                or ""
            ).strip()
            title = str(raw_form_launch.get("title") or "").strip()
            slug = str(
                raw_form_launch.get("public_slug")
                or raw_form_launch.get("publicSlug")
                or ""
            ).strip()
            if event_id or public_url:
                session["form_launch"] = {
                    "event_id": event_id or None,
                    "title": title,
                    "public_url": public_url or None,
                    "public_slug": slug or None,
                }
                if public_url:
                    session["form_url"] = public_url
                if event_id:
                    session["form_event_id"] = event_id
                if not session.get("stage") or session.get("stage") in (
                    "intake",
                    "idle",
                ):
                    session["stage"] = "form_campaign"
                session = await save_session(session, token=access["token"])

        # Clone-past: seed campaign fields, channels, and templates from FE draft.
        clone_mode = bool((data or {}).get("clone_mode"))
        raw_campaign = (data or {}).get("campaign")
        raw_seeded = (data or {}).get("seeded_templates")
        if session.get("recommendation_run") or session.get("library_run"):
            pass
        elif clone_mode or isinstance(raw_campaign, dict) or isinstance(
            raw_seeded, list
        ):
            session["clone_mode"] = True
            campaign = session.setdefault("campaign", {})
            if isinstance(raw_campaign, dict):
                for key in ("name", "goal", "objective"):
                    val = str(raw_campaign.get(key) or "").strip()
                    if val and not str(campaign.get(key) or "").strip():
                        campaign[key] = val
            if isinstance(raw_channels, list):
                channels = _normalize_channels_arg(raw_channels)
                if channels and not (session.get("channels") or []):
                    session["channels"] = channels

            seeded: list[dict] = []
            if isinstance(raw_seeded, list):
                for row in raw_seeded:
                    if not isinstance(row, dict):
                        continue
                    tid = str(
                        row.get("template_id") or row.get("id") or ""
                    ).strip()
                    channel_list = _normalize_channels_arg(
                        [row.get("channel")]
                    )
                    channel = channel_list[0] if channel_list else ""
                    if not tid or not channel:
                        continue
                    card = {
                        "template_id": tid,
                        "channel": channel,
                        "logo": row.get("logo"),
                        "launch_at": row.get("launch_at"),
                        "fields": row.get("fields")
                        if isinstance(row.get("fields"), dict)
                        else {},
                        "how_it_works": row.get("how_it_works"),
                        "generation_batch_id": row.get("generation_batch_id"),
                    }
                    seeded.append(card)
            if seeded:
                existing_ids = {
                    str(t.get("template_id") or "")
                    for t in (session.get("templates") or [])
                    if isinstance(t, dict)
                }
                templates = list(session.get("templates") or [])
                for card in seeded:
                    if card["template_id"] not in existing_ids:
                        templates.append(card)
                        existing_ids.add(card["template_id"])
                session["templates"] = templates
                session["confirmed_create_templates"] = True
                session["stage"] = "templates"
                clone_cards_to_emit = list(seeded)
                source = str((data or {}).get("clone_source_name") or "").strip()
                if not source:
                    clone_src = str(campaign.get("name") or "").strip()
                    if clone_src.lower().startswith("clone"):
                        source = clone_src.replace("Clone ·", "").strip()
                channels_label = ", ".join(session.get("channels") or [])
                intro = (
                    f'Cloned "{source or "past campaign"}". These are the templates '
                    f"that ran ({channels_label or 'your channels'}). Audience is not "
                    "copied — tell me the new name and who to reach. If you don't like "
                    "these templates, ask to create all new."
                )
                msgs = session.get("messages") or []
                has_assistant = any(
                    isinstance(m, dict) and str(m.get("role") or "") == "assistant"
                    for m in msgs
                )
                if not has_assistant:
                    session = await append_message(
                        session_id,
                        "assistant",
                        intro,
                        token=access["token"],
                        module=module,
                    )
            elif campaign.get("goal") or campaign.get("objective"):
                session["stage"] = "audience"
            session = await save_session(session, token=access["token"])

        # Recommendations board snapshot for create-campaign suggestions.
        raw_recs = (data or {}).get("recommendations_snapshot")
        if isinstance(raw_recs, list):
            session["recommendations_snapshot"] = compact_recommendations_snapshot(
                raw_recs
            )
            session = await save_session(session, token=access["token"])

        # Create-campaign hub: picker mode + board/drafts snapshots.
        if _apply_hub_context(session, data):
            session = await save_session(session, token=access["token"])

    # Seed WhatsApp approved/rejected template snapshot from FE.
    if module in ("whatsapp_approved", "whatsapp_rejected"):
        raw_tpl = (data or {}).get("whatsapp_template_snapshot")
        if isinstance(raw_tpl, dict) and raw_tpl:
            session["whatsapp_template_snapshot"] = raw_tpl
            if module == "whatsapp_approved":
                from app.agents.whatsapp_approved.launch_helpers import (
                    seed_approved_campaign_session,
                )

                session = seed_approved_campaign_session(session, raw_tpl)
                session["whatsapp_approved_run"] = True
                from app.session_store import _ensure_agent_session_shell

                await _ensure_agent_session_shell(
                    session_id,
                    token=access["token"],
                )
            session = await save_session(session, token=access["token"])

    is_new = len(session.get("messages") or []) == 0
    skip_welcome = bool((data or {}).get("skip_welcome"))
    # Hub is a throwaway router — never auto-welcome / never restore a “session feel”.
    if session.get("hub_mode") or is_hub_session_id(session_id):
        skip_welcome = True
    seed_text = str((data or {}).get("seed_user_message") or "").strip()
    # Parallel join_session can both see an empty transcript; lock + re-check before append.
    if is_new and not skip_welcome and not seed_text:
        async with _welcome_lock_for(session_id):
            session = await get_or_create_session(
                session_id, token=access["token"], module=module
            )
            if len(session.get("messages") or []) > 0:
                pass  # Another join already welcomed this session.
            else:
                profile = session.get("campaign_profile")
                if module == "contacts":
                    welcome = welcome_override(
                        "contacts",
                        profile,
                        focus_contact_id=session.get("focus_contact_id"),
                        draft_contact=session.get("draft_contact"),
                    ) or contacts_welcome_text(
                        focus_contact_id=session.get("focus_contact_id"),
                        draft_contact=session.get("draft_contact"),
                        campaign_profile=profile,
                    )
                elif module == "monitoring":
                    welcome = welcome_override(
                        "monitoring",
                        profile,
                        focus_campaign_id=session.get("focus_campaign_id"),
                        campaign_name=session.get("focus_campaign_name"),
                    ) or monitoring_welcome_text(
                        focus_campaign_id=session.get("focus_campaign_id"),
                        campaign_name=session.get("focus_campaign_name"),
                    )
                elif module == "reports":
                    try:
                        welcome = await generate_reports_welcome(session)
                    except Exception:  # noqa: BLE001
                        welcome = (
                            welcome_override("reports", profile)
                            or reports_welcome_text()
                        )
                    # LLM welcome is slow — another join may have finished while we waited.
                    session = await get_or_create_session(
                        session_id, token=access["token"], module=module
                    )
                    if len(session.get("messages") or []) > 0:
                        welcome = ""
                elif module == "events_report":
                    welcome = (
                        welcome_override("events_report", profile)
                        or events_report_welcome_text()
                    )
                elif module == "recommendations":
                    welcome = recommendations_welcome_text(profile)
                elif module == "forms":
                    welcome = (
                        welcome_override("forms", profile) or forms_welcome_text()
                    )
                elif module == "mas":
                    welcome = (
                        "I can help across Audience, Campaign Creation, Content, "
                        "Optimization, and Forms. What would you like to do?"
                    )
                elif module == "whatsapp_approved":
                    welcome = welcome_override(
                        "whatsapp_approved",
                        profile,
                    ) or wa_approved_welcome_text()
                elif module == "whatsapp_rejected":
                    snap = session.get("whatsapp_template_snapshot") or {}
                    welcome = welcome_override(
                        "whatsapp_rejected",
                        profile,
                        template_name=snap.get("name"),
                        reason=snap.get("rejected_reason")
                        or snap.get("rejectedReason"),
                    ) or wa_rejected_welcome_text(
                        snap.get("name"),
                        snap.get("rejected_reason") or snap.get("rejectedReason"),
                    )
                else:
                    fl = (
                        session.get("form_launch")
                        if isinstance(session.get("form_launch"), dict)
                        else {}
                    )
                    if fl.get("public_url") or fl.get("title"):
                        welcome = form_campaign_welcome_text(fl)
                    elif (
                        module == "recommendation_run"
                        or session.get("recommendation_run")
                    ):
                        welcome = welcome_recommendation_run()
                    elif module == "library_run" or session.get("library_run"):
                        welcome = welcome_library_run()
                    elif session.get("hub_mode") or is_hub_session_id(session_id):
                        welcome = hub_welcome_text()
                    else:
                        welcome = campaign_welcome_text(
                            session.get("recommendations_snapshot"),
                            campaign_profile=profile,
                        )
                if str(welcome or "").strip():
                    session = await append_message(
                        session_id,
                        "assistant",
                        welcome,
                        token=access["token"],
                        module=module,
                    )

    # Load past campaign performance for recommendations (no dummy seed cards).
    if module == "recommendations":
        await store_past_campaigns(session_id, access["token"])

    # Seed events snapshot for Reports / Events tracking (read-only; does not migrate localStorage).
    if module in ("reports", "events_report"):
        raw_events = (data or {}).get("events_snapshot")
        if isinstance(raw_events, dict):
            session["events_snapshot"] = raw_events
            session = await save_session(session, token=access["token"])

    # Seed form design from FE snapshot when opening the forms editor.
    if module == "forms":
        form_event_id = str((data or {}).get("form_event_id") or "").strip()
        if form_event_id:
            session["form_event_id"] = form_event_id
        raw_snapshot = (data or {}).get("form_snapshot")
        if isinstance(raw_snapshot, dict) and not session.get("form_design"):
            fields = raw_snapshot.get("fields") or raw_snapshot.get("formFields") or []
            theme = raw_snapshot.get("theme") or {}
            session["form_design"] = {
                "title": str(raw_snapshot.get("title") or "").strip()
                or default_form_design()["title"],
                "description": str(raw_snapshot.get("description") or "").strip(),
                "thank_you_message": str(
                    raw_snapshot.get("thank_you_message")
                    or raw_snapshot.get("thankYouMessage")
                    or ""
                ).strip(),
                "fields": fields if isinstance(fields, list) else [],
                "theme": theme if isinstance(theme, dict) else {},
                "public_slug": str(
                    raw_snapshot.get("public_slug")
                    or raw_snapshot.get("publicSlug")
                    or ""
                ).strip()
                or None,
                "public_url": str(
                    raw_snapshot.get("public_url")
                    or raw_snapshot.get("publicUrl")
                    or ""
                ).strip()
                or None,
            }
            session["stage"] = "form_seeded"
            session = await save_session(session, token=access["token"])
        elif not session.get("form_design"):
            session["form_design"] = default_form_design()
            session["stage"] = "form_seeded"
            session = await save_session(session, token=access["token"])

    if module in ("create_campaign", "recommendation_run", "library_run") and not (
        session.get("hub_mode") or is_hub_session_id(session_id)
    ):
        try:
            from app.agents.create_campaign.context import ensure_audience_summary

            await ensure_audience_summary(session_id, access["token"])
            session = await get_or_create_session(session_id, token=access["token"])
        except Exception:  # noqa: BLE001
            pass

    session = await _seed_carry_messages(
        session_id,
        session,
        data,
        token=access["token"],
        module=module,
    )

    carry_query = str((data or {}).get("carry_query") or "").strip()
    carry_from = str((data or {}).get("carry_from_module") or "").strip()
    if carry_query:
        msgs = session.get("messages") or []
        already = any(
            isinstance(m, dict) and (m.get("meta") or {}).get("carry_query")
            for m in msgs
        )
        if not already:
            from_label = carry_from.replace("_", " ").strip() or "another workspace"
            cue = (
                f"[Routed from {from_label}] The user wants: {carry_query}. "
                "Continue from that intent. Do not tell them to navigate manually."
            )
            session = await append_message(
                session_id,
                "system",
                cue,
                meta={"carry_query": True, "from_module": carry_from},
                token=access["token"],
                module=module,
            )

    await sio.emit(
        "session_ready",
        {
            "session_id": session_id,
            "state": public_state(session),
            "messages": session.get("messages") or [],
            "module": module,
            "agent_busy": _create_chat_busy(session_id),
            "ready_phase": "hydration",
        },
        to=sid,
    )

    if clone_cards_to_emit and module == "create_campaign":
        persist_payload = [
            {
                "template_id": t.get("template_id"),
                "channel": t.get("channel"),
                "logo": t.get("logo"),
                "launch_at": t.get("launch_at"),
                "how_it_works": t.get("how_it_works"),
                "fields": t.get("fields")
                if isinstance(t.get("fields"), dict)
                else {},
                "generation_batch_id": t.get("generation_batch_id"),
            }
            for t in clone_cards_to_emit
            if t.get("template_id") and t.get("channel")
        ]
        if persist_payload:
            try:
                await sync_session_templates(
                    session_id,
                    persist_payload,
                    token=access["token"],
                )
            except Exception:  # noqa: BLE001
                pass
        await sio.emit(
            "ui_event",
            {
                "session_id": session_id,
                "type": "templates_ready",
                "payload": {
                    "source": "clone",
                    "template_count": len(clone_cards_to_emit),
                },
            },
            to=sid,
        )

    # Seed first user turn on join when FE sends seed_user_message.
    # Same MAS/legacy bridges as user_message so flags apply consistently.
    run_seed = bool(seed_text) and module in (
        "contacts",
        "monitoring",
        "reports",
        "events_report",
        "whatsapp_approved",
        "whatsapp_rejected",
        "create_campaign",
        "recommendations",
    )
    create_key = _chat_task_key(session_id, chat_context="create")
    if run_seed and create_key in active_tasks:
        run_seed = False
    if run_seed:
        seed_task = asyncio.current_task()
        if seed_task:
            active_tasks[create_key] = seed_task
        await _emit_create_chat_typing(session_id, typing=True)

        async def emit_progress(event):
            await _emit_agent_progress(session_id, event)

        try:
            from app.progress_status import emit_process_progress

            await emit_process_progress(emit_progress, "thinking")
            if module == "monitoring":
                result = await run_monitoring_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "reports":
                result = await run_reports_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "events_report":
                result = await run_events_report_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "whatsapp_approved":
                result = await run_whatsapp_approved_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "whatsapp_rejected":
                result = await run_whatsapp_rejected_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "recommendation_run":
                result = await run_recommendation_run_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "library_run":
                result = await run_library_run_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "create_campaign":
                result = await run_create_campaign_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            elif module == "recommendations":
                result = await run_recommendations_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            else:
                result = await run_contacts_turn_via_mas_or_legacy(
                    session_id,
                    access["token"],
                    seed_text,
                    event_callback=emit_progress,
                )
            if module in ("create_campaign", "recommendation_run", "library_run", "recommendations"):
                await _emit_create_chat_agent_message(session_id, result)
            elif module == "contacts":
                await _emit_contacts_turn_result(session_id, result)
            elif module in _DASHBOARD_EMIT_MODULES:
                await _emit_dashboard_agent_message(session_id, result)
            else:
                await _emit_to_session(
                    "agent_message",
                    session_id,
                    {
                        "session_id": session_id,
                        "text": result["reply"],
                        "role": "assistant",
                        **(
                            {"analytics": result["analytics"]}
                            if isinstance(result.get("analytics"), dict)
                            else {}
                        ),
                        **(
                            {"suggestions": result["suggestions"]}
                            if isinstance(result.get("suggestions"), list)
                            and result.get("suggestions")
                            else {}
                        ),
                    },
                )
            if module not in (
                "create_campaign",
                "recommendation_run",
                "library_run",
                "recommendations",
                "contacts",
                *_DASHBOARD_EMIT_MODULES,
            ):
                await _emit_to_session(
                    "state_update",
                    session_id,
                    {
                        "session_id": session_id,
                        "state": result.get("state")
                        or public_state(session),
                    },
                )
                for event in result.get("ui_events") or []:
                    await _emit_to_session(
                        "ui_event",
                        session_id,
                        {"session_id": session_id, **event},
                    )
            elif module in _DASHBOARD_EMIT_MODULES:
                await _emit_to_session(
                    "state_update",
                    session_id,
                    {
                        "session_id": session_id,
                        "state": result.get("state")
                        or public_state(session),
                    },
                )
        except Exception as exc:  # noqa: BLE001
            from app.mas.runtime.turn_audit_log import log_turn_socket_error

            log_turn_socket_error(
                session_id=session_id,
                module=str(module or ""),
                error=str(exc),
                chat_context="create",
            )
            await _emit_to_session(
                "error",
                session_id,
                {"message": f"Agent failed: {exc}", "session_id": session_id},
            )
        finally:
            if active_tasks.get(create_key) is seed_task:
                active_tasks.pop(create_key, None)
            await _emit_create_chat_typing(session_id, typing=False)
            if module in ("create_campaign", "recommendation_run", "library_run", "recommendations"):
                await _emit_to_session(
                    "turn_complete",
                    session_id,
                    {
                        "session_id": session_id,
                        "chat_context": _CREATE_CHAT_CTX,
                    },
                )


@sio.on("user_message")
async def user_message(sid, data):
    try:
        access = await _require_session_access(sid, data)
    except Exception as exc:  # noqa: BLE001
        sid_hint = str((data or {}).get("session_id") or "").strip()
        await sio.emit(
            "error",
            {
                "session_id": sid_hint or None,
                "message": f"Session access failed: {exc}",
            },
            to=sid,
        )
        return
    if not access:
        return
    session_id = access["session_id"]
    token = access["token"]
    text = str((data or {}).get("text") or "").strip()
    module = access.get("module") or _module_from_data(data, access["session"])
    # Refresh read-only events snapshot on each reports / events_report turn.
    if module in ("reports", "events_report"):
        raw_events = (data or {}).get("events_snapshot")
        if isinstance(raw_events, dict):
            session = access["session"]
            session["events_snapshot"] = raw_events
            await save_session(session, token=token)
            access["session"] = session
    if module == "reports":
        raw_period = (data or {}).get("dashboard_period")
        if isinstance(raw_period, dict):
            session = access["session"]
            session["dashboard_period"] = {
                "range": str(raw_period.get("range") or "").strip() or "today",
                "from": str(raw_period.get("from") or "").strip() or None,
                "to": str(raw_period.get("to") or "").strip() or None,
                "label": str(raw_period.get("label") or "").strip() or None,
                "relative": str(raw_period.get("relative") or "").strip() or None,
                "from_date": str(
                    raw_period.get("from_date") or raw_period.get("from") or ""
                ).strip()
                or None,
                "to_date": str(
                    raw_period.get("to_date") or raw_period.get("to") or ""
                ).strip()
                or None,
            }
            await save_session(session, token=token)
            access["session"] = session
    # Refresh recommendations snapshot for create-campaign turns.
    if module in (
        "create_campaign",
        "recommendation_run",
        "library_run",
        "whatsapp_approved",
    ):
        session = access["session"]
        raw_recs = (data or {}).get("recommendations_snapshot")
        if isinstance(raw_recs, list):
            session["recommendations_snapshot"] = compact_recommendations_snapshot(
                raw_recs
            )
            await save_session(session, token=token)
            access["session"] = session
        if _apply_hub_context(session, data):
            await save_session(session, token=token)
            access["session"] = session
        # Sheet upload from FE → run upload_temporary_contacts before the LLM turn.
        raw_temp_rows = (data or {}).get("temporary_contact_rows")
        if isinstance(raw_temp_rows, list) and raw_temp_rows:
            session["pending_temporary_contact_rows"] = [
                r for r in raw_temp_rows if isinstance(r, dict)
            ][:2000]
            await save_session(session, token=token)
            access["session"] = session
        # Chat image upload → pending assets; LLM confirms via confirm_chat_images.
        raw_chat_images = (data or {}).get("chat_image_uploads")
        from app.agents.image.user_assets import ingest_pending_chat_images

        if isinstance(raw_chat_images, list) and raw_chat_images:
            ingested = ingest_pending_chat_images(session, raw_chat_images)
        else:
            ingested = []
        session["_turn_chat_image_uploads"] = ingested
        await save_session(session, token=token)
        access["session"] = session
    # Keep form design in sync with FE after manual Quick UI edits.
    if module == "forms":
        session = access["session"]
        form_event_id = str((data or {}).get("form_event_id") or "").strip()
        if form_event_id:
            session["form_event_id"] = form_event_id
        raw_snapshot = (data or {}).get("form_snapshot")
        if isinstance(raw_snapshot, dict):
            fields = (
                raw_snapshot.get("fields")
                or raw_snapshot.get("formFields")
                or []
            )
            theme = raw_snapshot.get("theme") or {}
            session["form_design"] = {
                "title": str(raw_snapshot.get("title") or "").strip()
                or (session.get("form_design") or {}).get("title")
                or default_form_design()["title"],
                "description": str(
                    raw_snapshot.get("description") or ""
                ).strip(),
                "thank_you_message": str(
                    raw_snapshot.get("thank_you_message")
                    or raw_snapshot.get("thankYouMessage")
                    or ""
                ).strip(),
                "fields": fields if isinstance(fields, list) else [],
                "theme": theme if isinstance(theme, dict) else {},
                "public_slug": str(
                    raw_snapshot.get("public_slug")
                    or raw_snapshot.get("publicSlug")
                    or ""
                ).strip()
                or (session.get("form_design") or {}).get("public_slug"),
                "public_url": str(
                    raw_snapshot.get("public_url")
                    or raw_snapshot.get("publicUrl")
                    or ""
                ).strip()
                or (session.get("form_design") or {}).get("public_url"),
            }
            await save_session(session, token=token)
            access["session"] = session

    if not text and not (
        module
        in (
            "create_campaign",
            "recommendation_run",
            "library_run",
            "whatsapp_approved",
        )
        and isinstance((data or {}).get("temporary_contact_rows"), list)
        and (data or {}).get("temporary_contact_rows")
    ) and not (
        module in ("create_campaign", "recommendation_run", "library_run")
        and isinstance((data or {}).get("chat_image_uploads"), list)
        and (data or {}).get("chat_image_uploads")
    ):
        await sio.emit("error", {"message": "text required"}, to=sid)
        return
    if session_id in paused_sessions:
        await sio.emit(
            "chat_paused",
            {"session_id": session_id, "paused": True},
            to=sid,
        )
        return
    create_key = _chat_task_key(session_id, chat_context="create")
    if create_key in active_tasks:
        await sio.emit(
            "error",
            {
                "session_id": session_id,
                "message": "Please wait for the current agent response.",
                "code": "agent_busy",
                "chat_context": "create",
            },
            to=sid,
        )
        return

    # Soft-nav leave_session drops the room; create chat often sends before/without
    # a successful re-join. Re-enter so room broadcasts reach this socket.
    try:
        await sio.enter_room(sid, f"campaign_session:{session_id}")
    except Exception:  # noqa: BLE001
        pass

    current_task = asyncio.current_task()
    if current_task:
        active_tasks[create_key] = current_task
    await _emit_create_chat_typing(session_id, typing=True)

    async def emit_progress(event):
        if session_id in paused_sessions:
            return
        await _emit_agent_progress(session_id, event)

    module = access.get("module") or _module_from_data(data, access["session"])
    is_create_module = module in (
        "create_campaign",
        "recommendation_run",
        "library_run",
        "recommendations",
    )
    try:
        from app.progress_status import emit_process_progress

        if is_create_module:
            await emit_process_progress(emit_progress, "thinking")
        if module == "contacts":
            result = await run_contacts_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "monitoring":
            result = await run_monitoring_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "reports":
            result = await run_reports_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "events_report":
            result = await run_events_report_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "recommendations":
            result = await run_recommendations_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "forms":
            result = await run_forms_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "whatsapp_approved":
            session = access.get("session") or {}
            pending_rows = session.get("pending_temporary_contact_rows")
            if isinstance(pending_rows, list) and pending_rows:
                from app.agents.whatsapp_approved.tools.handlers import (
                    handle_upload_temporary_contacts as wa_upload,
                )

                upload_result = await wa_upload(
                    session_id,
                    token,
                    {
                        "rows": pending_rows,
                        "change_summary": "User uploaded temporary contact sheet",
                    },
                    event_callback=emit_progress,
                )
                session = await get_or_create_session(session_id)
                session.pop("pending_temporary_contact_rows", None)
                await save_session(session, token=token)
                access["session"] = session
                try:
                    await _emit_to_session(
                        "state_update",
                        session_id,
                        {
                            "session_id": session_id,
                            "type": "state_update",
                            "state": {
                                "campaign": session.get("campaign"),
                                "audience": session.get("audience"),
                                "whatsapp_audience": session.get("whatsapp_audience"),
                                "temporary_contact_summary": session.get(
                                    "temporary_contact_summary"
                                ),
                                "temporary_contact_count": session.get(
                                    "temporary_contact_count"
                                ),
                            },
                        },
                    )
                except Exception:  # noqa: BLE001
                    pass
                um = str(
                    upload_result.get("user_message")
                    or upload_result.get("message")
                    or ""
                ).strip()
                if um:
                    await _emit_to_session(
                        "chat_message",
                        session_id,
                        {
                            "session_id": session_id,
                            "role": "assistant",
                            "text": um
                            if um.startswith("<")
                            else f"<p>{um}</p>",
                        },
                    )
                if not text:
                    text = (
                        "Temporary contact sheet uploaded for this approved template run. "
                        "Continue with audience confirmation and launch timing."
                    )
                elif "temporary" not in text.lower() and "sheet" not in text.lower():
                    text = (
                        f"{text}\n\n"
                        "(User also uploaded a temporary contact sheet for this run.)"
                    )
            result = await run_whatsapp_approved_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "whatsapp_rejected":
            result = await run_whatsapp_rejected_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module == "mas":
            result = await run_super_entry_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        elif module in ("create_campaign", "recommendation_run", "library_run"):
            # Auto-run temporary sheet upload tool when FE sent parsed rows.
            session = access.get("session") or {}
            pending_rows = session.get("pending_temporary_contact_rows")
            if isinstance(pending_rows, list) and pending_rows:
                from app.agents.create_campaign.tool_functions import (
                    handle_upload_temporary_contacts,
                )

                upload_result = await handle_upload_temporary_contacts(
                    session_id,
                    token,
                    {
                        "rows": pending_rows,
                        "change_summary": "User uploaded temporary contact sheet",
                    },
                    event_callback=emit_progress,
                )
                session = await get_or_create_session(session_id)
                session.pop("pending_temporary_contact_rows", None)
                await save_session(session, token=token)
                access["session"] = session
                try:
                    await _emit_to_session(
                        "state_update",
                        session_id,
                        {
                            "session_id": session_id,
                            "type": "state_update",
                            "state": {
                                "audience": session.get("audience"),
                                "temporary_contact_summary": session.get(
                                    "temporary_contact_summary"
                                ),
                                "temporary_contact_count": session.get(
                                    "temporary_contact_count"
                                ),
                            },
                        },
                    )
                except Exception:  # noqa: BLE001
                    pass
                um = str(
                    upload_result.get("user_message")
                    or upload_result.get("message")
                    or ""
                ).strip()
                if um:
                    await _emit_to_session(
                        "chat_message",
                        session_id,
                        {
                            "session_id": session_id,
                            "role": "assistant",
                            "text": um
                            if um.startswith("<")
                            else f"<p>{um}</p>",
                        },
                    )
                if not text:
                    text = (
                        "Temporary contact sheet uploaded for this campaign. "
                        "Continue campaign setup using that temporary audience."
                    )
                elif "temporary" not in text.lower() and "sheet" not in text.lower():
                    text = (
                        f"{text}\n\n"
                        "(User also uploaded a temporary contact sheet for this campaign.)"
                    )

            turn_runner = (
                run_library_run_turn_via_mas_or_legacy
                if module == "library_run"
                else run_recommendation_run_turn_via_mas_or_legacy
                if module == "recommendation_run"
                else run_create_campaign_turn_via_mas_or_legacy
            )
            result = await turn_runner(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
        else:
            result = await run_create_campaign_turn_via_mas_or_legacy(
                session_id,
                token,
                text,
                event_callback=emit_progress,
            )
    except asyncio.CancelledError:
        await _finish_create_chat_turn(session_id)
        return
    except Exception as exc:  # noqa: BLE001
        from app.mas.runtime.turn_audit_log import log_turn_socket_error

        log_turn_socket_error(
            session_id=session_id,
            module=str(module or ""),
            error=str(exc),
            chat_context="create",
        )
        await _finish_create_chat_turn(session_id)
        await _emit_to_session(
            "error",
            session_id,
            {"session_id": session_id, "message": f"Agent failed: {exc}"},
        )
        return
    finally:
        if active_tasks.get(create_key) is current_task:
            active_tasks.pop(create_key, None)

    if session_id in paused_sessions:
        await _finish_create_chat_turn(session_id)
        return

    if is_create_module:
        await _emit_create_chat_agent_message(session_id, result)
    elif module == "contacts":
        await _emit_contacts_turn_result(session_id, result)
    elif module in _DASHBOARD_EMIT_MODULES:
        await _emit_dashboard_agent_message(session_id, result)
    else:
        await _emit_to_session(
            "agent_message",
            session_id,
            {
                "session_id": session_id,
                "text": result["reply"],
                "role": "assistant",
                **(
                    {"analytics": result["analytics"]}
                    if isinstance(result.get("analytics"), dict)
                    else {}
                ),
                **(
                    {"suggestions": result["suggestions"]}
                    if isinstance(result.get("suggestions"), list)
                    and result.get("suggestions")
                    else {}
                ),
            },
        )
        for followup in result.get("followups") or []:
            text = str(followup or "").strip()
            if not text:
                continue
            await _emit_to_session(
                "agent_message",
                session_id,
                {
                    "session_id": session_id,
                    "text": text,
                    "role": "assistant",
                },
            )
    if module not in (
        "create_campaign",
        "recommendation_run",
        "library_run",
        "recommendations",
        "contacts",
        *_DASHBOARD_EMIT_MODULES,
    ):
        await _emit_to_session(
            "state_update",
            session_id,
            {
                "session_id": session_id,
                "state": result.get("state")
                or public_state(await get_or_create_session(session_id)),
            },
        )
        for event in result.get("ui_events") or []:
            await _emit_to_session(
                "ui_event",
                session_id,
                {"session_id": session_id, **event},
            )
    elif module in _DASHBOARD_EMIT_MODULES:
        await _emit_to_session(
            "state_update",
            session_id,
            {
                "session_id": session_id,
                "state": result.get("state")
                or public_state(await get_or_create_session(session_id)),
            },
        )
    if is_create_module:
        await _finish_create_chat_turn(session_id)
    else:
        await _emit_create_chat_typing(session_id, typing=False)


@sio.on("pause_session")
async def pause_session(sid, data):
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    paused_sessions.add(session_id)
    create_key = _chat_task_key(session_id, chat_context="create")
    task = active_tasks.pop(create_key, None)
    if task and task is not asyncio.current_task():
        task.cancel()
    for key in list(active_tasks.keys()):
        if str(key).startswith(f"{session_id}:edit:"):
            edit_task = active_tasks.pop(key, None)
            if edit_task and edit_task is not asyncio.current_task():
                edit_task.cancel()
    await _emit_create_chat_typing(session_id, typing=False)
    await sio.emit(
        "chat_paused",
        {"session_id": session_id, "paused": True},
        room=f"campaign_session:{session_id}",
    )


@sio.on("stop_generation")
async def stop_generation(sid, data):
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    chat_context = str((data or {}).get("chat_context") or "create").strip().lower()
    template_id = str((data or {}).get("template_id") or "").strip() or None
    task_key = _chat_task_key(
        session_id,
        chat_context=chat_context,
        template_id=template_id,
    )
    task = active_tasks.pop(task_key, None)
    if task and task is not asyncio.current_task():
        task.cancel()
    if chat_context == "edit":
        await sio.emit(
            "edit_agent_typing",
            {
                "session_id": session_id,
                "template_id": template_id or "",
                "typing": False,
            },
            room=f"campaign_session:{session_id}",
        )
    else:
        await _emit_create_chat_typing(session_id, typing=False)
    await sio.emit(
        "generation_stopped",
        {
            "session_id": session_id,
            "chat_context": chat_context,
            "template_id": template_id or "",
        },
        room=f"campaign_session:{session_id}",
    )


@sio.on("resume_session")
async def resume_session(sid, data):
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    paused_sessions.discard(session_id)
    await sio.emit(
        "chat_paused",
        {"session_id": session_id, "paused": False},
        room=f"campaign_session:{session_id}",
    )


@sio.on("get_history")
async def get_history(sid, data):
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    session = access["session"]
    await sio.emit(
        "session_ready",
        {
            "session_id": session_id,
            "state": public_state(session),
            "messages": session.get("messages") or [],
        },
        to=sid,
    )


def _selected_library_template_ids(session: dict) -> set[str]:
    ids: set[str] = set()
    for row in session.get("selected_library_templates") or []:
        if not isinstance(row, dict):
            continue
        for key in ("template_id", "id"):
            val = str(row.get(key) or "").strip()
            if val:
                ids.add(val)
    return ids


def _omit_library_template_id(session: dict, tid: str, lib_ref: str) -> bool:
    tid = str(tid or "").strip()
    lib_ref = str(lib_ref or "").strip()
    selected = _selected_library_template_ids(session)
    if tid and tid in selected:
        return True
    if lib_ref and tid == lib_ref:
        return True
    return False


def _editor_sync_payload(session: dict, session_templates: list[dict]) -> list[dict]:
    """Persist session cards; never reuse library catalog ids as channel template ids."""
    syncable: list[dict] = []
    for t in session_templates:
        if not isinstance(t, dict) or not t.get("channel"):
            continue
        fields = t.get("fields") if isinstance(t.get("fields"), dict) else {}
        if not fields:
            continue
        tid = str(t.get("template_id") or "").strip()
        lib_ref = str(t.get("library_template_id") or "").strip()
        item = {
            "channel": t.get("channel"),
            "logo": t.get("logo"),
            "launch_at": t.get("launch_at"),
            "how_it_works": t.get("how_it_works"),
            "fields": fields,
            "preview": t.get("preview"),
            "generation_batch_id": t.get("generation_batch_id"),
        }
        if tid and not _omit_library_template_id(session, tid, lib_ref):
            item["template_id"] = tid
        syncable.append(item)
    return syncable


def _find_editor_template_match(
    *,
    template_id: str,
    channel: str,
    templates: list[dict],
    session_templates: list[dict],
) -> dict | None:
    if template_id:
        for pool in (templates, session_templates):
            match = next(
                (t for t in pool if t.get("template_id") == template_id),
                None,
            )
            if match:
                return match
        for pool in (templates, session_templates):
            match = next(
                (
                    t
                    for t in pool
                    if str(t.get("library_template_id") or "") == template_id
                ),
                None,
            )
            if match:
                return match
        return None

    # Legacy open-by-channel when no template_id was requested.
    ch = str(channel or "").strip().lower()
    if ch:
        for pool in (templates, session_templates):
            same = [
                t
                for t in pool
                if str(t.get("channel") or "").lower() == ch
            ]
            if same:
                return same[-1]
    return None


@sio.on("open_template_editor")
async def open_template_editor(sid, data):
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    session = access["session"]
    token = access["token"]
    channel = str((data or {}).get("channel") or "").strip().lower()
    template_id = str((data or {}).get("template_id") or "").strip()
    session_templates = list(session.get("templates") or [])

    # Backfill any session cards that never landed in DB.
    syncable = _editor_sync_payload(session, session_templates)
    if syncable:
        try:
            await sync_session_templates(session_id, syncable, token=token)
        except Exception:  # noqa: BLE001
            pass

    try:
        db_templates = await list_session_templates(session_id, token=token)
    except Exception:  # noqa: BLE001
        db_templates = []

    # Prefer DB list; fall back to session payload for older drafts.
    templates = db_templates or session_templates
    # Merge: DB wins for shared ids (edited fields must not be overwritten by
    # stale session cards). Session-only cards fill gaps.
    if db_templates and session_templates:
        by_id = {
            t.get("template_id"): dict(t)
            for t in session_templates
            if t.get("template_id")
        }
        for row in db_templates:
            tid = row.get("template_id")
            if not tid:
                continue
            prior = by_id.get(tid) or {}
            merged = {**prior, **row}
            if isinstance(row.get("fields"), dict) and row.get("fields"):
                merged["fields"] = row["fields"]
            by_id[tid] = merged
        templates = list(by_id.values())

    match = _find_editor_template_match(
        template_id=template_id,
        channel=channel,
        templates=templates,
        session_templates=session_templates,
    )
    if not match and template_id:
        for row in session_templates:
            if str(row.get("template_id") or "") == template_id:
                match = dict(row)
                break
        if not match:
            for row in db_templates:
                if str(row.get("template_id") or "") == template_id:
                    match = dict(row)
                    break
        if not match:
            match = {
                "template_id": template_id,
                "channel": channel or "email",
                "fields": {},
            }
    if not match:
        await sio.emit(
            "error",
            {"message": "Template not found", "chat_context": "edit"},
            to=sid,
        )
        return

    messages: list[dict] = []
    tid = str(match.get("template_id") or "")
    if tid:
        try:
            detail = await get_template(tid, token=token)
            if detail.get("template"):
                match = {**match, **detail["template"]}
            messages = list(detail.get("messages") or [])
        except Exception:  # noqa: BLE001
            # Build a minimal chat from session fields so View is never empty.
            fields = match.get("fields") if isinstance(match.get("fields"), dict) else {}
            channel_name = str(match.get("channel") or channel or "template")
            if fields or match.get("preview"):
                messages = [
                    {
                        "id": f"{tid}-0",
                        "template_id": tid,
                        "role": "assistant",
                        "seq": 0,
                        "kind": "template",
                        "payload": {"fields": fields},
                    },
                ]

    # Keep compose HTML from session when DB row is thin.
    for row in session_templates:
        if str(row.get("template_id") or "") != str(match.get("template_id") or ""):
            continue
        sess_fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        match_fields = match.get("fields") if isinstance(match.get("fields"), dict) else {}
        sess_html = str(sess_fields.get("compiled_html") or "").strip()
        db_html = str(match_fields.get("compiled_html") or "").strip()
        if sess_html and (not db_html or len(sess_html) > len(db_html)):
            match["fields"] = {**match_fields, **sess_fields}
        break

    client_fields = (data or {}).get("fields")
    if isinstance(client_fields, dict) and client_fields:
        base = match.get("fields") if isinstance(match.get("fields"), dict) else {}
        match = {**match, "fields": {**base, **client_fields}}

    session["active_edit_channel"] = match.get("channel")
    session["active_edit_template_id"] = str(match.get("template_id") or template_id or "")
    session["stage"] = "edit"
    if db_templates:
        # Keep session cards; merge DB truth for persisted ones (fields from DB win).
        merged = {
            t.get("template_id"): dict(t)
            for t in session_templates
            if t.get("template_id")
        }
        for row in db_templates:
            tid_row = row.get("template_id")
            if not tid_row:
                continue
            prior = merged.get(tid_row) or {}
            next_row = {**prior, **row}
            if isinstance(row.get("fields"), dict) and row.get("fields"):
                next_row["fields"] = row["fields"]
            merged[tid_row] = next_row
        session["templates"] = list(merged.values())
    session = await save_session(session, token=token)
    edit_busy_key = _chat_task_key(
        session_id,
        chat_context="edit",
        template_id=str(match.get("template_id") or ""),
    )
    from app.agents.image.user_assets import session_images_for_edit

    session_chat_images = session_images_for_edit(session)
    await sio.emit(
        "editor_ready",
        {
            "session_id": session_id,
            "template": match,
            "messages": messages,
            "templates": session.get("templates") or templates,
            "campaign": session.get("campaign") or {},
            "state": public_state(session),
            "agent_busy": edit_busy_key in active_tasks,
            "session_chat_images": session_chat_images,
        },
        to=sid,
    )


@sio.on("compose_generate_image")
async def compose_generate_image(sid, data):
    """Images tab: Gemini hero URL only — caller maps into compiled_html locally until Save."""
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    session = access["session"]
    token = access["token"]
    template_id = str((data or {}).get("template_id") or "").strip()
    brief = str((data or {}).get("brief") or "").strip()

    async def _reply(payload: dict) -> None:
        await sio.emit(
            "compose_image_ready",
            {"session_id": session_id, "template_id": template_id, **payload},
            to=sid,
        )

    if not template_id:
        await _reply({"ok": False, "error": "template_id required"})
        return

    fields: dict = {}
    session_card = next(
        (
            t
            for t in (session.get("templates") or [])
            if str(t.get("template_id") or "") == template_id
        ),
        None,
    )
    if isinstance(session_card, dict) and isinstance(session_card.get("fields"), dict):
        fields = dict(session_card["fields"])
    if not fields:
        try:
            detail = await get_template(template_id, token=token)
            tpl = detail.get("template") if isinstance(detail, dict) else {}
            if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
                fields = dict(tpl["fields"])
        except Exception:  # noqa: BLE001
            fields = {}
    if not fields:
        await _reply({"ok": False, "error": "Template not found"})
        return

    from app.mas.phase2_compose.domain import is_compose_html_fields

    if not is_compose_html_fields(fields):
        await _reply({"ok": False, "error": "This editor is for full HTML emails only."})
        return

    try:
        from app.agents.create_campaign.user_facing import user_facing_image_failure
        from app.mas.phase2_compose.executors.image import generate_and_map_compose_images

        campaign = (
            session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
        )
        gen = await generate_and_map_compose_images(
            fields,
            brief=brief,
            campaign=campaign,
            token=token,
        )
        if not gen.get("ok"):
            err = str(gen.get("error") or "Image generation failed.")
            try:
                from app.mas.runtime.turn_audit_log import turn_audit_stage

                turn_audit_stage(
                    "compose_image_generate_failed",
                    error=err[:400],
                    template_id=template_id or None,
                )
            except Exception:  # noqa: BLE001
                pass
            await _reply(
                {
                    "ok": False,
                    "error": user_facing_image_failure(err, kind="generate"),
                }
            )
            return
        await _reply(
            {
                "ok": True,
                "url": str(gen.get("url") or "").strip(),
                "used_stub": bool(gen.get("used_stub")),
            }
        )
    except Exception as exc:  # noqa: BLE001
        from app.agents.create_campaign.user_facing import user_facing_image_failure

        await _reply({"ok": False, "error": user_facing_image_failure(str(exc), kind="generate")})


@sio.on("leave_template_editor")
async def leave_template_editor(sid, data):
    """User closed template edit overlay; clear edit scope and cancel edit turns."""
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    session = access["session"]
    token = access["token"]
    template_id = str((data or {}).get("template_id") or "").strip() or None

    session.pop("active_edit_channel", None)
    session.pop("active_edit_template_id", None)
    if str(session.get("stage") or "").strip().lower() == "edit":
        session["stage"] = "templates"
    try:
        from app.agents.template_edit.memory import clear_undo

        if template_id:
            clear_undo(session, template_id)
        else:
            session.pop("edit_working", None)
    except Exception:  # noqa: BLE001
        pass
    try:
        session = await save_session(session, token=token)
    except Exception:  # noqa: BLE001
        pass

    prefix = f"{session_id}:edit:"
    cleared_templates: list[str] = []
    for key in list(active_tasks.keys()):
        if not str(key).startswith(prefix):
            continue
        if template_id:
            want = _chat_task_key(
                session_id, chat_context="edit", template_id=template_id
            )
            if key != want:
                continue
        task = active_tasks.pop(key, None)
        if task and not task.done():
            task.cancel()
        tid = str(key).removeprefix(prefix)
        if tid:
            cleared_templates.append(tid)

    for tid in cleared_templates:
        await sio.emit(
            "edit_agent_typing",
            {
                "session_id": session_id,
                "template_id": tid,
                "typing": False,
            },
            room=f"campaign_session:{session_id}",
        )


@sio.on("template_edit_message")
async def template_edit_message(sid, data):
    access = await _require_session_access(sid, data)
    if not access:
        return
    session_id = access["session_id"]
    session = access["session"]
    token = access["token"]
    channel = str((data or {}).get("channel") or "").strip().lower()
    template_id = str((data or {}).get("template_id") or "").strip()
    instruction = str((data or {}).get("text") or "").strip()
    from app.agents.image.user_assets import (
        compact_chat_image_uploads,
        ingest_pending_edit_chat_images,
        session_image_library,
    )
    from app.config import get_settings

    turn_uploads = compact_chat_image_uploads(
        (data or {}).get("chat_image_uploads")
    )
    if turn_uploads:
        ingest_pending_edit_chat_images(session, turn_uploads)
        try:
            session = await save_session(session, token=token)
        except Exception:  # noqa: BLE001
            pass
    unified = bool(get_settings().edit_space_unified_agent)
    pending_uploads = session_image_library(
        session,
        turn_uploads=turn_uploads or None,
        edit_space=True,
    )
    if not template_id or (not instruction and not turn_uploads):
        await sio.emit(
            "error",
            {"message": "session_id, template_id and text (or image upload) required"},
            to=sid,
        )
        return

    active_edit_tid = str(session.get("active_edit_template_id") or "").strip()
    if active_edit_tid and active_edit_tid != template_id:
        await sio.emit(
            "error",
            {
                "message": "This edit session is for a different template. Re-open View from the card you want to edit.",
                "chat_context": "edit",
                "template_id": template_id,
            },
            to=sid,
        )
        return
    if not instruction and turn_uploads and not unified:
        instruction = (
            "User uploaded an image this turn (see available uploads). "
            "Acknowledge briefly in your own words and ask whether to use it as the "
            "hero/header — or attach if they already asked to add it."
        )

    match = None
    messages: list[dict] = []
    session_card = next(
        (
            t
            for t in (session.get("templates") or [])
            if str(t.get("template_id") or "") == template_id
        ),
        None,
    )
    try:
        detail = await get_template(template_id, token=token)
        match = detail.get("template")
        messages = list(detail.get("messages") or [])
    except Exception:
        match = None
        messages = []
    if not match and isinstance(session_card, dict):
        try:
            await sync_session_templates(
                session_id,
                [
                    {
                        "template_id": session_card.get("template_id"),
                        "channel": session_card.get("channel"),
                        "logo": session_card.get("logo"),
                        "launch_at": session_card.get("launch_at"),
                        "how_it_works": session_card.get("how_it_works"),
                        "fields": session_card.get("fields")
                        if isinstance(session_card.get("fields"), dict)
                        else {},
                        "preview": session_card.get("preview"),
                    }
                ],
                token=token,
            )
            detail = await get_template(template_id, token=token)
            match = detail.get("template") or dict(session_card)
            messages = list(detail.get("messages") or [])
        except Exception:  # noqa: BLE001
            match = dict(session_card)
            messages = []

    if not match:
        await sio.emit(
            "error",
            {
                "message": "Template not found",
                "chat_context": "edit",
                "template_id": template_id,
            },
            to=sid,
        )
        return

    # Prefer session compiled_html when DB fields lost the compose body.
    if isinstance(session_card, dict):
        sess_fields = (
            session_card.get("fields")
            if isinstance(session_card.get("fields"), dict)
            else {}
        )
        match_fields = match.get("fields") if isinstance(match.get("fields"), dict) else {}
        sess_html = str(sess_fields.get("compiled_html") or "").strip()
        db_html = str(match_fields.get("compiled_html") or "").strip()
        if sess_html and (not db_html or len(sess_html) > len(db_html)):
            match["fields"] = {**match_fields, **sess_fields}

    channel = str(match.get("channel") or channel).strip().lower()
    template_id = str(match.get("template_id") or template_id)
    match_channel = str(match.get("channel") or "").strip().lower()
    if channel and match_channel and channel != match_channel:
        await sio.emit(
            "error",
            {
                "message": "Edit applies to this template's channel only.",
                "chat_context": "edit",
                "template_id": template_id,
            },
            to=sid,
        )
        return
    session["active_edit_channel"] = match_channel or channel
    session["active_edit_template_id"] = template_id
    current_fields = dict(match.get("fields") or {})

    edit_key = _chat_task_key(session_id, chat_context="edit", template_id=template_id)
    if edit_key in active_tasks:
        await sio.emit(
            "error",
            {
                "message": "Please wait for the current agent response.",
                "chat_context": "edit",
                "template_id": template_id,
            },
            to=sid,
        )
        return

    current_task = asyncio.current_task()
    if current_task:
        active_tasks[edit_key] = current_task

    # Persist the user turn immediately so leave/return / cross-device reload
    # still shows the exact message (and image) while the agent is working.
    user_payload: dict[str, Any] = {"text": instruction}
    from app.agents.image.user_assets import message_images_from_upload_rows

    image_list = message_images_from_upload_rows(turn_uploads)
    if image_list:
        user_payload["image_urls"] = image_list
        user_payload["image_url"] = image_list[0]["url"]
        if image_list[0].get("filename"):
            user_payload["image_filename"] = image_list[0]["filename"]
    try:
        await append_template_messages(
            template_id,
            [
                {
                    "role": "user",
                    "kind": "text",
                    "payload": user_payload,
                }
            ],
            token=token,
        )
    except Exception as persist_user_exc:  # noqa: BLE001
        await sio.emit(
            "error",
            {
                "message": f"Could not save your message: {persist_user_exc}",
                "chat_context": "edit",
                "template_id": template_id,
            },
            to=sid,
        )
        if active_tasks.get(edit_key) is current_task:
            active_tasks.pop(edit_key, None)
        return

    await sio.emit(
        "edit_agent_typing",
        {
            "session_id": session_id,
            "channel": channel,
            "template_id": template_id,
            "typing": True,
        },
        room=f"campaign_session:{session_id}",
    )
    try:
        set_request_token(token)

        async def emit_edit_progress(event):
            await _emit_edit_progress(
                sid,
                session_id,
                event,
                template_id=template_id,
            )

        from app.agents.template_library.edit_orchestrator import (
            run_template_edit_orchestrated,
        )
        from app.mas.runtime.turn_audit_log import run_with_turn_audit
        from app.text_cleanup import strip_html_tags, strip_markdown_emphasis

        async def _edit_runner() -> dict:
            return await run_template_edit_orchestrated(
                channel=channel,
                current_fields=current_fields,
                instruction=instruction,
                campaign=session.get("campaign") or {},
                recent_messages=list(messages)
                + [
                    {
                        "role": "user",
                        "kind": "text",
                        "payload": user_payload,
                    }
                ],
                session_id=session_id,
                token=token,
                template_id=template_id,
                event_callback=emit_edit_progress,
                pending_image_uploads=pending_uploads,
                session=session,
            )

        final = await run_with_turn_audit(
            module="template_edit",
            session_id=session_id,
            user_text=instruction,
            chat_context="edit",
            template_id=template_id,
            channel=channel,
            runner=_edit_runner,
        )

        # LLM tool handoff_campaign_launch — not regex intent.
        if str(final.get("intent") or "") == "launch":

            async def emit_progress(event):
                await _emit_edit_progress(
                    sid,
                    session_id,
                    event,
                    template_id=template_id,
                )

            launch_text = instruction
            note = str(final.get("launch_note") or "").strip()
            if note:
                launch_text = f"{instruction}\n\n({note})"
            result = await run_create_campaign_turn_via_mas_or_legacy(
                session_id,
                token,
                launch_text,
                event_callback=emit_progress,
                persist_chat=False,
            )
            reply = str(result.get("reply") or "").strip() or (
                str(final.get("reply") or "").strip() or "Launch update applied."
            )
            await append_template_messages(
                template_id,
                [
                    {
                        "role": "assistant",
                        "kind": "text",
                        "payload": {"text": reply},
                    },
                ],
                token=token,
            )
            await sio.emit(
                "edit_agent_message",
                {
                    "session_id": session_id,
                    "channel": channel,
                    "template_id": template_id,
                    "text": reply,
                    "intent": "launch",
                    "template_changed": False,
                    "fields": None,
                    "chat_context": "edit",
                },
                to=sid,
            )
            await sio.emit(
                "state_update",
                {
                    "session_id": session_id,
                    "state": result.get("state"),
                    "chat_context": "edit",
                },
                to=sid,
            )
            for event in result.get("ui_events") or []:
                await sio.emit(
                    "ui_event",
                    {
                        "session_id": session_id,
                        "chat_context": "edit",
                        "template_id": template_id,
                        **event,
                    },
                    to=sid,
                )
            return

        for event in final.get("ui_events") or []:
            if isinstance(event, dict):
                await sio.emit(
                    "ui_event",
                    {
                        "session_id": session_id,
                        "chat_context": "edit",
                        "template_id": template_id,
                        **event,
                    },
                    to=sid,
                )
        intent = str(final.get("intent") or "general")
        raw_reply = str(final.get("reply") or "").strip()
        reply = strip_markdown_emphasis(strip_html_tags(raw_reply)) if raw_reply else ""
        display_fields = final.get("display_fields")
        emit_template = bool(final.get("emit_template") and display_fields)
        persist_fields = bool(final.get("persist_fields") and display_fields)
        if (
            not persist_fields
            and intent in {"modify", "save"}
            and isinstance(display_fields, dict)
            and display_fields
        ):
            persist_fields = True
            emit_template = True
        if intent == "save" and not persist_fields:
            display_fields = (
                match.get("fields")
                if isinstance(match.get("fields"), dict)
                else current_fields
            )
            if channel == "whatsapp" and isinstance(display_fields, dict):
                display_fields = mark_whatsapp_draft_after_edit(display_fields)
            persist_fields = True
            emit_template = True

        if persist_fields:
            match["fields"] = display_fields
            try:
                saved = await update_template_fields(
                    template_id, display_fields, token=token
                )
                saved_tpl = (
                    saved.get("template")
                    if isinstance(saved, dict)
                    else None
                )
                if isinstance(saved_tpl, dict) and saved_tpl.get("fields"):
                    match["fields"] = saved_tpl["fields"]
                    display_fields = saved_tpl["fields"]
            except Exception as persist_exc:  # noqa: BLE001
                await sio.emit(
                    "error",
                    {
                        "session_id": session_id,
                        "message": (
                            f"Could not save template changes: {persist_exc}"
                        ),
                    },
                    to=sid,
                )
                raise

        pending_msgs: list[dict] = []
        if emit_template:
            pending_msgs.append(
                {
                    "role": "assistant",
                    "kind": "template",
                    "payload": {"fields": display_fields},
                }
            )
        if reply:
            pending_msgs.append(
                {"role": "assistant", "kind": "text", "payload": {"text": reply}}
            )
        # User turn already persisted at the start of this handler.
        if pending_msgs:
            await append_template_messages(
                template_id, pending_msgs, token=token
            )

        cards = list(session.get("templates") or [])
        for idx, card in enumerate(cards):
            if card.get("template_id") == template_id:
                cards[idx] = {**card, **match, "fields": match.get("fields")}
                break
        session["templates"] = cards
        await save_session(session, token=token)

        if persist_fields:
            updated_event = {
                "session_id": session_id,
                "channel": channel,
                "template_id": template_id,
                "template": match,
                "intent": "modify",
                "chat_context": "edit",
            }
            await sio.emit("template_updated", updated_event, to=sid)
            await _emit_to_session("template_updated", session_id, updated_event)

        if reply:
            await sio.emit(
                "edit_agent_message",
                {
                    "session_id": session_id,
                    "channel": channel,
                    "template_id": template_id,
                    "text": reply,
                    "intent": intent,
                    "template_changed": emit_template,
                    "fields": display_fields if emit_template else None,
                    "chat_context": "edit",
                    "skill_id": str(final.get("skill_id") or ""),
                },
                to=sid,
            )
        elif persist_fields and isinstance(display_fields, dict):
            # Fields already streamed via template_updated; no canned chat line.
            pass
        else:
            try:
                from app.mas.runtime.turn_audit_log import turn_audit_stage

                turn_audit_stage(
                    "edit_empty_reply",
                    skill_id=str(final.get("skill_id") or "") or None,
                    intent=str(final.get("intent") or "") or None,
                    persist_fields=bool(persist_fields),
                )
            except Exception:  # noqa: BLE001
                pass
            await sio.emit(
                "error",
                {
                    "session_id": session_id,
                    "message": "The editor couldn't reply. Try sending that again.",
                    "chat_context": "edit",
                    "template_id": template_id,
                },
                to=sid,
            )
    except asyncio.CancelledError:
        return
    except Exception as exc:  # noqa: BLE001
        try:
            from app.mas.runtime.turn_audit_log import log_turn_socket_error

            log_turn_socket_error(
                session_id=session_id,
                module="template_edit",
                error=str(exc),
                chat_context="edit",
                template_id=template_id,
                channel=channel,
            )
        except Exception:  # noqa: BLE001
            pass
        await sio.emit(
            "error",
            {
                "message": f"{channel} edit agent failed: {exc}",
                "chat_context": "edit",
                "template_id": template_id,
            },
            to=sid,
        )
    finally:
        if active_tasks.get(edit_key) is current_task:
            active_tasks.pop(edit_key, None)
        await sio.emit(
            "edit_agent_typing",
            {
                "session_id": session_id,
                "channel": channel,
                "template_id": template_id,
                "typing": False,
            },
            room=f"campaign_session:{session_id}",
        )


@sio.on("template_coach_message")
async def template_coach_message(sid, data):
    """Isolated Manual-Edit coach. Idea is passed in the payload; no shared memory."""
    access = await _require_session_access(sid, data)
    if not access:
        return
    payload = data or {}
    session_id = access["session_id"]
    channel = str(payload.get("channel") or "").strip().lower() or "email"
    mode = str(payload.get("mode") or "assist").strip().lower()
    request_id = str(payload.get("request_id") or "").strip()
    campaign = payload.get("campaign") if isinstance(payload.get("campaign"), dict) else {}
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    selected = payload.get("selected") if isinstance(payload.get("selected"), dict) else None
    idea_chat = payload.get("idea_chat") if isinstance(payload.get("idea_chat"), list) else []
    instruction = str(payload.get("instruction") or "").strip()
    await sio.emit(
        "template_coach_typing",
        {
            "session_id": session_id,
            "channel": channel,
            "request_id": request_id,
            "typing": True,
        },
        to=sid,
    )
    try:
        result = await run_template_coach(
            mode=mode,
            channel=channel,
            campaign=campaign,
            fields=fields,
            selected=selected,
            idea_chat=idea_chat,
            instruction=instruction,
        )
        await sio.emit(
            "template_coach_reply",
            {
                "session_id": session_id,
                "channel": channel,
                "request_id": request_id,
                "mode": mode,
                **result,
            },
            to=sid,
        )
    except Exception as exc:  # noqa: BLE001
        await sio.emit(
            "template_coach_reply",
            {
                "session_id": session_id,
                "channel": channel,
                "request_id": request_id,
                "mode": mode,
                "ok": True,
                "walkthrough": "Coach is unavailable. You can still save when limits are green.",
                "issues": [],
                "apply": False,
                "corrected_content": None,
                "field_patches": {},
                "error": str(exc),
            },
            to=sid,
        )
    finally:
        await sio.emit(
            "template_coach_typing",
            {
                "session_id": session_id,
                "channel": channel,
                "request_id": request_id,
                "typing": False,
            },
            to=sid,
        )
