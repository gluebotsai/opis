"""Native AI HTTP routes."""

from __future__ import annotations

import json
import queue
import threading
from typing import Any, Iterator

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from app.config import get_settings
from app.contracts.execution import ActorContext, RunBudgets, RunRequest
from app.runtime.orchestrator import run_native_turn
from app.runtime.progress import progress_sink


router = APIRouter(prefix="/ai/v1")


def _upload_urls_from_draft(draft: dict[str, Any] | None) -> list[str]:
    raw = draft.get("attachments") if isinstance(draft, dict) else None
    if not isinstance(raw, list):
        return []
    return [
        str(item).strip()
        for item in raw
        if str(item).strip().startswith("/uploads/")
        and ".." not in str(item)
        and "\\" not in str(item)
    ]


def message_for_native_run(message: str, ticket_draft: dict[str, Any] | None) -> str:
    """User text, or a factual attach line from this turn's /uploads/ names."""
    text = str(message or "").strip()
    if text:
        return text
    names = [
        url.rsplit("/", 1)[-1] or url for url in _upload_urls_from_draft(ticket_draft)
    ]
    if not names:
        return ""
    return "Attached " + ", ".join(names)


class NativeRunBody(BaseModel):
    message: str = ""
    run_id: str | None = None
    request_id: str | None = None
    session_id: str | None = None
    organization_id: str | None = None
    user_id: str | None = None
    user_role: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    user_phone: str | None = None
    can_create_ticket: bool | None = None
    module: str | None = None
    surface: str | None = None
    page: str | None = None
    page_surface: str | None = None
    channel: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)
    focused_entity: dict[str, Any] | None = None
    drafts: dict[str, Any] = Field(default_factory=dict)
    ticket_draft: dict[str, Any] | None = None
    session_memory: dict[str, Any] = Field(default_factory=dict)
    confirm_tool: dict[str, Any] | None = None
    execution_mode: str = "native"
    mcp_token: str | None = None
    portal_customer_id: str | None = None
    portal_authenticated: bool | None = None
    portal_auth_mode: str | None = None
    budgets: dict[str, Any] | None = None
    locale: str | None = None
    debug: bool = False

    @model_validator(mode="after")
    def message_or_this_turn_uploads(self) -> NativeRunBody:
        filled = message_for_native_run(self.message, self.ticket_draft)
        if not filled:
            raise ValueError("message must be at least 1 character")
        self.message = filled
        return self


def require_tasks_key(x_coworker_tasks_key: str | None) -> None:
    expected = (get_settings().coworker_tasks_secret or "").strip() or "worktual-tasks-dev-secret"
    if not x_coworker_tasks_key or x_coworker_tasks_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing tasks API key")


def _reply_locale(body: NativeRunBody) -> str | None:
    direct = str(body.locale or "").strip()
    if direct:
        return direct
    memory = body.session_memory if isinstance(body.session_memory, dict) else {}
    nested = str(memory.get("reply_locale") or "").strip()
    return nested or None


def _normalize_hub_channel(raw: str | None) -> str:
    ch = str(raw or "chat").strip().lower()
    return ch if ch in ("chat", "email") else "chat"


def _resolve_drafts(body: NativeRunBody) -> dict[str, Any]:
    drafts = dict(body.drafts or {})
    if not (body.ticket_draft or drafts):
        return drafts
    from app.agent_turn import resolve_client_form_drafts

    resolved = resolve_client_form_drafts(
        module=body.module,
        page=body.page,
        page_surface=body.page_surface or body.surface,
        session_memory=body.session_memory,
        ticket_draft=body.ticket_draft,
        draft=body.ticket_draft,
    )
    for key, blob in resolved.items():
        if not isinstance(blob, dict) or not blob:
            continue
        if key == "priority_draft" and str(blob.get("kind") or "").lower() == "status":
            if "status_draft" not in drafts:
                drafts["status_draft"] = blob
            continue
        if key not in drafts:
            drafts[key] = blob
    for key in list(drafts.keys()):
        blob = drafts.get(key)
        if not isinstance(blob, dict):
            continue
        has_value = any(
            str(v).strip()
            for k, v in blob.items()
            if k not in {"awaiting", "step", "kind", "surface"}
            and not isinstance(v, (dict, list))
        ) or (
            isinstance(blob.get("members"), list) and bool(blob.get("members"))
        ) or (
            isinstance(blob.get("attachments"), list) and bool(blob.get("attachments"))
        )
        if not has_value:
            drafts.pop(key, None)
    incoming_td = body.ticket_draft if isinstance(body.ticket_draft, dict) else {}
    atts = incoming_td.get("attachments")
    if isinstance(atts, list) and atts:
        urls = [
            str(item).strip()
            for item in atts
            if str(item).strip().startswith("/uploads/")
            and ".." not in str(item)
            and "\\" not in str(item)
        ]
        if urls:
            ticket = dict(drafts.get("ticket_draft") or {})
            ticket["attachments"] = urls
            drafts["ticket_draft"] = ticket
    return drafts


