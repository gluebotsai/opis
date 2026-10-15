"""
Orchestrator — park / resume / clarify / route_to_agent only.

Specialists own continue / start / list / mutate. Commands shim is nav/settings
fallback only — not a second mutate path.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

from app.memory_contract import (
    collect_active_drafts,
    looks_like_side_quest,
    next_step_hint_for_draft,
    normalize_parked,
    park_flows,
    pick_resume_flow_from_decision,
    unpark,
)
from app.agents.workflow_nlu import (
    ADMIN_OPERATIONS,
    CUSTOMER_OPERATIONS,
    KB_OPERATIONS,
    MACRO_OPERATIONS,
    TEAM_OPERATIONS,
    TICKET_OPERATIONS,
    _admin_topic_from_page,
)
from app.state import AgentState
from app.workflow_state import (
    ENTITY_TEAM,
    SPECIALIST_ROUTES,
    WORKFLOW_TO_FLOW,
    agent_for_workflow,
    apply_last_entity_to_ticket,
    enrich_handler_result,
    ensure_team_draft,
    hydrate_from_legacy_drafts,
    last_entity_from_state,
    normalize_last_entity,
    workflow_type_from_flow,
)
from app.workflow_schemas import (
    mark_macro_intent_start,
    mark_priority_intent_start,
    mark_status_intent_start,
    missing_fields,
)


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _phrase_resume(*, text: str, flow: str, draft: dict, page: str | None) -> str:
    hint = next_step_hint_for_draft(flow, draft)
    try:
        from app.tasks.chat_commands import _llm_phrase

        return _llm_phrase(
            module="nav",
            kind="resume_draft",
            fallback=f"Resume {flow} draft; ask next step.",
            user_text=text,
            page_label=page,
            context={"flow": flow, "draft": draft, "nextStep": hint},
        )
    except Exception:  # noqa: BLE001
        # Never paint the nextStep label as the chat bubble.
        return ""


def _route_for_flow(flow: str) -> str:
    if flow == "kb":
        return "kb"
    if flow == "escalate":
        return "tickets"
    if flow == "ticket":
        return "tickets"
    if flow == "team":
        return "teams"
    if flow == "customer":
        return "customers"
    return "general"


def _resume_draft(
    flow: str,
    draft: dict[str, Any],
    last_entity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Restore a parked draft at its first schema-missing field."""
    restored = dict(draft)
    if flow == "ticket":
        restored = apply_last_entity_to_ticket(restored, last_entity)
    awaiting = str(restored.get("awaiting") or "").strip().lower()
    workflow_id = {
        "ticket": "create_ticket",
        "macro": "create_macro",
        "kb": "create_kb",
        "escalate": "escalate",
        "reassign": "reassign_ticket",
        "priority": (
            "create_status"
            if str(restored.get("kind") or "").strip().lower() == "status"
            else "create_priority"
        ),
        "customer": "create_customer",
    }.get(flow)
    if flow == "team":
        if awaiting in ("members", "members_names", "members_team") or (
            str(restored.get("id") or "").strip()
            and any(key in restored for key in ("members", "member_names"))
        ):
            workflow_id = "add_team_members"
        elif awaiting in ("name", "description", "create_members", "confirm"):
            workflow_id = "create_team"
    if not workflow_id:
        return restored
    missing = missing_fields(workflow_id, restored)
    step_map = {
        "customerName": "name",
        "contact": "contact",
        "issue": "issue",
        "priority": "priority",
        "ticket_number": "ticket",
        "assignee": "assignee",
        "displayName": "name",
        "resolutionHours": "hours",
        "members": (
            "create_members" if workflow_id == "create_team" else "members_names"
        ),
        "team": "members_team",
        "description": "description",
    }
    if missing:
        restored["awaiting"] = step_map.get(missing[0], missing[0])
    elif workflow_id == "create_team":
        restored["awaiting"] = "create_members"
    else:
        restored["awaiting"] = "confirm"
    logger.info(
        "workflow_resume_hydrate flow=%s workflow_id=%s missing=%s awaiting=%s field_keys=%s",
        flow,
        workflow_id,
        missing,
        restored.get("awaiting"),
        sorted(k for k, v in restored.items() if v not in (None, "", [], {})),
    )
    return restored


def resolve_active_workflow(
    text: str,
    *,
    page: str | None,
    organization_id: str,
    user_role: str | None,
    user_id: str | None,
    user_name: str | None,
    escalate_draft: dict | None,
    reassign_draft: dict | None = None,
    macro_draft: dict | None,
    team_draft: dict | None,
    kb_draft: dict | None,
    parked_drafts: list | None,
    session_history: list | None,
    last_entity: dict | None = None,
    workflow_decision: dict[str, Any] | None = None,
    ticket_draft: dict | None = None,
    priority_draft: dict | None = None,
    customer_draft: dict | None = None,
) -> dict[str, Any] | None:
    """
    Continue / resume / park active guided workflows.
    Returns a handler dict if this turn is owned by workflow state; else None.
    """
    from app.tasks.chat_commands import (
        _continue_macro_draft,
        _continue_ticket_draft,
        _pending_from_history,
        continue_escalate_draft,
        continue_reassign_draft,
        start_create_team_flow,
        start_create_ticket_flow,
        start_or_continue_delete_macro,
        start_or_continue_escalate,
        start_or_continue_reassign,
    )
    from app.tasks.catalog_commands import (
        _continue_add_team_members,
        continue_customer_draft,
        continue_kb_draft,
        continue_priority_draft,
        continue_team_draft,
        start_create_customer_flow,
        start_or_continue_add_team_members,
    )

    org = (organization_id or "").strip()
    if not org or not (text or "").strip():
        return None

    role = (user_role or "").strip().lower()
    parked = normalize_parked(parked_drafts)
    prior_le = normalize_last_entity(last_entity)

    mdraft = macro_draft if isinstance(macro_draft, dict) else None
    tdraft = team_draft if isinstance(team_draft, dict) else None
    kdraft = kb_draft if isinstance(kb_draft, dict) else None
    tixdraft = ticket_draft if isinstance(ticket_draft, dict) else None
    pdraft = priority_draft if isinstance(priority_draft, dict) else None
    cdraft = customer_draft if isinstance(customer_draft, dict) else None

    other_guided = any(
        isinstance(d, dict) and str(d.get("awaiting") or "").strip()
        for d in (mdraft, tdraft, kdraft, tixdraft, pdraft, cdraft)
    )
    draft = escalate_draft if isinstance(escalate_draft, dict) else None
    rdraft = reassign_draft if isinstance(reassign_draft, dict) else None
    if not draft and not other_guided:
        draft = _pending_from_history(session_history)
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    pending = bool(draft and awaiting in ("assignee", "ticket", "note", "confirm"))
    reassign_awaiting = str((rdraft or {}).get("awaiting") or "").strip().lower()
    reassign_pending = bool(
        rdraft and reassign_awaiting in ("ticket", "target_role", "person", "confirm")
    )

    active = collect_active_drafts(
        escalate_draft=draft if pending else None,
        reassign_draft=rdraft if reassign_pending else None,
        macro_draft=mdraft,
        team_draft=tdraft,
        kb_draft=kdraft,
        ticket_draft=tixdraft,
        priority_draft=pdraft,
        customer_draft=cdraft,
    )

    def _park_except(keep: set[str]) -> list:
        return park_flows(active, except_flows=keep, existing_parked=parked)

    def _with_start_park(
        out: dict[str, Any], keep: set[str], parked_now: list
    ) -> dict[str, Any]:
        """Park siblings and null their drafts so the UI cannot keep the old form."""
        draft_by_flow = {
            "ticket": "ticket_draft",
            "team": "team_draft",
            "macro": "macro_draft",
            "kb": "kb_draft",
            "escalate": "escalate_draft",
            "reassign": "reassign_draft",
            "priority": "priority_draft",
            "customer": "customer_draft",
        }
        extra = {key: None for flow, key in draft_by_flow.items() if flow not in keep}
        if parked_now:
            extra["parked_drafts"] = parked_now
        return {**out, **extra}

    def _finish(result: dict[str, Any]) -> dict[str, Any]:
        return enrich_handler_result(result, prior_last_entity=prior_le)

    def _handoff_armed_write(awaiting: str) -> bool:
        """Confirm/delete_confirm writes belong to specialist bind_tools, not continue_*."""
        return awaiting in {"confirm", "delete_confirm"} and semantic_action != "CANCEL_WORKFLOW"

    decision = workflow_decision if isinstance(workflow_decision, dict) else {}
    semantic_action = str(decision.get("action") or "").strip().upper()
    semantic_team = str(decision.get("entity_name") or "").strip()
    semantic_values = [
        str(value).strip()
        for value in (decision.get("values") or [])
        if str(value).strip()
    ]
    owner_flow = decision_owner_flow(decision)

    def _skip_foreign(flow: str) -> bool:
        """Do not continue a leftover draft when Super Agent named another module."""
        if not owner_flow:
            return False
        if semantic_action in {
            "NEW_TASK",
            "SIDE_QUEST",
            "CANCEL_WORKFLOW",
        }:
            return False
        return owner_flow != flow

    def _defer_side_quest() -> dict[str, Any]:
        """Park every active workflow and release this turn to normal routing."""
        return {
            "handled": False,
            "defer_to_commands": True,
            "reply": "",
            "actions": [],
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": None,
            "escalate_draft": None,
            "reassign_draft": None,
            "ticket_draft": None,
            "priority_draft": None,
            "customer_draft": None,
            "parked_drafts": _park_except(set()),
            "semantic_intent": str(decision.get("intent") or "").strip().upper()
            or None,
        }

    # One semantic side-quest transition for every workflow. The active draft
    # must not remain hydrated or it will keep owning the turn in policy.
    # Exception: create-team awaiting members — a roster first name is collect,
    # not LIST_TEAMS / park.
    if active and decision and semantic_action == "SIDE_QUEST":
        roster_continue = False
        aw = str((tdraft or {}).get("awaiting") or "").strip().lower() if tdraft else ""
        create_members = aw == "create_members" or (
            aw == "members" and not str((tdraft or {}).get("id") or "").strip()
        )
        if tdraft and create_members:
            from app.workflow_schemas import members_from_user_text, resolve_roster_name

            roster = [
                str(n).strip()
                for n in ((tdraft or {}).get("available_members") or [])
                if str(n).strip()
            ]
            roster_continue = bool(
                members_from_user_text(text, roster)
                or resolve_roster_name(text, roster)
            )
        if roster_continue:
            decision = {
                **decision,
                "action": "CONTINUE_WORKFLOW",
                "operation": "NONE",
                "proposed_tool": None,
            }
            semantic_action = "CONTINUE_WORKFLOW"
        else:
            return _defer_side_quest()

    if (
        active
        and owner_flow
        and semantic_action in {
            "CONTINUE_WORKFLOW",
            "CONFIRM_WORKFLOW",
            "RESUME_WORKFLOW",
        }
        and owner_flow not in active
    ):
        return _defer_side_quest()

    # Super Agent owns create vs add-members. Do not rewrite from utterance keywords.

    # Account secrets belong to Settings UI (commands shim) — never create-ticket/team.
    _secret_msg = (text or "").strip().lower()
    if (
        re.search(
            r"\b(change|update)\s+(my\s+)?password\b"
            r"|\b(reset)\s+(my\s+)?password\b"
            r"|\bpassword\s+(change|update)\b",
            _secret_msg,
        )
        and not re.search(
            r"\b(kb|knowledge|article|ticket|howto|how\s+to|search)\b",
            _secret_msg,
        )
    ):
        return None

    def _is_create_team_draft(d: dict | None) -> bool:
        if not isinstance(d, dict):
            return False
        aw = str(d.get("awaiting") or "").strip().lower()
        if aw == "members" and not str(d.get("id") or "").strip():
            return True
        return aw in (
            "name",
            "description",
            "create_members",
            "confirm",
            "type",
            "visibility",
            "agents",
        )

    def _is_add_members_draft(d: dict | None) -> bool:
        if not isinstance(d, dict):
            return False
        aw = str(d.get("awaiting") or "").strip().lower()
        if aw in ("members_names", "members_team"):
            return True
        return aw == "members" and bool(str(d.get("id") or "").strip())

    def _parked_create_team() -> dict | None:
        for item in reversed(parked):
            if str(item.get("flow") or "").strip().lower() != "team":
                continue
            draft = item.get("draft") if isinstance(item.get("draft"), dict) else None
            if _is_create_team_draft(draft):
                return draft
        return None

    # Create a NEW team (never confuse with add-members).
    # Restart when the utterance is the create command so it is not stored as the name.
    if semantic_action == "START_CREATE_TEAM":
        parked_now = _park_except({"team"}) if active else parked
        out = start_create_team_flow(
            text,
            role=role or "agent",
            page=page,
        )
        return _finish(_with_start_park(out, {"team"}, parked_now))

    if semantic_action == "START_CREATE_CUSTOMER":
        parked_now = _park_except({"customer"}) if active else parked
        out = start_create_customer_flow(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            ticket_draft=tixdraft,
            parked_drafts=parked_now or parked,
            session_history=session_history,
            semantic_decision=decision or None,
        )
        return _finish(_with_start_park(out, {"customer"}, parked_now))

    # Update an EXISTING team roster — park other flows (incl. create-ticket).
    # Do not steal an in-progress or parked create-team for a nameless add-members turn.
    if (
        semantic_action == "START_ADD_TEAM_MEMBERS"
        and not _is_add_members_draft(tdraft)
        and not _is_create_team_draft(tdraft)
        and not (_parked_create_team() is not None and not semantic_team)
    ):
        parked_now = _park_except({"team"}) if active else parked
        hit = start_or_continue_add_team_members(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=None,
            intent_confirmed=True,
            resolved_team_name=semantic_team or None,
            resolved_member_names=semantic_values,
        ) or {"handled": False, "reply": "", "actions": []}
        if parked_now and hit.get("handled"):
            hit = {**hit, "parked_drafts": parked_now}
        return _finish(hit)

    if semantic_action == "START_REASSIGN" and not reassign_pending:
        # Stale escalate-at-confirm must not block reassign (and must not keep
        # winning hydrate). Park/clear escalate; do not treat it as collecting_other.
        collecting_other = any(
            [
                _is_create_team_draft(tdraft),
                bool(tixdraft and str(tixdraft.get("awaiting") or "").strip()),
                bool(mdraft and str(mdraft.get("awaiting") or "").strip()),
                bool(kdraft and str(kdraft.get("awaiting") or "").strip()),
                bool(cdraft and str(cdraft.get("awaiting") or "").strip()),
                bool(pdraft and str(pdraft.get("awaiting") or "").strip()),
            ]
        )
        if not collecting_other:
            from app.tasks.chat_commands import (
                _resolve_open_ticket_number,
                _ticket_number_from_entity,
            )

            seed_ticket = semantic_team if decision.get("entity_type") == "ticket" else ""
            if not seed_ticket:
                seed_ticket = _ticket_number_from_entity(prior_le) or ""
            if not seed_ticket:
                seed_ticket = (
                    _resolve_open_ticket_number(
                        history=session_history,
                        last_entity=prior_le,
                    )
                    or ""
                )
            nlu_fields = (
                decision.get("fields")
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            person_hint = str(nlu_fields.get("person") or "").strip() or None
            if not person_hint:
                for val in semantic_values:
                    sv = str(val or "").strip()
                    if not sv:
                        continue
                    if sv.lstrip("#").isdigit():
                        continue
                    if sv.lower() in {"agent", "resolver"}:
                        continue
                    person_hint = sv
                    break
            role_hint = str(nlu_fields.get("target_role") or "").strip() or None
            if not role_hint:
                for val in semantic_values:
                    sv = str(val or "").strip().lower()
                    if sv in {"agent", "resolver"}:
                        role_hint = sv
                        break
            if not role_hint:
                from app.tasks.chat_commands import _infer_target_role

                role_hint = _infer_target_role(text)
            parked_now = _park_except({"reassign"}) if pending else parked
            hit = start_or_continue_reassign(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                reassign_draft=rdraft,
                intent_confirmed=True,
                resolved_ticket_number=seed_ticket or None,
                resolved_person=person_hint,
                resolved_target_role=role_hint,
                semantic_decision=decision,
                session_history=session_history,
                last_entity=prior_le,
            ) or {"handled": False, "reply": "", "actions": []}
            hit = {**hit, "escalate_draft": None}
            if parked_now:
                hit["parked_drafts"] = parked_now
            return _finish(hit)

    if semantic_action == "START_ESCALATE" and not pending:
        collecting_other = any(
            [
                _is_create_team_draft(tdraft),
                bool(tixdraft and str(tixdraft.get("awaiting") or "").strip()),
                bool(mdraft and str(mdraft.get("awaiting") or "").strip()),
                bool(kdraft and str(kdraft.get("awaiting") or "").strip()),
                bool(cdraft and str(cdraft.get("awaiting") or "").strip()),
                bool(pdraft and str(pdraft.get("awaiting") or "").strip()),
            ]
        )
        if not collecting_other:
            seed_ticket = semantic_team if decision.get("entity_type") == "ticket" else ""
            if not seed_ticket and prior_le and prior_le.get("type") == "ticket":
                from app.tasks.chat_commands import _ticket_number_from_entity

                seed_ticket = _ticket_number_from_entity(prior_le) or ""
            if not seed_ticket:
                from app.tasks.chat_commands import _resolve_open_ticket_number

                seed_ticket = (
                    _resolve_open_ticket_number(
                        history=session_history,
                        last_entity=prior_le,
                    )
                    or ""
                )
            assignee_hint = semantic_values[0] if semantic_values else None
            parked_now = _park_except({"escalate"}) if reassign_pending else parked
            hit = start_or_continue_escalate(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                escalate_draft=None,
                intent_confirmed=True,
                resolved_ticket_number=seed_ticket or None,
                resolved_assignee=assignee_hint,
                semantic_decision=decision,
            ) or {"handled": False, "reply": "", "actions": []}
            hit = {**hit, "reassign_draft": None}
            if parked_now:
                hit["parked_drafts"] = parked_now
            return _finish(hit)

    if role in ("portal_guest", "portal_customer") and semantic_action == "START_CREATE_TICKET":
        parked_now = _park_except({"ticket"}) if active else parked
        out = start_create_ticket_flow(
            text,
            org=org,
            role=role,
            page=page,
            semantic_decision=decision or None,
            user_id=user_id,
            user_name=user_name,
        )
        return _finish(_with_start_park(out, {"ticket"}, parked_now))

    if semantic_action == "START_CREATE_TICKET" and not (
        tixdraft and str(tixdraft.get("awaiting") or "").strip()
    ):
        parked_now = _park_except({"ticket"}) if active else parked
        out = start_create_ticket_flow(
            text,
            org=org,
            role=role or "agent",
            page=page,
            semantic_decision=decision or None,
            user_id=user_id,
            user_name=user_name,
        )
        return _finish(_with_start_park(out, {"ticket"}, parked_now))

    if semantic_action in (
        "START_CREATE_MACRO",
        "START_CREATE_KB",
        "START_CREATE_PRIORITY",
        "START_CREATE_STATUS",
    ):
        from app.tasks.chat_commands import _can_access_module, _llm_phrase
        from app.tasks.catalog_commands import continue_kb_draft

        # Active create-article awaiting category: never divert to Priorities/Statuses.
        # Active manage-category: never divert to Priorities or create-article START_*.
        if (
            semantic_action in {"START_CREATE_PRIORITY", "START_CREATE_STATUS"}
            and isinstance(kdraft, dict)
            and str(kdraft.get("awaiting") or "").strip().lower() == "category"
        ):
            out = continue_kb_draft(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                kb_draft=kdraft,
                semantic_decision={
                    **(decision or {}),
                    "action": "CONTINUE_WORKFLOW",
                    "operation": "NONE",
                    "agent": "kb",
                    "workflow": "create_kb",
                },
            )
            return _finish(out)
        from app.tasks.catalog_commands import (
            _is_manage_category_draft,
            start_or_continue_kb_category_manage,
        )

        if _is_manage_category_draft(kdraft) and semantic_action in {
            "START_CREATE_PRIORITY",
            "START_CREATE_STATUS",
            "START_CREATE_KB",
        }:
            cat_out = start_or_continue_kb_category_manage(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                kb_draft=kdraft if isinstance(kdraft, dict) else None,
                semantic_decision=decision or None,
                force_start=True,
            )
            if cat_out and cat_out.get("handled"):
                return _finish(cat_out)

        keep = {
            "START_CREATE_MACRO": "macro",
            "START_CREATE_KB": "kb",
            "START_CREATE_PRIORITY": "priority",
            "START_CREATE_STATUS": "priority",
        }[semantic_action]
        parked_now = _park_except({keep}) if active else parked
        if semantic_action == "START_CREATE_MACRO":
            if not _can_access_module(role or "agent", "macros"):
                out = {
                    "handled": True,
                    "reply": _llm_phrase(
                        module="nav",
                        kind="forbidden",
                        fallback="Role cannot use Macros.",
                        user_text=text,
                        page_label=page,
                        context={"feature": "Macros", "denied": True},
                    ),
                    "actions": [],
                    "route": "general",
                    "macro_draft": None,
                }
            else:
                out = {
                    "handled": True,
                    "reply": _llm_phrase(
                        module="macro",
                        kind="start",
                        fallback="Start create-macro: acknowledge and ask for the macro title only.",
                        user_text=text,
                        page_label=page or "Macros",
                        context={"nextStep": "macro title"},
                    ),
                    "actions": [
                        {"type": "navigate", "view": "macros"},
                        {"type": "create_macro"},
                    ],
                    "route": "macros",
                    "macro_draft": mark_macro_intent_start(
                        {"awaiting": "title"}, text
                    ),
                    "team_draft": tdraft,
                    "kb_draft": kdraft,
                }
        elif semantic_action == "START_CREATE_KB":
            from app.tasks.catalog_commands import (
                _KB_MANAGE_MODE_RE,
                _KB_MANAGE_START_RE,
                _is_manage_category_draft,
                start_or_continue_kb_category_manage,
            )

            low = (text or "").strip().lower().rstrip("!?.")
            # Bare "add" / manage-category phrases must not open create-article.
            if (
                _is_manage_category_draft(kdraft)
                or _KB_MANAGE_START_RE.match(low)
                or _KB_MANAGE_MODE_RE.match(low)
            ):
                cat_out = start_or_continue_kb_category_manage(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    kb_draft=kdraft if isinstance(kdraft, dict) else None,
                    semantic_decision=decision or None,
                    force_start=_is_manage_category_draft(kdraft)
                    or bool(_KB_MANAGE_MODE_RE.match(low)),
                )
                if cat_out and cat_out.get("handled"):
                    return _finish(cat_out)
            if not _can_access_module(role or "agent", "kb") or (role or "") in (
                "resolver",
                "viewer",
                "customer",
            ):
                out = {
                    "handled": True,
                    "reply": _llm_phrase(
                        module="nav",
                        kind="forbidden",
                        fallback="Role cannot create KB articles.",
                        user_text=text,
                        page_label=page,
                        context={"feature": "Knowledge Base create", "denied": True},
                    ),
                    "actions": [],
                    "route": "kb",
                    "kb_draft": None,
                }
            else:
                out = {
                    "handled": True,
                    "reply": _llm_phrase(
                        module="kb",
                        kind="start",
                        fallback="Start create-kb: acknowledge and ask for the article title.",
                        user_text=text,
                        page_label=page or "Knowledge Base",
                        context={"nextStep": "article title"},
                    ),
                    "actions": [
                        {"type": "navigate", "view": "kb"},
                        {"type": "create_kb", "step": "title"},
                    ],
                    "route": "kb",
                    "kb_draft": {"awaiting": "title"},
                    "macro_draft": mdraft,
                    "team_draft": tdraft,
                }
        else:
            is_status = semantic_action == "START_CREATE_STATUS"
            if role != "admin":
                out = {
                    "handled": True,
                    "reply": _llm_phrase(
                        module="nav",
                        kind="forbidden",
                        fallback="Only admins can create priorities.",
                        user_text=text,
                        page_label=page,
                        context={"feature": "Priorities", "denied": True},
                    ),
                    "actions": [],
                    "route": "general",
                    "priority_draft": None,
                }
            else:
                out = {
                    "handled": True,
                    "reply": _llm_phrase(
                        module="admin",
                        kind="start",
                        fallback=(
                            "Start create-status: ask for the display name."
                            if is_status
                            else "Start create-priority: ask for the display name."
                        ),
                        user_text=text,
                        page_label=page or "Priorities",
                        context={"nextStep": "status display name" if is_status else "priority name"},
                    ),
                    "actions": [
                        {"type": "navigate", "view": "priorities"},
                        {"type": "create_status" if is_status else "create_priority"},
                    ],
                    "route": "admin",
                    "priority_draft": (
                        mark_status_intent_start({"awaiting": "name", "kind": "status"}, text)
                        if is_status
                        else mark_priority_intent_start(
                            {"awaiting": "name", "kind": "priority"}, text
                        )
                    ),
                }
        return _finish(_with_start_park(out, {keep}, parked_now))

    # Compatibility resume parsing remains only for unmigrated workflows.
    semantic_fields = (
        decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    )
    if (
        semantic_action == "RESUME_WORKFLOW"
        or (
            semantic_action
            in ("CONTINUE_WORKFLOW", "CONFIRM_WORKFLOW")
            and parked
            and not active
            and not semantic_fields
        )
    ) and (parked or active):
        flow = pick_resume_flow_from_decision(decision, parked)
        if not flow and len(parked) == 1:
            sole = str(parked[0].get("flow") or "") or None
            if not owner_flow or owner_flow == sole or sole in {
                "escalate",
                "reassign",
            }:
                flow = sole
        if not flow and owner_flow and any(
            str(item.get("flow") or "") == owner_flow for item in parked
        ):
            flow = owner_flow
        if flow == "ticket" and not decision:
            flow = None
        if not flow and active:
            flow = next(reversed(list(active.keys())), None)
        if flow and flow in active:
            d = _resume_draft(flow, active[flow], prior_le)
            logger.info(
                "workflow_resume trigger=%s source=active flow=%s",
                semantic_action or "RESUME_WORKFLOW",
                flow,
            )
            return _finish(
                {
                    "handled": True,
                    "reply": _phrase_resume(text=text, flow=flow, draft=d, page=page),
                    "actions": [],
                    "route": _route_for_flow(flow),
                    "escalate_draft": d if flow == "escalate" else draft if pending else None,
                    "reassign_draft": d if flow == "reassign" else rdraft if reassign_pending else None,
                    "macro_draft": d if flow == "macro" else mdraft,
                    "team_draft": d if flow == "team" else tdraft,
                    "kb_draft": d if flow == "kb" else kdraft,
                    "ticket_draft": d if flow == "ticket" else tixdraft,
                    "priority_draft": d if flow == "priority" else pdraft,
                    "customer_draft": d if flow == "customer" else cdraft,
                    "parked_drafts": parked,
                }
            )
        if flow:
            d, rest = unpark(parked, flow)
            if d:
                d = _resume_draft(flow, d, prior_le)
                logger.info(
                    "workflow_resume trigger=%s source=parked flow=%s",
                    semantic_action or "RESUME_WORKFLOW",
                    flow,
                )
                return _finish(
                    {
                        "handled": True,
                        "reply": _phrase_resume(text=text, flow=flow, draft=d, page=page),
                        "actions": [],
                        "route": _route_for_flow(flow),
                        "escalate_draft": d if flow == "escalate" else None,
                        "reassign_draft": d if flow == "reassign" else None,
                        "macro_draft": d if flow == "macro" else None,
                        "team_draft": d if flow == "team" else None,
                        "kb_draft": d if flow == "kb" else None,
                        "ticket_draft": d if flow == "ticket" else None,
                        "priority_draft": d if flow == "priority" else None,
                        "customer_draft": d if flow == "customer" else None,
                        "parked_drafts": rest,
                    }
                )

    # Auto-resume parked KB/macro answers
    if not active and parked:
        top = parked[-1]
        flow = top["flow"]
        d = dict(top["draft"])
        if flow == "kb" and str(d.get("awaiting") or "") in (
            "category",
            "body",
            "confirm",
            "title",
        ):
            should_resume = (
                semantic_action
                in ("RESUME_WORKFLOW", "CONTINUE_WORKFLOW", "AMBIGUOUS")
                if decision
                else not looks_like_side_quest(text)
            )
            if _skip_foreign("kb"):
                should_resume = False
            if should_resume:
                rest = parked[:-1]
                out = continue_kb_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    kb_draft=d,
                    semantic_decision=decision or None,
                )
                out["parked_drafts"] = rest
                return _finish(out)
        if flow == "macro" and str(d.get("awaiting") or "") in (
            "title",
            "body",
            "confirm",
            "delete_confirm",
        ):
            should_resume = (
                semantic_action
                in ("RESUME_WORKFLOW", "CONTINUE_WORKFLOW", "AMBIGUOUS")
                if decision
                else not looks_like_side_quest(text)
            )
            if _skip_foreign("macro"):
                should_resume = False
            if should_resume:
                rest = parked[:-1]
                out = _continue_macro_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    macro_draft=d,
                    semantic_decision=decision or None,
                )
                out["parked_drafts"] = rest
                return _finish(out)
        if flow == "ticket" and str(d.get("awaiting") or "") in (
            "name",
            "contact",
            "issue",
            "priority",
            "confirm",
            "kb_resolution",
        ):
            should_resume = bool(decision) and semantic_action in (
                "RESUME_WORKFLOW",
                "CONTINUE_WORKFLOW",
            )
            if _skip_foreign("ticket"):
                should_resume = False
            if should_resume:
                rest = parked[:-1]
                out = _continue_ticket_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    ticket_draft=d,
                    semantic_decision=decision or None,
                )
                out["parked_drafts"] = rest
                return _finish(out)
        awaiting_team = str(d.get("awaiting") or "").strip().lower()
        is_create_team = awaiting_team in (
            "name",
            "description",
            "create_members",
            "confirm",
        ) or (awaiting_team == "members" and not str(d.get("id") or "").strip())
        if flow == "team" and is_create_team:
            should_resume = bool(decision) and semantic_action in (
                "RESUME_WORKFLOW",
                "CONTINUE_WORKFLOW",
                "CONFIRM_WORKFLOW",
            )
            if (
                not should_resume
                and semantic_action == "START_ADD_TEAM_MEMBERS"
                and not semantic_team
            ):
                should_resume = True
            if _skip_foreign("team"):
                should_resume = False
            if should_resume:
                rest = parked[:-1]
                out = continue_team_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    team_draft=d,
                    semantic_decision=decision or None,
                )
                out["parked_drafts"] = rest
                return _finish(out)

    def _defer_interrupt(
        *,
        clear_macro: bool = False,
        clear_team: bool = False,
        clear_kb: bool = False,
        clear_escalate: bool = False,
        clear_reassign: bool = False,
        clear_ticket: bool = False,
        clear_customer: bool = False,
        parked_now: list,
    ) -> dict[str, Any]:
        """Park current flow and let commands shim start the interrupting flow."""
        return {
            "handled": False,
            "defer_to_commands": True,
            "reply": "",
            "actions": [],
            "macro_draft": None if clear_macro else mdraft,
            "team_draft": None if clear_team else tdraft,
            "kb_draft": None if clear_kb else kdraft,
            "escalate_draft": None if clear_escalate else (draft if pending else None),
            "reassign_draft": None if clear_reassign else (rdraft if reassign_pending else None),
            "ticket_draft": None if clear_ticket else tixdraft,
            "customer_draft": None if clear_customer else cdraft,
            "parked_drafts": parked_now,
        }

    c_await = str((cdraft or {}).get("awaiting") or "").strip().lower()
    if cdraft and c_await and not _skip_foreign("customer"):
        if decision and semantic_action == "NEW_TASK":
            return _defer_interrupt(clear_customer=True, parked_now=_park_except(set()))
        if _handoff_armed_write(c_await):
            return None
        if decision and semantic_action == "CANCEL_WORKFLOW":
            return _finish(
                continue_customer_draft(
                    "cancel",
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    customer_draft=cdraft,
                    semantic_decision=decision or None,
                    parked_drafts=parked,
                )
            )
        if not decision or semantic_action in (
            "CONTINUE_WORKFLOW",
            "AMBIGUOUS",
            "CONFIRM_WORKFLOW",
            "NORMAL_ROUTE",
        ):
            return _finish(
                continue_customer_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    customer_draft=cdraft,
                    semantic_decision=decision or None,
                    parked_drafts=parked,
                )
            )

    # Active create-ticket draft — semantic cancel/continue/side-quest.
    # Confirm writes belong to tickets specialist bind_tools (not Python POST).
    tix_await = str((tixdraft or {}).get("awaiting") or "").strip().lower()
    if (
        tixdraft
        and tix_await in ("name", "contact", "issue", "priority", "confirm", "kb_resolution")
        and not _is_create_team_draft(tdraft)
        and not _skip_foreign("ticket")
    ):
        if decision and semantic_action == "NEW_TASK":
            from app.workflow_schemas import draft_complete, workflow_id_for_draft

            if tix_await == "confirm" and draft_complete(
                workflow_id_for_draft("ticket_draft", tixdraft), tixdraft
            ):
                # Misrouted ack at confirm — stay armed; do not park/restart create.
                return None
            return _defer_interrupt(clear_ticket=True, parked_now=_park_except(set()))
        # Portal: confirm/kb_resolution stay in continue_* (no staff confirm chip).
        # Staff confirm writes belong to specialist bind_tools.
        if (
            _handoff_armed_write(tix_await)
            and str((tixdraft or {}).get("surface") or "").strip().lower() != "portal"
        ):
            return None
        if decision and semantic_action in (
            "CANCEL_WORKFLOW",
            "CONTINUE_WORKFLOW",
            "CONFIRM_WORKFLOW",
            "AMBIGUOUS",
            "START_CREATE_TICKET",
            "NORMAL_ROUTE",
            "RESUME_WORKFLOW",
        ):
            return _finish(
                _continue_ticket_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    ticket_draft=tixdraft,
                    semantic_decision=decision,
                )
            )
        if (
            decision
            and tix_await in ("name", "contact", "issue", "priority", "kb_resolution")
            and semantic_action not in ("NEW_TASK", "SIDE_QUEST")
        ):
            return _finish(
                _continue_ticket_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    ticket_draft=tixdraft,
                    semantic_decision=decision or None,
                )
            )
        if not decision:
            return _finish(
                {
                    "handled": True,
                    "reply": "",
                    "actions": [],
                    "data": {"serviceError": "WORKFLOW_NLU_UNAVAILABLE"},
                    "ticket_draft": tixdraft,
                    "parked_drafts": parked,
                }
            )

    # Active escalate draft — Workflow Manager owns continue / park / cancel.
    if pending and draft and not _skip_foreign("escalate"):
        if semantic_action == "NEW_TASK":
            parked_now = _park_except(set())
            return _defer_interrupt(clear_escalate=True, parked_now=parked_now)
        # Re-pick / "best agent" at confirm stays in escalate continue — do not
        # hand the turn to the specialist write path (false "I've escalated").
        from app.tasks.chat_commands import _is_auto_pick_phrase

        if awaiting == "confirm" and (
            _is_auto_pick_phrase(text) or semantic_action == "PROVIDE_ASSIGNEE"
        ):
            return _finish(
                continue_escalate_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    escalate_draft=draft,
                    semantic_decision=decision
                    or {
                        "action": "PROVIDE_ASSIGNEE",
                        "entity_name": text,
                        "values": [],
                    },
                )
            )
        if _handoff_armed_write(awaiting):
            return None
        if decision and semantic_action in (
            "CONTINUE_WORKFLOW",
            "PROVIDE_TICKET",
            "PROVIDE_ASSIGNEE",
            "START_ESCALATE",
            "CANCEL_WORKFLOW",
            "AMBIGUOUS",
        ):
            return _finish(
                continue_escalate_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    escalate_draft=draft,
                    semantic_decision=decision,
                )
            )
        if not decision:
            if looks_like_side_quest(text):
                return _defer_side_quest()
            return _finish(
                continue_escalate_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    escalate_draft=draft,
                    semantic_decision=None,
                )
            )

    # Active reassign draft — agent vs resolver assignment with confirm.
    if reassign_pending and rdraft and not _skip_foreign("reassign"):
        if semantic_action == "NEW_TASK":
            parked_now = _park_except(set())
            return _defer_interrupt(clear_reassign=True, parked_now=parked_now)
        # Confirm handoff is for write tools. Bare "agent"/"resolver" switches the
        # assignment column and must list the roster — not invent two ticket people.
        from app.tasks.chat_commands import utterance_is_reassign_role_column

        role_column_switch = bool(utterance_is_reassign_role_column(text))
        if _handoff_armed_write(reassign_awaiting) and not role_column_switch:
            return None
        if decision and semantic_action in (
            "CONTINUE_WORKFLOW",
            "PROVIDE_TICKET",
            "PROVIDE_ASSIGNEE",
            "START_REASSIGN",
            "CONFIRM_WORKFLOW",
            "CANCEL_WORKFLOW",
            "AMBIGUOUS",
        ):
            return _finish(
                continue_reassign_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    reassign_draft=rdraft,
                    semantic_decision=decision,
                    session_history=session_history,
                    last_entity=prior_le,
                )
            )
        if not decision:
            if looks_like_side_quest(text):
                return _defer_side_quest()
            return _finish(
                continue_reassign_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    reassign_draft=rdraft,
                    semantic_decision=None,
                    session_history=session_history,
                    last_entity=prior_le,
                )
            )

    m_await = str((mdraft or {}).get("awaiting") or "").strip().lower()
    if mdraft and m_await in ("title", "body", "confirm", "delete_confirm") and not _skip_foreign(
        "macro"
    ):

        def _macro_continue(msg: str) -> dict[str, Any]:
            if m_await == "delete_confirm":
                return start_or_continue_delete_macro(
                    msg,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    macro_draft=mdraft,
                    semantic_decision=decision or None,
                ) or {"handled": False, "reply": "", "actions": []}
            return _continue_macro_draft(
                msg,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                macro_draft=mdraft,
                semantic_decision=decision or None,
            )

        if decision and semantic_action == "NEW_TASK":
            return _defer_interrupt(clear_macro=True, parked_now=_park_except(set()))
        if _handoff_armed_write(m_await):
            return None
        if decision and semantic_action == "CANCEL_WORKFLOW":
            return _finish(_macro_continue("cancel"))
        if decision and semantic_action in (
            "CONTINUE_WORKFLOW",
            "AMBIGUOUS",
            "CONFIRM_WORKFLOW",
        ):
            return _finish(_macro_continue(text))
        if not decision and looks_like_side_quest(text):
            return _defer_side_quest()
        if not decision:
            return _finish(_macro_continue(text))

    t_await = str((tdraft or {}).get("awaiting") or "").strip().lower()
    if tdraft and t_await in (
        "name",
        "description",
        "create_members",
        "confirm",
        "delete_confirm",
        "members",
        "members_names",
        "members_team",
        "remove_members",
        "remove_names",
        "remove_team",
        "edit_name",
        "edit_description",
        "edit_team",
    ) and not _skip_foreign("team"):
        if semantic_action == "NEW_TASK":
            parked_now = _park_except(set())
            return _defer_interrupt(clear_team=True, parked_now=parked_now)
        if semantic_action == "CANCEL_WORKFLOW" and t_await in (
            "members",
            "members_names",
            "members_team",
        ):
            return _finish(
                _continue_add_team_members(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    team_draft=tdraft,
                    semantic_decision=decision,
                )
            )
        if decision and t_await in (
            "name",
            "description",
            "create_members",
            "confirm",
            "delete_confirm",
        ):
            if _handoff_armed_write(t_await):
                return None
            if semantic_action in (
                "CONTINUE_WORKFLOW",
                "CONFIRM_WORKFLOW",
                "PROVIDE_TEAM",
                "AMBIGUOUS",
                "NORMAL_ROUTE",
                "START_CREATE_TEAM",
                "START_CREATE_TICKET",
            ):
                return _finish(
                    continue_team_draft(
                        text,
                        org=org,
                        role=role or "agent",
                        user_id=user_id,
                        user_name=user_name,
                        page=page,
                        team_draft=tdraft,
                        semantic_decision=decision or None,
                    )
                )
            if semantic_action == "CANCEL_WORKFLOW":
                return _finish(
                    continue_team_draft(
                        "cancel",
                        org=org,
                        role=role or "agent",
                        user_id=user_id,
                        user_name=user_name,
                        page=page,
                        team_draft=tdraft,
                        semantic_decision=decision or None,
                    )
                )
        if t_await in ("members", "members_names", "members_team") and decision:
            if semantic_action in (
                "CONTINUE_WORKFLOW",
                "PROVIDE_TEAM",
                "PROVIDE_MEMBERS",
                "START_ADD_TEAM_MEMBERS",
                "AMBIGUOUS",
            ):
                return _finish(
                    _continue_add_team_members(
                        text,
                        org=org,
                        role=role or "agent",
                        user_id=user_id,
                        user_name=user_name,
                        page=page,
                        team_draft=tdraft,
                        semantic_decision=decision,
                    )
                )
        elif not decision and looks_like_side_quest(text) and t_await not in (
            "delete_confirm",
            "members",
            "members_names",
            "members_team",
            "create_members",
        ):
            return _defer_side_quest()
        elif not decision:
            return _finish(
                continue_team_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    team_draft=tdraft,
                    semantic_decision=decision or None,
                )
            )

    k_await = str((kdraft or {}).get("awaiting") or "").strip().lower()
    from app.tasks.catalog_commands import _is_manage_category_draft

    if (
        kdraft
        and (
            k_await in ("title", "category", "body", "confirm", "manage_mode", "category_name")
            or _is_manage_category_draft(kdraft)
        )
        and not _skip_foreign("kb")
    ):
        if decision and semantic_action == "NEW_TASK":
            if _is_manage_category_draft(kdraft):
                return _finish(
                    continue_kb_draft(
                        text,
                        org=org,
                        role=role or "agent",
                        user_id=user_id,
                        user_name=user_name,
                        page=page,
                        kb_draft=kdraft,
                        semantic_decision={
                            **(decision or {}),
                            "action": "CONTINUE_WORKFLOW",
                            "operation": "NONE",
                            "agent": "kb",
                            "workflow": "manage_kb_category",
                        },
                    )
                )
            return _defer_interrupt(clear_kb=True, parked_now=_park_except(set()))
        if _handoff_armed_write(k_await):
            return None
        if decision and semantic_action == "CANCEL_WORKFLOW":
            return _finish(
                continue_kb_draft(
                    "cancel",
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    kb_draft=kdraft,
                    semantic_decision=decision or None,
                )
            )
        if decision and semantic_action in (
            "CONTINUE_WORKFLOW",
            "AMBIGUOUS",
            "CONFIRM_WORKFLOW",
        ):
            return _finish(
                continue_kb_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    kb_draft=kdraft,
                    semantic_decision=decision or None,
                )
            )
        # Locked manage-category: foreign START_* must not escape the draft.
        if (
            _is_manage_category_draft(kdraft)
            and decision
            and semantic_action
            in {
                "START_CREATE_KB",
                "START_CREATE_PRIORITY",
                "START_CREATE_STATUS",
                "START_CREATE_MACRO",
                "START_CREATE_TICKET",
                "START_CREATE_CUSTOMER",
                "START_CREATE_TEAM",
            }
        ):
            return _finish(
                continue_kb_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    kb_draft=kdraft,
                    semantic_decision={
                        **(decision or {}),
                        "action": "CONTINUE_WORKFLOW",
                        "operation": "NONE",
                        "agent": "kb",
                        "workflow": "manage_kb_category",
                    },
                )
            )
        if not decision and looks_like_side_quest(text):
            return _defer_side_quest()
        if not decision:
            return _finish(
                continue_kb_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    kb_draft=kdraft,
                    semantic_decision=decision or None,
                )
            )

    p_await = str((pdraft or {}).get("awaiting") or "").strip().lower()
    if pdraft and p_await and not _skip_foreign("priority"):
        if decision and semantic_action == "NEW_TASK":
            return {
                "handled": False,
                "defer_to_commands": True,
                "reply": "",
                "actions": [],
                "macro_draft": mdraft,
                "team_draft": tdraft,
                "kb_draft": kdraft,
                "ticket_draft": tixdraft,
                "priority_draft": None,
                "customer_draft": cdraft,
                "escalate_draft": draft if pending else None,
                "parked_drafts": _park_except(set()),
            }
        if _handoff_armed_write(p_await):
            return None
        if decision and semantic_action == "CANCEL_WORKFLOW":
            return _finish(
                continue_priority_draft(
                    "cancel",
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    priority_draft=pdraft,
                    semantic_decision=decision or None,
                )
            )
        if not decision or semantic_action in (
            "CONTINUE_WORKFLOW",
            "AMBIGUOUS",
            "CONFIRM_WORKFLOW",
        ):
            return _finish(
                continue_priority_draft(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    priority_draft=pdraft,
                    semantic_decision=decision or None,
                )
            )

    # Semantic follow-up attaches to the last real team; no phrase/typo matching.
    le = prior_le
    if (
        le
        and le.get("type") == ENTITY_TEAM
        and semantic_action
        in (
            "START_ADD_TEAM_MEMBERS",
            "CONTINUE_WORKFLOW",
            "PROVIDE_MEMBERS",
        )
        and not _is_create_team_draft(tdraft)
        and _parked_create_team() is None
    ):
        if semantic_action:
            seed = {
                "awaiting": "members_names"
                if semantic_action == "PROVIDE_MEMBERS"
                else "members",
                "name": str(le.get("name") or ""),
                "id": str(le.get("id") or ""),
            }
            hit = start_or_continue_add_team_members(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                team_draft=seed,
                intent_confirmed=True,
                resolved_team_name=semantic_team or str(le.get("name") or ""),
                resolved_member_names=semantic_values,
            )
            if hit and hit.get("handled"):
                return _finish(hit)

    return None


