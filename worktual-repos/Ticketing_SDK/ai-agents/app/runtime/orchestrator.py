"""Native run orchestrator — hydrate memory, run supervisor, persist, envelope."""

from __future__ import annotations

import uuid
from typing import Any

from app.contracts.errors import LLMEmptyResponse, NativeAIError
from app.contracts.execution import RunRequest, RunResult, RunError
from app.memory.durable_store import ConversationContextLoadError
from app.memory.session import SharedMemory
from app.runtime.supervisor import SPECIALIST_NAMES, run_with_handoffs

_NATIVE_START_AGENTS = frozenset(SPECIALIST_NAMES) | frozenset(
    {"ticketing_coworker", "supervisor"}
)


def _resolve_native_start_agent(request: RunRequest, memory: SharedMemory) -> str:
    """All interactive entries use Super; registered TaskState pins structured work."""
    memory.durable.pop("route_start_agent", None)
    return "ticketing_coworker"


def _is_portal_request(request: RunRequest) -> bool:
    role = str(request.actor.user_role or "").strip().lower()
    mod = str(request.module or "").strip().lower()
    return role.startswith("portal") or mod == "portal"


def _merge_client_draft_into_durable(
    memory: SharedMemory,
    key: str,
    client: dict[str, Any] | Any,
) -> None:
    """Merge UI draft into durable memory without demoting an armed confirm.

    Client forms can lag behind chat (e.g. team still on members step while chat
    already asked to confirm). Never overwrite confirm + filled members with a
    weaker client shell.
    """
    if not isinstance(client, dict):
        return
    existing = memory.durable.get(key)
    existing = dict(existing) if isinstance(existing, dict) else {}
    incoming = dict(client)
    ex_await = str(existing.get("awaiting") or "").strip().lower()
    in_await = str(incoming.get("awaiting") or "").strip().lower()
    if ex_await in {"confirm", "delete_confirm"} and in_await not in {
        "confirm",
        "delete_confirm",
        "",
    }:
        # Keep armed confirm; still absorb any new field values from the client.
        merged = {**incoming, **existing, "awaiting": existing.get("awaiting")}
        if key == "team_draft":
            members = existing.get("members")
            if isinstance(members, list) and members:
                merged["members"] = members
        memory.durable[key] = merged
        return
    if key == "ticket_draft" and existing:
        for stamp in (
            "customerDirectoryStatus",
            "customerId",
            "customer_id",
            "precreate_duplicate_check",
            "issueReady",
            "needsOrderCheck",
            "orderVerified",
            "orderId",
            "order_id",
            "productId",
            "product_id",
            "orderItemCount",
            "issue",
            "contact",
            "customerName",
            "customerEmail",
            "customerPhone",
        ):
            prior = existing.get(stamp)
            incoming_val = incoming.get(stamp)
            empty_in = incoming_val in (None, "", [], {})
            filled_prior = prior not in (None, "", [], {})
            if filled_prior and empty_in:
                incoming[stamp] = prior
        prior_atts = existing.get("attachments")
        incoming_atts = incoming.get("attachments")
        if isinstance(prior_atts, list) or isinstance(incoming_atts, list):
            seen: list[str] = []
            for item in list(prior_atts or []) + list(incoming_atts or []):
                url = str(item).strip()
                if (
                    url.startswith("/uploads/")
                    and ".." not in url
                    and "\\" not in url
                    and url not in seen
                ):
                    seen.append(url)
            if seen:
                incoming["attachments"] = seen
    if key == "kb_draft":
        from app.workflow_schemas import sanitize_kb_draft_fields, usable_kb_title

        incoming = sanitize_kb_draft_fields(incoming)
        start = str(
            incoming.get("_intent_start_text") or existing.get("_intent_start_text") or ""
        ).strip()
        if start:
            incoming["_intent_start_text"] = start
        if not usable_kb_title(
            str(incoming.get("title") or existing.get("title") or ""),
            start_utterance=start,
        ):
            incoming.pop("title", None)
            if not usable_kb_title(
                str(existing.get("title") or ""),
                start_utterance=start,
            ):
                incoming.pop("category", None)
                incoming["awaiting"] = "title"
                incoming["step"] = "title"
    memory.durable[key] = {**existing, **incoming} if existing else incoming