def _build_request(agent_name: str, body: NativeRunBody) -> RunRequest:
    drafts = _resolve_drafts(body)
    budgets = RunBudgets(**(body.budgets or {})) if body.budgets else RunBudgets()
    request = RunRequest(
        message=body.message,
        run_id=body.run_id,
        request_id=body.request_id,
        session_id=body.session_id,
        actor=ActorContext(
            user_id=body.user_id,
            organization_id=body.organization_id,
            user_role=body.user_role,
            user_name=body.user_name,
            user_email=body.user_email,
            user_phone=body.user_phone,
            can_create_ticket=body.can_create_ticket,
            portal_customer_id=body.portal_customer_id,
            portal_authenticated=body.portal_authenticated,
            portal_auth_mode=body.portal_auth_mode,
            locale=_reply_locale(body),
        ),
        module=body.module,
        surface=body.surface or body.page_surface,
        page=body.page,
        page_surface=body.page_surface,
        channel=_normalize_hub_channel(body.channel),
        history=body.history,
        focused_entity=body.focused_entity,
        drafts=drafts,
        session_memory=body.session_memory,
        confirm_tool=body.confirm_tool,
        execution_mode="native" if body.execution_mode == "native" else body.execution_mode,  # type: ignore[arg-type]
        budgets=budgets,
        mcp_token=body.mcp_token,
        debug=bool(body.debug),
    )
    if agent_name not in ("ticketing-coworker", "ticketing_coworker", "coworker"):
        request.session_memory = {
            **request.session_memory,
            "start_agent": agent_name.replace("-", "_"),
        }
    return request


def _run_to_envelope(request: RunRequest) -> dict[str, Any]:
    try:
        result = run_native_turn(request)
    except Exception as exc:
        from app.memory.durable_store import ConversationContextLoadError

        if isinstance(exc, ConversationContextLoadError):
            raise HTTPException(
                status_code=503,
                detail={
                    "source": "error",
                    "serviceError": {
                        "code": "CONVERSATION_CONTEXT_UNAVAILABLE",
                        "message": str(exc),
                    },
                    "assistantText": "",
                    "reply": "",
                },
            ) from exc
        raise
    envelope = result.to_agent_turn_envelope()
    if result.error:
        raise HTTPException(
            status_code=502 if result.error.retryable else 400, detail=envelope
        )
    return envelope


@router.post("/agents/{agent_name}/run")
def run_agent(
    agent_name: str,
    body: NativeRunBody,
    x_coworker_tasks_key: str | None = Header(default=None, alias="X-Coworker-Tasks-Key"),
) -> dict[str, Any]:
    require_tasks_key(x_coworker_tasks_key)
    request = _build_request(agent_name, body)
    return _run_to_envelope(request)


@router.post("/agents/{agent_name}/run/stream")
def run_agent_stream(
    agent_name: str,
    body: NativeRunBody,
    x_coworker_tasks_key: str | None = Header(default=None, alias="X-Coworker-Tasks-Key"),
) -> StreamingResponse:
    """SSE: progress events (ontology status labels only) then a final `result` envelope."""
    require_tasks_key(x_coworker_tasks_key)
    request = _build_request(agent_name, body)
    sink: queue.Queue[dict[str, Any] | None] = queue.Queue()

    def worker() -> None:
        try:
            with progress_sink(sink):
                envelope = _run_to_envelope(request)
            sink.put({"type": "result", "payload": envelope})
        except HTTPException as exc:
            raw = exc.detail
            if isinstance(raw, dict):
                detail_msg = str(raw.get("detail") or "").strip()
                if not detail_msg:
                    se = raw.get("serviceError")
                    if isinstance(se, dict):
                        detail_msg = str(
                            se.get("message") or se.get("code") or ""
                        ).strip()
                if not detail_msg:
                    detail_msg = str(
                        raw.get("message") or raw.get("error") or ""
                    ).strip()
                payload = {**raw, "detail": detail_msg or "AI service error"}
            else:
                payload = {"detail": str(raw)}
            sink.put(
                {
                    "type": "error",
                    "status": exc.status_code,
                    "payload": payload,
                }
            )
        except Exception as exc:  # noqa: BLE001
            sink.put(
                {
                    "type": "error",
                    "status": 502,
                    "payload": {"detail": str(exc)},
                }
            )
        finally:
            sink.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def gen() -> Iterator[str]:
        while True:
            item = sink.get()
            if item is None:
                yield "event: done\ndata: {}\n\n"
                break
            kind = str(item.get("type") or "")
            if kind == "result":
                yield f"event: result\ndata: {json.dumps(item.get('payload') or {}, default=str)}\n\n"
            elif kind == "error":
                yield f"event: error\ndata: {json.dumps(item, default=str)}\n\n"
            else:
                # ontology / tool progress
                yield f"event: progress\ndata: {json.dumps(item, default=str)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