_TICKET_QUERY_OPS = TICKET_OPERATIONS - {"NONE", "CREATE_TICKET"}
_TEAM_QUERY_OPS = TEAM_OPERATIONS - {"CREATE_TEAM"}
_KB_QUERY_OPS = KB_OPERATIONS - {"CREATE_KB"}
_CUSTOMER_QUERY_OPS = CUSTOMER_OPERATIONS - {"CREATE_CUSTOMER"}
_MACRO_QUERY_OPS = MACRO_OPERATIONS - {"CREATE_MACRO"}
_ADMIN_QUERY_OPS = ADMIN_OPERATIONS - {"CREATE_PRIORITY", "CREATE_STATUS"}
_MODULE_QUERY_OPS = (
    _TICKET_QUERY_OPS
    | _TEAM_QUERY_OPS
    | _KB_QUERY_OPS
    | _CUSTOMER_QUERY_OPS
    | _MACRO_QUERY_OPS
    | _ADMIN_QUERY_OPS
)
_DESTRUCTIVE_STATUSES = frozenset({"resolved", "closed"})
_AUTO_ASSIGN_TOKENS = frozenset({"auto", "automatic", "auto-assign", "auto_assign"})
_COUNT_UTTERANCE_RE = re.compile(r"\b(how\s+many|count|number of|total)\b", re.I)
_LIST_UTTERANCE_RE = re.compile(r"\b(show|list|display|pull up)\b", re.I)


def _tool_payload(result: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {}
    payload = result.get("payload")
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict):
            return data
        return payload
    return {}


def _ticket_number_from_request(
    request: dict[str, Any],
    *,
    last_entity: dict[str, Any] | None = None,
    pending: dict[str, Any] | None = None,
) -> str:
    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    filters = request.get("filters") if isinstance(request.get("filters"), dict) else {}
    candidates = [
        (pending or {}).get("ticket_number"),
        fields.get("ticket_number"),
        filters.get("query"),
        request.get("entity_name"),
        *((request.get("values") or []) if isinstance(request.get("values"), list) else []),
        (last_entity or {}).get("name")
        if str((last_entity or {}).get("type") or "").lower() == "ticket"
        else None,
        (last_entity or {}).get("id")
        if str((last_entity or {}).get("type") or "").lower() == "ticket"
        else None,
    ]
    for raw in candidates:
        text = str(raw or "").strip()
        match = re.search(r"#?\d{1,8}\b", text)
        if match:
            token = match.group(0)
            return token if token.startswith("#") else f"#{token.lstrip('#')}"
    return ""


def _count_only_utterance(text: str) -> bool:
    raw = text or ""
    return bool(_COUNT_UTTERANCE_RE.search(raw)) and not bool(_LIST_UTTERANCE_RE.search(raw))


def _ticket_view_for_page(page: str | None) -> str | None:
    page_l = str(page or "").lower()
    if any(token in page_l for token in ("team inbox", "team-inbox")):
        return "team-inbox"
    if "unassigned" in page_l:
        return "unassigned"
    if any(token in page_l for token in ("team-queue", "all tickets")):
        return "team-queue"
    if any(token in page_l for token in ("assigned", "my tickets")):
        return "assigned"
    if any(token in page_l for token in ("home", "dashboard", "overview")):
        return "dashboard"
    return None


def _apply_execute_page_scope(page: str | None, filters: dict[str, Any]) -> dict[str, Any]:
    if filters.get("scope") or filters.get("assigned_to"):
        return filters
    page_l = str(page or "").lower()
    if any(token in page_l for token in ("home", "dashboard", "overview")):
        return filters
    out = dict(filters)
    if any(token in page_l for token in ("team inbox", "team-inbox")):
        out["scope"] = "team"
    elif "unassigned" in page_l:
        out["scope"] = "unassigned"
    elif any(token in page_l for token in ("team-queue", "all tickets", "tickets-list")):
        out["scope"] = "org"
    return out


def _stay_ticket_navigate(page: str | None, list_scope: str | None, fallback: str) -> str:
    current = _ticket_view_for_page(page)
    if list_scope == "team" and current == "team-inbox":
        return "team-inbox"
    if list_scope == "unassigned" and current == "unassigned":
        return "unassigned"
    if list_scope == "org" and current == "team-queue":
        return "team-queue"
    if list_scope == "assignee" and current == "assigned":
        return "assigned"
    return fallback


