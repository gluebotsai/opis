"""Cheap Intent classifier — one tiny LLM call, label only (no regex greeting lists)."""

from __future__ import annotations

import re
import time

from app.messages_compat import HumanMessage, SystemMessage

from app.config import get_settings
from app.llm import get_llm
from app.llm_log import log_llm
from app.prompts import INTENT_SYSTEM
from app.state import AgentState

import logging

_log = logging.getLogger(__name__)

INTENT_LABELS: frozenset[str] = frozenset(
    {
        "GREETING",
        "CHAT",
        "TICKET",
        "CUSTOMER",
        "KB",
        "TEAMS",
        "MACRO",
        "ADMIN",
        "CREATE",
        "UPDATE",
        "SEARCH",
        "NAVIGATE",
    }
)
# UPDATE is used as a draft-forced label for add-members / delete-team (not LLM-classified).


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _draft_forced_intent(state: AgentState) -> str | None:
    """Active guided workflow owns the turn — skip re-classify."""
    from app.workflow_state import intent_for_workflow

    # Side quests must reach cheap/semantic intent (e.g. "show my open tickets"
    # while CreateTicket is active). WM already kept the draft in state.
    decision = state.get("workflow_decision")
    if isinstance(decision, dict) and str(decision.get("action") or "").upper() == "SIDE_QUEST":
        return None

    wf = (state.get("current_workflow") or "").strip()
    step = (state.get("current_step") or "").strip()
    if wf:
        return intent_for_workflow(wf, step)

    if state.get("escalate_draft"):
        return "UPDATE"
    team = state.get("team_draft") if isinstance(state.get("team_draft"), dict) else None
    if team:
        awaiting = str(team.get("awaiting") or "").strip().lower()
        if awaiting in ("members", "members_names", "members_team", "delete_confirm"):
            return "UPDATE"
        return "CREATE"
    if state.get("macro_draft") or state.get("kb_draft") or state.get("customer_draft"):
        return "CREATE"
    next_step = (state.get("next_step") or "").strip()
    draft = state.get("ticket_draft") or {}
    if next_step or (isinstance(draft, dict) and any(draft.values())):
        return "CREATE"
    return None


def _normalize_label(raw: str) -> str:
    text = (raw or "").strip().upper()
    # First token; strip punctuation
    token = re.split(r"[\s,.;:!?]+", text)[0] if text else ""
    token = "".join(ch for ch in token if ch.isalpha())
    if token in INTENT_LABELS:
        return token
    # Common model variants + leaked workflow-action tokens (fail safe → UPDATE,
    # never silent CHAT). Underscores are stripped above, so START_REASSIGN → STARTREASSIGN.
    aliases = {
        "HI": "GREETING",
        "HELLO": "GREETING",
        "THANKS": "GREETING",
        "HELP": "CHAT",
        "GENERAL": "CHAT",
        "TICKETS": "TICKET",
        "CUSTOMERS": "CUSTOMER",
        "QUEUE": "TEAMS",
        "QUEUES": "TEAMS",
        "TEAM": "TEAMS",
        "KNOWLEDGE": "KB",
        "ARTICLE": "KB",
        "ESCALATE": "UPDATE",
        "STARTREASSIGN": "UPDATE",
        "REASSIGN": "UPDATE",
        "STARTESCALATE": "UPDATE",
        "FILTER": "TICKET",
        "OPEN": "NAVIGATE",
    }
    return aliases.get(token, "CHAT")


def classify_intent(state: AgentState) -> dict:
    """
    Set state.intent via draft override or a tiny classifier LLM.

    Does not set route — policy / agent_router maps intent → agent.
    """
    forced = _draft_forced_intent(state)
    user_text = _latest_user_text(state)
    page = state.get("page") or ""

    if forced:
        log_llm(
            kind="intent",
            user_text=user_text,
            response=f"raw={forced!r} → intent={forced} (draft override, skip LLM)",
            agent="intent",
            page=page or None,
            organization_id=state.get("organization_id"),
            model=get_settings().model_name,
            ms=0,
        )
        return {"intent": forced}

    semantic = (state.get("semantic_intent") or "").strip().upper()
    decision = state.get("workflow_decision")
    decision_action = (
        str(decision.get("action") or "").strip().upper()
        if isinstance(decision, dict)
        else ""
    )
    # Idle NORMAL_ROUTE / AMBIGUOUS must use Cheap Intent — not workflow NLU label.
    # START_* / SIDE_QUEST / CONTINUE_* may reuse semantic intent.
    _SEMANTIC_OK = frozenset(
        {
            "START_ADD_TEAM_MEMBERS",
            "START_CREATE_TEAM",
            "START_ESCALATE",
            "START_REASSIGN",
            "START_CREATE_TICKET",
            "START_CREATE_CUSTOMER",
            "START_CREATE_MACRO",
            "START_CREATE_KB",
            "START_CREATE_PRIORITY",
            "SIDE_QUEST",
            "CONTINUE_WORKFLOW",
            "CONFIRM_WORKFLOW",
            "PROVIDE_TEAM",
            "PROVIDE_MEMBERS",
            "PROVIDE_TICKET",
            "PROVIDE_ASSIGNEE",
            "RESUME_WORKFLOW",
            "NEW_TASK",
            "CANCEL_WORKFLOW",
        }
    )
    if semantic in INTENT_LABELS and decision_action in _SEMANTIC_OK:
        log_llm(
            kind="intent",
            user_text=user_text,
            response=(
                f"intent={semantic} (workflow {decision_action}, skip second LLM)"
            ),
            agent="intent",
            page=page or None,
            organization_id=state.get("organization_id"),
            model=get_settings().model_name,
            ms=0,
        )
        return {"intent": semantic}

    if not (user_text or "").strip():
        return {"intent": "CHAT"}

    hint = f"\n(User is currently on page: {page})" if page else ""
    llm = get_llm()
    t0 = time.perf_counter()
    result = llm.invoke(
        [
            SystemMessage(content=INTENT_SYSTEM),
            HumanMessage(content=f"{user_text}{hint}"),
        ]
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    raw = result.content if isinstance(result.content, str) else str(result.content or "")
    label = _normalize_label(raw)
    raw_token = "".join(
        ch for ch in (re.split(r"[\s,.;:!?]+", (raw or "").strip().upper())[0] if raw else "")
        if ch.isalpha()
    )
    if raw_token and raw_token not in INTENT_LABELS and raw_token != label:
        _log.info(
            "intent_normalize raw=%r token=%s → intent=%s (alias_or_default)",
            (raw or "")[:80],
            raw_token,
            label,
        )

    log_llm(
        kind="intent",
        user_text=user_text,
        response=f"raw={raw!r} → intent={label}",
        agent="intent",
        page=page or None,
        organization_id=state.get("organization_id"),
        model=get_settings().model_name,
        ms=elapsed_ms,
    )
    return {"intent": label}
