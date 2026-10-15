"""
Shared memory contract constants + helpers used by graph, agents, and tests.

UI session history is the source of truth when the client sends it.
Missing/empty history must NOT wipe the LangGraph checkpointer.

Guided drafts (kb/macro/team/escalate) live in LangGraph state keyed by
org:session_id (see app.memory). Helpers below park/resume those drafts and
recover them from session_history when needed — not a second memory store.
"""

from __future__ import annotations

import re
from typing import Any

# Keep enough turns so a guided create (name/email/phone/issue/confirm)
# still fits after several follow-ups. Client + server must stay aligned.
HISTORY_WINDOW = 80


def normalize_history(history: list[dict] | None, *, limit: int = HISTORY_WINDOW) -> list[dict]:
    """Keep only user/assistant turns with non-empty text (newest `limit`)."""
    if not history:
        return []
    out: list[dict] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = str(item.get("text") or "").strip()
        if not text or role not in ("user", "assistant"):
            continue
        out.append({"role": role, "text": text})
    return out[-limit:] if limit > 0 else out


# ---------------------------------------------------------------------------
# Guided drafts — same session checkpointer; park/resume within that state
# ---------------------------------------------------------------------------

def collect_active_drafts(
    *,
    escalate_draft: dict | None,
    reassign_draft: dict | None = None,
    macro_draft: dict | None,
    team_draft: dict | None,
    kb_draft: dict | None,
    ticket_draft: dict | None = None,
    priority_draft: dict | None = None,
    customer_draft: dict | None = None,
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if isinstance(escalate_draft, dict) and escalate_draft.get("awaiting"):
        out["escalate"] = escalate_draft
    if isinstance(reassign_draft, dict) and reassign_draft.get("awaiting"):
        out["reassign"] = reassign_draft
    if isinstance(macro_draft, dict) and macro_draft.get("awaiting"):
        out["macro"] = macro_draft
    if isinstance(team_draft, dict) and team_draft.get("awaiting"):
        out["team"] = team_draft
    if isinstance(kb_draft, dict) and kb_draft.get("awaiting"):
        out["kb"] = kb_draft
    if isinstance(ticket_draft, dict) and ticket_draft.get("awaiting"):
        out["ticket"] = ticket_draft
    if isinstance(priority_draft, dict) and priority_draft.get("awaiting"):
        out["priority"] = priority_draft
    if isinstance(customer_draft, dict) and customer_draft.get("awaiting"):
        out["customer"] = customer_draft
    return out


def normalize_parked(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        flow = str(item.get("flow") or "").strip().lower()
        draft = item.get("draft")
        if not flow or not isinstance(draft, dict):
            continue
        draft = dict(draft)
        # Keep drafts that still have filled schema fields even if awaiting was cleared —
        # otherwise park→resume silently drops work and re-asks name/issue.
        if not draft.get("awaiting"):
            filled = any(
                str(draft.get(k) or "").strip()
                for k in (
                    "customerName",
                    "customerEmail",
                    "customerPhone",
                    "issue",
                    "subject",
                    "ticket_number",
                    "assignee",
                    "person",
                    "name",
                    "title",
                    "body",
                    "category",
                    "description",
                    "members",
                    "displayName",
                    "target_role",
                )
            )
            if not filled:
                continue
            try:
                from app.workflow_schemas import awaiting_hint_from_missing
                from app.workflow_state import workflow_type_from_flow

                wf = workflow_type_from_flow(flow, draft)
                hint = awaiting_hint_from_missing(wf, draft)
                if hint:
                    draft["awaiting"] = hint
            except Exception:  # noqa: BLE001
                draft["awaiting"] = draft.get("awaiting") or "confirm"
        if draft.get("awaiting"):
            out.append({"flow": flow, "draft": draft})
    return out


def park_flows(
    active: dict[str, dict[str, Any]],
    *,
    except_flows: set[str] | None = None,
    existing_parked: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Move active drafts (except the new flow) onto parked_drafts in session state."""
    import logging

    skip = except_flows or set()
    parked = normalize_parked(existing_parked)
    keep = [p for p in parked if p["flow"] not in active or p["flow"] in skip]
    for flow, draft in active.items():
        if flow in skip:
            continue
        keep = [p for p in keep if p["flow"] != flow]
        snap = dict(draft)
        keep.append({"flow": flow, "draft": snap})
        logging.getLogger(__name__).info(
            "workflow_park flow=%s awaiting=%s field_keys=%s",
            flow,
            str(snap.get("awaiting") or ""),
            sorted(k for k, v in snap.items() if v not in (None, "", [], {})),
        )
    return keep


def is_resume_request(text: str) -> bool:
    """Deprecated keyword probe — resume must come from RESUME_WORKFLOW / decision."""
    del text
    return False


def pick_resume_flow(text: str, parked: list[dict[str, Any]]) -> str | None:
    """Last-parked only when NLU did not name a flow (no utterance keyword maps)."""
    del text
    if not parked:
        return None
    return parked[-1]["flow"]


def pick_resume_flow_from_decision(
    decision: dict[str, Any] | None,
    parked: list[dict[str, Any]],
) -> str | None:
    """Resume target from Gemma decision (entity_type / values), not keywords."""
    if not parked or not isinstance(decision, dict):
        return None
    et = str(decision.get("entity_type") or "").strip().lower()
    mapping = {
        "ticket": "ticket",
        "team": "team",
        "article": "kb",
        "macro": "macro",
        "customer": "customer",
        "priority": "priority",
        "status": "priority",
    }
    want = mapping.get(et)
    if want:
        for p in reversed(parked):
            if p["flow"] == want:
                return want
    # values may include flow names from the model
    for raw in decision.get("values") or []:
        v = str(raw or "").strip().lower()
        for flow in (
            "ticket",
            "team",
            "kb",
            "macro",
            "escalate",
            "reassign",
            "customer",
            "priority",
        ):
            if flow in v:
                for p in reversed(parked):
                    if p["flow"] == flow:
                        return flow
    return None


def unpark(
    parked: list[dict[str, Any]], flow: str
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    import logging

    draft = None
    rest: list[dict[str, Any]] = []
    for p in parked:
        if p["flow"] == flow and draft is None:
            draft = dict(p["draft"])
        else:
            rest.append(p)
    if draft is not None:
        logging.getLogger(__name__).info(
            "workflow_unpark flow=%s awaiting=%s field_keys=%s parked_remaining=%s",
            flow,
            str(draft.get("awaiting") or ""),
            sorted(k for k, v in draft.items() if v not in (None, "", [], {})),
            [str(p.get("flow") or "") for p in rest],
        )
    return draft, rest


_INTERNAL_DRAFT_KEYS = frozenset(
    {
        "awaiting",
        "enriched",
        "confidence",
        "surface",
        "kind",
        "customer_not_found",
        "members_skipped",
        "candidates",
        "person_hint",
        "roster",
        "pending_tool",
        "write_armed",
    }
)

_FLOW_WORKFLOW_ID = {
    "ticket": "create_ticket",
    "customer": "create_customer",
    "macro": "create_macro",
    "kb": "create_kb",
    "escalate": "escalate",
    "reassign": "reassign_ticket",
}

_FLOW_LABEL = {
    "ticket": "ticket creation",
    "customer": "customer creation",
    "team": "team workflow",
    "macro": "macro creation",
    "kb": "knowledge article",
    "escalate": "escalation",
    "reassign": "reassignment",
    "priority": "priority/status setup",
}

# Guided writes that complete a parkable collect (trigger resume offer).
GUIDED_COMPLETION_TOOLS = frozenset(
    {
        "create_ticket",
        "create_customer",
        "create_queue",
        "create_kb_article",
        "create_macro",
        "create_priority",
        "create_status",
        "escalate_ticket",
        "update_queue",
        "delete_queue",
        "delete_macro",
        "delete_priority",
        "delete_status",
    }
)


def workflow_id_for_parked_flow(flow: str, draft: dict[str, Any] | None) -> str:
    """Map park flow key → schema id (same rules as resume hydration)."""
    f = str(flow or "").strip().lower()
    d = draft if isinstance(draft, dict) else {}
    awaiting = str(d.get("awaiting") or "").strip().lower()
    if f == "team":
        if awaiting in ("members", "members_names", "members_team") or (
            str(d.get("id") or "").strip()
            and any(key in d for key in ("members", "member_names"))
        ):
            return "add_team_members"
        return "create_team"
    if f == "priority":
        if str(d.get("kind") or "").strip().lower() == "status":
            return "create_status"
        return "create_priority"
    if f in {"kb", "manage_category", "manage_kb_category"}:
        draft_flow = str(d.get("flow") or "").strip().lower()
        if (
            draft_flow == "manage_category"
            or awaiting in {"manage_mode", "category_name"}
            or f in {"manage_category", "manage_kb_category"}
        ):
            return "manage_kb_category"
        return "create_kb"
    return _FLOW_WORKFLOW_ID.get(f) or f


def filled_fields_from_draft(
    draft: dict[str, Any] | None, workflow_id: str | None = None
) -> dict[str, Any]:
    """Non-empty collected values for LLM context (not transcript reconstruction)."""
    from app.workflow_schemas import schema_for_workflow

    d = draft if isinstance(draft, dict) else {}
    schema = schema_for_workflow(workflow_id) or {}
    prefer = list(schema.get("required") or []) + list(schema.get("optional") or [])
    # Common aliases present on drafts but not always in schema.required
    prefer += [
        "customerName",
        "customerEmail",
        "customerPhone",
        "customerId",
        "issue",
        "subject",
        "title",
        "body",
        "category",
        "name",
        "email",
        "phone",
        "description",
        "members",
        "ticket_number",
        "ticketNumber",
        "assignee",
        "person",
        "target_role",
        "displayName",
        "resolutionHours",
    ]
    out: dict[str, Any] = {}
    seen: set[str] = set()
    for key in prefer:
        if key in seen or key in _INTERNAL_DRAFT_KEYS:
            continue
        seen.add(key)
        val = d.get(key)
        if val is None or val == "" or val == [] or val == {}:
            continue
        if isinstance(val, str) and not val.strip():
            continue
        out[key] = val
    return out


def summarize_parked_item(item: dict[str, Any]) -> dict[str, Any]:
    """Compact parked workflow for Super Agent / specialist context."""
    from app.workflow_schemas import missing_fields

    flow = str(item.get("flow") or "").strip().lower()
    draft = item.get("draft") if isinstance(item.get("draft"), dict) else {}
    wid = workflow_id_for_parked_flow(flow, draft)
    missing = missing_fields(wid, draft)
    filled = filled_fields_from_draft(draft, wid)
    return {
        "flow": flow,
        "workflow_id": wid,
        "status": "parked",
        "current_step": draft.get("awaiting"),
        "awaiting": draft.get("awaiting"),
        "filled_fields": filled,
        "missing_fields": missing,
        "draft": draft,
    }


def summarize_parked_workflows(
    parked: list[dict[str, Any]] | None, *, limit: int = 8
) -> list[dict[str, Any]]:
    items = normalize_parked(parked)
    out: list[dict[str, Any]] = []
    for item in items[-limit:]:
        summary = summarize_parked_item(item)
        # Drop full draft from NLU payload to save tokens; keep filled/missing.
        out.append({k: v for k, v in summary.items() if k != "draft"})
    return out


def format_parked_for_specialist(parked: list[dict[str, Any]] | None) -> str:
    """Human block for specialist prompts."""
    items = normalize_parked(parked)
    if not items:
        return ""
    lines = ["### PARKED WORKFLOWS (do not restart; resume from filled/missing)"]
    for idx, item in enumerate(items, start=1):
        s = summarize_parked_item(item)
        lines.append(f"{idx}. {s.get('workflow_id') or s.get('flow')}")
        filled = s.get("filled_fields") or {}
        if filled:
            lines.append("   filled:")
            for k, v in filled.items():
                lines.append(f"     {k} = {v}")
        missing = s.get("missing_fields") or []
        if missing:
            lines.append("   missing: " + ", ".join(str(m) for m in missing))
        else:
            lines.append("   missing: (none — confirm/write when user resumes)")
    return "\n".join(lines)


def _subject_hint(filled: dict[str, Any], flow: str) -> str:
    for key in (
        "name",
        "customerName",
        "title",
        "issue",
        "subject",
        "displayName",
        "team",
        "ticket_number",
        "ticketNumber",
    ):
        val = str(filled.get(key) or "").strip()
        if val:
            return val
    return _FLOW_LABEL.get(flow, flow or "workflow")


def apply_customer_row_to_parked_tickets(
    parked: list[dict[str, Any]] | None,
    *,
    customer_id: str,
    name: str,
    email: str = "",
    phone: str = "",
) -> list[dict[str, Any]]:
    """When add-customer completes, bind the new customer onto parked ticket drafts."""
    items = normalize_parked(parked)
    if not items or not str(customer_id or "").strip():
        return items
    out: list[dict[str, Any]] = []
    for item in items:
        flow = str(item.get("flow") or "").strip().lower()
        # Native park uses create_ticket; classic park uses ticket.
        if flow not in {"ticket", "create_ticket"}:
            out.append(item)
            continue
        draft = dict(item.get("draft") or {})
        draft["customerId"] = str(customer_id).strip()
        if name:
            draft["customerName"] = name
        if email:
            draft["customerEmail"] = email
        if phone:
            draft["customerPhone"] = phone
        out.append({"flow": "ticket", "draft": draft})
    return out


def maybe_offer_resume(
    parked: list[dict[str, Any]] | None,
    *,
    user_text: str = "",
    page: str | None = None,
    completed_tool: str | None = None,
) -> dict[str, Any] | None:
    """After any guided write succeeds: offer to continue the newest parked flow.

    Does not auto-unpark. Returns offer_reply + pending_resume metadata.
    """
    del completed_tool  # reserved for future prioritization
    items = normalize_parked(parked)
    if not items:
        return None
    top = items[-1]
    summary = summarize_parked_item(top)
    flow = str(summary.get("flow") or "")
    filled = summary.get("filled_fields") if isinstance(summary.get("filled_fields"), dict) else {}
    hint = _subject_hint(filled, flow)
    label = _FLOW_LABEL.get(flow, flow or "workflow")
    missing = summary.get("missing_fields") or []
    fallback = (
        f"You also have an unfinished {label} for {hint}. "
        "Would you like to continue it?"
    )
    try:
        from app.tasks.chat_commands import _llm_phrase

        offer = _llm_phrase(
            module="workflow",
            kind="offer_resume",
            fallback=fallback,
            user_text=user_text or "",
            page_label=page or "",
            context={
                "flow": flow,
                "workflowId": summary.get("workflow_id"),
                "subjectHint": hint,
                "filledFields": filled,
                "missingFields": missing,
                "intent": "offer to resume parked workflow; ask yes/no only",
            },
        )
    except Exception:  # noqa: BLE001
        # Never paint the seed as the chat bubble (no-static-chat-replies).
        offer = ""
    offer = str(offer or "").strip()
    if not offer:
        return None
    return {
        "offer_reply": offer,
        "pending_resume": {
            "flow": flow,
            "workflow_id": summary.get("workflow_id"),
            "missing_fields": missing,
            "filled_fields": filled,
            "subject_hint": hint,
            "parked_count": len(items),
            "other_parked_flows": [
                str(p.get("flow") or "")
                for p in items[:-1]
                if str(p.get("flow") or "")
            ],
        },
        "parked_drafts": items,
    }


def looks_like_side_quest(text: str) -> bool:
    """Deprecated — side quests come from Gemma SIDE_QUEST, not utterance keywords."""
    del text
    return False


def recover_kb_draft_from_history(history: list | None) -> dict[str, Any] | None:
    """Rebuild kb_draft from session_history when checkpoint fields were cleared."""
    if not isinstance(history, list):
        return None
    title = ""
    category = ""
    awaiting = ""
    for item in reversed(history[-30:]):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").lower()
        text = str(item.get("text") or "")
        if role == "assistant":
            if re.search(
                r"category|billing|troubleshooting|accounts|general|type a (new )?name",
                text,
                re.I,
            ) and re.search(r"\btitle\b|\*\*[^*]+\*\*", text, re.I):
                m = re.search(r"\*\*([^*]{2,80})\*\*", text)
                if m and not title:
                    cand = m.group(1).strip()
                    if cand.lower() not in {
                        "billing",
                        "troubleshooting",
                        "accounts",
                        "general",
                        "other",
                        "confirm",
                        "cancel",
                    }:
                        title = cand
                if not awaiting:
                    awaiting = "category"
            if re.search(r"article content|body|what should the article", text, re.I):
                if not awaiting:
                    awaiting = "body"
            if re.search(r"\bconfirm\b.*publish|say \*\*confirm\*\*", text, re.I):
                if not awaiting:
                    awaiting = "confirm"
            if re.search(r"article title|what should the (article )?title", text, re.I):
                if not awaiting:
                    awaiting = "title"
    if not title:
        saw_title_ask = False
        for item in history[-30:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").lower()
            text = str(item.get("text") or "").strip()
            if role == "assistant" and re.search(
                r"article title|what should the (article )?title", text, re.I
            ):
                saw_title_ask = True
                continue
            if saw_title_ask and role == "user" and len(text) >= 3:
                title = text
                if not awaiting:
                    awaiting = "category"
                break
    if not awaiting:
        return None
    draft: dict[str, Any] = {"awaiting": awaiting}
    if title:
        draft["title"] = title
    if category:
        draft["category"] = category
    return draft


def recover_macro_draft_from_history(history: list | None) -> dict[str, Any] | None:
    if not isinstance(history, list):
        return None
    awaiting = ""
    title = ""
    saw_title_ask = False
    for item in history[-30:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").lower()
        text = str(item.get("text") or "").strip()
        if role == "assistant":
            if re.search(r"\bmacro title\b|what.*(title|name).*macro", text, re.I):
                saw_title_ask = True
                awaiting = awaiting or "title"
            if re.search(r"\b(body|reply text|macro body)\b", text, re.I):
                awaiting = "body"
            if re.search(r"confirm.*macro|save this macro", text, re.I):
                awaiting = "confirm"
        if saw_title_ask and role == "user" and len(text) >= 2 and not title:
            title = text
            awaiting = awaiting if awaiting != "title" else "body"
            saw_title_ask = False
    if not awaiting:
        return None
    draft: dict[str, Any] = {"awaiting": awaiting}
    if title:
        draft["title"] = title
    return draft


def next_step_hint_for_draft(flow: str, draft: dict[str, Any]) -> str:
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if flow == "ticket":
        if awaiting == "name":
            return "customer full name"
        if awaiting == "contact":
            return "email address or phone number"
        if awaiting == "issue":
            return "short description of the customer issue"
        if awaiting == "kb_resolution":
            return "try the suggested steps, or say you still need a ticket"
        if awaiting == "priority":
            return "priority (urgent, high, medium, or low)"
        if awaiting == "confirm":
            return "confirm to file, or cancel"
    if flow == "kb":
        if awaiting == "title":
            return "article title"
        if awaiting == "category":
            return "article category name"
        if awaiting == "body":
            return "article content"
        if awaiting == "confirm":
            return "confirm or cancel"
    if flow == "macro":
        if awaiting == "title":
            return "macro title"
        if awaiting == "body":
            return "macro reply body"
        if awaiting == "confirm":
            return "confirm or cancel"
    if flow == "team":
        if awaiting == "name":
            return "team name"
        if awaiting == "description":
            return "short team description"
        if awaiting in ("create_members", "confirm"):
            return "staff names to add, or skip"
        if awaiting in ("members", "members_names", "members_team"):
            name = str(draft.get("name") or "").strip() or "the team"
            if awaiting == "members_team" or not str(draft.get("name") or "").strip():
                return "team name to update"
            return f"staff names to add to {name}"
        if awaiting == "delete_confirm":
            return "confirm or cancel"
    if flow == "escalate":
        if awaiting == "ticket":
            return "ticket number to escalate"
        if awaiting == "assignee":
            return "assignee or best resolver"
    if flow == "reassign":
        if awaiting == "ticket":
            return "ticket number to reassign"
        if awaiting == "target_role":
            return "agent or resolver"
        if awaiting == "person":
            return "teammate name"
        if awaiting == "confirm":
            return "confirm or cancel"
    if flow == "customer":
        if awaiting == "name":
            return "customer full name"
        if awaiting == "contact":
            return "email address or phone number"
    if flow == "priority":
        if awaiting == "name":
            return "priority display name"
        if awaiting == "hours":
            return "resolution hours (SLA)"
        if awaiting == "delete_confirm":
            return "confirm or cancel"
    return "continue where we left off"