def _catalog_rows(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in (
            "data",
            "queues",
            "teams",
            "items",
            "rows",
            "customers",
            "articles",
            "kb",
            "macros",
            "priorities",
            "statuses",
            "events",
            "widgets",
            "keys",
        ):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
        if any(payload.get(k) for k in ("id", "queueName", "name", "title", "email")):
            return [payload]
    return []


def _row_label(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def _row_member_names(row: dict[str, Any] | None) -> list[str]:
    if not isinstance(row, dict):
        return []
    raw = row.get("members")
    if not isinstance(raw, list):
        raw = row.get("memberNames")
    if not isinstance(raw, list):
        raw = row.get("memberDetails")
    names: list[str] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        label = ""
        if isinstance(item, str):
            label = item.strip()
        elif isinstance(item, dict):
            label = str(item.get("name") or "").strip()
        key = label.lower()
        if label and key not in seen:
            seen.add(key)
            names.append(label)
    return names


def _compact_team_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _row_label(row, "queueName", "name"),
        "openTickets": int(row.get("openTickets") or 0),
        "members": _row_member_names(row),
        "description": str(row.get("description") or "").strip(),
    }


def _offered_staff_from_state(state: dict[str, Any] | None) -> list[str]:
    src = state if isinstance(state, dict) else {}
    drafts: list[dict[str, Any]] = []
    td = src.get("team_draft")
    if isinstance(td, dict):
        drafts.append(td)
    for item in src.get("parked_drafts") or []:
        if not isinstance(item, dict) or str(item.get("flow") or "").strip().lower() != "team":
            continue
        draft = item.get("draft")
        if isinstance(draft, dict):
            drafts.append(draft)
    names: list[str] = []
    seen: set[str] = set()
    for draft in drafts:
        roster = draft.get("available_members")
        if not isinstance(roster, list) or not roster:
            roster = draft.get("members")
        for raw in roster if isinstance(roster, list) else []:
            label = str(raw).strip() if not isinstance(raw, dict) else str(raw.get("name") or "").strip()
            key = label.lower()
            if label and key not in seen:
                seen.add(key)
                names.append(label)
    return names


def _people_from_team_request(request: dict[str, Any] | None) -> list[str]:
    req = request if isinstance(request, dict) else {}
    fields = req.get("fields") if isinstance(req.get("fields"), dict) else {}
    names: list[str] = []
    seen: set[str] = set()
    members = fields.get("members") if isinstance(fields.get("members"), list) else []
    for raw in [*members, *(req.get("values") or [])]:
        label = str(raw).strip()
        key = label.lower()
        if label and key not in seen:
            seen.add(key)
            names.append(label)
    return names


def _membership_for_people(
    rows: list[dict[str, Any]], people: list[str]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for person in people:
        needle = person.strip().lower()
        if not needle:
            continue
        teams: list[str] = []
        for row in rows:
            members = _row_member_names(row)
            if any(needle == m.lower() or needle in m.lower() or m.lower() in needle for m in members):
                label = _row_label(row, "queueName", "name")
                if label:
                    teams.append(label)
        out.append({"person": person, "teams": teams})
    return out


def _row_by_id(rows: list[dict[str, Any]], eid: str) -> dict[str, Any] | None:
    want = str(eid or "").strip()
    if not want:
        return None
    for row in rows:
        if str(row.get("id") or row.get("externalId") or "").strip() == want:
            return row
    return None


def _match_named_rows(
    rows: list[dict[str, Any]], needle: str, *keys: str
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    query = (needle or "").strip().lower()
    if not query:
        return None, []
    exact = [row for row in rows if _row_label(row, *keys).lower() == query]
    if len(exact) == 1:
        return exact[0], []
    if len(exact) > 1:
        return None, exact
    partial = [row for row in rows if query in _row_label(row, *keys).lower()]
    if len(partial) == 1:
        return partial[0], []
    if len(partial) > 1:
        return None, partial
    return None, []


def _chart_range_from_filters(filters: dict[str, Any]) -> str:
    created = str(filters.get("created_range") or filters.get("updated_range") or "").lower()
    if created in {"today", "last_24h", "yesterday"}:
        return "24hours"
    if created in {"this_month", "last_month", "last_30d"}:
        return "30days"
    return "7days"


def _created_today_asked(text: str) -> bool:
    lower = (text or "").lower()
    return bool(
        re.search(
            r"\b(created|filed|raised)\b.{0,24}\btoday\b|\btoday\b.{0,16}\b(created|filed|raised)\b",
            lower,
        )
    )


def _metrics_facts_block(
    *,
    open_n: Any,
    overdue_n: Any,
    due_n: Any,
    created_n: Any,
    ask_created_today: bool,
    ask_overdue: bool,
    ask_open: bool,
) -> str:
    """Live KPI bullets from Express — survive an empty LLM intro."""
    def _num(value: Any) -> str | None:
        if value is None or value == "":
            return None
        return str(value)

    created = _num(created_n)
    overdue = _num(overdue_n)
    opened = _num(open_n)
    due = _num(due_n)
    lines: list[str] = []
    if ask_created_today and created is not None:
        lines.append(f"* **Created today:** {created}")
    elif ask_overdue and overdue is not None:
        lines.append(f"* **Overdue:** {overdue}")
    elif ask_open and opened is not None:
        lines.append(f"* **Open:** {opened}")
    else:
        if opened is not None:
            lines.append(f"* **Open:** {opened}")
        if overdue is not None:
            lines.append(f"* **Overdue:** {overdue}")
        if due is not None:
            lines.append(f"* **Due today:** {due}")
        if created is not None:
            lines.append(f"* **Created today:** {created}")
    return "\n".join(lines)


def _infer_created_range(text: str, filters: dict[str, Any]) -> dict[str, Any]:
    out = dict(filters)
    if str(out.get("created_range") or "").strip():
        return out
    if _created_today_asked(text):
        out["created_range"] = "today"
    return out


def _execute_ticket_metrics(
    state: AgentState,
    text: str,
    request: dict[str, Any],
    *,
    operation: str,
    actor: Any,
    parked_result: dict[str, Any] | None,
    on_home: bool,
    fail,
) -> dict[str, Any]:
    from app.tasks.chat_commands import (
        _compose_intro_and_list,
        _format_ticket_list_details,
        _llm_phrase,
        _tickets_from_tool_result,
    )
    from app.tools.catalog_tools import (
        get_dashboard_chart,
        get_metrics,
        get_triage_stats,
        list_activities,
        list_queues,
    )
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_read import list_tickets

    filters = dict(request.get("filters") or {})
    filters = _infer_created_range(text, filters)
    request["filters"] = filters
    filters = _apply_execute_page_scope(state.get("page"), filters)
    topic = str(filters.get("topic") or "").strip().lower()
    scope_f = str(filters.get("scope") or "").strip().lower()
    org_id = str(state.get("organization_id") or "") or None
    session_id = str(state.get("session_id") or "") or None
    from app.tools.insights_routing import (
        classify_insights_question,
        log_insights_routing,
        semantic_result_usable,
        try_ontology_narrative,
        try_semantic_metrics,
    )

    insights_kind = classify_insights_question(text)
    semantic_result = None
    ontology_result = None

    if insights_kind in ("why", "both"):
        with tool_actor_scope(actor):
            ontology_result = try_ontology_narrative(
                text,
                organization_id=org_id,
                session_id=session_id,
            )
        log_insights_routing(
            kind=insights_kind,
            tool="ask_knowledge_graph",
            success=bool(ontology_result and ontology_result.get("success")),
            user_text=text,
            organization_id=org_id,
        )

    if insights_kind in ("values", "both") or operation in {
        "GET_METRICS",
        "COMPARE",
        "RECOMMEND",
    }:
        scope_hint = scope_f or (
            "self"
            if str(filters.get("assigned_to") or "").upper() == "SELF"
            else None
        )
        with tool_actor_scope(actor):
            semantic_result = try_semantic_metrics(
                text,
                organization_id=org_id,
                scope_hint=scope_hint,
            )
        log_insights_routing(
            kind=insights_kind,
            tool="ask_semantic_layer",
            success=semantic_result_usable(semantic_result),
            fallback=None
            if semantic_result_usable(semantic_result)
            else "express",
            user_text=text,
            organization_id=org_id,
        )

    sem_ok = semantic_result_usable(semantic_result)
    ont_ok = bool(ontology_result and ontology_result.get("success"))
    if sem_ok or ont_ok:
        if insights_kind == "why" and ont_ok and not sem_ok:
            primary_tool = "ask_knowledge_graph"
            phrase_context: dict[str, Any] = {
                "ontology": ontology_result.get("payload"),
                "operation": operation,
            }
            phrase_fallback = (
                "Explain using only the ontology narrative. "
                "Do not invent exact KPI numbers."
            )
        elif insights_kind == "both" and sem_ok and ont_ok:
            primary_tool = "ask_semantic_layer+ask_knowledge_graph"
            phrase_context = {
                "semanticMetrics": semantic_result.get("payload"),
                "ontology": ontology_result.get("payload"),
                "operation": operation,
            }
            phrase_fallback = (
                "Cite metric values from semantic JSON; explain why from "
                "ontology narrative only."
            )
        elif sem_ok:
            primary_tool = "ask_semantic_layer"
            phrase_context = {
                "semanticMetrics": semantic_result.get("payload"),
                "operation": operation,
            }
            phrase_fallback = (
                "Answer using only the semantic metrics JSON. Cite real numbers. "
                "Never invent KPIs."
            )
        else:
            primary_tool = "ask_knowledge_graph"
            phrase_context = {
                "ontology": ontology_result.get("payload"),
                "operation": operation,
            }
            phrase_fallback = (
                "Explain using only the ontology narrative. "
                "Do not invent exact KPI numbers."
            )
        reply = _llm_phrase(
            module="ticket",
            kind="filter",
            fallback=phrase_fallback,
            user_text=text,
            page_label=state.get("page") or "Dashboard",
            context=phrase_context,
        )
        navigate = (
            "dashboard"
            if on_home or operation in {"GET_METRICS", "COMPARE"}
            else "tickets-list"
        )
        data_out: dict[str, Any] = {
            "last_query": {
                "entity": "tickets",
                "operation": operation,
                "filters": filters,
            },
            "success": True,
            "_tool_name": primary_tool,
        }
        if sem_ok:
            data_out["semantic"] = semantic_result.get("payload")
        if ont_ok:
            data_out["ontology"] = ontology_result.get("payload")
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": navigate}],
            "route": "tickets",
            "semantic_request": request,
            "data": data_out,
        }

    if operation == "GET_METRICS" and scope_f in {"team", "unassigned"}:
        from app.tasks.chat_commands import _llm_phrase
        from app.tools.express_client import tool_actor_scope
        from app.tools.ticket_read import list_tickets

        with tool_actor_scope(actor):
            scoped = list_tickets(
                limit=100,
                scope=scope_f,
                status=filters.get("status"),
                priority=filters.get("priority"),
                channel=filters.get("channel"),
                query=str(filters.get("query") or "").strip() or None,
                queue=filters.get("queue"),
                due=filters.get("due"),
                created_range=filters.get("created_range"),
                updated_range=filters.get("updated_range"),
            )
        if not scoped.get("success"):
            return fail(scoped)
        rows = _tickets_from_tool_result(scoped)
        view = _stay_ticket_navigate(
            state.get("page"),
            scope_f,
            "team-inbox" if scope_f == "team" else "unassigned",
        )
        reply = _llm_phrase(
            module="ticket",
            kind="filter",
            fallback="Report Context.totalCount for this page scope. Do not list ticket rows.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={
                "totalCount": len(rows),
                "listCount": 0,
                "scopeLabel": "your teams" if scope_f == "team" else "unassigned",
                "filters": filters,
                "metricsOnly": True,
            },
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": view}],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "ticketCount": len(rows),
                "last_query": {"entity": "tickets", "operation": "GET_METRICS", "filters": filters},
                "success": True,
                "_tool_name": "list_tickets",
            },
        }

    # Express fallback when semantic layer is unavailable or returned no match.
    chart_range = _chart_range_from_filters(filters)
    metrics: dict[str, Any] = {}
    triage: dict[str, Any] = {}
    chart: dict[str, Any] = {}
    queues: list[Any] = []
    activities: list[Any] = []
    rec_rows: list[dict[str, Any]] = []
    with tool_actor_scope(actor):
        if topic == "activity":
            act_res = list_activities()
            if not act_res.get("success"):
                return fail(act_res)
            payload = act_res.get("payload")
            if isinstance(payload, list):
                activities = [r for r in payload if isinstance(r, dict)]
            elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
                activities = [r for r in payload["data"] if isinstance(r, dict)]
        else:
            assigned_self = str(filters.get("assigned_to") or "").upper() == "SELF"
            scope_f = str(filters.get("scope") or "").strip().lower()
            metric_scope = (
                "self"
                if assigned_self or scope_f in {"self", "assignee"}
                else "org"
                if scope_f == "org"
                else None
            )
            met_res = get_metrics(scope=metric_scope) if metric_scope else get_metrics()
            if not met_res.get("success"):
                return fail(met_res)
            metrics = _tool_payload(met_res)
            if topic in {"", "overview", "created", "reassigned", "pressure"} or operation in {
                "COMPARE",
                "RECOMMEND",
            }:
                tri_res = get_triage_stats()
                if tri_res.get("success"):
                    triage = _tool_payload(tri_res)
            if operation == "COMPARE" or topic == "workload":
                chart_res = get_dashboard_chart(chart_range=chart_range)
                if chart_res.get("success"):
                    chart = _tool_payload(chart_res)
            if topic in {"queues", "pressure"} or (
                operation == "GET_METRICS" and not topic
            ):
                q_res = list_queues()
                if q_res.get("success"):
                    q_payload = q_res.get("payload")
                    if isinstance(q_payload, list):
                        queues = q_payload
                    elif isinstance(q_payload, dict) and isinstance(q_payload.get("data"), list):
                        queues = q_payload["data"]
            if operation == "RECOMMEND":
                seen: set[str] = set()
                for kwargs in (
                    {"limit": 8, "due": "overdue", "sort": "due"},
                    {"limit": 8, "due": "today", "sort": "priority"},
                    {"limit": 8, "priority": "urgent", "sort": "priority"},
                ):
                    rec_res = list_tickets(**kwargs)
                    if not rec_res.get("success"):
                        continue
                    for row in _tickets_from_tool_result(rec_res):
                        key = str(
                            row.get("id")
                            or row.get("ticketNumber")
                            or row.get("ticket_number")
                            or ""
                        )
                        if key and key in seen:
                            continue
                        if key:
                            seen.add(key)
                        rec_rows.append(row)
                        if len(rec_rows) >= 8:
                            break
                    if len(rec_rows) >= 8:
                        break

    if topic == "activity":
        lines: list[str] = []
        for row in activities[:8]:
            title = str(
                row.get("text") or row.get("title") or row.get("message") or row.get("action") or ""
            ).strip()
            if not title:
                continue
            when = str(row.get("time") or row.get("createdAt") or "").strip()
            lines.append(f"* {title}" + (f" — _{when}_" if when else ""))
        summary = "\n".join(lines) if lines else "(no recent activity yet)"
        intro = _llm_phrase(
            module="ticket",
            kind="filter",
            fallback="Report live recent activity without inventing rows.",
            user_text=text,
            page_label=state.get("page") or "Home",
            context={
                "listCount": len(activities),
                "listSummary": summary,
                "metric": "recentActivity",
                "empty": not activities,
            },
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _compose_intro_and_list(intro, summary),
            "actions": [{"type": "navigate", "view": "dashboard"}],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "activities": activities[:8],
                "last_query": {"entity": "tickets", "operation": operation, "filters": filters},
                "success": True,
                "_tool_name": "list_activities",
            },
        }

    rec_summary = _format_ticket_list_details(rec_rows, limit=5) if rec_rows else ""
    change_open = str(metrics.get("openChange") or metrics.get("open_change") or "—")
    trend_available = change_open not in {"", "—", "-"}
    overdue_n = metrics.get("overdue")
    if overdue_n is None:
        overdue_n = metrics.get("overdueTickets")
    open_n = metrics.get("openTickets") or metrics.get("open_tickets")
    due_n = metrics.get("dueToday") or metrics.get("due_today")
    created_n = metrics.get("createdToday")
    if created_n is None:
        created_n = metrics.get("created_today")
    created_rng = str(filters.get("created_range") or "").strip().lower()
    ask_created_today = created_rng in {"today", "last_24h"} or _created_today_asked(text)
    role_l = str(state.get("user_role") or "").strip().lower()
    scope_f = str(filters.get("scope") or "").strip().lower()
    assigned_self = str(filters.get("assigned_to") or "").upper() == "SELF"
    ask_overdue = (
        str(filters.get("due") or "").lower() == "overdue"
        or "overdue" in text.lower()
    )
    ask_open = str(filters.get("status") or "").lower() == "open" or (
        "open" in text.lower() and "overdue" not in text.lower() and not ask_created_today
    )
    if assigned_self or scope_f in {"self", "assignee"}:
        scope_label = "assigned to you"
    elif scope_f == "org":
        scope_label = (
            "organization"
            if role_l in {"admin", "viewer"}
            else "assigned to you"
        )
    elif scope_f == "team":
        scope_label = "your teams"
    else:
        scope_label = (
            "organization"
            if role_l in {"admin", "viewer"}
            else "assigned to you"
        )
    intro = _llm_phrase(
        module="ticket",
        kind="filter" if operation != "RECOMMEND" else "start",
        fallback=(
            "Report live dashboard/ticket numbers from tool JSON only; "
            "never invent counts. If trend fields are em dash, say trend is unavailable. "
            "Do not say tickets are only yours unless scopeLabel is assigned to you. "
            "If they asked tickets created/filed today, report Context.createdToday only — "
            "that is not dueToday. If they asked overdue, report Context.overdue only. "
            "If they asked open, report Context.openTickets only. "
            "Do not list ticket ids or ask which ticket."
        ),
        user_text=text,
        page_label=state.get("page") or ("Home" if on_home else "Tickets"),
        context={
            "metrics": metrics,
            "overdue": overdue_n,
            "openTickets": open_n,
            "dueToday": due_n,
            "createdToday": created_n,
            "askCreatedToday": ask_created_today,
            "totalCount": (
                created_n
                if ask_created_today
                else overdue_n
                if ask_overdue
                else due_n
                if str(filters.get("due") or "").lower() == "today"
                else open_n
            ),
            "askOverdue": ask_overdue,
            "askOpen": ask_open,
            "scopeLabel": scope_label,
            "triage": triage,
            "chartTotals": chart.get("totals") if isinstance(chart.get("totals"), dict) else {},
            "queueCount": len(queues),
            "trendAvailable": trend_available,
            "recommendSummary": rec_summary or None,
            "operation": operation,
            "topic": "created" if ask_created_today else (topic or "overview"),
            "listCount": len(rec_rows),
            "chatUnavailable": False,
        },
    )
    facts = _metrics_facts_block(
        open_n=open_n,
        overdue_n=overdue_n,
        due_n=due_n,
        created_n=created_n,
        ask_created_today=ask_created_today,
        ask_overdue=ask_overdue,
        ask_open=ask_open,
    )
    reply = _compose_intro_and_list(intro, facts)
    if rec_summary:
        reply = _compose_intro_and_list(reply, rec_summary)
    navigate = "dashboard" if on_home or operation in {"GET_METRICS", "COMPARE"} else "tickets-list"
    if operation == "RECOMMEND" and rec_rows and not on_home:
        navigate = "tickets-list"
    last_query = {"entity": "tickets", "operation": operation, "filters": filters}
    return {
        **(parked_result or {}),
        "handled": True,
        "workflow_handled": True,
        "reply": reply,
        "actions": [{"type": "navigate", "view": navigate}],
        "route": "tickets",
        "semantic_request": request,
        "data": {
            "metrics": metrics,
            "triage": triage,
            "chart": chart,
            "tickets": rec_rows[:8],
            "last_query": last_query,
            "success": True,
            "_tool_name": "get_metrics",
        },
    }


def _execute_ticket_detail(
    state: AgentState,
    text: str,
    request: dict[str, Any],
    *,
    operation: str,
    actor: Any,
    parked_result: dict[str, Any] | None,
    fail,
) -> dict[str, Any]:
    from app.tasks.chat_commands import _llm_phrase
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_read import get_ticket, get_ticket_progress

    tn = _ticket_number_from_request(
        request,
        last_entity=request.get("resolved_entity")
        or last_entity_from_state(dict(state)),
    )
    if not tn:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask which ticket number to look up.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={"nextStep": "ticket number"},
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": "tickets-list"}],
            "route": "tickets",
            "semantic_request": request,
        }
    with tool_actor_scope(actor):
        ticket_res = get_ticket(tn)
        if not ticket_res.get("success"):
            return fail(ticket_res)
        progress_res = None
        if operation == "GET_HISTORY":
            progress_res = get_ticket_progress(tn)
            if not progress_res.get("success"):
                return fail(progress_res)
    ticket = _tool_payload(ticket_res)
    progress = _tool_payload(progress_res) if progress_res else {}
    intro = _llm_phrase(
        module="ticket",
        kind="filter",
        fallback="Summarize this ticket using only tool JSON fields; do not invent history.",
        user_text=text,
        page_label=state.get("page") or "Tickets",
        context={
            "ticket": ticket,
            "progress": progress,
            "ticketNumber": tn,
            "history": operation == "GET_HISTORY",
        },
    )
    return {
        **(parked_result or {}),
        "handled": True,
        "workflow_handled": True,
        "reply": intro,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "set_filter", "module": "tickets", "query": tn},
        ],
        "route": "tickets",
        "semantic_request": request,
        "last_entity": {"type": "ticket", "id": "", "name": tn.lstrip("#")},
        "data": {
            "ticket": ticket,
            "progress": progress,
            "last_query": {
                "entity": "tickets",
                "operation": operation,
                "filters": {"query": tn},
            },
            "success": True,
            "_tool_name": "get_ticket_progress" if operation == "GET_HISTORY" else "get_ticket",
            "payload": ticket,
        },
    }


def _execute_ticket_update(
    state: AgentState,
    text: str,
    request: dict[str, Any],
    *,
    actor: Any,
    parked_result: dict[str, Any] | None,
    pending_update: dict[str, Any] | None,
    confirm: bool,
    cancel: bool = False,
    fail,
    prior_query: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.agents.workflow_nlu import PRIORITY_CANONICAL, TICKET_PRIORITIES, TICKET_STATUSES
    from app.tasks.chat_commands import (
        _format_ticket_list_details,
        _llm_phrase,
        _tickets_from_tool_result,
    )
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_read import list_tickets
    from app.tools.ticket_write import (
        add_ticket_note,
        auto_assign_ticket,
        update_ticket,
    )

    from app.workflow_state import last_entity_from_state

    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    filters = dict(request.get("filters") or {})
    patch = dict(pending_update or {})
    view = _ticket_view_for_page(state.get("page")) or "tickets-list"
    tn = _ticket_number_from_request(
        request, last_entity=last_entity_from_state(dict(state)), pending=patch
    )
    for key in ("status", "priority", "assignee", "queue", "note", "subject"):
        value = fields.get(key)
        if value not in (None, ""):
            patch[key] = value
    if fields.get("body") and not patch.get("note"):
        patch["note"] = fields.get("body")
    status_raw = str(patch.get("status") or "").strip()
    if status_raw:
        patch["status"] = TICKET_STATUSES.get(status_raw.lower(), status_raw)
    pri_raw = str(patch.get("priority") or "").strip().lower()
    if pri_raw in TICKET_PRIORITIES:
        patch["priority"] = PRIORITY_CANONICAL.get(pri_raw, pri_raw)
    proposed = str(request.get("proposed_tool") or "").strip().lower()
    assignee_l = str(patch.get("assignee") or "").strip().lower().replace(" ", "_")
    auto_assign = proposed == "auto_assign_ticket" or assignee_l in _AUTO_ASSIGN_TOKENS
    if auto_assign:
        patch["assignee"] = "AUTO"
    if tn:
        patch["ticket_number"] = tn
    if cancel:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Acknowledge the ticket update was cancelled.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={"ticketNumber": tn or None, "cancelled": True},
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": view}],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "last_query": {
                    "entity": "tickets",
                    "operation": "UPDATE_TICKET",
                    "filters": {"query": tn} if tn else {},
                },
                "success": True,
            },
        }
    search_q = str(
        filters.get("query") or request.get("entity_name") or patch.get("query") or ""
    ).strip()
    if not tn and search_q and not re.search(r"#?\d{3,}", search_q):
        page_filters = _apply_execute_page_scope(state.get("page"), dict(filters))
        scope = str(page_filters.get("scope") or "").strip().lower() or None
        with tool_actor_scope(actor):
            found = list_tickets(
                limit=20,
                scope=scope,
                query=search_q,
                status=page_filters.get("status"),
                priority=page_filters.get("priority"),
                queue=page_filters.get("queue"),
            )
        if not found.get("success"):
            return fail(found)
        matches = _tickets_from_tool_result(found)
        if len(matches) == 1:
            raw_id = str(
                matches[0].get("ticketNumber")
                or matches[0].get("ticket_number")
                or matches[0].get("id")
                or ""
            ).strip()
            tn = raw_id if raw_id.startswith("#") else f"#{raw_id.lstrip('#')}"
            patch["ticket_number"] = tn
        elif len(matches) > 1:
            summary = _format_ticket_list_details(matches, limit=8)
            reply = _llm_phrase(
                module="ticket",
                kind="validation",
                fallback="Several tickets match. Ask which ticket id to update.",
                user_text=text,
                page_label=state.get("page") or "Tickets",
                context={
                    "ambiguous": True,
                    "listSummary": summary,
                    "nextStep": "ticket id to update",
                },
            )
            return {
                **(parked_result or {}),
                "handled": True,
                "workflow_handled": True,
                "reply": reply,
                "actions": [{"type": "navigate", "view": view}],
                "route": "tickets",
                "semantic_request": request,
                "data": {
                    "tickets": matches[:8],
                    "last_query": {
                        "entity": "tickets",
                        "operation": "UPDATE_TICKET",
                        "filters": {**page_filters, "query": search_q},
                        "pending_update": patch,
                    },
                    "success": True,
                    "_tool_name": "list_tickets",
                },
            }
    prior_filters = (
        prior_query.get("filters") if isinstance((prior_query or {}).get("filters"), dict) else {}
    )
    bulk_hint = bool(
        re.search(r"\b(all|these|matching|bulk)\b", text or "", re.I)
        or (prior_query or {}).get("pending_bulk")
    )
    if (
        not tn
        and (patch.get("assignee") or auto_assign)
        and (bulk_hint or prior_filters)
        and not search_q
    ):
        list_filters = dict(prior_filters or filters)
        list_filters = _apply_execute_page_scope(state.get("page"), list_filters)
        scope = str(list_filters.get("scope") or "").strip().lower() or None
        with tool_actor_scope(actor):
            preview = list_tickets(
                limit=100,
                scope=scope,
                status=list_filters.get("status"),
                priority=list_filters.get("priority"),
                channel=list_filters.get("channel"),
                queue=list_filters.get("queue"),
                due=list_filters.get("due"),
                assigned_to=(
                    None
                    if str(list_filters.get("assigned_to") or "").upper() in {"SELF", "UNASSIGNED", ""}
                    else list_filters.get("assigned_to")
                ),
                query=str(list_filters.get("query") or "").strip() or None,
            )
        if not preview.get("success"):
            return fail(preview)
        count = len(_tickets_from_tool_result(preview))
        already_asked_bulk = bool((prior_query or {}).get("pending_bulk"))
        if not already_asked_bulk:
            reply = _llm_phrase(
                module="ticket",
                kind="confirm",
                fallback="Preview how many matching tickets would be updated and ask to confirm. Do not apply yet.",
                user_text=text,
                page_label=state.get("page") or "Tickets",
                context={
                    "bulkCount": count,
                    "pendingUpdate": {
                        k: patch.get(k)
                        for k in ("status", "priority", "assignee", "queue", "note")
                        if patch.get(k)
                    },
                    "nextStep": "confirm or cancel",
                },
            )
            return {
                **(parked_result or {}),
                "handled": True,
                "workflow_handled": True,
                "reply": reply,
                "actions": [{"type": "navigate", "view": view}],
                "route": "tickets",
                "semantic_request": request,
                "data": {
                    "last_query": {
                        "entity": "tickets",
                        "operation": "UPDATE_TICKET",
                        "filters": list_filters,
                        "pending_update": patch,
                        "pending_bulk": True,
                        "bulk_count": count,
                    },
                    "success": True,
                    "_tool_name": "list_tickets",
                },
            }
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Bulk ticket updates are not available yet. Do not claim tickets were changed.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={
                "bulkCount": count,
                "refused": True,
                "reason": "no_bulk_api",
            },
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": view}],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "last_query": {
                    "entity": "tickets",
                    "operation": "UPDATE_TICKET",
                    "filters": list_filters,
                },
                "success": True,
            },
        }
    if not tn:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask which ticket number to update.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={"nextStep": "ticket number to update"},
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": view}],
            "route": "tickets",
            "semantic_request": request,
        }
    has_change = any(patch.get(k) for k in ("status", "priority", "assignee", "queue", "note")) or auto_assign
    if not has_change:
        from app.tasks.chat_commands import (
            start_or_continue_reassign,
            utterance_is_reassign_role_column,
            _asks_reassign_roster_list,
        )
        from app.workflow_schemas import utterance_plausibly_starts_reassign

        assignee_label = str(fields.get("assignee") or text or "").strip().lower()
        role_column = utterance_is_reassign_role_column(text)
        pick_assignee_column = assignee_label in {
            "assignee",
            "assigneee",
            "agent",
            "resolver",
            "owner",
            "person",
            "the assignee",
            "an assignee",
        } or bool(role_column) or _asks_reassign_roster_list(text)
        if utterance_plausibly_starts_reassign(text) or pick_assignee_column:
            hit = start_or_continue_reassign(
                text,
                org=str(state.get("organization_id") or ""),
                role=str(state.get("user_role") or "agent"),
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
                page=state.get("page"),
                reassign_draft=state.get("reassign_draft"),
                intent_confirmed=True,
                resolved_ticket_number=tn.lstrip("#") if tn else None,
                resolved_person=None,
                resolved_target_role=(
                    role_column
                    or (
                        "agent"
                        if assignee_label == "agent"
                        else ("resolver" if assignee_label == "resolver" else None)
                    )
                ),
                semantic_decision=request,
            )
            if hit and hit.get("handled"):
                return {
                    **(parked_result or {}),
                    **hit,
                    "workflow_handled": True,
                    "semantic_request": request,
                }
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask for the new status, priority, assignee, queue, or note.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={"ticketNumber": tn, "nextStep": "status, priority, assignee, queue, or note"},
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": view},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "last_query": {
                    "entity": "tickets",
                    "operation": "UPDATE_TICKET",
                    "filters": {"query": tn},
                    "pending_update": patch,
                }
            },
        }
    assignee_raw = str(patch.get("assignee") or "").strip()
    if assignee_raw and not auto_assign:
        from app.tasks.chat_commands import _match_named_assignee

        org_id = str(state.get("organization_id") or "").strip()
        matched = _match_named_assignee(org_id, assignee_raw) if org_id else None
        if not matched and not confirm:
            reply = _llm_phrase(
                module="ticket",
                kind="validation",
                fallback="Could not find that teammate on the roster. Ask for a name from the team list.",
                user_text=text,
                page_label=state.get("page") or "Tickets",
                context={
                    "ticketNumber": tn,
                    "missingName": assignee_raw,
                    "nextStep": "assignee name from roster",
                },
            )
            return {
                **(parked_result or {}),
                "handled": True,
                "workflow_handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": view},
                    {"type": "set_filter", "module": "tickets", "query": tn},
                ],
                "route": "tickets",
                "semantic_request": request,
                "data": {
                    "last_query": {
                        "entity": "tickets",
                        "operation": "UPDATE_TICKET",
                        "filters": {"query": tn},
                        "pending_update": patch,
                    },
                    "success": False,
                },
            }
        if matched and not matched.get("ambiguous"):
            patch["assignee"] = matched.get("assignee") or assignee_raw
            if matched.get("assignee_id"):
                patch["assignee_id"] = matched.get("assignee_id")

    status_l = str(patch.get("status") or "").strip().lower()
    needs_confirm = bool(patch.get("assignee")) or auto_assign or status_l in _DESTRUCTIVE_STATUSES
    if needs_confirm and not confirm:
        reply = _llm_phrase(
            module="ticket",
            kind="confirm",
            fallback="Ask the user to confirm this ticket update before applying it.",
            user_text=text,
            page_label=state.get("page") or "Tickets",
            context={
                "ticketNumber": tn,
                "pendingUpdate": {
                    k: patch.get(k)
                    for k in ("status", "priority", "assignee", "queue", "note")
                    if patch.get(k)
                },
                "autoAssign": auto_assign,
                "nextStep": "confirm or cancel",
            },
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": view},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "last_query": {
                    "entity": "tickets",
                    "operation": "UPDATE_TICKET",
                    "filters": {"query": tn},
                    "pending_update": patch,
                },
                "success": True,
            },
        }
    tool_name = "update_ticket"
    with tool_actor_scope(actor):
        note_text = str(patch.get("note") or "").strip()
        if auto_assign:
            result = auto_assign_ticket(tn)
            tool_name = "auto_assign_ticket"
            if result.get("success") and note_text:
                add_ticket_note(tn, note_text)
        elif note_text and not any(patch.get(k) for k in ("status", "priority", "assignee", "queue")):
            result = add_ticket_note(tn, note_text)
            tool_name = "add_ticket_note"
        else:
            result = update_ticket(
                tn,
                status=str(patch["status"]).strip() if patch.get("status") else None,
                priority=str(patch["priority"]).strip() if patch.get("priority") else None,
                assignee=str(patch["assignee"]).strip() if patch.get("assignee") else None,
                queue=str(patch["queue"]).strip() if patch.get("queue") else None,
            )
            if result.get("success") and note_text:
                add_ticket_note(tn, note_text)
    if not result.get("success"):
        return fail(result)
    payload = _tool_payload(result)
    assigned = (
        payload.get("resolver")
        or payload.get("assignee")
        or payload.get("assignedTo")
        or (None if auto_assign else patch.get("assignee"))
    )
    reply = _llm_phrase(
        module="ticket",
        kind="created",
        fallback="Confirm the ticket was updated using only the applied fields. Never invent an assignee.",
        user_text=text,
        page_label=state.get("page") or "Tickets",
        context={
            "ticketNumber": tn,
            "updated": {
                k: patch.get(k)
                for k in ("status", "priority", "assignee", "queue", "note")
                if patch.get(k) and k != "assignee"
            },
            "assignee": assigned or (None if auto_assign else patch.get("assignee")),
            "autoAssign": auto_assign,
            "filed": True,
        },
    )
    return {
        **(parked_result or {}),
        "handled": True,
        "workflow_handled": True,
        "reply": reply,
        "actions": [
            {"type": "navigate", "view": view},
            {"type": "set_filter", "module": "tickets", "query": tn},
            {"type": "refresh_tickets"},
        ],
        "route": "tickets",
        "semantic_request": request,
        "last_entity": {"type": "ticket", "id": "", "name": tn.lstrip("#")},
        "data": {
            "last_query": {
                "entity": "tickets",
                "operation": "UPDATE_TICKET",
                "filters": {"query": tn},
            },
            "success": True,
            "_tool_name": tool_name,
        },
    }