def _portal_ui_articles(pending_or_rows: Any) -> list[dict[str, Any]]:
    """Map pending_kb / chosen articles into the portal UI shape."""
    rows: list[Any] = []
    if isinstance(pending_or_rows, dict):
        raw = pending_or_rows.get("articles")
        rows = raw if isinstance(raw, list) else []
    elif isinstance(pending_or_rows, list):
        rows = pending_or_rows
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        aid = str(row.get("id") or "").strip()
        title = str(row.get("title") or "").strip()
        if not aid and not title:
            continue
        body = str(
            row.get("excerpt") or row.get("content") or row.get("body") or ""
        ).strip()
        out.append(
            {
                "id": aid,
                "title": title or "Untitled",
                "excerpt": body[:240],
                "category": str(row.get("category") or ""),
            }
        )
    return out


def _rows_from_kb_payload(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    article = payload.get("article")
    if isinstance(article, dict):
        return [article]
    raw = (
        payload.get("articles")
        or payload.get("data")
        or payload.get("items")
        or payload.get("results")
    )
    return raw if isinstance(raw, list) else []


def _portal_articles_from_memory(memory: SharedMemory) -> list[dict[str, Any]]:
    """Related published KB rows from pending_kb or this turn's list_kb / get_kb."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def _add(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            key = str(row.get("id") or row.get("title") or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(row)

    draft = memory.durable.get("ticket_draft")
    if isinstance(draft, dict):
        _add(_portal_ui_articles(draft.get("pending_kb")))
    last = memory.durable.get("last_tool_outcome")
    if isinstance(last, dict):
        tool = str(last.get("tool") or last.get("name") or "").strip()
        if tool in {"list_kb", "get_kb"}:
            result = last.get("result")
            payload = last.get("payload")
            if payload is None and isinstance(result, dict):
                payload = result.get("payload")
            _add(_portal_ui_articles(_rows_from_kb_payload(payload)))
            if isinstance(result, dict) and payload is None:
                _add(_portal_ui_articles(_rows_from_kb_payload(result)))
    return out


def prepare_portal_dssa(
    request: RunRequest,
    memory: SharedMemory,
) -> dict[str, Any]:
    """
    Code-owned DSSA gate for the support portal before specialist speech.

    On issue entry: LLM selects related published KB articles (no regex matching)
    and seeds interactive troubleshooting into ticket_draft.pending_kb.
    On kb_resolution follow-ups: LLM continues next steps / files / closes.
    """
    from app.proactive.dssa import classify_kb_followup
    from app.tasks.chat_commands import _portal_advance_after_issue
    from app.workflow_schemas import issue_looks_usable

    text = str(request.message or "").strip()
    org = str(request.actor.organization_id or "").strip()

    # Portal: bind the logged-in customer (never collect email). Convert leftover
    # staff name/contact shells instead of dropping a live issue draft.
    from app.agents.ticketing_coworker import seed_portal_ticket_identity

    seed_portal_ticket_identity(memory, request)
    draft_raw = memory.durable.get("ticket_draft")
    draft = dict(draft_raw) if isinstance(draft_raw, dict) else {}
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    surface = str(draft.get("surface") or "").strip().lower()
    role = str(request.actor.user_role or "").strip().lower()
    if (
        role == "portal_guest"
        and draft
        and surface != "portal"
        and awaiting in {
            "name",
            "contact",
            "priority",
            "",
        }
    ):
        memory.durable.pop("ticket_draft", None)
        draft = {}
        awaiting = ""
        surface = ""

    def _pin_kb(*, step: str | None = None) -> None:
        memory.durable["active_agent"] = "kb"
        if draft or step or memory.durable.get("ticket_draft"):
            memory.durable["current_workflow"] = "create_ticket"
        if step:
            memory.durable["current_step"] = step

    def _pending_articles(pending: dict[str, Any]) -> list[dict[str, Any]]:
        return _portal_ui_articles(pending)

    if awaiting == "kb_resolution":
        _pin_kb(step="kb_resolution")
        pending = (
            dict(draft.get("pending_kb"))
            if isinstance(draft.get("pending_kb"), dict)
            else {}
        )
        articles = _pending_articles(pending)
        steps_all = [
            str(s).strip()
            for s in (pending.get("steps") or [])
            if str(s).strip()
        ]
        shown = int(pending.get("steps_shown") or 0)
        remaining = steps_all[shown:] if shown < len(steps_all) else []
        article_bits: list[str] = []
        for row in pending.get("articles") or []:
            if isinstance(row, dict):
                title = str(row.get("title") or "").strip()
                body = str(row.get("content") or row.get("body") or "").strip()
                if title or body:
                    article_bits.append(f"{title}\n{body[:2500]}")
        follow: dict[str, Any] = {
            "intent": "followup",
            "reply": "",
            "confidence": 0.0,
        }
        try:
            follow = classify_kb_followup(
                text,
                issue=str(draft.get("issue") or draft.get("description") or ""),
                prior_guidance=str(pending.get("guidance_notes") or ""),
                article_content="\n---\n".join(article_bits) if article_bits else None,
                steps_remaining=remaining,
            )
        except Exception:  # noqa: BLE001
            # Keep prior guidance as seed so chat never hard-fails mid-walkthrough.
            follow = {
                "intent": "continue",
                "reply": str(pending.get("guidance_notes") or "").strip(),
                "confidence": 0.0,
            }
        intent = str(follow.get("intent") or "").strip().lower()
        seed = str(follow.get("reply") or "").strip()
        if not seed and pending.get("guidance_notes"):
            seed = str(pending.get("guidance_notes") or "").strip()
        if intent == "need_ticket":
            draft = {
                **draft,
                "surface": "portal",
                "kb_offered": True,
                "awaiting": "confirm",
                "pending_kb": pending,
            }
            memory.durable["ticket_draft"] = draft
            memory.durable["current_step"] = "confirm"
            return {
                "agent": "kb",
                "articles": articles,
                "seed_reply": seed or None,
                "followup_intent": intent,
            }
        if intent in {"continue", "followup"} and seed:
            pending = {
                **pending,
                "guidance_notes": seed,
                "steps_shown": min(len(steps_all), shown + 2) if steps_all else shown,
            }
            draft = {**draft, "surface": "portal", "pending_kb": pending, "awaiting": "kb_resolution"}
            memory.durable["ticket_draft"] = draft
        elif intent == "resolved" and seed:
            pending = {**pending, "guidance_notes": seed}
            draft = {**draft, "surface": "portal", "pending_kb": pending}
            memory.durable["ticket_draft"] = draft
        return {
            "agent": "dssa" if (articles or pending) else "kb",
            "articles": articles,
            "seed_reply": seed or str(pending.get("guidance_notes") or "").strip() or None,
            "followup_intent": intent,
            "dssa_deflected": True,
        }

    if awaiting == "confirm":
        _pin_kb(step="confirm")
        # Customer affirmed after an LLM "search?" offer without prior DSSA hit —
        # re-run deflection on the stored issue so we guide from KB instead of
        # failing empty / filing prematurely.
        issue = str(draft.get("issue") or draft.get("description") or "").strip()
        if issue and issue_looks_usable(text) is False and len(text) <= 40:
            # Short affirm / continue — try DSSA once if KB never offered.
            if not draft.get("kb_offered") and not (
                isinstance(draft.get("pending_kb"), dict) and draft.get("pending_kb")
            ):
                handoff = _portal_advance_after_issue(
                    issue,
                    page=request.page,
                    org=org,
                    data={**draft, "issue": issue, "surface": "portal"},
                )
                draft_out = handoff.get("ticket_draft")
                if isinstance(draft_out, dict):
                    memory.durable["ticket_draft"] = draft_out
                    memory.durable["active_agent"] = "kb"
                    memory.durable["current_workflow"] = (
                        handoff.get("current_workflow") or "create_ticket"
                    )
                    memory.durable["current_step"] = handoff.get("current_step")
                    data = (
                        handoff.get("data")
                        if isinstance(handoff.get("data"), dict)
                        else {}
                    )
                    pending = (
                        draft_out.get("pending_kb")
                        if isinstance(draft_out.get("pending_kb"), dict)
                        else {}
                    )
                    if data.get("dssa_deflected"):
                        return {
                            "agent": "dssa",
                            "articles": _pending_articles(pending),
                            "dssa_deflected": True,
                            "seed_reply": str(data.get("seed_reply") or pending.get("guidance_notes") or "").strip()
                            or None,
                        }
        return {"agent": "kb", "articles": []}

    if awaiting in {"issue", ""} or not draft:
        if issue_looks_usable(text):
            base = {
                **draft,
                "issue": text,
                "subject": str(draft.get("subject") or text[:120]).strip(),
                "description": str(draft.get("description") or text).strip(),
                "surface": "portal",
            }
            handoff = _portal_advance_after_issue(
                text,
                page=request.page,
                org=org,
                data=base,
            )
            draft_out = handoff.get("ticket_draft")
            if isinstance(draft_out, dict):
                memory.durable["ticket_draft"] = draft_out
                memory.durable["active_agent"] = "kb"
                memory.durable["current_workflow"] = (
                    handoff.get("current_workflow") or "create_ticket"
                )
                memory.durable["current_step"] = handoff.get("current_step")
                pending = (
                    draft_out.get("pending_kb")
                    if isinstance(draft_out.get("pending_kb"), dict)
                    else {}
                )
                articles = _pending_articles(pending)
                data = (
                    handoff.get("data")
                    if isinstance(handoff.get("data"), dict)
                    else {}
                )
                if data.get("dssa_deflected"):
                    return {
                        "agent": "dssa",
                        "articles": articles,
                        "dssa_deflected": True,
                        "seed_reply": str(
                            data.get("seed_reply")
                            or pending.get("guidance_notes")
                            or ""
                        ).strip()
                        or None,
                    }
                # No KB hit: do not pin create/confirm. Super → Domain can still
                # try list_kb / get_kb on this utterance before filing.
                identity = {
                    key: draft_out.get(key)
                    for key in (
                        "surface",
                        "customerId",
                        "customerName",
                        "name",
                    )
                    if draft_out.get(key) not in (None, "")
                }
                identity["surface"] = "portal"
                memory.durable["ticket_draft"] = identity
                memory.durable.pop("current_workflow", None)
                memory.durable.pop("current_step", None)
                return {"agent": "kb", "articles": []}
        if draft and awaiting == "issue":
            _pin_kb(step="issue")
            return {"agent": "kb", "articles": []}
        _pin_kb()
        return {"agent": "kb", "articles": []}

    if surface == "portal":
        _pin_kb(step=awaiting or None)
        return {"agent": "kb", "articles": []}

    _pin_kb()
    return {"agent": "kb", "articles": []}


def run_native_turn(request: RunRequest) -> RunResult:
    """Hydrate → run Super/Domain/Executor → persist (session-serialized)."""
    from app.memory.durable_store import build_thread_id, serialized_conversation_turn

    org = str(request.actor.organization_id or "").strip()
    sid = str(request.session_id or "").strip()
    # Same lock as /focus so focus CAS and chat persist cannot interleave in-process.
    if org and sid:
        with serialized_conversation_turn(build_thread_id(org, sid)):
            return _run_native_turn_unlocked(request)
    return _run_native_turn_unlocked(request)


def _run_native_turn_unlocked(request: RunRequest) -> RunResult:
    from app.agents.ticketing_coworker import run_coworker_agent

    run_id = request.run_id or str(uuid.uuid4())
    request_id = request.request_id or str(uuid.uuid4())

    try:
        memory = SharedMemory.hydrate(
            organization_id=request.actor.organization_id,
            user_id=request.actor.user_id,
            session_id=request.session_id,
            request_id=request_id,
            session_memory=request.session_memory,
            history=request.history,
        )
        reply_locale = str(getattr(request.actor, "locale", "") or "").strip()
        if reply_locale:
            memory.durable["reply_locale"] = reply_locale
    except ConversationContextLoadError:
        raise

    if request.focused_entity and isinstance(request.focused_entity, dict):
        # Always hydrate the open UI row from Express/Postgres into last_entity.
        from app.workflow_state import normalize_last_entity

        fe = dict(request.focused_entity)
        memory.durable["last_entity"] = normalize_last_entity(fe) or fe
        try:
            from app.focus_entity import fetch_focused_entity
            from app.tools.express_client import ToolActor, tool_actor_scope

            actor = ToolActor(
                user_id=str(request.actor.user_id or "").strip(),
                organization_id=str(request.actor.organization_id or "").strip(),
                user_role=request.actor.user_role,
                user_name=request.actor.user_name,
                request_id=request_id,
            )
            with tool_actor_scope(actor):
                rich = fetch_focused_entity(request.focused_entity)
            if rich:
                memory.durable["last_entity"] = normalize_last_entity(rich) or rich
        except Exception:  # noqa: BLE001
            pass
        ent = memory.durable.get("last_entity")
        if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "ticket":
            raw = str(
                ent.get("ticketNumber")
                or ent.get("ticket_number")
                or ent.get("id")
                or ""
            ).strip()
            digits = raw.lstrip("#")
            if digits.isdigit():
                tn = f"#{digits}"
                ent["ticketNumber"] = tn
                ent["ticket_number"] = tn
                memory.durable["last_entity"] = ent
    ch = str(getattr(request, "channel", None) or "chat").strip().lower()
    memory.durable["hub_channel"] = ch if ch in ("chat", "email") else "chat"
    if request.drafts:
        pending_intent = str(
            (request.session_memory or {}).get("pendingIntent")
            or memory.durable.get("current_workflow")
            or ""
        ).strip()
        draft_owner = {
            "ticket_draft": "create_ticket",
            "team_draft": "create_team",
            "kb_draft": "create_kb",
            "macro_draft": "create_macro",
            "customer_draft": "create_customer",
            "priority_draft": "create_priority",
            "status_draft": "create_status",
            "escalate_draft": "escalate",
        }
        for key, value in request.drafts.items():
            if value is None:
                continue
            owner = draft_owner.get(str(key))
            # Don't let a stale open form rehydrate a parked sibling draft over
            # the active guided workflow (e.g. Create Ticket form while creating a macro).
            if pending_intent and owner and pending_intent != owner:
                continue
            before_ticket: dict[str, Any] | None = None
            if str(key) == "ticket_draft" and isinstance(
                memory.durable.get("ticket_draft"), dict
            ):
                before_ticket = dict(memory.durable.get("ticket_draft") or {})
            _merge_client_draft_into_durable(memory, str(key), value)
            if str(key) == "ticket_draft" and before_ticket is not None:
                from app.agents.ticketing_coworker import (
                    sync_ticket_directory_on_draft_merge,
                )

                sync_ticket_directory_on_draft_merge(memory, before_ticket)

    surface = request.surface or request.page_surface
    # Portal tool allowlist is keyed as ("portal", "home") — never ("portal", "portal").
    if _is_portal_request(request) and str(surface or "").strip().lower() in {
        "",
        "portal",
    }:
        surface = request.page_surface or "home"
    context = {
        "request": request,
        "run_id": run_id,
        "request_id": request_id,
        "module": request.module,
        "surface": surface,
        "page": request.page,
        "mcp_token": request.mcp_token,
    }
    pinned_task = str(
        (request.session_memory or {}).get("harnessTaskId") or ""
    ).strip()
    sm = request.session_memory if isinstance(request.session_memory, dict) else {}
    if not isinstance(memory.durable.get("last_tool_outcome"), dict):
        client_last = sm.get("lastToolOutcome") or sm.get("last_tool_outcome")
        if isinstance(client_last, dict) and client_last:
            memory.durable["last_tool_outcome"] = dict(client_last)
    if pinned_task and not memory.current_task_state():
        from app.agents.ticketing_coworker import _primary_write_already_succeeded
        from app.workflow_schemas import new_harness_task_state

        # Client shallow-merge can keep harnessTaskId after a successful write.
        # Do not resurrect that pin — Super must route the next utterance.
        if not _primary_write_already_succeeded(memory, pinned_task):
            memory.set_task_state(
                new_harness_task_state(
                    pinned_task,
                    channel=request.channel or request.surface,
                    collected=(
                        dict((request.session_memory or {}).get("harnessFields") or {})
                        if isinstance(
                            (request.session_memory or {}).get("harnessFields"), dict
                        )
                        else {}
                    ),
                    provenance={
                        key: "trusted_structured"
                        for key in (
                            (request.session_memory or {}).get("harnessFields") or {}
                        )
                    },
                    idempotency_key=str(
                        (request.session_memory or {}).get("idempotencyKey") or ""
                    )
                    or None,
                )
            )

    # Skill memory: hydrate prefs + relevant long-term snippets for this turn.
    try:
        memory.preferences.get(
            tenant_id=memory.organization_id,
            user_id=memory.user_id,
        )
        q = str(request.message or "").strip()
        if q:
            memory.long_term.search(
                tenant_id=memory.organization_id,
                user_id=memory.user_id,
                query=q,
                limit=5,
            )
        else:
            memory.long_term.get_recent(
                tenant_id=memory.organization_id,
                user_id=memory.user_id,
                limit=5,
            )
    except Exception:  # noqa: BLE001
        pass

    turn_started = False
    turn_close: dict[str, Any] = {"text": "", "agent": None, "error": None}
    try:
        portal_meta: dict[str, Any] = {}
        if _is_portal_request(request):
            # Support portal preserves DSSA preparation but enters the same
            # Super → Domain → Executor/Skill runtime as staff chat.
            portal_meta = prepare_portal_dssa(request, memory)
            start_agent = "ticketing_coworker"
        else:
            start_agent = _resolve_native_start_agent(request, memory)

        try:
            from app.observability.turn_log import begin_turn

            begin_turn(
                user_query=request.message,
                session_id=request.session_id,
                request_id=request_id,
                organization_id=str(request.actor.organization_id or ""),
                user_id=str(request.actor.user_id or ""),
                start_agent=start_agent,
            )
            turn_started = True
            turn_close["agent"] = start_agent
        except Exception:  # noqa: BLE001
            turn_started = False

        outcome = run_with_handoffs(
            memory=memory,
            start_agent=start_agent,
            max_handoffs=request.budgets.max_handoffs,
            run_agent=lambda agent, mem, query: run_coworker_agent(
                agent_name=agent,
                memory=mem,
                query=query or request.message,
                context=context,
            ),
            initial_query=request.message,
        )
        text = str(outcome.get("assistant_text") or "").strip()
        if not text and portal_meta:
            # DSSA already produced interactive guidance — never 503 with empty chat.
            text = str(portal_meta.get("seed_reply") or "").strip()
            if not text:
                draft_now = memory.durable.get("ticket_draft")
                if isinstance(draft_now, dict):
                    pending = draft_now.get("pending_kb")
                    if isinstance(pending, dict):
                        text = str(pending.get("guidance_notes") or "").strip()
        turn_close["text"] = text
        turn_close["agent"] = outcome.get("agent") or start_agent
        if not text:
            raise LLMEmptyResponse("Native agent produced no assistant text")

        try:
            version = memory.persist()
        except NativeAIError as exc:
            turn_close["error"] = exc.message
            failed = RunResult(
                assistant_text=None,
                agent=outcome.get("agent"),
                run_id=run_id,
                request_id=request_id,
                error=RunError(
                    code=exc.code,
                    message=exc.message,
                    details=exc.details,
                    retryable=exc.http_status >= 500,
                ),
            )
            turn_close["result"] = failed
            return failed

        data = dict(outcome.get("data") or {})
        agent = str(outcome.get("agent") or "general")
        if portal_meta:
            articles = list(portal_meta.get("articles") or [])
            if articles:
                data["articles"] = articles
            if portal_meta.get("agent") == "dssa":
                agent = "dssa"
                data["dssa_deflected"] = True
            if portal_meta.get("followup_intent"):
                data["dssa_followup_intent"] = portal_meta.get("followup_intent")
        if _is_portal_request(request):
            merged = list(data.get("articles") or [])
            extra = _portal_articles_from_memory(memory)
            if extra:
                seen = {
                    str(row.get("id") or row.get("title") or "")
                    for row in merged
                    if isinstance(row, dict)
                }
                for row in extra:
                    key = str(row.get("id") or row.get("title") or "")
                    if key and key not in seen:
                        merged.append(row)
                        seen.add(key)
            if merged:
                data["articles"] = merged
                if agent in {"", "kb", "general", "ticketing_coworker"}:
                    agent = "dssa"

        turn_close["agent"] = agent
        turn_close["text"] = text
        result = RunResult(
            assistant_text=text,
            agent=agent,
            tool_proposals=list(outcome.get("tool_proposals") or []),
            patch=outcome.get("patch"),
            session_memory_patch={
                **(outcome.get("session_memory_patch") or {}),
                **_session_patch(memory),
            },
            ui_refresh=outcome.get("ui_refresh"),
            ui_actions=list(outcome.get("ui_actions") or []),
            data=data,
            durable_memory=memory.allowlisted_durable(),
            durable_memory_version=version,
            run_id=run_id,
            request_id=request_id,
        )
        turn_close["result"] = result
        return result
    except NativeAIError as exc:
        turn_close["error"] = exc.message
        failed = RunResult(
            assistant_text=None,
            agent=None,
            run_id=run_id,
            request_id=request_id,
            error=RunError(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                retryable=exc.http_status >= 500,
            ),
            durable_memory=memory.allowlisted_durable(),
            durable_memory_version=memory.version,
        )
        turn_close["result"] = failed
        return failed
    finally:
        if turn_started:
            try:
                from app.observability.turn_log import finish_turn, trace_snapshot

                if getattr(request, "debug", False):
                    snap = trace_snapshot()
                    held = turn_close.get("result")
                    if snap and held is not None and hasattr(held, "data"):
                        held.data = {**(held.data or {}), "trace": snap}
                finish_turn(
                    final_response=str(turn_close.get("text") or ""),
                    final_agent=turn_close.get("agent"),
                    error=turn_close.get("error"),
                )
            except Exception:  # noqa: BLE001
                pass


def _session_patch(memory: SharedMemory) -> dict[str, Any]:
    from app.agents.ticketing_coworker import _harness_session_pin_fields

    patch: dict[str, Any] = {
        "slots": dict(memory.durable.get("slots") or {}),
        "pendingAsk": memory.durable.get("pending_ask"),
        "activeAgent": memory.durable.get("active_agent"),
        "lastEntity": memory.durable.get("last_entity"),
        "lastToolOutcome": memory.durable.get("last_tool_outcome"),
    }
    patch.update(_harness_session_pin_fields(memory))
    return patch