def _execute_ticket_query(
    state: AgentState,
    text: str,
    decision: dict[str, Any],
    *,
    parked_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute list/search/metrics/recommend/update through Express tools."""
    from app.agents.workflow_nlu import TICKET_TOOLS
    from app.tasks.chat_commands import (
        _compose_intro_and_list,
        _format_ticket_list_details,
        _llm_phrase,
        _tickets_from_tool_result,
    )
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import authorize_tool
    from app.tools.ticket_read import list_tickets
    from app.workflow_state import (
        conversation_context_from_state,
        resolve_query_reference,
    )

    context = conversation_context_from_state(dict(state))
    request, reference_error = resolve_query_reference(decision, context)
    operation = str(request.get("operation") or "").strip().upper()
    le = context.get("last_entity") if isinstance(context.get("last_entity"), dict) else {}
    le_type = str(le.get("type") or "").strip().lower()
    prior = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    prior_op = str(prior.get("operation") or "").strip().upper()
    ref = str(request.get("reference") or decision.get("reference") or "").strip().upper()
    if operation in {"", "NONE"} or (
        operation not in _TICKET_QUERY_OPS and ref == "LAST_ENTITY"
    ):
        if le_type == "ticket" or prior_op in {"GET_TICKET", "GET_HISTORY"}:
            operation = "GET_TICKET"
            request["operation"] = operation
    if operation not in _TICKET_QUERY_OPS and str(
        request.get("reference") or ""
    ).strip().upper() == "LAST_QUERY":
        prior = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
        operation = str(prior.get("operation") or "LIST_TICKETS").strip().upper()
        request["operation"] = operation
    if reference_error:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask a brief clarification about which previous ticket list they mean.",
            user_text=text,
            page_label=state.get("page"),
            context={"clarificationRequired": True, "reason": reference_error},
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "semantic_request": request,
        }
    if request.get("tool_proposal_valid") is False:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": "",
            "actions": [],
            "route": "tickets",
            "semantic_request": request,
            "data": {
                "serviceError": "INVALID_TOOL_PROPOSAL",
                "retryable": False,
            },
        }
    if operation not in _TICKET_QUERY_OPS:
        if le_type == "ticket" or prior_op in {"GET_TICKET", "GET_HISTORY"}:
            operation = "GET_TICKET"
        else:
            operation = "LIST_TICKETS"
        request["operation"] = operation
    expected_tool = str(TICKET_TOOLS.get(operation) or "list_tickets").strip().lower()
    proposed = str(
        request.get("proposed_tool") or expected_tool
    ).strip().lower()
    # Never authorize a write tool (e.g. create_ticket) against a remapped list op.
    if proposed != expected_tool:
        proposed = expected_tool
        request["proposed_tool"] = proposed
    try:
        authorize_tool(
            agent="tickets",
            tool_name=proposed,
            operation=operation,
            role=state.get("user_role"),
            workflow=state.get("current_workflow"),
        )
    except PermissionError as exc:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Explain briefly that that ticket action could not be authorized.",
            user_text=text,
            page_label=state.get("page"),
            context={"clarificationRequired": True, "reason": str(exc)},
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "semantic_request": request,
            "data": {"serviceError": "FORBIDDEN", "message": str(exc)},
        }
    filters = dict(request.get("filters") or {})
    filters = _infer_created_range(text, filters)
    request["filters"] = filters
    prior_query = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    pending_update = (
        prior_query.get("pending_update")
        if isinstance(prior_query.get("pending_update"), dict)
        else None
    )
    action = str(request.get("action") or decision.get("action") or "").strip().upper()
    page = str(state.get("page") or "")
    page_l = page.lower()
    on_home = any(token in page_l for token in ("home", "dashboard", "overview"))
    actor = ToolActor(
        user_id=str(state.get("user_id") or "").strip(),
        organization_id=str(state.get("organization_id") or "").strip(),
        user_role=state.get("user_role"),
        user_name=state.get("user_name"),
    )

    def _fail(result: dict[str, Any]) -> dict[str, Any]:
        reply = _llm_phrase(
            module="ticket",
            kind="forbidden"
            if result.get("error_code") == "FORBIDDEN"
            else "validation",
            fallback="Explain that the live ticket request failed and suggest retrying.",
            user_text=text,
            page_label=state.get("page"),
            context={
                "errorCode": result.get("error_code"),
                "unavailable": True,
            },
        )
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "semantic_request": request,
        }

    if (
        operation == "UPDATE_TICKET"
        or (pending_update and action in ("CANCEL_WORKFLOW", "CONFIRM_WORKFLOW"))
    ):
        fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
        pu = dict(pending_update or {})
        assignee_hint = str(fields.get("assignee") or pu.get("assignee") or "").strip()
        person_hint = str(fields.get("person") or "").strip()
        role_from_fields = str(fields.get("target_role") or "").strip()
        auto_tokens = {"AUTO", "BEST", "BEST_RESOLVER", "AUTO_ASSIGN", "AUTO-ASSIGN"}
        field_labels = {
            "assignee",
            "agent",
            "resolver",
            "owner",
            "person",
            "the assignee",
            "an assignee",
            "assigneee",
        }

        def _looks_like_person_name(raw: str) -> bool:
            s = str(raw or "").strip()
            if not s:
                return False
            if s.upper().replace(" ", "_") in auto_tokens:
                return False
            if s.lower() in field_labels:
                return False
            if s.lstrip("#").isdigit():
                return False
            return True

        want_reassign = (
            str(request.get("action") or decision.get("action") or "").strip().upper()
            == "START_REASSIGN"
            or str(request.get("workflow") or decision.get("workflow") or "")
            .strip()
            .lower()
            in {"reassign", "reassign_ticket"}
            or bool(role_from_fields)
            or bool(person_hint)
            or (bool(assignee_hint) and not _looks_like_person_name(assignee_hint))
        )
        from app.workflow_schemas import utterance_plausibly_starts_reassign

        want_reassign = want_reassign or utterance_plausibly_starts_reassign(text)
        person_for_reassign = (
            person_hint
            if _looks_like_person_name(person_hint)
            else (assignee_hint if _looks_like_person_name(assignee_hint) else None)
        )
        seed_ticket = _ticket_number_from_request(
            request,
            last_entity=le if le_type == "ticket" else None,
            pending=pu,
        )
        decision_action = str(
            request.get("action") or decision.get("action") or ""
        ).strip().upper()
        explicit_ticket_assign = bool(
            seed_ticket
            and assignee_hint
            and _looks_like_person_name(assignee_hint)
            and not role_from_fields
            and not person_hint
            and decision_action != "START_REASSIGN"
        )
        bulk_assign_intent = bool(
            not seed_ticket
            and assignee_hint
            and _looks_like_person_name(assignee_hint)
            and (
                re.search(r"\b(all|these|matching|bulk)\b", text or "", re.I)
                or isinstance((prior_query or {}).get("filters"), dict)
            )
        )
        auto_assign_intent = bool(
            str(assignee_hint or "").strip().upper().replace(" ", "_") in auto_tokens
            or str(request.get("proposed_tool") or "").strip().lower()
            == "auto_assign_ticket"
        )
        if (want_reassign or person_for_reassign) and not (
            explicit_ticket_assign or bulk_assign_intent or auto_assign_intent
        ):
            from app.tasks.chat_commands import (
                _infer_target_role,
                start_or_continue_reassign,
            )

            role_hint = (
                role_from_fields
                or _infer_target_role(text)
                or (
                    _infer_target_role(assignee_hint)
                    if assignee_hint.lower() in {"agent", "resolver"}
                    else None
                )
            )
            hit = start_or_continue_reassign(
                text,
                org=str(state.get("organization_id") or ""),
                role=str(state.get("user_role") or "agent"),
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
                page=state.get("page"),
                reassign_draft=state.get("reassign_draft"),
                intent_confirmed=True,
                resolved_ticket_number=seed_ticket.lstrip("#") if seed_ticket else None,
                resolved_person=person_for_reassign,
                resolved_target_role=role_hint or None,
                semantic_decision=request
                if isinstance(request, dict)
                else decision,
            )
            if hit:
                return {
                    **(parked_result or {}),
                    **hit,
                    "workflow_handled": True,
                    "semantic_request": request,
                }
        return _execute_ticket_update(
            state,
            text,
            request,
            actor=actor,
            parked_result=parked_result,
            pending_update=pending_update,
            confirm=action == "CONFIRM_WORKFLOW",
            cancel=action == "CANCEL_WORKFLOW",
            fail=_fail,
            prior_query=prior_query,
        )

    if operation in ("GET_METRICS", "COMPARE", "RECOMMEND"):
        return _execute_ticket_metrics(
            state,
            text,
            request,
            operation=operation,
            actor=actor,
            parked_result=parked_result,
            on_home=on_home,
            fail=_fail,
        )

    if operation in ("GET_TICKET", "GET_HISTORY"):
        return _execute_ticket_detail(
            state,
            text,
            request,
            operation=operation,
            actor=actor,
            parked_result=parked_result,
            fail=_fail,
        )
    role = str(state.get("user_role") or "").strip().lower()
    from app.tasks.chat_commands import _can_access_module, _tickets_list_for_role

    filters = _apply_execute_page_scope(page, filters)
    scope = str(filters.get("scope") or "").strip().lower() or None
    assigned_raw = str(filters.get("assigned_to") or "").strip()
    assigned_upper = assigned_raw.upper()
    assigned_to = (
        assigned_upper
        if assigned_upper in {"SELF", "UNASSIGNED"}
        else (assigned_raw or None)
    )
    # "My tickets" → assignee scope (includes L2 for resolvers). Unassigned → scoped list.
    list_scope: str | None = None
    list_assigned_to: str | None = None if assigned_to in {None, "SELF", "UNASSIGNED"} else assigned_to
    navigate_view = "tickets-list"
    if scope == "unassigned" or assigned_to == "UNASSIGNED":
        if not _can_access_module(role, "unassigned"):
            reply = _llm_phrase(
                module="ticket",
                kind="forbidden",
                fallback=(
                    "Role cannot open Unassigned tickets. "
                    "Suggest My Tickets, Search, or Knowledge Base."
                ),
                user_text=text,
                page_label=state.get("page"),
                context={"feature": "Unassigned", "denied": True},
            )
            return {
                **(parked_result or {}),
                "handled": True,
                "workflow_handled": True,
                "reply": reply,
                "actions": [],
                "route": "tickets",
                "semantic_request": request,
            }
        list_scope = "unassigned"
        list_assigned_to = None
        navigate_view = "unassigned"
        filters = {**filters, "scope": "unassigned"}
        filters.pop("assigned_to", None)
    elif assigned_to == "SELF":
        list_scope = "assignee"
        list_assigned_to = None
        navigate_view = (
            "assigned"
            if _can_access_module(role, "assigned")
            else _tickets_list_for_role(role)
        )
    elif scope == "org" or (
        scope is None
        and not assigned_to
        and str(filters.get("due") or "").lower() == "overdue"
        and not filters.get("status")
        and not filters.get("priority")
        and not filters.get("queue")
        and not filters.get("created_by")
    ):
        if _can_access_module(role, "team-queue"):
            list_scope = "org"
            navigate_view = "team-queue"
            filters = {**filters, "scope": "org"}
        elif _can_access_module(role, "team-inbox"):
            list_scope = "team"
            navigate_view = "team-inbox"
            filters = {**filters, "scope": "team"}
        else:
            list_scope = "assignee"
            navigate_view = (
                "assigned"
                if _can_access_module(role, "assigned")
                else _tickets_list_for_role(role)
            )
            filters = {**filters, "scope": "assignee"}
    elif scope == "team":
        list_scope = "team"
        navigate_view = (
            "team-inbox"
            if _can_access_module(role, "team-inbox")
            else _tickets_list_for_role(role)
        )
    elif filters.get("created_by") == "SELF":
        list_scope = "created"
    navigate_view = _stay_ticket_navigate(page, list_scope, navigate_view)
    count_only = _count_only_utterance(text) or operation == "GET_METRICS"
    list_limit = int(filters.get("limit") or 100)
    list_query = str(filters.get("query") or filters.get("customer") or "").strip() or None
    from app.tools.catalog_tools import get_metrics as _get_metrics

    metrics_total = None
    with tool_actor_scope(actor):
        tool_result = list_tickets(
            limit=max(1, min(list_limit, 100)),
            scope=list_scope,
            created_by=filters.get("created_by"),
            assigned_to=list_assigned_to,
            status=filters.get("status"),
            priority=filters.get("priority"),
            channel=filters.get("channel"),
            query=list_query,
            queue=filters.get("queue"),
            customer=filters.get("customer"),
            due=filters.get("due"),
            created_range=filters.get("created_range"),
            updated_range=filters.get("updated_range"),
            sort=filters.get("sort"),
        )
        if str(filters.get("due") or "").lower() == "overdue" or str(
            filters.get("status") or ""
        ).lower() == "overdue":
            met_scope = (
                "self"
                if list_scope in {"assignee", "created"}
                else "org"
                if list_scope == "org"
                else None
            )
            met_res = _get_metrics(scope=met_scope) if met_scope else _get_metrics()
            if met_res.get("success"):
                met_payload = _tool_payload(met_res)
                metrics_total = met_payload.get("overdue")
                if metrics_total is None:
                    metrics_total = met_payload.get("overdueTickets")
        elif str(filters.get("created_range") or "").lower() in {"today", "last_24h"}:
            met_scope = (
                "self"
                if list_scope in {"assignee", "created"}
                else "org"
                if list_scope == "org"
                else None
            )
            met_res = _get_metrics(scope=met_scope) if met_scope else _get_metrics()
            if met_res.get("success"):
                met_payload = _tool_payload(met_res)
                metrics_total = met_payload.get("createdToday")
                if metrics_total is None:
                    metrics_total = met_payload.get("created_today")
    if not tool_result.get("success"):
        return _fail(tool_result)
    rows = _tickets_from_tool_result(tool_result)
    summary = _format_ticket_list_details(rows, limit=8)
    scope_label = (
        "organization"
        if list_scope == "org"
        else "your teams"
        if list_scope == "team"
        else "assigned to you"
        if list_scope == "assignee"
        else "matching tickets"
    )
    total_count = metrics_total if metrics_total is not None else len(rows)
    intro = _llm_phrase(
        module="ticket",
        kind="filter",
        fallback=(
            "Report Context.totalCount when set (live overdue/org total), not only "
            "listCount. Listed bullets are a sample when sampleOnly is true. "
            "Do not say tickets are only yours unless scopeLabel is assigned to you."
        ),
        user_text=text,
        page_label=state.get("page") or "Tickets",
        context={
            "listCount": len(rows),
            "totalCount": total_count,
            "sampleOnly": metrics_total is not None and int(metrics_total) > len(rows),
            "scopeLabel": scope_label,
            "listSummary": summary,
            "filters": filters,
            "nextStep": "offer a filter or a ticket number if they want one row",
        },
    )
    actions: list[dict[str, Any]] = [
        {"type": "navigate", "view": navigate_view}
    ]
    if not count_only:
        filter_action: dict[str, Any] = {
            "type": "set_filter",
            "module": "tickets",
            "query": str(filters.get("query") or ""),
        }
        if filters.get("created_by") == "SELF":
            filter_action["creator"] = "me"
        if assigned_to == "SELF" or list_scope == "assignee":
            filter_action["assignee"] = "me"
        if list_scope == "unassigned":
            filter_action["assignee"] = "unassigned"
        elif assigned_to and assigned_to not in {"SELF", "UNASSIGNED"}:
            filter_action["assignee"] = assigned_to
        if filters.get("queue"):
            filter_action["queue"] = filters["queue"]
        if filters.get("due") == "overdue" and not filters.get("status"):
            filter_action["status"] = "Overdue"
        for key in ("status", "priority", "channel"):
            if filters.get(key):
                filter_action[key] = filters[key]
        actions.append(filter_action)
    last_query = {
        "entity": "tickets",
        "operation": operation,
        "filters": filters,
    }
    return {
        **(parked_result or {}),
        "handled": True,
        "workflow_handled": True,
        "reply": _compose_intro_and_list(intro, summary),
        "actions": actions,
        "route": "tickets",
        "semantic_request": request,
        "data": {
            "tickets": rows[:8],
            "ticketCount": len(rows),
            "last_query": last_query,
            "success": True,
            "_tool_name": "list_tickets",
            "payload": {"data": rows[:8]},
        },
    }


def _execute_team_query(
    state: AgentState,
    text: str,
    decision: dict[str, Any],
    *,
    parked_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tasks.chat_commands import _can_access_module, _llm_phrase
    from app.tools.catalog_tools import delete_queue, list_queues, update_queue
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import authorize_tool
    from app.workflow_state import conversation_context_from_state, resolve_query_reference

    context = conversation_context_from_state(dict(state))
    request, reference_error = resolve_query_reference(decision, context)
    operation = str(request.get("operation") or "").strip().upper()
    le = context.get("last_entity") if isinstance(context.get("last_entity"), dict) else {}
    le_type = str(le.get("type") or "").strip().lower()
    if operation in {"", "NONE"} and le_type in {"team"}:
        operation = "GET_TEAM"
        request["operation"] = operation
    if operation == "GET_METRICS":
        operation = "LIST_TEAMS"
        request["operation"] = operation
    if operation not in _TEAM_QUERY_OPS | {"COMPARE"}:
        operation = "GET_TEAM" if le_type == "team" else "LIST_TEAMS"
        request["operation"] = operation
    if reference_error:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="team",
                kind="validation",
                fallback="Ask which previous team list they mean.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={"clarificationRequired": True, "reason": reference_error},
            ),
            "actions": [],
            "route": "teams",
            "semantic_request": request,
        }
    tool_by_op = {
        "LIST_TEAMS": "list_queues",
        "SEARCH_TEAMS": "list_queues",
        "GET_TEAM": "list_queues",
        "COMPARE": "list_queues",
        "UPDATE_TEAM": "update_queue",
        "ADD_MEMBERS": "update_queue",
        "REMOVE_MEMBERS": "update_queue",
        "DELETE_TEAM": "delete_queue",
    }
    proposed = str(
        request.get("proposed_tool") or tool_by_op.get(operation) or "list_queues"
    ).strip().lower()
    if proposed not in {"list_queues", "list_agents", "update_queue", "delete_queue"}:
        proposed = tool_by_op.get(operation) or "list_queues"
    if operation in {"UPDATE_TEAM", "ADD_MEMBERS", "REMOVE_MEMBERS", "DELETE_TEAM"} and str(
        state.get("user_role") or ""
    ).strip().lower() != "admin":
        from app.tasks.chat_commands import _llm_phrase as _phrase_denied

        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _phrase_denied(
                module="team",
                kind="forbidden",
                fallback="Only admins can change teams.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={"denied": True, "feature": operation.lower()},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "semantic_request": request,
        }
    authorize_tool(
        agent="teams",
        tool_name=proposed,
        operation="LIST_TEAMS" if operation == "COMPARE" else operation,
        role=state.get("user_role"),
        workflow=state.get("current_workflow"),
    )
    filters = dict(request.get("filters") or {})
    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    prior_query = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    pending = prior_query.get("pending_update") if isinstance(prior_query.get("pending_update"), dict) else {}
    pending_delete = prior_query.get("pending_delete") if isinstance(prior_query.get("pending_delete"), dict) else {}
    action = str(request.get("action") or decision.get("action") or "").strip().upper()
    role = str(state.get("user_role") or "").strip().lower()
    actor = ToolActor(
        user_id=str(state.get("user_id") or "").strip(),
        organization_id=str(state.get("organization_id") or "").strip(),
        user_role=state.get("user_role"),
        user_name=state.get("user_name"),
    )
    resolved = (
        request.get("resolved_entity")
        if isinstance(request.get("resolved_entity"), dict)
        else {}
    )
    query = str(
        filters.get("query")
        or request.get("entity_name")
        or fields.get("name")
        or resolved.get("name")
        or ""
    ).strip()
    resolved_type = str(resolved.get("type") or "").strip().lower()
    team_id = str(
        filters.get("id")
        or (resolved.get("id") if resolved_type in {"team", "queue"} else "")
        or ""
    ).strip()
    count_only = _count_only_utterance(text)
    people = _people_from_team_request(request)
    offered = _offered_staff_from_state({**dict(state), **(parked_result or {})})
    membership_lookup = bool(people)
    list_query = None if membership_lookup else query

    def _fail(result: dict[str, Any]) -> dict[str, Any]:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="team",
                kind="forbidden" if result.get("error_code") == "FORBIDDEN" else "validation",
                fallback="Explain that the live teams request failed.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={"errorCode": result.get("error_code"), "unavailable": True},
            ),
            "actions": [],
            "route": "teams",
            "semantic_request": request,
        }

    def _ok(reply: str, *, rows=None, extra=None, tool="list_queues", refresh=False, last_query=None):
        actions: list[dict[str, Any]] = [{"type": "navigate", "view": "agent-queues"}]
        if (
            not count_only
            and operation in {"LIST_TEAMS", "SEARCH_TEAMS", "GET_TEAM"}
            and query
            and not membership_lookup
        ):
            actions.append({"type": "set_filter", "module": "teams", "query": query})
        if refresh:
            actions.append({"type": "refresh_teams"})
        pending_del = (
            (last_query or {}).get("pending_delete")
            if isinstance((last_query or {}).get("pending_delete"), dict)
            else {}
        )
        if pending_del:
            actions.append(
                {
                    "type": "delete_team",
                    "id": str(pending_del.get("id") or "").strip(),
                    "name": str(
                        pending_del.get("queueName") or pending_del.get("name") or ""
                    ).strip(),
                    "step": "confirm",
                }
            )
        data: dict[str, Any] = {
            "last_query": last_query
            or {"entity": "teams", "operation": operation, "filters": filters},
            "success": True,
            "_tool_name": tool,
        }
        if rows is not None:
            data["teams"] = rows[:8]
            data["teamCount"] = len(rows)
        if extra:
            data.update(extra)
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": actions,
            "route": "teams",
            "semantic_request": request,
            "data": data,
        }

    def _reload_all_teams() -> dict[str, Any] | None:
        with tool_actor_scope(actor):
            listed_all = list_queues()
        if not listed_all.get("success"):
            return listed_all
        return listed_all

    with tool_actor_scope(actor):
        listed = list_queues(query=list_query or None)
    if not listed.get("success"):
        return _fail(listed)
    rows = _catalog_rows(listed)

    team_hit, team_ambiguous = (
        _match_named_rows(rows, query, "queueName", "name") if query else (None, [])
    )
    if (
        not membership_lookup
        and offered
        and operation in {"LIST_TEAMS", "SEARCH_TEAMS", "GET_TEAM"}
        and not (team_hit or team_ambiguous)
    ):
        if list_query:
            reloaded = _reload_all_teams()
            if reloaded is None:
                return _fail({"error_code": "UNAVAILABLE"})
            if not reloaded.get("success"):
                return _fail(reloaded)
            rows = _catalog_rows(reloaded)
        people = list(offered)
        membership_lookup = True

    def _membership_reply() -> str:
        return _llm_phrase(
            module="team",
            kind="filter",
            fallback=(
                "Report which existing teams each listed person already belongs to "
                "using membership[].teams and teams[].members from the tool JSON only. "
                "Empty teams means that person is not on any team yet. Do not invent names."
            ),
            user_text=text,
            page_label=state.get("page") or "Teams",
            context={
                "teamCount": len(rows),
                "metricsOnly": count_only,
                "membership": _membership_for_people(rows, people),
                "teams": [_compact_team_row(r) for r in rows[:12]],
            },
        )

    if action == "CANCEL_WORKFLOW":
        return _ok(
            _llm_phrase(
                module="team",
                kind="validation",
                fallback="Acknowledge the team change was cancelled.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={"cancelled": True},
            ),
            last_query={"entity": "teams", "operation": operation, "filters": filters},
        )

    if operation == "COMPARE" or "most" in (text or "").lower():
        ranked = sorted(rows, key=lambda r: int(r.get("openTickets") or 0), reverse=True)
        top = ranked[0] if ranked else None
        reply = _llm_phrase(
            module="team",
            kind="filter",
            fallback="Report which team has the most openTickets from the tool JSON only.",
            user_text=text,
            page_label=state.get("page") or "Teams",
            context={
                "teamCount": len(rows),
                "topTeam": _row_label(top or {}, "queueName", "name") if top else None,
                "openTickets": int((top or {}).get("openTickets") or 0) if top else 0,
                "teams": [_compact_team_row(r) for r in ranked[:8]],
            },
        )
        return _ok(reply, rows=ranked, tool="list_queues")

    if operation in {"LIST_TEAMS", "SEARCH_TEAMS"}:
        if membership_lookup:
            return _ok(_membership_reply(), rows=rows, extra={"membership": _membership_for_people(rows, people)})
        reply = _llm_phrase(
            module="team",
            kind="filter",
            fallback="Summarize live teams from tool JSON. Do not invent names or counts.",
            user_text=text,
            page_label=state.get("page") or "Teams",
            context={
                "teamCount": len(rows),
                "metricsOnly": count_only,
                "teams": [_compact_team_row(r) for r in rows[:8]],
            },
        )
        return _ok(reply, rows=rows)

    hit, ambiguous = _match_named_rows(rows, query, "queueName", "name")
    if team_id:
        by_id = _row_by_id(rows, team_id)
        if by_id:
            hit, ambiguous = by_id, []
    if operation == "GET_TEAM" or (operation == "COMPARE" and query):
        if ambiguous:
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Several teams match. Ask which one.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={
                        "ambiguous": True,
                        "matches": [_row_label(r, "queueName", "name") for r in ambiguous[:8]],
                    },
                ),
                rows=ambiguous,
            )
        if not hit:
            person_query = False
            if query:
                qn = query.lower()
                person_query = any(
                    qn in n.lower() or n.lower() in qn for n in offered
                ) or any(
                    qn in m.lower() or m.lower() in qn
                    for r in rows
                    for m in _row_member_names(r)
                )
            if membership_lookup or person_query:
                if not people and offered:
                    people = list(offered)
                    membership_lookup = True
                return _ok(
                    _membership_reply(),
                    rows=rows,
                    extra={"membership": _membership_for_people(rows, people)},
                )
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="No matching team was found.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={"missing": True, "query": query},
                ),
                rows=[],
            )
        if operation == "COMPARE" or "most" in (text or "").lower():
            ranked = sorted(rows, key=lambda r: int(r.get("openTickets") or 0), reverse=True)
            top = ranked[0] if ranked else hit
            reply = _llm_phrase(
                module="team",
                kind="filter",
                fallback="Compare openTickets from tool JSON only.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={
                    "team": {
                        "name": _row_label(hit, "queueName", "name"),
                        "openTickets": int(hit.get("openTickets") or 0),
                    },
                    "topTeam": _row_label(top, "queueName", "name") if top else None,
                    "openTickets": int((top or {}).get("openTickets") or 0),
                },
            )
            return _ok(reply, rows=[hit], extra={"team": hit})
        compact = _compact_team_row(hit)
        reply = _llm_phrase(
            module="team",
            kind="filter",
            fallback="Describe this team using only tool JSON.",
            user_text=text,
            page_label=state.get("page") or "Teams",
            context={"team": compact},
        )
        return _ok(reply, rows=[hit], extra={"team": hit})

    if role != "admin" or not _can_access_module(role, "agent-queues"):
        return _ok(
            _llm_phrase(
                module="team",
                kind="forbidden",
                fallback="Only admins can change teams.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={"denied": True, "feature": operation.lower()},
            ),
            rows=rows,
        )

    if operation == "DELETE_TEAM" or pending_delete:
        target = pending_delete or hit
        if not target and query:
            target, ambiguous = _match_named_rows(rows, query, "queueName", "name")
            if ambiguous:
                return _ok(
                    _llm_phrase(
                        module="team",
                        kind="validation",
                        fallback="Several teams match. Ask which one to delete.",
                        user_text=text,
                        page_label=state.get("page") or "Teams",
                        context={
                            "ambiguous": True,
                            "matches": [_row_label(r, "queueName", "name") for r in ambiguous[:8]],
                        },
                    ),
                    rows=ambiguous,
                )
        if not target:
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask which team to delete.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={"nextStep": "team name to delete"},
                )
            )
        qid = str(target.get("id") or "").strip()
        qname = _row_label(target, "queueName", "name")
        open_n = int(target.get("openTickets") or 0)
        if action == "CANCEL_WORKFLOW":
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Acknowledge the team delete was cancelled.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={"teamName": qname, "cancelled": True},
                ),
                last_query={"entity": "teams", "operation": "DELETE_TEAM", "filters": {"query": qname}},
            )
        reply = _llm_phrase(
            module="team",
            kind="confirm",
            fallback="Warn about open tickets and ask to confirm deleting this team.",
            user_text=text,
            page_label=state.get("page") or "Teams",
            context={
                "teamName": qname,
                "openTickets": open_n,
                "nextStep": "confirm or cancel",
            },
        )
        return _ok(
            reply,
            extra={},
            last_query={
                "entity": "teams",
                "operation": "DELETE_TEAM",
                "filters": {"query": qname},
                "pending_delete": {"id": qid, "queueName": qname, "openTickets": open_n},
            },
        )

    member_names = [
        str(v).strip()
        for v in (
            (fields.get("members") if isinstance(fields.get("members"), list) else None)
            or request.get("values")
            or []
        )
        if str(v).strip()
    ]
    new_name = str(fields.get("name") or pending.get("name") or "").strip() or None
    new_desc = str(fields.get("description") or pending.get("description") or "").strip() or None
    if operation in {"UPDATE_TEAM", "ADD_MEMBERS", "REMOVE_MEMBERS"} or pending:
        target = hit
        if not target and query:
            target, ambiguous = _match_named_rows(rows, query, "queueName", "name")
            if ambiguous:
                return _ok(
                    _llm_phrase(
                        module="team",
                        kind="validation",
                        fallback="Several teams match. Ask which one to update.",
                        user_text=text,
                        page_label=state.get("page") or "Teams",
                        context={
                            "ambiguous": True,
                            "matches": [_row_label(r, "queueName", "name") for r in ambiguous[:8]],
                        },
                    ),
                    rows=ambiguous,
                )
        if not target and isinstance(pending, dict) and pending.get("id"):
            target = pending
        if not target:
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask which team to update.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={"nextStep": "team name"},
                )
            )
        qid = str(target.get("id") or "").strip()
        qname = _row_label(target, "queueName", "name")
        if operation == "ADD_MEMBERS" and not member_names:
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask which members to add.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={"teamName": qname, "nextStep": "member names"},
                ),
                last_query={
                    "entity": "teams",
                    "operation": "ADD_MEMBERS",
                    "filters": {"query": qname},
                    "pending_update": {"id": qid, "queueName": qname},
                },
            )
        if operation == "REMOVE_MEMBERS" and not member_names:
            current = [
                str(x).strip()
                for x in (target.get("members") or target.get("memberNames") or [])
                if str(x).strip()
            ]
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask which members to remove.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={
                        "teamName": qname,
                        "availableMembers": ", ".join(current),
                        "nextStep": "member names to remove",
                    },
                ),
                last_query={
                    "entity": "teams",
                    "operation": "REMOVE_MEMBERS",
                    "filters": {"query": qname},
                    "pending_update": {"id": qid, "queueName": qname, "members": current},
                },
            )
        if operation == "UPDATE_TEAM" and not new_name and not new_desc and not member_names:
            return _ok(
                _llm_phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask for the new team name or description.",
                    user_text=text,
                    page_label=state.get("page") or "Teams",
                    context={"teamName": qname, "nextStep": "new name or description"},
                ),
                last_query={
                    "entity": "teams",
                    "operation": "UPDATE_TEAM",
                    "filters": {"query": qname},
                    "pending_update": {"id": qid, "queueName": qname},
                },
            )
        with tool_actor_scope(actor):
            if operation == "ADD_MEMBERS":
                result = update_queue(qid, members=member_names, add_members=True)
            elif operation == "REMOVE_MEMBERS":
                current = [
                    str(x).strip()
                    for x in (
                        (pending or {}).get("members")
                        or target.get("members")
                        or target.get("memberNames")
                        or []
                    )
                    if str(x).strip()
                ]
                remove_set = {n.lower() for n in member_names}
                remaining = [m for m in current if m.lower() not in remove_set]
                result = update_queue(qid, members=remaining, add_members=False)
            else:
                result = update_queue(
                    qid,
                    name=new_name,
                    description=new_desc,
                    members=member_names or None,
                )
        if not result.get("success"):
            return _fail(result)
        return _ok(
            _llm_phrase(
                module="team",
                kind="created",
                fallback="Confirm the team update from the tool result only.",
                user_text=text,
                page_label=state.get("page") or "Teams",
                context={
                    "teamName": new_name or qname,
                    "members": member_names,
                    "updated": True,
                },
            ),
            tool="update_queue",
            refresh=True,
            last_query={"entity": "teams", "operation": operation, "filters": {"query": qname}},
        )

    return _ok(
        _llm_phrase(
            module="team",
            kind="filter",
            fallback="Summarize live teams from tool JSON.",
            user_text=text,
            page_label=state.get("page") or "Teams",
            context={"teamCount": len(rows)},
        ),
        rows=rows,
    )


def _execute_kb_query(
    state: AgentState,
    text: str,
    decision: dict[str, Any],
    *,
    parked_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tasks.chat_commands import _llm_phrase
    from app.tools.catalog_tools import get_kb, list_kb, publish_kb_article, update_kb_article
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import authorize_tool
    from app.workflow_state import conversation_context_from_state, resolve_query_reference

    context = conversation_context_from_state(dict(state))
    request, reference_error = resolve_query_reference(decision, context)
    operation = str(request.get("operation") or "").strip().upper()
    wf = str(request.get("workflow") or decision.get("workflow") or "").strip().lower()
    last_q = (
        context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    )
    prior_op = str(last_q.get("operation") or "").strip().upper()
    le = context.get("last_entity") if isinstance(context.get("last_entity"), dict) else {}
    le_type = str(le.get("type") or "").strip().lower()
    follow_get_article = (
        prior_op == "GET_ARTICLE"
        or le_type in {"article", "kb"}
        or str(request.get("reference") or decision.get("reference") or "")
        .strip()
        .upper()
        == "LAST_ENTITY"
    )
    if operation in {"", "NONE"} or wf in {"article_summary", "summary"}:
        operation = "GET_ARTICLE" if follow_get_article else "LIST_KB"
        request["operation"] = operation
    if operation == "GET_METRICS":
        operation = "LIST_KB"
        request["operation"] = operation
    if operation not in _KB_QUERY_OPS:
        operation = "GET_ARTICLE" if follow_get_article else "LIST_KB"
        request["operation"] = operation
    if reference_error:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="kb",
                kind="validation",
                fallback="Ask which previous article list they mean.",
                user_text=text,
                page_label=state.get("page") or "Knowledge Base",
                context={"clarificationRequired": True, "reason": reference_error},
            ),
            "actions": [],
            "route": "kb",
            "semantic_request": request,
        }
    tool_by_op = {
        "LIST_KB": "list_kb",
        "SEARCH_KB": "list_kb",
        "GET_ARTICLE": "get_kb",
        "UPDATE_KB": "update_kb_article",
        "PUBLISH_KB": "publish_kb_article",
    }
    proposed = str(
        request.get("proposed_tool") or tool_by_op.get(operation) or "list_kb"
    ).strip().lower()
    if proposed not in {"list_kb", "get_kb", "update_kb_article", "publish_kb_article"}:
        proposed = tool_by_op.get(operation) or "list_kb"
    authorize_tool(
        agent="kb",
        tool_name=proposed,
        operation=operation,
        role=state.get("user_role"),
        workflow=state.get("current_workflow"),
    )
    filters = dict(request.get("filters") or {})
    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    prior_query = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    pending = prior_query.get("pending_update") if isinstance(prior_query.get("pending_update"), dict) else {}
    action = str(request.get("action") or decision.get("action") or "").strip().upper()
    actor = ToolActor(
        user_id=str(state.get("user_id") or "").strip(),
        organization_id=str(state.get("organization_id") or "").strip(),
        user_role=state.get("user_role"),
        user_name=state.get("user_name"),
    )
    resolved = (
        request.get("resolved_entity")
        if isinstance(request.get("resolved_entity"), dict)
        else {}
    )
    query = str(
        filters.get("query")
        or request.get("entity_name")
        or fields.get("title")
        or resolved.get("name")
        or ""
    ).strip()
    status = str(filters.get("status") or fields.get("status") or "").strip() or None
    category = str(filters.get("category") or fields.get("category") or "").strip() or None
    resolved_type = str(resolved.get("type") or "").strip().lower()
    article_id = str(
        fields.get("article_id")
        or filters.get("id")
        or pending.get("id")
        or (resolved.get("id") if resolved_type in {"article", "kb"} else "")
        or ""
    ).strip()
    offset = int(filters.get("offset") or prior_query.get("offset") or 0)
    if str(request.get("reference") or "").upper() == "LAST_QUERY" and re.search(
        r"\bnext\s+page\b", text or "", re.I
    ):
        offset = offset + 8
    count_only = _count_only_utterance(text)

    def _fail(result: dict[str, Any]) -> dict[str, Any]:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="kb",
                kind="forbidden" if result.get("error_code") == "FORBIDDEN" else "validation",
                fallback="Explain that the live knowledge base request failed.",
                user_text=text,
                page_label=state.get("page") or "Knowledge Base",
                context={"errorCode": result.get("error_code"), "unavailable": True},
            ),
            "actions": [],
            "route": "kb",
            "semantic_request": request,
        }

    def _ok(reply: str, *, rows=None, extra=None, tool="list_kb", refresh=False, last_query=None):
        actions: list[dict[str, Any]] = [{"type": "navigate", "view": "kb"}]
        if not count_only and operation in {"LIST_KB", "SEARCH_KB"} and (query or status or category):
            filt: dict[str, Any] = {"type": "set_filter", "module": "kb", "query": query}
            if status:
                filt["status"] = status
            actions.append(filt)
        if operation == "GET_ARTICLE" and extra:
            art = extra.get("article") if isinstance(extra.get("article"), dict) else None
            if art:
                open_title = str(
                    _row_label(art, "title", "name") or query or ""
                ).strip()
                open_id = str(art.get("id") or art.get("externalId") or "").strip()
                if open_title:
                    actions.append(
                        {
                            "type": "set_filter",
                            "module": "kb",
                            "query": open_title[:80],
                        }
                    )
                actions.append(
                    {"type": "open_kb", "id": open_id, "title": open_title}
                )
        if refresh:
            actions.append({"type": "refresh_kb"})
        data: dict[str, Any] = {
            "last_query": last_query
            or {
                "entity": "kb",
                "operation": operation,
                "filters": {**filters, "offset": offset},
            },
            "success": True,
            "_tool_name": tool,
        }
        if rows is not None:
            data["articles"] = rows[:8]
            data["articleCount"] = len(rows)
        if extra:
            data.update(extra)
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": actions,
            "route": "kb",
            "semantic_request": request,
            "data": data,
        }

    if action == "CANCEL_WORKFLOW":
        return _ok(
            _llm_phrase(
                module="kb",
                kind="validation",
                fallback="Acknowledge the knowledge base change was cancelled.",
                user_text=text,
                page_label=state.get("page") or "Knowledge Base",
                context={"cancelled": True},
            )
        )

    with tool_actor_scope(actor):
        listed = list_kb(query=query or None, category=category, status=status)
    if not listed.get("success"):
        return _fail(listed)
    rows = _catalog_rows(listed)
    page_rows = rows[offset : offset + 8]

    if operation in {"LIST_KB", "SEARCH_KB"} and operation != "GET_ARTICLE":
        published = sum(1 for r in rows if str(r.get("status") or "").lower() == "published")
        drafts = sum(1 for r in rows if str(r.get("status") or "").lower() == "draft")
        reply = _llm_phrase(
            module="kb",
            kind="filter",
            fallback="Summarize articles from tool JSON only. Never invent article text.",
            user_text=text,
            page_label=state.get("page") or "Knowledge Base",
            context={
                "articleCount": len(rows),
                "publishedCount": published,
                "draftCount": drafts,
                "metricsOnly": count_only,
                "articles": [
                    {
                        "id": r.get("id") or r.get("externalId"),
                        "title": _row_label(r, "title", "name"),
                        "status": r.get("status"),
                        "category": r.get("category"),
                    }
                    for r in page_rows
                ],
                "offset": offset,
            },
        )
        return _ok(reply, rows=rows)

    hit, ambiguous = _match_named_rows(rows, query, "title", "name")
    if not hit and article_id:
        with tool_actor_scope(actor):
            got = get_kb(article_id)
        if got.get("success"):
            payload = _tool_payload(got) or (_catalog_rows(got)[0] if _catalog_rows(got) else {})
            hit = payload if isinstance(payload, dict) and payload else None
        elif not got.get("success") and operation in {"GET_ARTICLE", "UPDATE_KB", "PUBLISH_KB"}:
            return _fail(got)
    if ambiguous and not hit:
        return _ok(
            _llm_phrase(
                module="kb",
                kind="validation",
                fallback="Several articles match. Ask which id or title.",
                user_text=text,
                page_label=state.get("page") or "Knowledge Base",
                context={
                    "ambiguous": True,
                    "matches": [
                        {"id": r.get("id") or r.get("externalId"), "title": _row_label(r, "title", "name")}
                        for r in ambiguous[:8]
                    ],
                },
            ),
            rows=ambiguous,
        )
    if operation == "GET_ARTICLE":
        if not hit:
            return _ok(
                _llm_phrase(
                    module="kb",
                    kind="validation",
                    fallback="No matching article was found.",
                    user_text=text,
                    page_label=state.get("page") or "Knowledge Base",
                    context={"missing": True, "query": query},
                ),
                rows=[],
            )
        aid = str(hit.get("id") or hit.get("externalId") or article_id or "").strip()
        body = ""
        with tool_actor_scope(actor):
            if aid:
                got = get_kb(aid)
                if got.get("success"):
                    payload = _tool_payload(got) or hit
                    hit = payload if isinstance(payload, dict) else hit
                    body = str(hit.get("content") or hit.get("body") or "")
        if not body:
            body = str(hit.get("content") or hit.get("body") or "")
        reply = _llm_phrase(
            module="kb",
            kind="filter",
            fallback="Summarize only the article body from tool JSON. Never fabricate.",
            user_text=text,
            page_label=state.get("page") or "Knowledge Base",
            context={
                "article": {
                    "id": aid or hit.get("id"),
                    "title": _row_label(hit, "title", "name"),
                    "status": hit.get("status"),
                    "category": hit.get("category"),
                    "content": body,
                }
            },
        )
        return _ok(reply, rows=[hit], extra={"article": hit}, tool="get_kb")

    if operation in {"UPDATE_KB", "PUBLISH_KB"} or pending:
        if not hit:
            return _ok(
                _llm_phrase(
                    module="kb",
                    kind="validation",
                    fallback="Ask which article to update or publish.",
                    user_text=text,
                    page_label=state.get("page") or "Knowledge Base",
                    context={"nextStep": "article title or id"},
                )
            )
        aid = str(hit.get("id") or hit.get("externalId") or article_id or "").strip()
        title = str(fields.get("title") or pending.get("title") or "").strip() or None
        content = str(fields.get("content") or fields.get("body") or pending.get("content") or "").strip() or None
        new_cat = str(fields.get("category") or pending.get("category") or "").strip() or None
        new_status = str(fields.get("status") or pending.get("status") or "").strip() or None
        if operation == "PUBLISH_KB":
            new_status = "Published"
        if operation == "PUBLISH_KB" and str(hit.get("status") or "").lower() != "published":
            return _ok(
                _llm_phrase(
                    module="kb",
                    kind="confirm",
                    fallback="Ask to confirm publishing this article.",
                    user_text=text,
                    page_label=state.get("page") or "Knowledge Base",
                    context={
                        "title": _row_label(hit, "title", "name"),
                        "nextStep": "confirm or cancel",
                    },
                ),
                last_query={
                    "entity": "kb",
                    "operation": "PUBLISH_KB",
                    "filters": {"query": _row_label(hit, "title", "name")},
                    "pending_update": {"id": aid, "status": "Published"},
                    "proposed_tool": "publish_kb_article",
                },
            )
        with tool_actor_scope(actor):
            if operation == "PUBLISH_KB":
                result = publish_kb_article(aid)
                tool_name = "publish_kb_article"
            else:
                result = update_kb_article(
                    aid, title=title, content=content, category=new_cat, status=new_status
                )
                tool_name = "update_kb_article"
        if not result.get("success"):
            return _fail(result)
        return _ok(
            _llm_phrase(
                module="kb",
                kind="created",
                fallback="Confirm the article change from the tool result only.",
                user_text=text,
                page_label=state.get("page") or "Knowledge Base",
                context={
                    "title": title or _row_label(hit, "title", "name"),
                    "status": new_status or hit.get("status"),
                    "updated": True,
                },
            ),
            tool=tool_name,
            refresh=True,
        )

    return _ok(
        _llm_phrase(
            module="kb",
            kind="filter",
            fallback="Summarize articles from tool JSON only.",
            user_text=text,
            page_label=state.get("page") or "Knowledge Base",
            context={"articleCount": len(rows)},
        ),
        rows=rows,
    )


def _execute_customer_query(
    state: AgentState,
    text: str,
    decision: dict[str, Any],
    *,
    parked_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tasks.chat_commands import (
        _can_access_module,
        _format_ticket_list_details,
        _llm_phrase,
        _tickets_from_tool_result,
    )
    from app.tools.catalog_tools import get_customer_360, import_customers, list_customers
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import authorize_tool
    from app.tools.ticket_read import list_tickets
    from app.workflow_state import conversation_context_from_state, resolve_query_reference

    context = conversation_context_from_state(dict(state))
    request, reference_error = resolve_query_reference(decision, context)
    operation = str(request.get("operation") or "").strip().upper()
    le = context.get("last_entity") if isinstance(context.get("last_entity"), dict) else {}
    le_type = str(le.get("type") or "").strip().lower()
    if operation in {"", "NONE"} and le_type in {"customer"}:
        operation = "GET_CUSTOMER"
        request["operation"] = operation
    if operation == "GET_METRICS":
        operation = "LIST_CUSTOMERS"
        request["operation"] = operation
    if operation not in _CUSTOMER_QUERY_OPS:
        operation = "GET_CUSTOMER" if le_type == "customer" else "LIST_CUSTOMERS"
        request["operation"] = operation
    role = str(state.get("user_role") or "").strip().lower()
    if not _can_access_module(role, "customers"):
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="customer",
                kind="forbidden",
                fallback="This role cannot use the customer directory.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={"denied": True, "feature": "customers"},
            ),
            "actions": [],
            "route": "customers",
            "semantic_request": request,
        }
    if reference_error:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="customer",
                kind="validation",
                fallback="Ask which previous customer they mean.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={"clarificationRequired": True, "reason": reference_error},
            ),
            "actions": [],
            "route": "customers",
            "semantic_request": request,
        }
    tool_by_op = {
        "LIST_CUSTOMERS": "list_customers",
        "SEARCH_CUSTOMERS": "list_customers",
        "GET_CUSTOMER": "list_customers",
        "GET_CUSTOMER_TICKETS": "list_tickets",
        "IMPORT_CUSTOMERS": "import_customers",
    }
    proposed = str(
        request.get("proposed_tool") or tool_by_op.get(operation) or "list_customers"
    ).strip().lower()
    if proposed not in {"list_customers", "get_customer_360", "import_customers", "list_tickets"}:
        proposed = tool_by_op.get(operation) or "list_customers"
    if operation == "IMPORT_CUSTOMERS" and role != "admin":
        from app.tasks.chat_commands import _llm_phrase as _phrase_denied

        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _phrase_denied(
                module="customer",
                kind="forbidden",
                fallback="Only admins can import customers.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={"denied": True, "feature": "import customers"},
            ),
            "actions": [{"type": "navigate", "view": "customers"}],
            "route": "customers",
            "semantic_request": request,
        }
    authorize_tool(
        agent="customers",
        tool_name=proposed,
        operation=operation,
        role=state.get("user_role"),
        workflow=state.get("current_workflow"),
    )
    filters = dict(request.get("filters") or {})
    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    actor = ToolActor(
        user_id=str(state.get("user_id") or "").strip(),
        organization_id=str(state.get("organization_id") or "").strip(),
        user_role=state.get("user_role"),
        user_name=state.get("user_name"),
    )
    resolved = (
        request.get("resolved_entity")
        if isinstance(request.get("resolved_entity"), dict)
        else {}
    )
    query = str(
        filters.get("query")
        or request.get("entity_name")
        or fields.get("name")
        or resolved.get("name")
        or ""
    ).strip()
    customer_id = str(
        filters.get("id")
        or (resolved.get("id") if str(resolved.get("type") or "").lower() == "customer" else "")
        or ""
    ).strip()
    status = str(filters.get("status") or fields.get("status") or "").strip() or None
    if status:
        status = "Inactive" if status.lower().startswith("inact") else "Active" if status.lower().startswith("act") else status
    exact_email = str(filters.get("email") or fields.get("email") or "").strip() or None
    exact_phone = str(filters.get("phone") or fields.get("phone") or "").strip() or None
    csv_text = str(fields.get("csv_text") or filters.get("csv_text") or "").strip()
    count_only = _count_only_utterance(text)

    def _fail(result: dict[str, Any]) -> dict[str, Any]:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="customer",
                kind="forbidden" if result.get("error_code") == "FORBIDDEN" else "validation",
                fallback="Explain that the live customer request failed.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={"errorCode": result.get("error_code"), "unavailable": True},
            ),
            "actions": [],
            "route": "customers",
            "semantic_request": request,
        }

    def _ok(reply: str, *, rows=None, extra=None, tool="list_customers", refresh=False):
        actions: list[dict[str, Any]] = [{"type": "navigate", "view": "customers"}]
        if not count_only and operation in {
            "LIST_CUSTOMERS",
            "SEARCH_CUSTOMERS",
            "GET_CUSTOMER",
        }:
            filt: dict[str, Any] = {"type": "set_filter", "module": "customers", "query": query}
            if status:
                filt["status"] = status
            if query or status:
                actions.append(filt)
        if refresh:
            actions.append({"type": "refresh_customers"})
        data: dict[str, Any] = {
            "last_query": {"entity": "customers", "operation": operation, "filters": filters},
            "success": True,
            "_tool_name": tool,
        }
        if rows is not None:
            data["customers"] = rows[:8]
            data["customerCount"] = len(rows)
        if extra:
            data.update(extra)
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": actions,
            "route": "customers",
            "semantic_request": request,
            "data": data,
        }

    if operation == "IMPORT_CUSTOMERS":
        if not csv_text:
            phrase = _llm_phrase(
                module="customer",
                kind="validation",
                fallback=(
                    "Ask them to pick a CSV, TSV, or Excel file in chat to "
                    "import customers or contacts."
                ),
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={
                    "nextStep": "pick import file in chat",
                    "needsFile": True,
                    "formats": [".csv", ".tsv", ".xlsx", ".xls"],
                },
            )
            return {
                **(parked_result or {}),
                "handled": True,
                "workflow_handled": True,
                "reply": phrase,
                "actions": [
                    {"type": "navigate", "view": "customers"},
                    {"type": "open_customer_import", "needsFile": True},
                ],
                "route": "customers",
                "semantic_request": request,
                "data": {
                    "last_query": {
                        "entity": "customers",
                        "operation": operation,
                        "filters": filters,
                    },
                    "success": True,
                    "needsFile": True,
                },
            }
        with tool_actor_scope(actor):
            result = import_customers(csv_text=csv_text)
        if not result.get("success"):
            return _fail(result)
        payload = _tool_payload(result)
        return _ok(
            _llm_phrase(
                module="customer",
                kind="created",
                fallback="Report created, customers, and errors from the import tool JSON only.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={
                    "created": payload.get("created"),
                    "customers": payload.get("customers"),
                    "errors": payload.get("errors"),
                },
            ),
            extra=payload if isinstance(payload, dict) else {},
            tool="import_customers",
            refresh=True,
        )

    with tool_actor_scope(actor):
        listed = list_customers(
            query=query or None,
            exact_email=exact_email,
            exact_phone=exact_phone,
            status=status,
        )
    if not listed.get("success"):
        return _fail(listed)
    rows = _catalog_rows(listed)

    if operation in {"LIST_CUSTOMERS", "SEARCH_CUSTOMERS"} and operation != "GET_CUSTOMER":
        reply = _llm_phrase(
            module="customer",
            kind="filter",
            fallback="Summarize directory rows from tool JSON only.",
            user_text=text,
            page_label=state.get("page") or "Customers",
            context={
                "customerCount": len(rows),
                "metricsOnly": count_only,
                "status": status,
                "customers": [
                    {
                        "name": _row_label(r, "name", "fullName"),
                        "email": r.get("email"),
                        "status": r.get("status"),
                        "totalTickets": r.get("totalTickets") or r.get("ticketCount"),
                    }
                    for r in rows[:8]
                ],
            },
        )
        return _ok(reply, rows=rows)

    hit, ambiguous = _match_named_rows(rows, query, "name", "fullName", "email")
    if customer_id:
        by_id = _row_by_id(rows, customer_id)
        if by_id:
            hit, ambiguous = by_id, []
    if ambiguous and not hit:
        return _ok(
            _llm_phrase(
                module="customer",
                kind="validation",
                fallback="Several customers match. Ask which one.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={
                    "ambiguous": True,
                    "matches": [
                        {"name": _row_label(r, "name", "fullName"), "email": r.get("email")}
                        for r in ambiguous[:8]
                    ],
                },
            ),
            rows=ambiguous,
        )
    if not hit and (operation in {"GET_CUSTOMER", "GET_CUSTOMER_TICKETS"}):
        return _ok(
            _llm_phrase(
                module="customer",
                kind="validation",
                fallback="No matching customer was found.",
                user_text=text,
                page_label=state.get("page") or "Customers",
                context={"missing": True, "query": query},
            ),
            rows=[],
        )
    if hit and operation == "GET_CUSTOMER":
        email = str(hit.get("email") or exact_email or "").strip()
        extra: dict[str, Any] = {"customer": hit}
        if email:
            with tool_actor_scope(actor):
                c360 = get_customer_360(email=email)
            if c360.get("success"):
                extra["customer360"] = _tool_payload(c360) or c360.get("payload")
        reply = _llm_phrase(
            module="customer",
            kind="filter",
            fallback="Describe this customer using only tool JSON, including totalTickets when present.",
            user_text=text,
            page_label=state.get("page") or "Customers",
            context={
                "customer": {
                    "name": _row_label(hit, "name", "fullName"),
                    "email": hit.get("email"),
                    "phone": hit.get("phone"),
                    "status": hit.get("status"),
                    "totalTickets": hit.get("totalTickets") or hit.get("ticketCount"),
                },
                "customer360": extra.get("customer360"),
            },
        )
        return _ok(reply, rows=[hit], extra=extra, tool="get_customer_360" if extra.get("customer360") else "list_customers")

    if hit and operation == "GET_CUSTOMER_TICKETS":
        email = str(hit.get("email") or exact_email or "").strip()
        name = _row_label(hit, "name", "fullName")
        with tool_actor_scope(actor):
            tickets = list_tickets(
                limit=25,
                customer=name or email or query,
                status=filters.get("ticket_status") or filters.get("ticketStatus"),
                priority=filters.get("priority"),
            )
            c360 = get_customer_360(email=email) if email else {"success": False}
        t_rows = _tickets_from_tool_result(tickets) if tickets.get("success") else []
        payload_360 = _tool_payload(c360) if c360.get("success") else {}
        total = (
            payload_360.get("totalTickets")
            or hit.get("totalTickets")
            or hit.get("ticketCount")
            or len(t_rows)
        )
        summary = _format_ticket_list_details(t_rows, limit=8) if t_rows else ""
        reply = _llm_phrase(
            module="customer",
            kind="filter",
            fallback="Report this customer's ticket count from tool JSON. Stay on Customers.",
            user_text=text,
            page_label=state.get("page") or "Customers",
            context={
                "customerName": name,
                "totalTickets": total,
                "listSummary": summary,
                "openCount": sum(
                    1 for r in t_rows if str(r.get("status") or "").lower() in {"open", "pending"}
                ),
            },
        )
        return _ok(
            reply,
            rows=[hit],
            extra={"tickets": t_rows[:8], "totalTickets": total, "customer360": payload_360},
            tool="list_tickets",
        )

    return _ok(
        _llm_phrase(
            module="customer",
            kind="filter",
            fallback="Summarize directory rows from tool JSON only.",
            user_text=text,
            page_label=state.get("page") or "Customers",
            context={"customerCount": len(rows)},
        ),
        rows=rows,
    )


def _admin_range_from_filters(filters: dict[str, Any], *, kind: str) -> str | None:
    explicit = str(filters.get("range") or "").strip()
    if kind == "analytics" and explicit in {"24hours", "7days", "30days"}:
        return explicit
    if kind == "csat" and explicit in {"7days", "30days", "90days"}:
        return explicit
    created = str(filters.get("created_range") or filters.get("updated_range") or "").lower()
    if kind == "analytics":
        if created in {"today", "last_24h", "yesterday"}:
            return "24hours"
        if created in {"this_month", "last_month", "last_30d"}:
            return "30days"
        if created in {"last_90d"}:
            return None
        return "7days"
    if created in {"last_90d"}:
        return "90days"
    if created in {"today", "last_24h", "yesterday", "this_week", "last_week", "last_7d"}:
        return "7days"
    return "30days"


def _admin_view_for_topic(topic: str | None, page: str | None) -> str:
    page_l = str(page or "").lower()
    t = str(topic or "").lower()
    if t == "csat" or "csat" in page_l:
        return "csat-reports"
    if t == "audit" or "audit" in page_l:
        return "audit"
    if t == "directory" or "escalation" in page_l:
        return "escalation-directory"
    if t == "org_prefs" or any(x in page_l for x in ("org-pref", "org pref", "settings")):
        return "org-preferences"
    if t in {"priorities", "statuses"} or "priorit" in page_l or (
        "status" in page_l and "ticket" not in page_l
    ):
        return "priorities"
    return "analytics"


def _execute_macro_query(
    state: AgentState,
    text: str,
    decision: dict[str, Any],
    *,
    parked_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tasks.chat_commands import _can_access_module, _llm_phrase
    from app.tools.catalog_tools import list_macros
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.macro_write import delete_macro, update_macro
    from app.tools.registry import authorize_tool
    from app.workflow_state import conversation_context_from_state, resolve_query_reference

    context = conversation_context_from_state(dict(state))
    request, reference_error = resolve_query_reference(decision, context)
    operation = str(request.get("operation") or "").strip().upper()
    le = context.get("last_entity") if isinstance(context.get("last_entity"), dict) else {}
    le_type = str(le.get("type") or "").strip().lower()
    if operation in {"", "NONE"} and le_type in {"macro"}:
        operation = "GET_MACRO"
        request["operation"] = operation
    if operation == "GET_METRICS":
        operation = "LIST_MACROS"
        request["operation"] = operation
    if operation not in _MACRO_QUERY_OPS:
        operation = "GET_MACRO" if le_type == "macro" else "LIST_MACROS"
        request["operation"] = operation
    if reference_error:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="macro",
                kind="validation",
                fallback="Ask which previous macro list they mean.",
                user_text=text,
                page_label=state.get("page") or "Macros",
                context={"clarificationRequired": True, "reason": reference_error},
            ),
            "actions": [],
            "route": "macros",
            "semantic_request": request,
        }
    tool_by_op = {
        "LIST_MACROS": "list_macros",
        "SEARCH_MACROS": "list_macros",
        "GET_MACRO": "list_macros",
        "UPDATE_MACRO": "update_macro",
        "DELETE_MACRO": "delete_macro",
    }
    proposed = str(
        request.get("proposed_tool") or tool_by_op.get(operation) or "list_macros"
    ).strip().lower()
    if proposed not in {"list_macros", "update_macro", "delete_macro"}:
        proposed = tool_by_op.get(operation) or "list_macros"
    authorize_tool(
        agent="macros",
        tool_name=proposed,
        operation=operation,
        role=state.get("user_role"),
        workflow=state.get("current_workflow"),
    )
    filters = dict(request.get("filters") or {})
    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    prior_query = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    pending = prior_query.get("pending_update") if isinstance(prior_query.get("pending_update"), dict) else {}
    pending_delete = prior_query.get("pending_delete") if isinstance(prior_query.get("pending_delete"), dict) else {}
    action = str(request.get("action") or decision.get("action") or "").strip().upper()
    role = str(state.get("user_role") or "").strip().lower()
    actor = ToolActor(
        user_id=str(state.get("user_id") or "").strip(),
        organization_id=str(state.get("organization_id") or "").strip(),
        user_role=state.get("user_role"),
        user_name=state.get("user_name"),
    )
    query = str(
        filters.get("query")
        or request.get("entity_name")
        or fields.get("title")
        or (
            (request.get("resolved_entity") or {}).get("name")
            if isinstance(request.get("resolved_entity"), dict)
            else ""
        )
        or ""
    ).strip()
    macro_id = str(
        filters.get("id")
        or (
            (request.get("resolved_entity") or {}).get("id")
            if isinstance(request.get("resolved_entity"), dict)
            and str((request.get("resolved_entity") or {}).get("type") or "").lower()
            == "macro"
            else ""
        )
        or ""
    ).strip()
    count_only = _count_only_utterance(text)

    def _fail(result: dict[str, Any]) -> dict[str, Any]:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="macro",
                kind="forbidden" if result.get("error_code") == "FORBIDDEN" else "validation",
                fallback="Explain that the live macros request failed.",
                user_text=text,
                page_label=state.get("page") or "Macros",
                context={"errorCode": result.get("error_code"), "unavailable": True},
            ),
            "actions": [],
            "route": "macros",
            "semantic_request": request,
        }

    def _ok(reply: str, *, rows=None, extra=None, tool="list_macros", refresh=False, last_query=None):
        actions: list[dict[str, Any]] = [{"type": "navigate", "view": "macros"}]
        if not count_only and operation in {"LIST_MACROS", "SEARCH_MACROS", "GET_MACRO"} and query:
            actions.append({"type": "set_filter", "module": "macros", "query": query})
        if refresh:
            actions.append({"type": "refresh_macros"})
        pending_del = (
            (last_query or {}).get("pending_delete")
            if isinstance((last_query or {}).get("pending_delete"), dict)
            else {}
        )
        if pending_del:
            actions.append(
                {
                    "type": "delete_macro",
                    "id": str(pending_del.get("id") or "").strip(),
                    "title": str(pending_del.get("title") or "").strip(),
                    "step": "confirm",
                }
            )
        data: dict[str, Any] = {
            "last_query": last_query
            or {"entity": "macros", "operation": operation, "filters": filters},
            "success": True,
            "_tool_name": tool,
        }
        if rows is not None:
            data["macros"] = rows[:8]
            data["macroCount"] = len(rows)
        if extra:
            data.update(extra)
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": actions,
            "route": "macros",
            "semantic_request": request,
            "data": data,
        }

    if not _can_access_module(role, "macros"):
        return _ok(
            _llm_phrase(
                module="macro",
                kind="forbidden",
                fallback="This role cannot open macros.",
                user_text=text,
                page_label=state.get("page") or "Macros",
                context={"denied": True, "feature": "macros"},
            ),
            rows=[],
        )

    with tool_actor_scope(actor):
        listed = list_macros(query=query or None)
    if not listed.get("success"):
        return _fail(listed)
    rows = _catalog_rows(listed)

    if action == "CANCEL_WORKFLOW":
        return _ok(
            _llm_phrase(
                module="macro",
                kind="validation",
                fallback="Acknowledge the macro change was cancelled.",
                user_text=text,
                page_label=state.get("page") or "Macros",
                context={"cancelled": True},
            ),
            last_query={"entity": "macros", "operation": operation, "filters": filters},
        )

    if operation in {"LIST_MACROS", "SEARCH_MACROS"}:
        reply = _llm_phrase(
            module="macro",
            kind="filter",
            fallback="Summarize live macros from tool JSON. Do not invent titles or bodies.",
            user_text=text,
            page_label=state.get("page") or "Macros",
            context={
                "macroCount": len(rows),
                "metricsOnly": count_only,
                "macros": [
                    {"title": _row_label(r, "title", "name"), "id": r.get("id")}
                    for r in rows[:8]
                ],
            },
        )
        return _ok(reply, rows=rows)

    hit, ambiguous = _match_named_rows(rows, query, "title", "name")
    if macro_id:
        by_id = _row_by_id(rows, macro_id)
        if by_id:
            hit, ambiguous = by_id, []
    if operation == "GET_MACRO":
        if ambiguous:
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="validation",
                    fallback="Several macros match. Ask which one.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={
                        "ambiguous": True,
                        "matches": [_row_label(r, "title", "name") for r in ambiguous[:8]],
                    },
                ),
                rows=ambiguous,
            )
        if not hit:
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="validation",
                    fallback="No matching macro was found.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={"missing": True, "query": query},
                ),
                rows=[],
            )
        return _ok(
            _llm_phrase(
                module="macro",
                kind="filter",
                fallback="Describe this macro using only tool JSON title and body.",
                user_text=text,
                page_label=state.get("page") or "Macros",
                context={
                    "macro": {
                        "title": _row_label(hit, "title", "name"),
                        "body": hit.get("body"),
                    }
                },
            ),
            rows=[hit],
            extra={"macro": hit},
        )

    if operation in {"UPDATE_MACRO", "DELETE_MACRO"} or pending or pending_delete:
        if role != "admin" and operation in {"UPDATE_MACRO", "DELETE_MACRO"}:
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="forbidden",
                    fallback="Only admins can change macros.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={"denied": True, "feature": operation.lower()},
                ),
                rows=rows,
            )
        target = pending_delete or pending or hit
        if not target and query:
            target, ambiguous = _match_named_rows(rows, query, "title", "name")
            if ambiguous:
                return _ok(
                    _llm_phrase(
                        module="macro",
                        kind="validation",
                        fallback="Several macros match. Ask which one.",
                        user_text=text,
                        page_label=state.get("page") or "Macros",
                        context={
                            "ambiguous": True,
                            "matches": [_row_label(r, "title", "name") for r in ambiguous[:8]],
                        },
                    ),
                    rows=ambiguous,
                )
        if not target:
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="validation",
                    fallback="Ask which macro to update or delete.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={"nextStep": "macro title"},
                )
            )
        mid = str(target.get("id") or "").strip()
        title = _row_label(target, "title", "name")
        if operation == "DELETE_MACRO" or pending_delete:
            if action == "CANCEL_WORKFLOW":
                return _ok(
                    _llm_phrase(
                        module="macro",
                        kind="validation",
                        fallback="Acknowledge the macro delete was cancelled.",
                        user_text=text,
                        page_label=state.get("page") or "Macros",
                        context={"macroTitle": title, "cancelled": True},
                    ),
                    last_query={"entity": "macros", "operation": "DELETE_MACRO", "filters": {"query": title}},
                )
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="confirm",
                    fallback="Ask to confirm deleting this macro.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={"macroTitle": title, "nextStep": "confirm or cancel"},
                ),
                last_query={
                    "entity": "macros",
                    "operation": "DELETE_MACRO",
                    "filters": {"query": title},
                    "pending_delete": {"id": mid, "title": title},
                    "proposed_tool": "delete_macro",
                },
            )
        new_title = str(fields.get("title") or pending.get("title") or "").strip() or None
        new_body = str(fields.get("body") or pending.get("body") or "").strip() or None
        if not new_title and not new_body:
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="validation",
                    fallback="Ask what title or body to change.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={"macroTitle": title, "nextStep": "new title or body"},
                ),
                extra={"macro": target},
            )
        if new_body:
            return _ok(
                _llm_phrase(
                    module="macro",
                    kind="confirm",
                    fallback="Confirm replacing this macro body.",
                    user_text=text,
                    page_label=state.get("page") or "Macros",
                    context={"macroTitle": title, "nextStep": "confirm or cancel"},
                ),
                last_query={
                    "entity": "macros",
                    "operation": "UPDATE_MACRO",
                    "filters": {"query": title},
                    "pending_update": {"id": mid, "title": new_title, "body": new_body},
                    "proposed_tool": "update_macro",
                },
            )
        with tool_actor_scope(actor):
            result = update_macro(mid, title=new_title, body=new_body)
        if not result.get("success"):
            return _fail(result)
        return _ok(
            _llm_phrase(
                module="macro",
                kind="created",
                fallback="Confirm the macro was updated from tool JSON only.",
                user_text=text,
                page_label=state.get("page") or "Macros",
                context={"macroTitle": new_title or title, "updated": True},
            ),
            tool="update_macro",
            refresh=True,
        )

    return _ok(
        _llm_phrase(
            module="macro",
            kind="filter",
            fallback="Summarize live macros from tool JSON.",
            user_text=text,
            page_label=state.get("page") or "Macros",
            context={"macroCount": len(rows)},
        ),
        rows=rows,
    )


def _catalog_active_from_decision(decision: dict[str, Any]) -> bool | None:
    """Toggle from Super Agent fields.active — not utterance keywords."""
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    if "active" in fields:
        val = fields.get("active")
        if isinstance(val, bool):
            return val
        if str(val).strip().lower() in {"false", "0", "no", "off"}:
            return False
        if str(val).strip().lower() in {"true", "1", "yes", "on"}:
            return True
    op = str(decision.get("operation") or "").strip().upper()
    if op.startswith("TOGGLE_") and isinstance(fields.get("active"), bool):
        return fields.get("active")
    if op.startswith("DELETE_"):
        return None
    return None


def _execute_admin_query(
    state: AgentState,
    text: str,
    decision: dict[str, Any],
    *,
    parked_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tasks.chat_commands import _can_access_module, _llm_phrase
    from app.tools.catalog_tools import (
        ask_semantic_layer,
        create_widget,
        export_analytics,
        get_analytics,
        get_csat_reports,
        get_org_preferences,
        list_audit,
        list_escalation_directory,
        list_integration_keys,
        list_priorities,
        list_statuses,
        list_widgets,
        update_org_preferences,
        update_priority,
        update_status,
        delete_priority,
        delete_status,
    )
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import authorize_tool
    from app.tools.ticket_read import list_tickets
    from app.workflow_state import conversation_context_from_state, resolve_query_reference

    context = conversation_context_from_state(dict(state))
    request, reference_error = resolve_query_reference(decision, context)
    operation = str(request.get("operation") or "").strip().upper()
    filters = dict(request.get("filters") or {})
    page = str(state.get("page") or "")
    topic = str(filters.get("topic") or "").strip().lower() or _admin_topic_from_page(page) or ""
    if operation == "GET_METRICS":
        operation = "GET_CSAT" if topic == "csat" else "GET_ANALYTICS"
        request["operation"] = operation
        filters["topic"] = topic or ("csat" if operation == "GET_CSAT" else "analytics")
    if operation == "COMPARE" and topic in {"", "analytics", "csat", "volume", "channel", "performance", "sla"}:
        if topic == "csat":
            operation = "GET_CSAT"
        else:
            operation = "GET_ANALYTICS"
        request["operation"] = operation
        filters["topic"] = topic or "analytics"
        filters["compare"] = True
    wanted_active = _catalog_active_from_decision(request if request else decision)
    if wanted_active is not None:
        status_catalog = (
            operation.endswith("_STATUS")
            or operation.endswith("_STATUSES")
            or topic in {"statuses", "status"}
        )
        priority_catalog = (
            operation.endswith("_PRIORITY")
            or operation.endswith("_PRIORITIES")
            or topic in {"priorities", "priority"}
        )
        if status_catalog and not priority_catalog:
            operation = "TOGGLE_STATUS"
            filters["topic"] = "statuses"
        else:
            operation = "TOGGLE_PRIORITY"
            filters["topic"] = filters.get("topic") or "priorities"
        request["operation"] = operation
        request["proposed_tool"] = "update_status" if status_catalog and not priority_catalog else "update_priority"
        fields_early = request.get("fields") if isinstance(request.get("fields"), dict) else {}
        request["fields"] = {**fields_early, "active": wanted_active}
    if operation not in _ADMIN_QUERY_OPS:
        if topic == "csat":
            operation = "GET_CSAT"
        elif topic == "audit":
            operation = "LIST_AUDIT"
        elif topic in {"priorities", "priority"}:
            operation = "LIST_PRIORITIES"
        elif topic in {"statuses", "status"}:
            operation = "LIST_STATUSES"
        elif topic == "directory":
            operation = "LIST_DIRECTORY"
        elif topic == "org_prefs":
            operation = "GET_ORG_PREFERENCES"
        else:
            operation = "GET_ANALYTICS"
        request["operation"] = operation
    if not filters.get("topic") and topic:
        filters["topic"] = topic
    if reference_error:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="admin",
                kind="validation",
                fallback="Ask which previous admin report they mean.",
                user_text=text,
                page_label=state.get("page") or "Admin",
                context={"clarificationRequired": True, "reason": reference_error},
            ),
            "actions": [],
            "route": "admin",
            "semantic_request": request,
        }
    tool_by_op = {
        "GET_ANALYTICS": "ask_semantic_layer",
        "COMPARE": "ask_semantic_layer",
        "EXPORT_ANALYTICS": "export_analytics",
        "GET_CSAT": "ask_semantic_layer",
        "LIST_AUDIT": "list_audit",
        "SEARCH_AUDIT": "list_audit",
        "LIST_PRIORITIES": "list_priorities",
        "GET_PRIORITY": "list_priorities",
        "UPDATE_PRIORITY": "update_priority",
        "TOGGLE_PRIORITY": "update_priority",
        "DELETE_PRIORITY": "delete_priority",
        "LIST_STATUSES": "list_statuses",
        "GET_STATUS": "list_statuses",
        "UPDATE_STATUS": "update_status",
        "TOGGLE_STATUS": "update_status",
        "DELETE_STATUS": "delete_status",
        "LIST_DIRECTORY": "list_escalation_directory",
        "SEARCH_DIRECTORY": "list_escalation_directory",
        "FIND_SKILL": "list_escalation_directory",
        "GET_ORG_PREFERENCES": "get_org_preferences",
        "UPDATE_ORG_PREFERENCES": "update_org_preferences",
        "LIST_WIDGETS": "list_widgets",
        "CREATE_WIDGET": "create_widget",
        "LIST_API_KEYS": "list_integration_keys",
    }
    proposed = str(
        request.get("proposed_tool") or tool_by_op.get(operation) or "ask_semantic_layer"
    ).strip().lower()
    if proposed == "list_tickets" and operation == "GET_ANALYTICS":
        pass
    elif proposed not in set(tool_by_op.values()) | {"list_tickets", "ask_semantic_layer"}:
        proposed = tool_by_op.get(operation) or "ask_semantic_layer"
    auth_op = "LIST_TEAMS" if operation == "COMPARE" and proposed == "list_queues" else operation
    if auth_op not in _ADMIN_QUERY_OPS:
        auth_op = operation
    authorize_tool(
        agent="admin",
        tool_name=proposed if proposed != "list_tickets" else "list_tickets",
        operation=operation if proposed != "list_tickets" else "GET_ANALYTICS",
        role=state.get("user_role"),
        workflow=state.get("current_workflow"),
    )
    fields = request.get("fields") if isinstance(request.get("fields"), dict) else {}
    prior_query = context.get("last_query") if isinstance(context.get("last_query"), dict) else {}
    pending = prior_query.get("pending_update") if isinstance(prior_query.get("pending_update"), dict) else {}
    pending_delete = prior_query.get("pending_delete") if isinstance(prior_query.get("pending_delete"), dict) else {}
    action = str(request.get("action") or decision.get("action") or "").strip().upper()
    role = str(state.get("user_role") or "").strip().lower()
    actor = ToolActor(
        user_id=str(state.get("user_id") or "").strip(),
        organization_id=str(state.get("organization_id") or "").strip(),
        user_role=state.get("user_role"),
        user_name=state.get("user_name"),
    )
    query = str(
        filters.get("query")
        or request.get("entity_name")
        or fields.get("displayName")
        or fields.get("name")
        or fields.get("title")
        or ""
    ).strip()
    count_only = _count_only_utterance(text)
    view = _admin_view_for_topic(filters.get("topic") or topic, page)
    refresh_type = {
        "analytics": "refresh_analytics",
        "csat-reports": "refresh_csat",
        "audit": "refresh_audit",
        "priorities": "refresh_priorities",
        "org-preferences": "refresh_org_preferences",
        "escalation-directory": "refresh_directory",
    }.get(view)

    def _fail(result: dict[str, Any]) -> dict[str, Any]:
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": _llm_phrase(
                module="admin",
                kind="forbidden" if result.get("error_code") == "FORBIDDEN" else "validation",
                fallback="Explain that the live admin request failed without inventing numbers.",
                user_text=text,
                page_label=state.get("page") or view,
                context={"errorCode": result.get("error_code"), "unavailable": True},
            ),
            "actions": [],
            "route": "admin",
            "semantic_request": request,
        }

    def _ok(
        reply: str,
        *,
        extra=None,
        tool=None,
        refresh=False,
        last_query=None,
        download=None,
        filter_query=None,
        filter_range=None,
    ):
        actions: list[dict[str, Any]] = [{"type": "navigate", "view": view}]
        filter_mod = {
            "analytics": "analytics",
            "csat-reports": "csat",
            "audit": "audit",
            "escalation-directory": "directory",
        }.get(view)
        q = str(filter_query or "").strip()
        rng = str(filter_range or "").strip()
        if filter_mod and (q or rng):
            filt: dict[str, Any] = {"type": "set_filter", "module": filter_mod, "query": q}
            if rng:
                filt["range"] = rng
            actions.append(filt)
        if refresh and refresh_type:
            actions.append({"type": refresh_type})
        if download:
            actions.append({"type": "download", **download})
        pending_del = (
            (last_query or {}).get("pending_delete")
            if isinstance((last_query or {}).get("pending_delete"), dict)
            else {}
        )
        if pending_del:
            kind = str(pending_del.get("kind") or "priority").strip().lower()
            if kind not in {"priority", "status"}:
                kind = "priority"
            actions.append(
                {
                    "type": f"delete_{kind}",
                    "id": str(pending_del.get("id") or "").strip(),
                    "displayName": str(pending_del.get("displayName") or "").strip(),
                    "kind": kind,
                    "step": "confirm",
                }
            )
        data: dict[str, Any] = {
            "last_query": last_query
            or {"entity": "admin", "operation": operation, "filters": filters},
            "success": True,
            "_tool_name": tool or tool_by_op.get(operation) or proposed,
        }
        if extra:
            data.update(extra)
        return {
            **(parked_result or {}),
            "handled": True,
            "workflow_handled": True,
            "reply": reply,
            "actions": actions,
            "route": "admin",
            "semantic_request": request,
            "data": data,
        }

    module_need = {
        "analytics": "analytics",
        "csat-reports": "csat-reports",
        "audit": "audit",
        "priorities": "priorities",
        "escalation-directory": "escalation-directory",
        "org-preferences": "org-preferences",
    }.get(view, "analytics")
    if not _can_access_module(role, module_need):
        return _ok(
            _llm_phrase(
                module="admin",
                kind="forbidden",
                fallback="This role cannot open that admin page.",
                user_text=text,
                page_label=state.get("page") or view,
                context={"denied": True, "feature": module_need},
            )
        )

    if action == "CANCEL_WORKFLOW":
        return _ok(
            _llm_phrase(
                module="admin",
                kind="validation",
                fallback="Acknowledge the admin change was cancelled.",
                user_text=text,
                page_label=state.get("page") or view,
                context={"cancelled": True},
            )
        )

    custom_from = filters.get("from") or filters.get("to") or fields.get("from") or fields.get("to")
    if custom_from and operation in {"GET_ANALYTICS", "GET_CSAT", "COMPARE", "EXPORT_ANALYTICS"}:
        presets = "24hours, 7days, or 30days" if operation != "GET_CSAT" else "7days, 30days, or 90days"
        return _ok(
            _llm_phrase(
                module="admin",
                kind="validation",
                fallback=f"Ask them to pick a UI date preset ({presets}). Custom from/to is not supported yet.",
                user_text=text,
                page_label=state.get("page") or view,
                context={"unsupportedRange": True, "presets": presets},
            )
        )

    # --- Analytics / CSAT ---
    if operation in {"GET_ANALYTICS", "COMPARE", "EXPORT_ANALYTICS"}:
        rng = _admin_range_from_filters(filters, kind="analytics")
        if rng is None:
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="validation",
                    fallback="Ask them to pick 24hours, 7days, or 30days. Custom from/to is not supported yet.",
                    user_text=text,
                    page_label=state.get("page") or "Analytics",
                    context={"unsupportedRange": True},
                )
            )
        if operation == "EXPORT_ANALYTICS":
            with tool_actor_scope(actor):
                exported = export_analytics(chart_range=rng)
            payload = _tool_payload(exported) if exported.get("success") else {}
            href = str(payload.get("href") or f"/api/analytics/export?range={rng}")
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="filter",
                    fallback="Tell them the Analytics export is ready via the Export control. Do not dump CSV.",
                    user_text=text,
                    page_label=state.get("page") or "Analytics",
                    context={"export": True, "range": rng, "href": href},
                ),
                extra={"export": payload or {"href": href, "range": rng}},
                tool="export_analytics",
                refresh=True,
                download={"href": href, "filename": f"worktual-analytics-{rng}.csv"},
                filter_range=rng,
            )
        from app.tools.insights_routing import (
            classify_insights_question,
            log_insights_routing,
            semantic_result_usable,
            try_ontology_narrative,
            try_semantic_metrics,
        )

        org_id = str(state.get("organization_id") or "") or None
        session_id = str(state.get("session_id") or "") or None
        insights_kind = classify_insights_question(text)
        semantic_result = None
        ontology_result = None

        if insights_kind in ("why", "both"):
            with tool_actor_scope(actor):
                ontology_result = try_ontology_narrative(
                    text,
                    organization_id=org_id,
                    session_id=session_id,
                )
            log_insights_routing(
                kind=insights_kind,
                tool="ask_knowledge_graph",
                success=bool(ontology_result and ontology_result.get("success")),
                user_text=text,
                organization_id=org_id,
            )

        query = (text or "").strip() or f"Ticketing analytics overview for range {rng}"
        if insights_kind in ("values", "both"):
            with tool_actor_scope(actor):
                semantic_result = try_semantic_metrics(
                    query,
                    organization_id=org_id,
                )
            log_insights_routing(
                kind=insights_kind,
                tool="ask_semantic_layer",
                success=semantic_result_usable(semantic_result),
                fallback=None
                if semantic_result_usable(semantic_result)
                else "get_analytics",
                user_text=text,
                organization_id=org_id,
            )

        sem_ok = semantic_result_usable(semantic_result)
        ont_ok = bool(ontology_result and ontology_result.get("success"))
        used_tool = "get_analytics"
        if sem_ok and ont_ok:
            used_tool = "ask_semantic_layer+ask_knowledge_graph"
            result = {"success": True, "payload": semantic_result.get("payload")}
            payload = _tool_payload(result)
            ontology_payload = ontology_result.get("payload")
        elif ont_ok and insights_kind == "why" and not sem_ok:
            used_tool = "ask_knowledge_graph"
            result = {"success": True, "payload": ontology_result.get("payload")}
            payload = _tool_payload(result)
            ontology_payload = None
        elif sem_ok:
            used_tool = "ask_semantic_layer"
            result = semantic_result
            payload = _tool_payload(result)
            ontology_payload = None
        else:
            with tool_actor_scope(actor):
                result = get_analytics(chart_range=rng)
            ontology_payload = None
            if not result.get("success"):
                return _fail(result)
            payload = _tool_payload(result)
        wants_ticket_list = bool(
            re.search(r"\b(list|show|display)\b", text or "", re.I)
            and re.search(r"\btickets?\b", text or "", re.I)
        )
        extra: dict[str, Any] = {
            "analytics": payload,
            "range": rng,
            "semantic": used_tool.startswith("ask_semantic_layer"),
        }
        if ontology_payload is not None:
            extra["ontology"] = ontology_payload
        if used_tool == "ask_knowledge_graph":
            extra = {"ontology": payload, "range": rng}
        if wants_ticket_list:
            with tool_actor_scope(actor):
                tickets = list_tickets(limit=25, due="overdue" if "overdue" in (text or "").lower() else None)
            extra["tickets"] = _catalog_rows(tickets)[:8]
        reply = _llm_phrase(
            module="admin",
            kind="filter",
            fallback=(
                "Phrase analytics from tool JSON only. Cite real numbers from the "
                "semantic or Express payload. Never invent KPIs."
            ),
            user_text=text,
            page_label=state.get("page") or "Analytics",
            context={
                "analytics": payload if used_tool != "ask_knowledge_graph" else None,
                "ontology": payload if used_tool == "ask_knowledge_graph" else ontology_payload,
                "semanticMetrics": payload if used_tool.startswith("ask_semantic_layer") else None,
                "range": rng,
                "compare": bool(filters.get("compare")),
                "topic": filters.get("topic") or "analytics",
                "metricsOnly": count_only,
            },
        )
        return _ok(
            reply,
            extra=extra,
            tool=used_tool,
            refresh=True,
            filter_range=rng,
        )

    if operation == "GET_CSAT":
        rng = _admin_range_from_filters(filters, kind="csat") or "30days"
        from app.tools.insights_routing import (
            classify_insights_question,
            log_insights_routing,
            semantic_result_usable,
            try_ontology_narrative,
            try_semantic_metrics,
        )

        org_id = str(state.get("organization_id") or "") or None
        session_id = str(state.get("session_id") or "") or None
        insights_kind = classify_insights_question(text)
        semantic_result = None
        ontology_result = None

        if insights_kind in ("why", "both"):
            with tool_actor_scope(actor):
                ontology_result = try_ontology_narrative(
                    text,
                    organization_id=org_id,
                    session_id=session_id,
                )
            log_insights_routing(
                kind=insights_kind,
                tool="ask_knowledge_graph",
                success=bool(ontology_result and ontology_result.get("success")),
                user_text=text,
                organization_id=org_id,
            )

        query = (text or "").strip() or f"CSAT scores and response rates for range {rng}"
        if insights_kind in ("values", "both"):
            with tool_actor_scope(actor):
                semantic_result = try_semantic_metrics(
                    query,
                    organization_id=org_id,
                )
            log_insights_routing(
                kind=insights_kind,
                tool="ask_semantic_layer",
                success=semantic_result_usable(semantic_result),
                fallback=None
                if semantic_result_usable(semantic_result)
                else "get_csat_reports",
                user_text=text,
                organization_id=org_id,
            )

        sem_ok = semantic_result_usable(semantic_result)
        ont_ok = bool(ontology_result and ontology_result.get("success"))
        used_tool = "get_csat_reports"
        ontology_payload = None
        if sem_ok and ont_ok:
            used_tool = "ask_semantic_layer+ask_knowledge_graph"
            result = semantic_result
            ontology_payload = ontology_result.get("payload")
        elif ont_ok and insights_kind == "why" and not sem_ok:
            used_tool = "ask_knowledge_graph"
            result = ontology_result
        elif sem_ok:
            used_tool = "ask_semantic_layer"
            result = semantic_result
        else:
            with tool_actor_scope(actor):
                result = get_csat_reports(chart_range=rng)
        if not result.get("success"):
            return _fail(result)
        payload = _tool_payload(result)
        avg = payload.get("avgScore")
        reply = _llm_phrase(
            module="admin",
            kind="filter",
            fallback=(
                "Phrase CSAT from tool JSON only: ratings, avgScore (use — if null), "
                "lowScores, byAssignee, byTeam. Never invent scores."
            ),
            user_text=text,
            page_label=state.get("page") or "CSAT reports",
            context={
                "csat": payload if used_tool != "ask_knowledge_graph" else None,
                "ontology": payload if used_tool == "ask_knowledge_graph" else ontology_payload,
                "semanticMetrics": payload if used_tool.startswith("ask_semantic_layer") else None,
                "range": rng,
                "avgScore": avg if avg is not None and used_tool != "ask_knowledge_graph" else "—",
                "ratings": payload.get("ratings") or 0 if used_tool != "ask_knowledge_graph" else 0,
                "lowScores": payload.get("lowScores") or 0 if used_tool != "ask_knowledge_graph" else 0,
                "byAssignee": payload.get("byAssignee") or [] if used_tool != "ask_knowledge_graph" else [],
                "byTeam": payload.get("byTeam") or [] if used_tool != "ask_knowledge_graph" else [],
                "breakdown": filters.get("topic"),
                "metricsOnly": count_only,
            },
        )
        return _ok(
            reply,
            extra={"csat": payload, "range": rng},
            tool=used_tool,
            refresh=True,
            filter_range=rng,
        )

    # --- Audit ---
    if operation in {"LIST_AUDIT", "SEARCH_AUDIT"}:
        rng = str(filters.get("range") or filters.get("created_range") or "").strip() or None
        ticket_q = str(filters.get("query") or query or "").strip()
        if re.search(r"#?\d{3,}", ticket_q):
            ticket_q = re.search(r"#?\d{3,}", ticket_q).group(0)
        else:
            ticket_q = str(filters.get("customer") or "").strip() or ticket_q
        actor_name = str(filters.get("actor") or filters.get("assigned_to") or "").strip()
        action_f = str(filters.get("action") or filters.get("status") or "").strip()
        with tool_actor_scope(actor):
            result = list_audit(
                limit=int(filters.get("limit") or 50),
                action=action_f or None,
                actor=actor_name or None,
                ticket=ticket_q or None,
                chart_range=rng,
            )
        if not result.get("success"):
            return _fail(result)
        rows = _catalog_rows(result)
        reply = _llm_phrase(
            module="admin",
            kind="filter",
            fallback="Summarize audit events from tool JSON only. Never invent or edit rows.",
            user_text=text,
            page_label=state.get("page") or "Audit",
            context={
                "auditCount": len(rows),
                "events": [
                    {
                        "actorName": r.get("actorName"),
                        "action": r.get("action"),
                        "ticketNumber": r.get("ticketNumber"),
                        "createdAt": r.get("createdAt"),
                    }
                    for r in rows[:8]
                ],
                "metricsOnly": count_only,
            },
        )
        return _ok(
            reply,
            extra={"audit": rows[:12], "auditCount": len(rows)},
            tool="list_audit",
            refresh=True,
            filter_query=ticket_q or actor_name or None,
            filter_range=rng,
        )

    # --- Escalation directory ---
    if operation in {"LIST_DIRECTORY", "SEARCH_DIRECTORY", "FIND_SKILL"}:
        skill = str(filters.get("skill") or fields.get("category") or "").strip()
        if operation == "FIND_SKILL" and not skill:
            skill = query
        with tool_actor_scope(actor):
            result = list_escalation_directory(
                query=None if skill and operation == "FIND_SKILL" else (query or None),
                skill=skill or None,
            )
        if not result.get("success"):
            return _fail(result)
        rows = _catalog_rows(result)
        reply = _llm_phrase(
            module="admin",
            kind="filter",
            fallback=(
                "Phrase escalation directory from tool JSON only (teams, members, roles, skills, "
                "openTickets). Recommend a resolver from that JSON. Do not escalate a ticket."
            ),
            user_text=text,
            page_label=state.get("page") or "Escalation directory",
            context={
                "teamCount": len(rows),
                "skill": skill or None,
                "teams": [
                    {
                        "name": _row_label(r, "name", "queueName"),
                        "openTickets": r.get("openTickets"),
                        "members": r.get("members") or [],
                    }
                    for r in rows[:8]
                ],
                "recommendOnly": operation == "FIND_SKILL",
            },
        )
        return _ok(
            reply,
            extra={"directory": rows[:8], "teamCount": len(rows)},
            tool="list_escalation_directory",
            refresh=True,
            filter_query=(skill or query) if not count_only else None,
        )

    # --- Priorities / statuses ---
    if operation in {
        "LIST_PRIORITIES",
        "GET_PRIORITY",
        "UPDATE_PRIORITY",
        "TOGGLE_PRIORITY",
        "DELETE_PRIORITY",
        "LIST_STATUSES",
        "GET_STATUS",
        "UPDATE_STATUS",
        "TOGGLE_STATUS",
        "DELETE_STATUS",
    }:
        is_status = operation.endswith("_STATUS") or operation.endswith("_STATUSES") or topic == "statuses"
        list_fn = list_statuses if is_status else list_priorities
        label_keys = ("displayName", "name", "status", "priority")
        with tool_actor_scope(actor):
            listed = list_fn(include_inactive=True)
        if not listed.get("success"):
            return _fail(listed)
        rows = _catalog_rows(listed)
        if operation in {"LIST_PRIORITIES", "LIST_STATUSES"}:
            kind = "statuses" if is_status else "priorities"
            reply = _llm_phrase(
                module="admin",
                kind="filter",
                fallback=f"Summarize live {kind} from tool JSON only.",
                user_text=text,
                page_label=state.get("page") or "Priorities",
                context={
                    "count": len(rows),
                    kind: [
                        {
                            "displayName": _row_label(r, *label_keys),
                            "resolutionHours": r.get("resolutionHours"),
                            "active": r.get("active"),
                        }
                        for r in rows[:12]
                    ],
                    "metricsOnly": count_only,
                },
            )
            extra_key = "statuses" if is_status else "priorities"
            return _ok(
                reply,
                extra={extra_key: rows, f"{extra_key[:-1]}Count": len(rows)},
                tool="list_statuses" if is_status else "list_priorities",
                refresh=True,
            )

        hit, ambiguous = _match_named_rows(rows, query, *label_keys)
        if operation in {"GET_PRIORITY", "GET_STATUS"}:
            if ambiguous:
                return _ok(
                    _llm_phrase(
                        module="admin",
                        kind="validation",
                        fallback="Several catalog rows match. Ask which one.",
                        user_text=text,
                        page_label=state.get("page") or "Priorities",
                        context={
                            "ambiguous": True,
                            "matches": [_row_label(r, *label_keys) for r in ambiguous[:8]],
                        },
                    ),
                    extra={"matches": ambiguous[:8]},
                )
            if not hit:
                return _ok(
                    _llm_phrase(
                        module="admin",
                        kind="validation",
                        fallback="No matching priority or status was found.",
                        user_text=text,
                        page_label=state.get("page") or "Priorities",
                        context={"missing": True, "query": query},
                    )
                )
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="filter",
                    fallback="Describe this catalog row from tool JSON only.",
                    user_text=text,
                    page_label=state.get("page") or "Priorities",
                    context={"row": hit},
                ),
                extra={"row": hit},
                tool="list_statuses" if is_status else "list_priorities",
            )

        if role != "admin":
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="forbidden",
                    fallback="Only admins can change priorities or statuses.",
                    user_text=text,
                    page_label=state.get("page") or "Priorities",
                    context={"denied": True},
                )
            )
        target = pending_delete or pending or hit
        if not target and query:
            target, ambiguous = _match_named_rows(rows, query, *label_keys)
            if ambiguous:
                return _ok(
                    _llm_phrase(
                        module="admin",
                        kind="validation",
                        fallback="Several catalog rows match. Ask which one.",
                        user_text=text,
                        page_label=state.get("page") or "Priorities",
                        context={
                            "ambiguous": True,
                            "matches": [_row_label(r, *label_keys) for r in ambiguous[:8]],
                        },
                    ),
                    extra={"matches": ambiguous[:8]},
                )
        if not target:
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="validation",
                    fallback="Ask which priority or status to change.",
                    user_text=text,
                    page_label=state.get("page") or "Priorities",
                    context={"nextStep": "name"},
                )
            )
        rid = str(target.get("id") or "").strip()
        rname = _row_label(target, *label_keys)
        if wanted_active is not None:
            pending_delete = {}
        mutating_delete = (
            operation in {"DELETE_PRIORITY", "DELETE_STATUS"} or pending_delete
        ) and wanted_active is None
        if mutating_delete:
            if action == "CANCEL_WORKFLOW":
                return _ok(
                    _llm_phrase(
                        module="admin",
                        kind="validation",
                        fallback="Acknowledge the catalog delete was cancelled.",
                        user_text=text,
                        page_label=state.get("page") or "Priorities",
                        context={"name": rname, "cancelled": True},
                    ),
                    last_query={
                        "entity": "admin",
                        "operation": "DELETE_STATUS" if is_status else "DELETE_PRIORITY",
                        "filters": {"query": rname, "topic": "statuses" if is_status else "priorities"},
                    },
                )
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="confirm",
                    fallback="Confirm deleting or disabling this catalog row. System defaults may be refused.",
                    user_text=text,
                    page_label=state.get("page") or "Priorities",
                    context={"name": rname, "isSystem": target.get("isSystem"), "nextStep": "confirm or cancel"},
                ),
                last_query={
                    "entity": "admin",
                    "operation": "DELETE_STATUS" if is_status else "DELETE_PRIORITY",
                    "filters": {"query": rname, "topic": "statuses" if is_status else "priorities"},
                    "pending_delete": {"id": rid, "displayName": rname, "kind": "status" if is_status else "priority"},
                    "proposed_tool": "delete_status" if is_status else "delete_priority",
                },
            )
        hours = fields.get("resolutionHours")
        if hours is None and pending:
            hours = pending.get("resolutionHours")
        try:
            hours_val = float(hours) if hours is not None and hours != "" else None
        except (TypeError, ValueError):
            hours_val = None
        active_val = fields.get("active")
        if active_val is None and pending:
            active_val = pending.get("active")
        if isinstance(active_val, str):
            active_val = active_val.strip().lower() in {"true", "1", "active", "enable", "enabled", "on"}
            if str(fields.get("active") or pending.get("active") or "").strip().lower() in {
                "false",
                "0",
                "inactive",
                "disable",
                "disabled",
                "off",
            }:
                active_val = False
        display = str(fields.get("displayName") or pending.get("displayName") or "").strip() or None
        if operation in {"TOGGLE_PRIORITY", "TOGGLE_STATUS"} and active_val is None:
            active_val = not bool(target.get("active", True))
        if hours_val is None and display is None and active_val is None:
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="validation",
                    fallback="Ask what to change (SLA hours, display name, or active).",
                    user_text=text,
                    page_label=state.get("page") or "Priorities",
                    context={"name": rname, "nextStep": "SLA hours or active"},
                ),
                extra={"row": target},
            )
        if (
            operation in {"DELETE_PRIORITY", "DELETE_STATUS", "TOGGLE_PRIORITY", "TOGGLE_STATUS"}
            or (active_val is False)
        ):
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="confirm",
                    fallback="Confirm this catalog update.",
                    user_text=text,
                    page_label=state.get("page") or "Priorities",
                    context={"name": rname, "resolutionHours": hours_val, "active": active_val, "nextStep": "confirm or cancel"},
                ),
                last_query={
                    "entity": "admin",
                    "operation": operation,
                    "filters": {"query": rname, "topic": "statuses" if is_status else "priorities"},
                    "pending_update": {
                        "id": rid,
                        "displayName": display,
                        "resolutionHours": hours_val,
                        "active": active_val,
                        "kind": "status" if is_status else "priority",
                    },
                    "proposed_tool": "update_status" if is_status else "update_priority",
                },
            )
        with tool_actor_scope(actor):
            if is_status:
                result = update_status(rid, display_name=display, active=active_val)
            else:
                result = update_priority(
                    rid,
                    display_name=display,
                    resolution_hours=hours_val,
                    active=active_val,
                )
        if not result.get("success"):
            return _fail(result)
        return _ok(
            _llm_phrase(
                module="admin",
                kind="created",
                fallback="Confirm the catalog update from tool JSON only.",
                user_text=text,
                page_label=state.get("page") or "Priorities",
                context={"name": display or rname, "resolutionHours": hours_val, "active": active_val, "updated": True},
            ),
            extra={"row": _tool_payload(result)},
            tool="update_status" if is_status else "update_priority",
            refresh=True,
        )

    # --- Org prefs / widgets / keys ---
    if operation in {
        "GET_ORG_PREFERENCES",
        "UPDATE_ORG_PREFERENCES",
        "LIST_WIDGETS",
        "CREATE_WIDGET",
        "LIST_API_KEYS",
    }:
        if operation == "LIST_WIDGETS" or (
            operation == "GET_ORG_PREFERENCES" and re.search(r"\bwidgets?\b", text or "", re.I)
        ):
            with tool_actor_scope(actor):
                result = list_widgets()
            if not result.get("success"):
                return _fail(result)
            payload = _tool_payload(result)
            widgets = payload.get("widgets") if isinstance(payload, dict) else _catalog_rows(result)
            if not isinstance(widgets, list):
                widgets = _catalog_rows(result)
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="filter",
                    fallback="Summarize widgets from tool JSON only.",
                    user_text=text,
                    page_label=state.get("page") or "Org preferences",
                    context={"widgetCount": len(widgets), "widgets": widgets[:8]},
                ),
                extra={"widgets": widgets, "widgetCount": len(widgets)},
                tool="list_widgets",
                refresh=True,
            )
        if operation == "LIST_API_KEYS" or (
            operation == "GET_ORG_PREFERENCES" and re.search(r"\b(api\s*keys?|integration keys?)\b", text or "", re.I)
        ):
            with tool_actor_scope(actor):
                result = list_integration_keys()
            if not result.get("success"):
                return _fail(result)
            payload = _tool_payload(result)
            keys = payload.get("keys") if isinstance(payload, dict) else []
            if not isinstance(keys, list):
                keys = []
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="filter",
                    fallback="Report API key count and masked prefixes only. Never show secrets.",
                    user_text=text,
                    page_label=state.get("page") or "Org preferences",
                    context={"keyCount": len(keys), "keys": keys, "secretsHidden": True},
                ),
                extra={"keys": keys, "keyCount": len(keys)},
                tool="list_integration_keys",
                refresh=True,
            )
        if operation == "CREATE_WIDGET":
            if role != "admin":
                return _ok(
                    _llm_phrase(
                        module="admin",
                        kind="forbidden",
                        fallback="Only admins can create widgets.",
                        user_text=text,
                        page_label=state.get("page") or "Org preferences",
                        context={"denied": True},
                    )
                )
            name = str(fields.get("name") or fields.get("title") or query or "").strip()
            if not name:
                return _ok(
                    _llm_phrase(
                        module="admin",
                        kind="validation",
                        fallback="Ask for the widget name.",
                        user_text=text,
                        page_label=state.get("page") or "Org preferences",
                        context={"nextStep": "widget name"},
                    )
                )
            with tool_actor_scope(actor):
                result = create_widget(name=name)
            if not result.get("success"):
                return _fail(result)
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="created",
                    fallback="Confirm the widget was created from tool JSON. Include embed snippet if present.",
                    user_text=text,
                    page_label=state.get("page") or "Org preferences",
                    context={"widget": _tool_payload(result), "created": True},
                ),
                extra={"widget": _tool_payload(result)},
                tool="create_widget",
                refresh=True,
            )
        with tool_actor_scope(actor):
            current = get_org_preferences()
        if not current.get("success"):
            return _fail(current)
        prefs = _tool_payload(current)
        if operation == "GET_ORG_PREFERENCES":
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="filter",
                    fallback=(
                        "Phrase org preferences from tool JSON only: prefix, timezone, portal label, "
                        "sign-in mode, business type, help-center URL. Never invent URLs."
                    ),
                    user_text=text,
                    page_label=state.get("page") or "Org preferences",
                    context={"preferences": prefs},
                ),
                extra={"preferences": prefs},
                tool="get_org_preferences",
                refresh=True,
            )
        if role != "admin":
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="forbidden",
                    fallback="Only admins can change org preferences.",
                    user_text=text,
                    page_label=state.get("page") or "Org preferences",
                    context={"denied": True},
                )
            )
        patch = {
            "ticket_prefix": fields.get("ticketPrefix") or pending.get("ticket_prefix"),
            "portal_label": fields.get("portalLabel") or pending.get("portal_label"),
            "display_timezone": fields.get("displayTimezone") or pending.get("display_timezone"),
            "portal_auth_mode": fields.get("portalAuthMode") or pending.get("portal_auth_mode"),
            "business_type": fields.get("businessType") or pending.get("business_type"),
        }
        kwargs = {k: v for k, v in patch.items() if v not in (None, "")}
        if not kwargs:
            return _ok(
                _llm_phrase(
                    module="admin",
                    kind="validation",
                    fallback="Ask which org preference to change (prefix, timezone, portal label, sign-in mode, business type).",
                    user_text=text,
                    page_label=state.get("page") or "Org preferences",
                    context={"preferences": prefs, "nextStep": "which field"},
                ),
                extra={"preferences": prefs},
            )
        return _ok(
            _llm_phrase(
                module="admin",
                kind="confirm",
                fallback="Confirm this org-wide preference update.",
                user_text=text,
                page_label=state.get("page") or "Org preferences",
                context={"pending": kwargs, "nextStep": "confirm or cancel"},
            ),
            last_query={
                "entity": "admin",
                "operation": "UPDATE_ORG_PREFERENCES",
                "filters": filters,
                "pending_update": kwargs,
                "proposed_tool": "update_org_preferences",
            },
        )

    return _ok(
        _llm_phrase(
            module="admin",
            kind="filter",
            fallback="Summarize the live admin tool JSON only.",
            user_text=text,
            page_label=state.get("page") or view,
            context={"operation": operation},
        )
    )


execute_ticket_query = _execute_ticket_query
execute_team_query = _execute_team_query
execute_kb_query = _execute_kb_query
execute_customer_query = _execute_customer_query
execute_macro_query = _execute_macro_query
execute_admin_query = _execute_admin_query

_DRAFT_KEYS = (
    "escalate_draft",
    "reassign_draft",
    "macro_draft",
    "team_draft",
    "kb_draft",
    "ticket_draft",
    "priority_draft",
    "customer_draft",
    "parked_drafts",
    "current_workflow",
    "current_step",
    "workflow_data",
    "last_entity",
)

_START_ACTIONS = frozenset(
    {
        "START_CREATE_TICKET",
        "START_ESCALATE",
        "START_REASSIGN",
        "START_CREATE_CUSTOMER",
        "START_CREATE_TEAM",
        "START_ADD_TEAM_MEMBERS",
        "START_CREATE_KB",
        "START_CREATE_MACRO",
        "START_CREATE_PRIORITY",
        "START_CREATE_STATUS",
    }
)
_START_ACTION_AGENT = {
    "START_CREATE_TICKET": "tickets",
    "START_ESCALATE": "tickets",
    "START_REASSIGN": "tickets",
    "START_CREATE_CUSTOMER": "customers",
    "START_CREATE_TEAM": "teams",
    "START_ADD_TEAM_MEMBERS": "teams",
    "START_CREATE_KB": "kb",
    "START_CREATE_MACRO": "macros",
    "START_CREATE_PRIORITY": "admin",
    "START_CREATE_STATUS": "admin",
}
_WORKFLOW_OWN_START = {
    "create_ticket": "START_CREATE_TICKET",
    "ticket": "START_CREATE_TICKET",
    "escalate": "START_ESCALATE",
    "reassign": "START_REASSIGN",
    "reassign_ticket": "START_REASSIGN",
    "create_customer": "START_CREATE_CUSTOMER",
    "customer": "START_CREATE_CUSTOMER",
    "create_team": "START_CREATE_TEAM",
    "team": "START_CREATE_TEAM",
    "add_team_members": "START_ADD_TEAM_MEMBERS",
    "create_kb": "START_CREATE_KB",
    "kb": "START_CREATE_KB",
    "create_macro": "START_CREATE_MACRO",
    "macro": "START_CREATE_MACRO",
    "create_priority": "START_CREATE_PRIORITY",
    "priority": "START_CREATE_PRIORITY",
    "create_status": "START_CREATE_STATUS",
    "status": "START_CREATE_STATUS",
}
_LIFECYCLE_ACTIONS = _START_ACTIONS | frozenset(
    {
        "CONTINUE_WORKFLOW",
        "CONFIRM_WORKFLOW",
        "CANCEL_WORKFLOW",
        "RESUME_WORKFLOW",
        "PROVIDE_TEAM",
        "PROVIDE_MEMBERS",
        "PROVIDE_TICKET",
        "PROVIDE_ASSIGNEE",
        "SIDE_QUEST",
    }
)
_TICKET_LIST_VIEWS = frozenset(
    {
        "assigned",
        "unassigned",
        "team-queue",
        "team-inbox",
        "tickets-list",
        "create-ticket",
    }
)


def _explicit_non_ticket_module_nav(text: str) -> bool:
    """True when the utterance is open/go-to a non-ticket module (not a list filter)."""
    from app.tasks.ui_actions import _module_nav_fallback

    nav = _module_nav_fallback(text)
    if not nav:
        return False
    views = [
        str(raw.get("view") or "").strip()
        for raw in (nav.get("actions") or [])
        if isinstance(raw, dict) and str(raw.get("type") or "").lower() == "navigate"
    ]
    return bool(views) and not any(view in _TICKET_LIST_VIEWS for view in views)


_SPECIALIST_OPS = frozenset(
    {
        "CREATE_TICKET",
        "LIST_TICKETS",
        "SEARCH_TICKETS",
        "UPDATE_TICKET",
        "ESCALATE_TICKET",
        "ADD_TICKET_NOTE",
        "CREATE_CUSTOMER",
        "LIST_CUSTOMERS",
        "SEARCH_CUSTOMERS",
        "GET_CUSTOMER",
        "IMPORT_CUSTOMERS",
        "GET_CUSTOMER_TICKETS",
        "CREATE_TEAM",
        "LIST_TEAMS",
        "SEARCH_TEAMS",
        "GET_TEAM",
        "UPDATE_TEAM",
        "ADD_MEMBERS",
        "REMOVE_MEMBERS",
        "DELETE_TEAM",
        "CREATE_KB",
        "LIST_KB",
        "SEARCH_KB",
        "GET_ARTICLE",
        "UPDATE_KB",
        "PUBLISH_KB",
        "CREATE_MACRO",
        "LIST_MACROS",
        "SEARCH_MACROS",
        "GET_MACRO",
        "UPDATE_MACRO",
        "DELETE_MACRO",
        "CREATE_PRIORITY",
        "LIST_PRIORITIES",
        "GET_PRIORITY",
        "UPDATE_PRIORITY",
        "TOGGLE_PRIORITY",
        "DELETE_PRIORITY",
        "CREATE_STATUS",
        "LIST_STATUSES",
        "GET_STATUS",
        "UPDATE_STATUS",
        "TOGGLE_STATUS",
        "DELETE_STATUS",
        "GET_METRICS",
        "COMPARE",
        "RECOMMEND",
        "GET_TICKET",
        "GET_HISTORY",
        "GET_ANALYTICS",
        "EXPORT_ANALYTICS",
        "GET_CSAT",
        "LIST_AUDIT",
        "SEARCH_AUDIT",
        "LIST_DIRECTORY",
        "SEARCH_DIRECTORY",
        "FIND_SKILL",
        "GET_ORG_PREFERENCES",
        "UPDATE_ORG_PREFERENCES",
        "LIST_WIDGETS",
        "CREATE_WIDGET",
        "LIST_API_KEYS",
    }
)


_AGENT_TO_FLOW = {
    "tickets": "ticket",
    "customers": "customer",
    "teams": "team",
    "kb": "kb",
    "macros": "macro",
    "admin": "priority",
}

_NEW_TASK_AGENT_START = {
    "kb": "START_CREATE_KB",
    "tickets": "START_CREATE_TICKET",
    "customers": "START_CREATE_CUSTOMER",
    "teams": "START_CREATE_TEAM",
    "macros": "START_CREATE_MACRO",
    "admin": "START_CREATE_PRIORITY",
}


def decision_owner_flow(decision: dict[str, Any] | None) -> str | None:
    """Module flow the Super Agent named (kb, ticket, team, …). None = unspecified."""
    if not isinstance(decision, dict):
        return None
    action = str(decision.get("action") or "").strip().upper()
    # Escalate field answers often set entity_type=ticket; that must not steal
    # the turn from an active escalate draft into create-ticket.
    if action in {"START_ESCALATE", "PROVIDE_TICKET", "PROVIDE_ASSIGNEE"}:
        return "escalate"
    if action in {"START_REASSIGN", "PROVIDE_TICKET", "PROVIDE_ASSIGNEE"}:
        return "reassign"
    wf = str(decision.get("workflow") or "").strip().lower()
    if wf:
        if wf in WORKFLOW_TO_FLOW:
            return WORKFLOW_TO_FLOW[wf]
        if wf in {
            "ticket",
            "customer",
            "team",
            "macro",
            "kb",
            "escalate",
            "priority",
        }:
            return wf
        if "article" in wf or wf.startswith("kb"):
            return "kb"
    ent = str(decision.get("entity_type") or "").strip().lower()
    if ent in {"article", "kb"}:
        return "kb"
    if ent in _AGENT_TO_FLOW.values() or ent in {
        "ticket",
        "customer",
        "team",
        "macro",
        "escalate",
        "priority",
    }:
        return ent
    agent = str(decision.get("agent") or "").strip().lower()
    return _AGENT_TO_FLOW.get(agent)


def build_routing_trace(
    *,
    user_text: str,
    active_workflow: str | None,
    current_step: str | None,
    decision: dict[str, Any] | None,
    selected: str | None,
    specialist: str | None = None,
    tool: str | None = None,
    result: str | None = None,
) -> dict[str, Any]:
    decision = decision if isinstance(decision, dict) else {}
    sa_agent = str(decision.get("agent") or "").strip().lower() or None
    selected_n = str(selected or "").strip().lower() or None
    mismatch = bool(
        sa_agent
        and selected_n
        and sa_agent in SPECIALIST_ROUTES
        and selected_n in SPECIALIST_ROUTES
        and sa_agent != selected_n
    )
    return {
        "user": (user_text or "").strip(),
        "state": {
            "active_workflow": active_workflow,
            "current_step": current_step,
        },
        "super_agent": {
            "agent": sa_agent,
            "workflow": str(decision.get("workflow") or "").strip() or None,
            "action": str(decision.get("action") or "").strip() or None,
            "operation": str(decision.get("operation") or "").strip() or None,
        },
        "router": {"selected": selected_n},
        "specialist": specialist or selected_n,
        "tool": tool,
        "result": result,
        "mismatch": mismatch,
    }


def emit_routing_trace(trace: dict[str, Any] | None) -> None:
    if not isinstance(trace, dict):
        return
    sa = trace.get("super_agent") if isinstance(trace.get("super_agent"), dict) else {}
    st = trace.get("state") if isinstance(trace.get("state"), dict) else {}
    router = trace.get("router") if isinstance(trace.get("router"), dict) else {}
    body = (
        f"USER:\n{trace.get('user') or ''}\n\n"
        f"STATE:\nactive_workflow={st.get('active_workflow')}\n"
        f"current_step={st.get('current_step')}\n\n"
        f"SUPER_AGENT:\nagent={sa.get('agent')}\nworkflow={sa.get('workflow')}\n"
        f"action={sa.get('action')}\noperation={sa.get('operation')}\n\n"
        f"ROUTER:\nselected={router.get('selected')}"
        f"{'   MISMATCH' if trace.get('mismatch') else ''}\n\n"
        f"SPECIALIST:\n{trace.get('specialist')}\n\n"
        f"TOOL:\n{trace.get('tool') or '-'}\n\n"
        f"RESULT:\n{trace.get('result') or '-'}"
    )
    log_fn = logger.error if trace.get("mismatch") else logger.info
    log_fn(
        "routing_trace mismatch=%s selected=%s super=%s",
        trace.get("mismatch"),
        router.get("selected"),
        sa.get("agent"),
    )
    try:
        from app.llm_log import log_llm

        log_llm(
            kind="routing_trace",
            user_text=str(trace.get("user") or ""),
            response=body,
            agent=str(trace.get("specialist") or sa.get("agent") or ""),
        )
    except Exception:  # noqa: BLE001
        pass


def _attach_routing_trace(out: dict[str, Any], trace: dict[str, Any] | None) -> dict[str, Any]:
    if not trace:
        return out
    emit_routing_trace(trace)
    out["routing_trace"] = trace
    data = dict(out.get("data") or {}) if isinstance(out.get("data"), dict) else {}
    data["routing_trace"] = trace
    out["data"] = data
    return out


def _specialist_from_decision(decision: dict[str, Any] | None) -> str | None:
    """Map NLU decision → specialist without pinning to the active workflow."""
    if not isinstance(decision, dict):
        return None
    op = str(decision.get("operation") or "").strip().upper()
    action = str(decision.get("action") or "").strip().upper()
    intent = str(decision.get("intent") or "").strip().upper()
    entity = str(decision.get("entity_type") or "").strip().lower()
    if op in ("GET_METRICS", "COMPARE"):
        topic = ""
        filters = decision.get("filters") if isinstance(decision.get("filters"), dict) else {}
        topic = str(filters.get("topic") or "").strip().lower()
        if entity in ("team", "queue") or intent == "TEAMS":
            return "teams"
        if entity in ("article", "kb") or intent == "KB":
            return "kb"
        if entity in ("customer",) or intent == "CUSTOMER":
            return "customers"
        if intent == "ADMIN" or topic in {
            "analytics",
            "csat",
            "audit",
            "priorities",
            "statuses",
            "directory",
            "org_prefs",
            "volume",
            "channel",
            "performance",
            "sla",
        }:
            return "admin"
        if intent == "MACRO" or entity == "macro":
            return "macros"
        return "tickets"
    op_agent = {
        "CREATE_TICKET": "tickets",
        "LIST_TICKETS": "tickets",
        "SEARCH_TICKETS": "tickets",
        "UPDATE_TICKET": "tickets",
        "ESCALATE_TICKET": "tickets",
        "ADD_TICKET_NOTE": "tickets",
        "CREATE_CUSTOMER": "customers",
        "LIST_CUSTOMERS": "customers",
        "SEARCH_CUSTOMERS": "customers",
        "GET_CUSTOMER": "customers",
        "IMPORT_CUSTOMERS": "customers",
        "GET_CUSTOMER_TICKETS": "customers",
        "CREATE_TEAM": "teams",
        "LIST_TEAMS": "teams",
        "SEARCH_TEAMS": "teams",
        "GET_TEAM": "teams",
        "UPDATE_TEAM": "teams",
        "ADD_MEMBERS": "teams",
        "REMOVE_MEMBERS": "teams",
        "DELETE_TEAM": "teams",
        "CREATE_KB": "kb",
        "LIST_KB": "kb",
        "SEARCH_KB": "kb",
        "GET_ARTICLE": "kb",
        "UPDATE_KB": "kb",
        "PUBLISH_KB": "kb",
        "CREATE_MACRO": "macros",
        "LIST_MACROS": "macros",
        "SEARCH_MACROS": "macros",
        "GET_MACRO": "macros",
        "UPDATE_MACRO": "macros",
        "DELETE_MACRO": "macros",
        "CREATE_PRIORITY": "admin",
        "CREATE_STATUS": "admin",
        "LIST_PRIORITIES": "admin",
        "GET_PRIORITY": "admin",
        "UPDATE_PRIORITY": "admin",
        "TOGGLE_PRIORITY": "admin",
        "DELETE_PRIORITY": "admin",
        "LIST_STATUSES": "admin",
        "GET_STATUS": "admin",
        "UPDATE_STATUS": "admin",
        "TOGGLE_STATUS": "admin",
        "DELETE_STATUS": "admin",
        "GET_METRICS": "tickets",
        "COMPARE": "tickets",
        "RECOMMEND": "tickets",
        "GET_TICKET": "tickets",
        "GET_HISTORY": "tickets",
        "GET_ANALYTICS": "admin",
        "EXPORT_ANALYTICS": "admin",
        "GET_CSAT": "admin",
        "LIST_AUDIT": "admin",
        "SEARCH_AUDIT": "admin",
        "LIST_DIRECTORY": "admin",
        "SEARCH_DIRECTORY": "admin",
        "FIND_SKILL": "admin",
        "GET_ORG_PREFERENCES": "admin",
        "UPDATE_ORG_PREFERENCES": "admin",
        "LIST_WIDGETS": "admin",
        "CREATE_WIDGET": "admin",
        "LIST_API_KEYS": "admin",
    }.get(op)
    if op_agent:
        return op_agent
    action_agent = _START_ACTION_AGENT.get(action)
    if action_agent:
        return action_agent
    if entity in ("ticket",):
        return "tickets"
    if entity in ("customer",):
        return "customers"
    if entity in ("team", "queue"):
        return "teams"
    if entity in ("article", "kb"):
        return "kb"
    if entity in ("macro",):
        return "macros"
    if entity in ("priority", "status"):
        return "admin"
    if intent in ("TICKET", "SEARCH", "UPDATE"):
        return "tickets"
    if intent == "CUSTOMER":
        return "customers"
    if intent == "TEAMS":
        return "teams"
    if intent == "KB":
        return "kb"
    if intent == "MACRO":
        return "macros"
    if intent == "ADMIN":
        return "admin"
    return None


def route_to_agent(
    decision: dict[str, Any] | None,
    *,
    current_workflow: str | None = None,
    text: str | None = None,
) -> str | None:
    """Execute the Super Agent decision. Active workflow pins only when it matches."""
    action = (
        str(decision.get("action") or "").strip().upper()
        if isinstance(decision, dict)
        else ""
    )
    wf = str(current_workflow or "").strip().lower()
    pin = agent_for_workflow(wf) if wf else None
    named = (
        str(decision.get("agent") or "").strip().lower()
        if isinstance(decision, dict)
        else ""
    )
    wf_named = ""
    if isinstance(decision, dict):
        wf_named = str(decision.get("workflow") or "").strip().lower()
    from_workflow = agent_for_workflow(wf_named) if wf_named else None
    decided = _specialist_from_decision(decision)
    decided_agent = (
        (named if named in SPECIALIST_ROUTES else None)
        or from_workflow
        or decided
    )
    if action in {
        "CONTINUE_WORKFLOW",
        "CONFIRM_WORKFLOW",
        "PROVIDE_TEAM",
        "PROVIDE_MEMBERS",
        "PROVIDE_TICKET",
        "PROVIDE_ASSIGNEE",
        "RESUME_WORKFLOW",
    }:
        if pin and decided_agent and pin == decided_agent:
            return pin
        if decided_agent:
            return decided_agent
        return pin
    if named in SPECIALIST_ROUTES:
        return named
    return decided_agent or pin


def specialist_result_from_handler(
    result: dict[str, Any],
    *,
    prior_last_entity: dict[str, Any] | None = None,
    default_route: str = "general",
) -> dict[str, Any]:
    result = enrich_handler_result(result, prior_last_entity=prior_last_entity)
    out: dict[str, Any] = {}
    for key in _DRAFT_KEYS:
        if key in result:
            out[key] = result[key]
    out["reply"] = str(result.get("reply") or "")
    out["actions"] = list(result.get("actions") or [])
    if isinstance(result.get("data"), dict):
        out["data"] = dict(result["data"])
        if result.get("routing_trace") and "routing_trace" not in out["data"]:
            out["data"]["routing_trace"] = result["routing_trace"]
    if result.get("routing_trace"):
        out["routing_trace"] = result["routing_trace"]
    out["route"] = result.get("route") or default_route
    if "tool_memory" in result:
        out["tool_memory"] = result.get("tool_memory")
    if "conversation_context" in result:
        out["conversation_context"] = result.get("conversation_context")
    from app.workflow_state import attach_tool_memory_to_result

    out = attach_tool_memory_to_result(out)
    data = out.get("data") if isinstance(out.get("data"), dict) else {}
    tool = str(data.get("_tool_name") or "").strip() or None
    if tool and isinstance(out.get("routing_trace"), dict):
        out["routing_trace"] = {**out["routing_trace"], "tool": tool, "result": "success"}
        data = dict(data)
        data["routing_trace"] = out["routing_trace"]
        out["data"] = data
    return out


def complete_specialist_handoff(state: AgentState, orch_out: dict[str, Any]) -> dict[str, Any]:
    """Unit-test helper: orchestrator then specialist (same as graph)."""
    if orch_out.get("workflow_handled"):
        return orch_out
    if not orch_out.get("specialist_handoff"):
        return orch_out
    route = str(orch_out.get("route") or "general").strip().lower()
    merged: AgentState = {**dict(state), **orch_out}  # type: ignore[assignment]
    from app.agents.admin import admin_agent
    from app.agents.customers import customers_agent
    from app.agents.general import general_agent
    from app.agents.kb import kb_agent
    from app.agents.macros import macros_agent
    from app.agents.teams import teams_agent
    from app.agents.tickets import tickets_agent

    fn = {
        "tickets": tickets_agent,
        "customers": customers_agent,
        "teams": teams_agent,
        "kb": kb_agent,
        "macros": macros_agent,
        "admin": admin_agent,
        "general": general_agent,
    }.get(route)
    if not fn:
        return orch_out
    spec = fn(merged)
    out = {**orch_out, **spec}
    out["workflow_handled"] = True
    prior_trace = (
        orch_out.get("routing_trace")
        if isinstance(orch_out.get("routing_trace"), dict)
        else {}
    )
    data = spec.get("data") if isinstance(spec.get("data"), dict) else {}
    tool = str(data.get("_tool_name") or "").strip() or None
    if prior_trace:
        trace = {
            **prior_trace,
            "specialist": route,
            "tool": tool or prior_trace.get("tool"),
            "result": "error" if data.get("serviceError") else "success",
        }
        out["routing_trace"] = trace
        merged_data = dict(out.get("data") or {}) if isinstance(out.get("data"), dict) else {}
        merged_data["routing_trace"] = trace
        out["data"] = merged_data
    return out


def _resume_metrics_scope(
    text: str, prior_query: dict[str, Any], decision: dict[str, Any]
) -> dict[str, Any] | None:
    """Resolve overall vs my from Super Agent filters after a metrics-scope ask."""
    del text
    if str(prior_query.get("awaiting") or "").strip().lower() != "metrics_scope":
        return None
    prior_filters = dict(prior_query.get("filters") or {})
    filters_in = dict(decision.get("filters") or {}) if isinstance(decision.get("filters"), dict) else {}
    assigned = str(filters_in.get("assigned_to") or "").strip().upper()
    scope = str(filters_in.get("scope") or "").strip().lower()
    overall = scope == "org"
    mine = assigned == "SELF" or scope in {"self", "assignee"}
    if overall == mine:
        return None
    filters = dict(prior_filters)
    filters.setdefault("topic", "overview")
    if overall:
        filters.pop("assigned_to", None)
        filters["scope"] = "org"
    else:
        filters["assigned_to"] = "SELF"
        filters.pop("scope", None)
    return {
        **decision,
        "action": "NORMAL_ROUTE",
        "intent": "TICKET",
        "operation": "GET_METRICS",
        "filters": filters,
        "proposed_tool": "get_metrics",
        "clarification": None,
        "reference": None,
    }


def _phrase_clarify(*, text: str, page: str | None, reason: str | None = None) -> str:
    try:
        from app.tasks.chat_commands import _llm_phrase

        return _llm_phrase(
            module="nav",
            kind="clarify",
            fallback="Ask a brief clarification about what they want to do next.",
            user_text=text,
            page_label=page,
            context={
                "clarificationRequired": True,
                "reason": reason or "ambiguous request",
            },
        )
    except Exception:  # noqa: BLE001
        return ""


def _copy_park_keys(result: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key in (
        "escalate_draft",
        "reassign_draft",
        "macro_draft",
        "team_draft",
        "kb_draft",
        "ticket_draft",
        "priority_draft",
        "customer_draft",
        "parked_drafts",
        "current_workflow",
        "current_step",
        "workflow_data",
        "last_entity",
    ):
        if key in result:
            out[key] = result[key]
    return out


_OPEN_ENTITY_GET = {
    "ticket": ("GET_TICKET", "tickets", "get_ticket", "ticket"),
    "article": ("GET_ARTICLE", "kb", "get_kb", "article"),
    "kb": ("GET_ARTICLE", "kb", "get_kb", "article"),
    "customer": ("GET_CUSTOMER", "customers", "list_customers", "customer"),
    "team": ("GET_TEAM", "teams", "list_queues", "team"),
    "macro": ("GET_MACRO", "macros", "list_macros", "macro"),
    "priority": ("GET_PRIORITY", "admin", "list_priorities", "priority"),
    "status": ("GET_STATUS", "admin", "list_statuses", "status"),
}


def bind_decision_to_open_entity(
    decision: dict[str, Any],
    last_entity: dict[str, Any] | None,
    text: str,
) -> dict[str, Any]:
    """When the UI has an open item, 'this ticket' is LAST_ENTITY — not a clarification."""
    if not isinstance(decision, dict):
        return decision
    le = normalize_last_entity(last_entity)
    if not le:
        return decision
    le_type = str(le.get("type") or "").strip().lower()
    mapping = _OPEN_ENTITY_GET.get(le_type)
    if not mapping:
        return decision
    get_op, agent, tool, entity_type = mapping
    action = str(decision.get("action") or "").strip().upper()
    if action in _START_ACTIONS or action in {
        "SIDE_QUEST",
        "CANCEL_WORKFLOW",
        "NEW_TASK",
        "CONFIRM_WORKFLOW",
        # Active / parked guided collects must keep CONTINUE/RESUME — do not
        # rewrite them into GET_* on the open UI entity (e.g. ticket detail).
        "CONTINUE_WORKFLOW",
        "RESUME_WORKFLOW",
    }:
        return decision
    operation = str(decision.get("operation") or "").strip().upper()
    deictic = str(decision.get("reference") or "").strip().upper() == "LAST_ENTITY"
    clarify = str(decision.get("clarification") or "")
    asks_which = bool(
        re.search(
            r"ticket number|which ticket|specific ticket|provide the ticket",
            clarify,
            re.I,
        )
    )
    named = str(decision.get("entity_name") or "").strip()
    if le_type == "ticket":
        numbered = _ticket_number_from_request(decision, last_entity=None)
    else:
        numbered = named
    if numbered and named:
        le_name = str(le.get("name") or le.get("id") or "").strip().lower().lstrip("#")
        named_l = named.lower().lstrip("#")
        if named_l and le_name and named_l not in le_name and le_name not in named_l:
            return decision
    wants_open = (
        deictic
        or asks_which
        or operation in {get_op, "GET_HISTORY", "NONE", ""}
        or (action == "AMBIGUOUS" and operation in {get_op, "NONE", "", "GET_HISTORY"})
    )
    if not wants_open:
        return decision
    if (
        not deictic
        and not asks_which
        and operation not in {get_op, "GET_HISTORY"}
        and action != "AMBIGUOUS"
    ):
        return decision
    out = dict(decision)
    out["action"] = "NORMAL_ROUTE"
    out["operation"] = "GET_HISTORY" if operation == "GET_HISTORY" else get_op
    out["reference"] = "LAST_ENTITY"
    out["agent"] = agent
    out["entity_type"] = entity_type
    out["clarification"] = None
    out["proposed_tool"] = tool
    out["intent"] = str(out.get("intent") or "TICKET").strip().upper() or "TICKET"
    if not str(out.get("entity_name") or "").strip():
        out["entity_name"] = str(le.get("name") or le.get("id") or "")
    return out


def workflow_manager_node(state: AgentState) -> dict:
    """
    Orchestrator: hydrate, NLU, park, resume routing, clarification.
    Specialists own continue / start / list / mutate.
    """
    org = (state.get("organization_id") or "").strip()
    text = _latest_user_text(state)
    restored_team = ensure_team_draft(dict(state))
    from app.workflow_state import conversation_context_from_state

    turn_context = conversation_context_from_state(dict(state))
    prior_entity = turn_context.get("last_entity") or state.get("last_entity")

    hydrated = hydrate_from_legacy_drafts(
        escalate_draft=state.get("escalate_draft"),
        reassign_draft=state.get("reassign_draft"),
        macro_draft=state.get("macro_draft"),
        team_draft=restored_team if restored_team else state.get("team_draft"),
        kb_draft=state.get("kb_draft"),
        ticket_draft=state.get("ticket_draft"),
        priority_draft=state.get("priority_draft"),
        customer_draft=state.get("customer_draft"),
        next_step=state.get("next_step"),
        current_workflow=state.get("current_workflow"),
        current_step=state.get("current_step"),
        workflow_data=state.get("workflow_data"),
        last_entity=prior_entity,
    )

    base: dict[str, Any] = {
        **hydrated,
        "workflow_handled": False,
        "specialist_handoff": False,
    }
    if restored_team:
        base["team_draft"] = restored_team

    if not org or not text:
        return base

    from app.agents.workflow_nlu import (
        _roster_from_state,
        decide_workflow_turn,
        ground_active_collect_decision,
        normalize_workflow_decision,
    )

    nlu_state: AgentState = {**state, **hydrated}  # type: ignore[assignment]
    if restored_team:
        nlu_state["team_draft"] = restored_team
        nlu_state["session_history"] = state.get("session_history")
    roster_members = _roster_from_state(nlu_state)
    awaiting_now = str(
        hydrated.get("current_step")
        or (restored_team or {}).get("awaiting")
        or ""
    ).strip().lower()
    if awaiting_now == "members":
        awaiting_now = "create_members"
    if (
        str(hydrated.get("current_workflow") or "").strip().lower() in {"create_team", "team"}
        and awaiting_now == "create_members"
        and not roster_members
        and org
    ):
        try:
            from app.tasks.catalog_commands import _load_available_staff

            roster_members = _load_available_staff(
                org=org,
                role=str(state.get("user_role") or "agent"),
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
            )
            if roster_members and restored_team:
                restored_team = {
                    **restored_team,
                    "available_members": roster_members,
                    "tool_memory": {
                        "list_agents": {
                            "names": roster_members,
                            "count": len(roster_members),
                            "entities": [{"id": "", "name": n} for n in roster_members],
                        }
                    },
                }
                nlu_state["team_draft"] = restored_team
                base["team_draft"] = restored_team
        except Exception:  # noqa: BLE001
            pass
    supplied_decision = state.get("workflow_decision")
    if isinstance(supplied_decision, dict):
        decision = normalize_workflow_decision(
            supplied_decision,
            workflow_id=hydrated.get("current_workflow"),
            user_text=text,
            page=state.get("page"),
            roster_members=roster_members,
        )
    else:
        try:
            decision = decide_workflow_turn(nlu_state, text)
        except Exception:  # noqa: BLE001
            # Fail closed — do not invent a specialist turn when NLU is down.
            return {
                **base,
                "workflow_handled": True,
                "reply": "",
                "actions": [],
                "data": {"serviceError": "WORKFLOW_NLU_UNAVAILABLE"},
            }
    decision_operation = str(decision.get("operation") or "").strip().upper()
    decision_action = str(decision.get("action") or "").strip().upper()
    if (
        decision_operation in {
            "CREATE_TICKET",
            "CREATE_TEAM",
            "CREATE_KB",
            "CREATE_CUSTOMER",
            "CREATE_MACRO",
            "CREATE_PRIORITY",
            "CREATE_STATUS",
        }
        and decision.get("tool_proposal_valid") is False
    ):
        # Gemma named the wrong tool; continue with the op's expected tool.
        decision = {**decision, "tool_proposal_valid": True, "proposed_tool": None}
    active_wf_pre = str(hydrated.get("current_workflow") or "").strip().lower() or None
    start_from_create = {
        "CREATE_TICKET": "START_CREATE_TICKET",
        "CREATE_TEAM": "START_CREATE_TEAM",
        "CREATE_KB": "START_CREATE_KB",
        "CREATE_CUSTOMER": "START_CREATE_CUSTOMER",
        "CREATE_MACRO": "START_CREATE_MACRO",
        "CREATE_PRIORITY": "START_CREATE_PRIORITY",
        "CREATE_STATUS": "START_CREATE_STATUS",
    }.get(decision_operation)
    own_start = _WORKFLOW_OWN_START.get(active_wf_pre or "")
    # Never clobber resume/continue into a fresh START_* — that wiped parked
    # ticket drafts and re-asked for the customer name after "yehh complete".
    if (
        start_from_create
        and start_from_create != own_start
        and decision_action
        not in {
            "RESUME_WORKFLOW",
            "CONTINUE_WORKFLOW",
            "CONFIRM_WORKFLOW",
            "SIDE_QUEST",
            "CANCEL_WORKFLOW",
        }
    ):
        decision = {**decision, "action": start_from_create}
        decision_action = start_from_create
    from app.workflow_schemas import redirect_import_customers_to_create

    decision = redirect_import_customers_to_create(decision, text)
    decision_action = str(decision.get("action") or "").strip().upper()
    decision_operation = str(decision.get("operation") or "").strip().upper()
    if decision_action == "NEW_TASK":
        wf_key = str(decision.get("workflow") or "").strip().lower()
        start_act = _WORKFLOW_OWN_START.get(wf_key)
        if not start_act and str(decision.get("intent") or "").strip().upper() == "CREATE":
            start_act = _NEW_TASK_AGENT_START.get(
                str(decision.get("agent") or "").strip().lower()
            )
        if start_act:
            decision = {**decision, "action": start_act}
            decision_action = start_act
    tix_await = ""
    tix_draft = state.get("ticket_draft") if isinstance(state.get("ticket_draft"), dict) else {}
    if tix_draft:
        tix_await = str(tix_draft.get("awaiting") or "").strip()
    kb_await = ""
    kb_draft_now = state.get("kb_draft") if isinstance(state.get("kb_draft"), dict) else {}
    if kb_draft_now:
        kb_await = str(kb_draft_now.get("awaiting") or "").strip()
    reassign_roster = roster_members
    rd_now = state.get("reassign_draft") if isinstance(state.get("reassign_draft"), dict) else None
    if not rd_now and isinstance(hydrated.get("reassign_draft"), dict):
        rd_now = hydrated.get("reassign_draft")
    if (
        str(active_wf_pre or "").lower() in {"reassign_ticket", "reassign"}
        and str((rd_now or {}).get("awaiting") or "").strip().lower() == "person"
    ):
        cand = (rd_now or {}).get("candidates")
        if isinstance(cand, list) and cand:
            reassign_roster = [str(n).strip() for n in cand if str(n).strip()]
    decision = ground_active_collect_decision(
        decision,
        workflow=active_wf_pre,
        step=str(
            (
                tix_await
                if (active_wf_pre or "") in {"create_ticket", "ticket"}
                else ""
            )
            or (
                kb_await
                if (active_wf_pre or "") in {"create_kb", "kb"}
                else ""
            )
            or hydrated.get("current_step")
            or (restored_team or {}).get("awaiting")
            or ""
        ),
        user_text=text,
        roster_members=reassign_roster,
        draft=(
            tix_draft
            if (active_wf_pre or "") in {"create_ticket", "ticket"}
            else kb_draft_now
            if (active_wf_pre or "") in {"create_kb", "kb"}
            else None
        ),
    )
    if not decision.get("agent"):
        inferred = route_to_agent(
            decision,
            current_workflow=active_wf_pre,
            text=text,
        )
        if inferred:
            decision = {**decision, "agent": inferred}
    decision_operation = str(decision.get("operation") or "").strip().upper()
    decision_action = str(decision.get("action") or "").strip().upper()
    base["workflow_decision"] = decision
    base["last_super_agent_decision"] = {
        "action": decision_action,
        "agent": decision.get("agent"),
        "workflow": decision.get("workflow") or active_wf_pre,
    }
    base["active_agent"] = decision.get("agent") or agent_for_workflow(active_wf_pre)
    logger.info(
        "super_agent_turn before_workflow=%s before_step=%s decision=%s agent=%s "
        "workflow=%s specialist=%s",
        active_wf_pre,
        hydrated.get("current_step"),
        decision_action,
        decision.get("agent"),
        decision.get("workflow") or active_wf_pre,
        decision.get("agent") or agent_for_workflow(active_wf_pre),
    )
    base["semantic_request"] = decision
    base["semantic_intent"] = decision.get("intent")

    # Idle ticket AMBIGUOUS with a clarification (overall vs my metrics, name role)
    # is answered here. Other idle AMBIGUOUS still falls through to cheap intent.
    # Active-workflow AMBIGUOUS is a field answer → specialist handoff below.

    active_wf = str(hydrated.get("current_workflow") or "").strip().lower() or None
    ctx = conversation_context_from_state(dict(state))
    prior_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    open_entity = last_entity_from_state({**dict(state), **hydrated, "conversation_context": ctx})
    decision = bind_decision_to_open_entity(decision, open_entity, text)
    from app.workflow_schemas import redirect_import_customers_to_create

    decision = redirect_import_customers_to_create(decision, text)
    decision_operation = str(decision.get("operation") or "").strip().upper()
    decision_action = str(decision.get("action") or "").strip().upper()
    base["workflow_decision"] = decision
    base["semantic_request"] = decision
    if decision.get("intent"):
        base["semantic_intent"] = decision.get("intent")
    resumed = None if active_wf else _resume_metrics_scope(text, prior_q, decision)
    if resumed:
        decision = resumed
        decision_action = "NORMAL_ROUTE"
        decision_operation = "GET_METRICS"
        base["workflow_decision"] = decision
        base["semantic_request"] = decision
        base["semantic_intent"] = "TICKET"
    metrics_ask = bool(
        str(prior_q.get("awaiting") or "").strip().lower() == "metrics_scope"
        or (
            decision_action == "AMBIGUOUS"
            and str(decision.get("intent") or "").upper() == "TICKET"
            and str(decision.get("clarification") or "").strip()
        )
    )
    if (
        not active_wf
        and decision_action == "AMBIGUOUS"
        and str(decision.get("intent") or "").upper() == "TICKET"
        and str(decision.get("clarification") or "").strip()
        and metrics_ask
        and not (
            isinstance(open_entity, dict)
            and str(open_entity.get("type") or "").lower() == "ticket"
            and str(decision.get("reference") or "").strip().upper() == "LAST_ENTITY"
        )
    ):
        pending_filters = dict(decision.get("filters") or {})
        clarify_out = {
            **base,
            "workflow_handled": True,
            "reply": _phrase_clarify(
                text=text,
                page=state.get("page"),
                reason=str(decision.get("clarification")).strip(),
            ),
            "actions": [{"type": "navigate", "view": "dashboard"}],
            "route": "tickets",
            "semantic_request": decision,
            "data": {
                "clarificationRequired": True,
                "reason": str(decision.get("clarification")).strip(),
                "last_query": {
                    "entity": "tickets",
                    "operation": "GET_METRICS",
                    "filters": pending_filters,
                    "awaiting": "metrics_scope",
                },
            },
        }
        return _attach_routing_trace(
            clarify_out,
            build_routing_trace(
                user_text=text,
                active_workflow=active_wf,
                current_step=hydrated.get("current_step"),
                decision=decision,
                selected="tickets",
                specialist="tickets",
                result="clarified",
            ),
        )
    target = route_to_agent(decision, current_workflow=active_wf, text=text)

    def _traced(out: dict[str, Any]) -> dict[str, Any]:
        data = out.get("data") if isinstance(out.get("data"), dict) else {}
        tool = str(data.get("_tool_name") or "").strip() or None
        selected = str(out.get("route") or target or "").strip() or None
        result = "handoff" if out.get("specialist_handoff") else (
            "success" if out.get("workflow_handled") else "pending"
        )
        if data.get("serviceError"):
            result = "error"
        trace = build_routing_trace(
            user_text=text,
            active_workflow=active_wf_pre,
            current_step=hydrated.get("current_step"),
            decision=decision,
            selected=selected,
            specialist=selected,
            tool=tool,
            result=result,
        )
        return _attach_routing_trace(out, trace)

    park_result = None
    needs_park = False
    if decision_action == "SIDE_QUEST" and active_wf:
        needs_park = True
    elif (
        target
        and active_wf
        and agent_for_workflow(active_wf) != target
        and decision_action in _LIFECYCLE_ACTIONS
    ):
        needs_park = True
    elif decision_operation in _MODULE_QUERY_OPS and active_wf:
        same_agent = bool(target) and agent_for_workflow(active_wf) == target
        collecting_confirm = decision_action in {
            "CONTINUE_WORKFLOW",
            "CONFIRM_WORKFLOW",
            "CANCEL_WORKFLOW",
        }
        if not (same_agent and collecting_confirm):
            needs_park = True

    if needs_park or decision_action == "SIDE_QUEST":
        park_result = resolve_active_workflow(
            text,
            page=state.get("page"),
            organization_id=org,
            user_role=state.get("user_role"),
            user_id=state.get("user_id"),
            user_name=state.get("user_name"),
            escalate_draft=state.get("escalate_draft"),
            reassign_draft=state.get("reassign_draft"),
            macro_draft=state.get("macro_draft"),
            team_draft=state.get("team_draft"),
            kb_draft=state.get("kb_draft"),
            ticket_draft=state.get("ticket_draft"),
            priority_draft=state.get("priority_draft"),
            customer_draft=state.get("customer_draft"),
            parked_drafts=state.get("parked_drafts"),
            session_history=state.get("session_history"),
            last_entity=last_entity_from_state(dict(state))
            or hydrated.get("last_entity"),
            workflow_decision=decision,
        )

    # After park, route the side quest / start to the owning specialist.
    if park_result and park_result.get("handled") is False:
        out = _copy_park_keys(park_result, base)
        out.update(
            hydrate_from_legacy_drafts(
                escalate_draft=out.get("escalate_draft", state.get("escalate_draft")),
                reassign_draft=out.get("reassign_draft", state.get("reassign_draft")),
                macro_draft=out.get("macro_draft", state.get("macro_draft")),
                team_draft=out.get("team_draft", state.get("team_draft")),
                kb_draft=out.get("kb_draft", state.get("kb_draft")),
                ticket_draft=out.get("ticket_draft", state.get("ticket_draft")),
                priority_draft=out.get("priority_draft", state.get("priority_draft")),
                customer_draft=out.get("customer_draft", state.get("customer_draft")),
                next_step=state.get("next_step"),
                last_entity=out.get("last_entity") or state.get("last_entity"),
            )
        )
        quest_agent = route_to_agent(decision, current_workflow=None, text=text) or target
        if (
            decision_operation in ("LIST_TICKETS", "SEARCH_TICKETS")
            and _explicit_non_ticket_module_nav(text)
        ):
            quest_agent = None
        if not quest_agent and decision_operation in _MODULE_QUERY_OPS:
            quest_agent = route_to_agent(decision, text=text) or "tickets"
        if quest_agent in SPECIALIST_ROUTES:
            out["specialist_handoff"] = True
            out["route"] = quest_agent
            out["workflow_handled"] = False
            return _traced(out)
        out["workflow_handled"] = False
        return _traced(out)

    if not target:
        parked = normalize_parked(state.get("parked_drafts"))
        if decision_action in ("RESUME_WORKFLOW", "CONTINUE_WORKFLOW") and parked:
            flow = str(parked[-1].get("flow") or "")
            target = agent_for_workflow(
                workflow_type_from_flow(flow, parked[-1].get("draft") if parked else None)
            )

    should_handoff = bool(
        target
        and target in SPECIALIST_ROUTES
        and (
            active_wf
            or decision_action in _LIFECYCLE_ACTIONS
            or decision_operation in _SPECIALIST_OPS
            or str(decision.get("reference") or "").strip().upper()
            in ("LAST_QUERY", "LAST_ENTITY")
        )
    )
    # Gemma sometimes labels "open priorities" / "go to search" as LIST_TICKETS.
    # Explicit module-open must stay nav, not a ticket list.
    if (
        should_handoff
        and not active_wf
        and decision_operation in ("LIST_TICKETS", "SEARCH_TICKETS")
        and _explicit_non_ticket_module_nav(text)
    ):
        should_handoff = False

    role_l = str(state.get("user_role") or "").strip().lower()
    if role_l in ("portal_guest", "portal_customer"):
        from app.tasks.chat_commands import (
            _continue_ticket_draft,
            start_create_ticket_flow,
        )
        portal_tix = (
            base.get("ticket_draft")
            if isinstance(base.get("ticket_draft"), dict)
            else None
        )
        if portal_tix is None and isinstance(state.get("ticket_draft"), dict):
            portal_tix = state.get("ticket_draft")
        if (
            isinstance(portal_tix, dict)
            and str(portal_tix.get("surface") or "").strip().lower() != "portal"
        ):
            portal_tix = None

        if decision_action in ("CONTINUE_WORKFLOW", "CONFIRM_WORKFLOW"):
            if portal_tix and str(portal_tix.get("awaiting") or "").strip():
                portal_out = _continue_ticket_draft(
                    text,
                    org=org,
                    role=role_l,
                    user_id=state.get("user_id"),
                    user_name=state.get("user_name"),
                    page=state.get("page"),
                    ticket_draft=portal_tix,
                    semantic_decision=decision or None,
                )
            else:
                portal_out = start_create_ticket_flow(
                    text,
                    org=org,
                    role=role_l,
                    page=state.get("page"),
                    semantic_decision=decision or None,
                    user_id=state.get("user_id"),
                    user_name=state.get("user_name"),
                )
            # Always specialist gateway — never END with Python reply text.
            out = dict(base)
            for key in _DRAFT_KEYS:
                if key in portal_out:
                    out[key] = portal_out[key]
            if "current_workflow" in portal_out:
                out["current_workflow"] = portal_out.get("current_workflow")
            if "current_step" in portal_out:
                out["current_step"] = portal_out.get("current_step")
            out["actions"] = list(portal_out.get("actions") or [])
            out["route"] = str(portal_out.get("route") or "kb")
            out["reply"] = ""
            out["specialist_handoff"] = True
            out["workflow_handled"] = False
            if isinstance(portal_out.get("data"), dict):
                out["data"] = {
                    **(out.get("data") if isinstance(out.get("data"), dict) else {}),
                    **portal_out["data"],
                }
            return _traced(out)
        elif decision_action == "START_CREATE_TICKET":
            portal_out = start_create_ticket_flow(
                text,
                org=org,
                role=role_l,
                page=state.get("page"),
                semantic_decision=decision or None,
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
            )
            out = dict(base)
            for key in _DRAFT_KEYS:
                if key in portal_out:
                    out[key] = portal_out[key]
            if "current_workflow" in portal_out:
                out["current_workflow"] = portal_out.get("current_workflow")
            if "current_step" in portal_out:
                out["current_step"] = portal_out.get("current_step")
            out["actions"] = list(portal_out.get("actions") or [])
            out["route"] = str(portal_out.get("route") or "kb")
            out["reply"] = ""
            out["specialist_handoff"] = True
            out["workflow_handled"] = False
            if isinstance(portal_out.get("data"), dict):
                out["data"] = {
                    **(out.get("data") if isinstance(out.get("data"), dict) else {}),
                    **portal_out["data"],
                }
            return _traced(out)
        elif decision_operation in _SPECIALIST_OPS or decision_action in _LIFECYCLE_ACTIONS:
            out = dict(base)
            if portal_tix:
                out["ticket_draft"] = portal_tix
            out["specialist_handoff"] = True
            out["route"] = "kb"
            out["workflow_handled"] = False
            out["reply"] = ""
            return _traced(out)

    if should_handoff and target:
        out = dict(base)
        # hydrate_from_legacy_drafts projects workflow fields only — keep legacy
        # drafts on the handoff so specialist bind_tools still sees confirm state.
        for key in _DRAFT_KEYS:
            if key not in out and isinstance(state.get(key), dict):
                out[key] = state.get(key)
        if park_result and park_result.get("handled"):
            # Resume/continue already resolved inside resolve_active_workflow —
            # still hand off so the specialist owns the reply when possible.
            for key in _DRAFT_KEYS:
                if key in park_result:
                    out[key] = park_result[key]
            if park_result.get("reply") or park_result.get("actions"):
                out.update(
                    specialist_result_from_handler(
                        park_result,
                        prior_last_entity=hydrated.get("last_entity"),
                        default_route=target,
                    )
                )
                out["workflow_handled"] = True
                out["route"] = target
                return _traced(out)
        out["specialist_handoff"] = True
        out["route"] = target
        out["workflow_handled"] = False
        return _traced(out)

    if park_result and park_result.get("handled"):
        out = {**base, "workflow_handled": True}
        for key in (
            *_DRAFT_KEYS,
            "data",
        ):
            if key in park_result:
                out[key] = park_result[key]
        out["reply"] = str(park_result.get("reply") or "")
        out["actions"] = list(park_result.get("actions") or [])
        if park_result.get("route"):
            out["route"] = park_result["route"]
        return _traced(out)

    return _traced(base)


def pick_after_workflow(state: AgentState) -> str:
    if state.get("workflow_handled"):
        return "done"
    if state.get("specialist_handoff"):
        route = str(state.get("route") or "").strip().lower()
        if route in SPECIALIST_ROUTES:
            return route
    return "continue"
