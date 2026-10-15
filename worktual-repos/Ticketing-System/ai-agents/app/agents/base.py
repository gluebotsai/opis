"""Lean specialist runner — Global + Agent + history + optional one tool round."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from app.messages_compat import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.config import get_settings
from app.llm import get_llm
from app.llm_log import log_llm
from app.prompts import AGENT_PROMPTS, GLOBAL_SYSTEM, PORTAL_SELF_SERVICE
from app.state import AgentState
from app.tools.bound import execute_tool_call, native_tools_for_agent

# Legacy name still referenced inside this module during migration.
langchain_tools_for_agent = native_tools_for_agent
from app.tools.express_client import ToolActor, tool_actor_scope

# Cap generation so greetings / short replies stay fast
_MAX_TOKENS = 200
_WRITE_MAX_TOKENS = 800


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _session_history_transcript(state: AgentState, limit: int | None = None) -> str:
    from app.memory_contract import HISTORY_WINDOW

    hist = state.get("session_history") or []
    if not isinstance(hist, list) or not hist:
        return ""
    cap = HISTORY_WINDOW if limit is None else limit
    user_text = (_latest_user_text(state) or "").strip()
    lines: list[str] = []
    window = hist[-cap:]
    for i, item in enumerate(window):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = str(item.get("text") or "").strip()
        if not text or role not in ("user", "assistant"):
            continue
        if role == "user" and text == user_text and i == len(window) - 1:
            continue
        label = "User" if role == "user" else "Assistant"
        lines.append(f"{label}: {text}")
    return "\n".join(lines)


def _checkpoint_transcript(state: AgentState, limit: int = 40) -> str:
    lines: list[str] = []
    msgs = list(state.get("messages") or [])
    prior = msgs[:-1] if msgs else []
    for msg in prior[-limit:]:
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        content = (content or "").strip()
        if not content:
            continue
        if role in ("human", "user"):
            lines.append(f"User: {content}")
        elif role in ("ai", "assistant"):
            lines.append(f"Assistant: {content}")
    return "\n".join(lines)


def _build_system(agent_key: str, state: AgentState) -> str:
    agent = AGENT_PROMPTS.get(agent_key) or AGENT_PROMPTS["general"]
    parts = [GLOBAL_SYSTEM, agent]
    if agent_key == "tickets" and state.get("can_create_ticket") is False:
        parts.append(
            "ROLE RESTRICTION: This user CANNOT create tickets. "
            "Never ask for customer name/email/issue to file a ticket. "
            "If they ask to create a ticket, say their role cannot and offer My Tickets, Search, or KB."
        )
    if state.get("policy_note") == "create_denied":
        parts.append("CREATE is denied for this role — do not start a create-ticket flow.")
    if state.get("policy_note") == "portal_auth_required":
        parts.append(
            "Visitor is not signed in as a registered customer. They may browse "
            "articles. To raise or check a ticket they must sign in (OTP only if "
            "their email/phone is already in the customer directory; or password "
            "if the org uses password mode). Do not invent an OTP send."
        )
    role_l = str(state.get("user_role") or "").strip().lower()
    surface_l = str(state.get("chat_surface") or state.get("surface") or "").strip().lower()
    if role_l.startswith("portal") or surface_l == "portal":
        parts.append(PORTAL_SELF_SERVICE)
    note = (state.get("policy_note") or "").strip()
    if note and note != "create_denied":
        parts.append(f"Policy note: {note}")
    from app.workflow_schemas import (
        armed_write_tools_from_state,
        write_schema_audit,
    )

    armed = armed_write_tools_from_state(dict(state))
    if armed:
        tools = ", ".join(sorted(armed))
        audit = write_schema_audit(dict(state))
        schema_line = f" Schema audit: {audit}." if audit else ""
        parts.append(
            "CONFIRM STEP: evaluate conversation memory (drafts in the human message) "
            "against the write-tool schema, then this turn's meaning."
            f"{schema_line} "
            "1) State: every required field must already be in the draft. If any "
            "required field is missing, ask only for that field — do not call the "
            "write tool. "
            "2) Confirm: if THIS turn means they want to proceed, call "
            f"{tools} now using the draft fields. Informal, misspelled, or slang "
            "agreement still counts — do not wait for a particular word, and do "
            "not re-ask just because the wording is short or messy. "
            "3) Invoke the write tool only when both (1) and (2) are true. "
            "Skip the write if a required field is missing, they refused, asked a "
            "question, asked to change a collected field, or started a different "
            "guided create. Never invent ids or values. Never tell them to type a "
            "specific word."
        )
    return "\n\n".join(parts)


def _build_human(state: AgentState, user_text: str, tool_json: str | None = None) -> str:
    from app.context_factory import build_specialist_human

    agent_key = str(state.get("route") or state.get("active_agent") or "general").strip().lower()
    # Prefer chat_module mapping for portal / idle specialists.
    mod = str(state.get("chat_module") or "").strip().lower()
    if mod == "portal":
        agent_key = "kb"
    elif mod in {"tickets", "teams", "customers", "kb", "macros", "admin"}:
        agent_key = mod
    return build_specialist_human(
        state, user_text, agent_key=agent_key, tool_json=tool_json
    )


def _message_text(msg: Any) -> str:
    content = getattr(msg, "content", None)
    if isinstance(content, str):
        text = content.strip()
    elif content is None:
        text = ""
    else:
        text = str(content).strip()
    # Gemma sometimes prefixes chain-of-thought; never paint it in chat.
    from app.tasks.phrase import strip_llm_thought_preamble

    return strip_llm_thought_preamble(text)


_WRITE_SUCCESS_PATCH: dict[str, dict[str, Any]] = {
    "create_ticket": {
        "ticket_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
            {"type": "create_ticket", "done": True, "refresh": True},
        ],
    },
    "portal_create_ticket": {
        "ticket_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [],
    },
    "create_queue": {
        "team_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "create_team", "done": True, "refresh": True},
        ],
    },
    "update_queue": {
        "team_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "update_team", "done": True, "refresh": True},
        ],
    },
    "delete_queue": {
        "team_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "refresh_teams"},
            {"type": "delete_team", "done": True, "refresh": True},
        ],
    },
    "create_customer": {
        "customer_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "customers"},
            {"type": "create_customer", "done": True, "refresh": True},
        ],
    },
    "create_kb_article": {
        "kb_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "kb"},
            {"type": "create_kb", "done": True, "refresh": True, "save": True},
        ],
    },
    "create_macro": {
        "macro_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "macros"},
            {"type": "create_macro", "done": True, "refresh": True},
        ],
    },
    "delete_macro": {
        "macro_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "macros"},
            {"type": "refresh_macros"},
            {"type": "delete_macro", "done": True, "refresh": True},
        ],
    },
    "create_priority": {
        "priority_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {"type": "create_priority", "done": True, "refresh": True},
        ],
    },
    "create_status": {
        "priority_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {"type": "create_status", "done": True, "refresh": True},
        ],
    },
    "delete_priority": {
        "priority_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {"type": "delete_priority", "done": True, "refresh": True},
        ],
    },
    "delete_status": {
        "priority_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {"type": "delete_status", "done": True, "refresh": True},
        ],
    },
    "escalate_ticket": {
        "escalate_draft": None,
        "reassign_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
            {"type": "escalate", "done": True, "refresh": True},
        ],
    },
    "publish_kb_article": {
        "actions": [
            {"type": "navigate", "view": "kb"},
            {"type": "refresh_kb"},
            {"type": "update_kb", "done": True, "refresh": True},
        ],
    },
    "update_ticket": {
        # Agent-column reassign completes via update_ticket — clear the draft so a
        # follow-up "resolver" starts a fresh person list, not a confirm handoff.
        "reassign_draft": None,
        "current_workflow": None,
        "current_step": None,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
        ],
    },
    "auto_assign_ticket": {
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
        ],
    },
    "add_ticket_note": {
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
        ],
    },
    "update_macro": {
        "actions": [
            {"type": "navigate", "view": "macros"},
            {"type": "refresh_macros"},
            {"type": "update_macro", "done": True, "refresh": True},
        ],
    },
    "update_org_preferences": {
        "actions": [
            {"type": "navigate", "view": "org-preferences"},
        ],
    },
    "update_priority": {
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {"type": "refresh_priorities"},
            {"type": "update_priority", "done": True, "refresh": True},
        ],
    },
    "update_status": {
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {"type": "refresh_priorities"},
            {"type": "update_status", "done": True, "refresh": True},
        ],
    },
}


_TOOL_NAME_ALIASES = {
    "create_team": "create_queue",
    "create_kb": "create_kb_article",
}

_INLINE_CALL_RE = re.compile(
    r"(?is)call:(?:[\w.-]+:)*([a-z][\w-]*)\s*\{(.*)\}\s*$",
)


def _parse_inline_kwargs(blob: str) -> dict[str, Any]:
    raw = (blob or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw if raw.startswith("{") else "{" + raw + "}")
        if isinstance(parsed, dict):
            return parsed
    except Exception:  # noqa: BLE001
        pass
    out: dict[str, Any] = {}
    keys = list(re.finditer(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", raw))
    for i, match in enumerate(keys):
        start = match.end()
        end = keys[i + 1].start() if i + 1 < len(keys) else len(raw)
        val = raw[start:end].strip().rstrip(",").strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in {"'", '"'}:
            val = val[1:-1]
        out[match.group(1)] = val
    return out


def parse_inline_tool_calls(text: str | None) -> list[dict[str, Any]]:
    """Gemma sometimes writes call:kb:create_kb_article{…} instead of bind_tools."""
    raw = (text or "").strip()
    if not raw or "call:" not in raw.lower():
        return []
    match = _INLINE_CALL_RE.search(raw)
    if not match:
        return []
    name = _TOOL_NAME_ALIASES.get(match.group(1).strip().lower(), match.group(1).strip().lower())
    args = _parse_inline_kwargs(match.group(2))
    if name == "create_kb_article" and not args.get("content") and args.get("body"):
        args["content"] = args.get("body")
    return [{"name": name, "args": args, "id": "call_text", "type": "tool_call"}]


def _reply_defers_armed_write(text: str | None) -> bool:
    """True when the specialist is still asking or refusing — do not auto-write."""
    raw = (text or "").strip()
    if not raw:
        return False
    if raw.endswith("?"):
        return True
    lower = raw.lower()
    if re.match(r"^(should|would|could|can)\b", lower):
        return True
    if re.search(r"\b(or change|change a field)\b", lower):
        return True
    return False


def _reply_commits_armed_write(text: str | None) -> bool:
    """True when the specialist already narrated the write instead of bind_tools."""
    raw = (text or "").strip()
    if _reply_defers_armed_write(raw):
        return False
    if not raw:
        return True
    return bool(
        re.search(
            r"\b(creat|publish|fil|sav|add|updat|delet|escalat|reassign|assign)\w*\b",
            raw,
            flags=re.I,
        )
    )


def _should_force_armed_write(state: AgentState, user_text: str) -> bool:
    """Armed confirm write only when NLU says CONFIRM/CONTINUE/RESUME.

    Affirmation and cancel are LLM-owned — never phrase regex on user text.
    Never force on field edits (assignee/person in decision.fields).
    """
    from app.tasks.chat_commands import _is_auto_pick_phrase
    from app.workflow_schemas import armed_write_tools_from_state

    decision = (
        state.get("workflow_decision")
        if isinstance(state.get("workflow_decision"), dict)
        else state.get("semantic_request")
        if isinstance(state.get("semantic_request"), dict)
        else {}
    )
    action = str(decision.get("action") or "").strip().upper()
    # Same-turn resume-to-confirm (parked flow restored, user affirmed).
    if state.get("force_armed_write"):
        action = "CONFIRM_WORKFLOW"
    if action not in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW", "RESUME_WORKFLOW"}:
        return False
    # RESUME only forces when a guided write is already armed at confirm.
    if action == "RESUME_WORKFLOW" and not armed_write_tools_from_state(dict(state)):
        return False
    raw = (user_text or "").strip()
    if not raw or raw.endswith("?"):
        return False
    if _is_auto_pick_phrase(raw):
        return False
    # Field-edit at confirm (different person / collected value) — do not force.
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    for key in ("assignee", "person"):
        if str(fields.get(key) or "").strip():
            return False
    return True


def _tool_calls(msg: Any) -> list[Any]:
    additional = getattr(msg, "additional_kwargs", None) or {}
    calls = getattr(msg, "tool_calls", None) or additional.get("tool_calls") or []
    found = list(calls) if calls else []
    if found:
        return found
    content = getattr(msg, "content", None)
    if isinstance(content, str):
        return parse_inline_tool_calls(content)
    return []


def run_specialist(agent_key: str, state: AgentState) -> dict:
    """
    Lean agent: Global + Agent + conversation; optional max one tool round.
    No DATA_INSTRUCTION / build_live_context dumps.
    """
    user_text = _latest_user_text(state)
    page = state.get("page") or ""
    org_id = state.get("organization_id") or ""
    intent = (state.get("intent") or "").strip().upper()
    tools_allowed = state.get("tools_allowed")
    if tools_allowed is None:
        # CHAT still binds tools: "yeah, show today's metrics" is often labeled
        # CHAT because of the ack, and disabling tools produced an empty bubble
        # that the UI then phrased as "chat is offline."
        tools_allowed = intent not in ("GREETING", "NAVIGATE")

    system = _build_system(agent_key, state)
    from app.context_factory import build_specialist_human

    human = build_specialist_human(state, user_text, agent_key=agent_key)

    from app.workflow_schemas import (
        armed_write_tools_from_state,
        draft_for_write_tool,
        fill_tool_args_from_state,
    )

    extra_tools = armed_write_tools_from_state(dict(state))
    # Armed confirm writes must bind even if cheap intent labeled the ack CHAT.
    if extra_tools:
        tools_allowed = True
    tools = (
        langchain_tools_for_agent(
            agent_key,
            module=state.get("chat_module"),
            surface=state.get("chat_surface"),
            extra_tools=extra_tools or None,
        )
        if tools_allowed
        else []
    )
    llm = get_llm()
    role_l = str(state.get("user_role") or "").strip().lower()
    surface_l = str(state.get("chat_surface") or state.get("surface") or "").strip().lower()
    portal_turn = role_l.startswith("portal") or surface_l == "portal"
    token_cap = (_WRITE_MAX_TOKENS if portal_turn else 600) if extra_tools else (
        600 if portal_turn else _MAX_TOKENS
    )
    # Prefer bind(max_tokens=…) when available (ChatOpenAI / fakes with bind)
    bound = llm
    if hasattr(llm, "bind"):
        try:
            bound = llm.bind(max_tokens=token_cap)
        except Exception:  # noqa: BLE001
            bound = llm
    if tools and hasattr(bound, "bind_tools"):
        try:
            bound = bound.bind_tools(tools)
        except Exception:  # noqa: BLE001
            pass

    actor = None
    if org_id and state.get("user_id"):
        actor = ToolActor(
            user_id=str(state.get("user_id")),
            organization_id=org_id,
            user_role=state.get("user_role"),
            user_name=state.get("user_name"),
            portal_customer_id=state.get("portal_customer_id"),
        )

    t0 = time.perf_counter()
    messages: list[Any] = [
        SystemMessage(content=system),
        HumanMessage(content=human),
    ]

    with tool_actor_scope(actor):
        result = bound.invoke(messages)
        text = _message_text(result)
        calls = _tool_calls(result) if tools_allowed else []
        if extra_tools and not calls:
            retry_system = (
                system
                + "\n\nCONFIRM STEP retry: re-check the draft against the tool schema, "
                "then this turn's meaning. If every required field is present and "
                "they mean to proceed, call the write tool now. Do not re-ask a "
                "field already in the draft. Skip only if a required field is "
                "missing, they refused, asked a question, asked to change a "
                "collected field, or started a different guided create. Informal "
                "or misspelled agreement still counts — never wait for a particular "
                "word. Never print call:tool{…} text — invoke the tool."
            )
            result = bound.invoke(
                [
                    SystemMessage(content=retry_system),
                    HumanMessage(content=human),
                ]
            )
            text = _message_text(result)
            calls = _tool_calls(result) if tools_allowed else []
        # Only force when the *user* confirmed. Never because the specialist
        # narrated a write ("I've escalated…") — that caused false success +
        # writes on "recommend best agent".
        if extra_tools and not calls and _should_force_armed_write(state, user_text):
            armed_name = next(iter(sorted(extra_tools)))
            calls = [
                {
                    "name": armed_name,
                    "args": {},
                    "id": "call_armed",
                    "type": "tool_call",
                }
            ]

        tool_payload: str | None = None
        data: dict[str, Any] = {}
        last_tool_name = ""

        rounds = 0
        while calls and rounds < 2:
            rounds += 1
            call = calls[0]
            if isinstance(call, dict):
                name = str(call.get("name") or call.get("function", {}).get("name") or "")
                raw_args = call.get("args")
                if raw_args is None and isinstance(call.get("function"), dict):
                    raw_args = call["function"].get("arguments")
                call_id = str(call.get("id") or f"call_{rounds}")
            else:
                name = str(getattr(call, "name", "") or "")
                raw_args = getattr(call, "args", None)
                call_id = str(getattr(call, "id", None) or f"call_{rounds}")

            args: dict[str, Any] = {}
            if isinstance(raw_args, dict):
                args = raw_args
            elif isinstance(raw_args, str) and raw_args.strip():
                try:
                    parsed = json.loads(raw_args)
                    if isinstance(parsed, dict):
                        args = parsed
                except json.JSONDecodeError:
                    args = {}

            decision = (
                state.get("workflow_decision")
                if isinstance(state.get("workflow_decision"), dict)
                else {}
            )
            ctx = (
                state.get("conversation_context")
                if isinstance(state.get("conversation_context"), dict)
                else {}
            )
            last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
            args = fill_tool_args_from_state(name, args, dict(state))
            draft, draft_key = draft_for_write_tool(name, dict(state))
            op_for_auth = str(decision.get("operation") or "") or None
            role_l = str(state.get("user_role") or "").strip().lower()
            surface_l = str(
                state.get("chat_surface") or state.get("surface") or ""
            ).strip().lower()
            if role_l.startswith("portal") or surface_l == "portal":
                op_for_auth = {
                    "list_kb": "LIST_KB",
                    "get_kb": "GET_ARTICLE",
                    "portal_list_tickets": "LIST_TICKETS",
                    "portal_create_ticket": "CREATE_TICKET",
                }.get(name, op_for_auth)
            try:
                tool_payload = execute_tool_call(
                    agent_key,
                    name,
                    args,
                    operation=op_for_auth,
                    role=state.get("user_role"),
                    workflow=state.get("current_workflow"),
                    action=str(decision.get("action") or "") or None,
                    last_query=last_q,
                    draft=draft,
                    workflow_id=str(state.get("current_workflow") or "") or None,
                    draft_key=draft_key,
                )
            except PermissionError as exc:
                tool_payload = json.dumps(
                    {"success": False, "error_code": "FORBIDDEN", "message": str(exc)}
                )
            except Exception as exc:  # noqa: BLE001
                tool_payload = json.dumps(
                    {
                        "success": False,
                        "error_code": "TOOL_EXECUTION_FAILED",
                        "message": str(exc),
                    }
                )

            last_tool_name = name
            try:
                parsed = json.loads(tool_payload)
                if isinstance(parsed, dict):
                    data = parsed
                    data["_tool_name"] = name
            except Exception:  # noqa: BLE001
                data = {"raw": tool_payload, "_tool_name": name}

            follow = [
            SystemMessage(content=system),
            HumanMessage(content=human),
                result,
                ToolMessage(content=tool_payload or "", tool_call_id=call_id),
            ]
            if rounds >= 2:
                final_llm = llm
                if hasattr(llm, "bind"):
                    try:
                        final_llm = llm.bind(max_tokens=token_cap)
                    except Exception:  # noqa: BLE001
                        final_llm = llm
                result2 = final_llm.invoke(follow)
                text = _message_text(result2)
                calls = []
                break
            result = bound.invoke(follow)
            text = _message_text(result)
            calls = _tool_calls(result) if tools_allowed else []

        if last_tool_name and not calls and tool_payload and rounds == 1:
            final_human = _build_human(state, user_text, tool_json=tool_payload)
            final_llm = llm
            if hasattr(llm, "bind"):
                try:
                    final_llm = llm.bind(max_tokens=token_cap)
                except Exception:  # noqa: BLE001
                    final_llm = llm
            result2 = final_llm.invoke(
                [
                    SystemMessage(content=system),
                    HumanMessage(content=final_human),
                ]
            )
            text = _message_text(result2)

    text = (text or "").strip()
    if last_tool_name and tool_payload and not text:
        final_human = _build_human(state, user_text, tool_json=tool_payload)
        final_llm = llm
        if hasattr(llm, "bind"):
            try:
                final_llm = llm.bind(max_tokens=token_cap)
            except Exception:  # noqa: BLE001
                final_llm = llm
        result3 = final_llm.invoke(
            [
                SystemMessage(
                    content=system
                    + "\n\nReply in 1–2 short sentences from TOOL RESULT. "
                    "Never print call:tool{…} or function-call syntax."
                ),
                HumanMessage(content=final_human),
            ]
        )
        text = _message_text(result3)

    elapsed_ms = (time.perf_counter() - t0) * 1000
    text = (text or "").strip()
    if not text:
        try:
            from app.tasks.phrase import phrase_reply

            module = {
                "teams": "team",
                "tickets": "ticket",
                "kb": "kb",
                "macros": "macro",
                "customers": "customer",
                "admin": "priority",
            }.get(agent_key, "nav")
            # Never kind=unavailable here — that makes Gemma invent "chat is offline"
            # when the specialist just returned an empty bubble.
            kind = "filter" if last_tool_name else "confirm_hint"
            text = str(
                phrase_reply(
                    module=module,
                    kind=kind,
                    fallback="Answer the user from Context. Never invent an outage.",
                    user_text=user_text,
                    page_label=page or "",
                    context={
                        "tool": last_tool_name or "",
                        "hadToolResult": bool(tool_payload),
                        "chatUnavailable": False,
                    },
                )
                or ""
            ).strip()
        except Exception:  # noqa: BLE001
            text = ""

    log_llm(
        kind="specialist",
        user_text=user_text,
        response=text,
        agent=agent_key,
        page=page or None,
        organization_id=org_id or None,
        model=get_settings().model_name,
        ms=elapsed_ms,
    )

    out: dict = {
        "reply": text,
        "messages": [AIMessage(content=text)],
    }
    if data:
        out["data"] = data
        from app.workflow_state import attach_tool_memory_to_result

        out = attach_tool_memory_to_result(out)
        success = bool(data.get("success"))
        patch = _WRITE_SUCCESS_PATCH.get(last_tool_name) if success else None
        if success:
            extra_data = dict(out.get("data") or {})
            last_q_out = extra_data.get("last_query")
            ctx = (
                state.get("conversation_context")
                if isinstance(state.get("conversation_context"), dict)
                else {}
            )
            ctx_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
            source_q = last_q_out if isinstance(last_q_out, dict) else ctx_q
            if source_q.get("pending_update") or source_q.get("pending_delete"):
                extra_data["last_query"] = {
                    k: v
                    for k, v in source_q.items()
                    if k not in {"pending_update", "pending_delete", "proposed_tool"}
                }
                out["data"] = extra_data
            # KB sidebar parity: category / export / import / refresh (no write patch).
            if last_tool_name in {
                "manage_kb_category",
                "export_kb",
                "import_kb_articles",
            }:
                payload = (
                    data.get("payload") if isinstance(data.get("payload"), dict) else {}
                )
                ui = str(payload.get("ui_action") or "").strip()
                kb_actions: list[dict] = list(out.get("actions") or [])
                if ui == "add_kb_category" and payload.get("category"):
                    kb_actions.append(
                        {
                            "type": "add_kb_category",
                            "category": str(payload.get("category") or "").strip(),
                        }
                    )
                elif last_tool_name == "export_kb" or ui == "export_kb":
                    kb_actions.append(
                        {
                            "type": "export_kb",
                            "format": str(payload.get("format") or "json"),
                            "filename": str(
                                payload.get("filename") or "worktual-kb.json"
                            ),
                            "articles": payload.get("articles") or [],
                        }
                    )
                elif last_tool_name == "import_kb_articles" or ui == "refresh_kb":
                    kb_actions.append({"type": "refresh_kb"})
                    kb_actions.append(
                        {"type": "create_kb", "done": True, "refresh": True}
                    )
                if kb_actions:
                    out["actions"] = kb_actions
        if patch:
            out.update({k: v for k, v in patch.items() if k != "actions"})
            actions = list(patch.get("actions") or [])
            if last_tool_name in {"update_ticket", "auto_assign_ticket", "add_ticket_note"}:
                from app.agents.workflow_manager import _ticket_view_for_page

                view = _ticket_view_for_page(page) or "tickets-list"
                actions = [
                    {"type": "navigate", "view": view},
                    {"type": "refresh_tickets"},
                ]
            out["actions"] = actions
            payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
            tn = str(
                payload.get("ticketNumber") or payload.get("ticket_number") or payload.get("id") or ""
            ).strip()
            if tn and last_tool_name in {"create_ticket", "escalate_ticket"}:
                out["last_entity"] = {"type": "ticket", "id": "", "name": tn.lstrip("#")}
                extra_data = dict(out.get("data") or {})
                extra_data["ticket_number"] = tn
                out["data"] = extra_data
            # Generic: after any guided write, offer resume of unfinished parked work.
            from app.memory_contract import (
                GUIDED_COMPLETION_TOOLS,
                apply_customer_row_to_parked_tickets,
                maybe_offer_resume,
                normalize_parked,
            )

            parked_now = normalize_parked(state.get("parked_drafts"))
            if last_tool_name == "create_customer" and parked_now:
                from app.tasks.catalog_commands import _directory_row_from_tool

                row = _directory_row_from_tool(data) or {}
                draft = (
                    state.get("customer_draft")
                    if isinstance(state.get("customer_draft"), dict)
                    else {}
                )
                cid = str(row.get("id") or "").strip()
                cname = str(row.get("name") or draft.get("name") or "").strip()
                if cid and cname:
                    parked_now = apply_customer_row_to_parked_tickets(
                        parked_now,
                        customer_id=cid,
                        name=cname,
                        email=str(row.get("email") or draft.get("email") or ""),
                        phone=str(row.get("phone") or draft.get("phone") or ""),
                    )
                    out["parked_drafts"] = parked_now
                    out["last_entity"] = {
                        "type": "customer",
                        "id": cid,
                        "name": cname,
                    }
            if last_tool_name in GUIDED_COMPLETION_TOOLS and parked_now:
                offer = maybe_offer_resume(
                    parked_now,
                    user_text=user_text,
                    page=page,
                    completed_tool=last_tool_name,
                )
                if offer:
                    offer_text = str(offer.get("offer_reply") or "").strip()
                    prior_reply = str(out.get("reply") or "").strip()
                    # After a successful write, never keep a collect prompt
                    # ("provide the customer's full name") next to the resume offer.
                    collectish = bool(
                        re.search(
                            r"\b(full name|provide|enter|what is|to (get )?started|"
                            r"need (an? |their )?email|phone number|describe)\b",
                            prior_reply,
                            re.I,
                        )
                    )
                    if offer_text and (not prior_reply or collectish):
                        from app.tasks.phrase import phrase_reply

                        done = phrase_reply(
                            module=(
                                "customer"
                                if last_tool_name == "create_customer"
                                else "ticket"
                                if last_tool_name == "create_ticket"
                                else "nav"
                            ),
                            kind="done",
                            fallback="That is saved.",
                            user_text=user_text,
                            page_label=page,
                            context={
                                "tool": last_tool_name,
                                "success": True,
                                "note": "Acknowledge the completed save only; do not ask for fields.",
                            },
                        )
                        out["reply"] = (
                            str(done or "").strip() + "\n\n" + offer_text
                        ).strip()
                    elif offer_text:
                        out["reply"] = (prior_reply + "\n\n" + offer_text).strip()
                    out["parked_drafts"] = offer.get("parked_drafts") or parked_now
                    pending = offer.get("pending_resume")
                    if isinstance(pending, dict) and pending:
                        extra_data = dict(out.get("data") or {})
                        extra_data["pending_resume"] = pending
                        out["data"] = extra_data
                        # Durable cue for next-turn Super Agent RESUME.
                        prior_ctx = (
                            out.get("conversation_context")
                            if isinstance(out.get("conversation_context"), dict)
                            else state.get("conversation_context")
                            if isinstance(state.get("conversation_context"), dict)
                            else {}
                        )
                        ctx_out = dict(prior_ctx)
                        last_q = (
                            dict(ctx_out["last_query"])
                            if isinstance(ctx_out.get("last_query"), dict)
                            else {}
                        )
                        last_q["pending_resume"] = pending
                        last_q["awaiting"] = "resume_offer"
                        ctx_out["last_query"] = last_q
                        out["conversation_context"] = ctx_out
        elif last_tool_name and last_tool_name in _WRITE_SUCCESS_PATCH:
            # Failed armed write: keep confirm draft so the user can retry.
            keep_draft, keep_key = draft_for_write_tool(last_tool_name, dict(state))
            # create_customer 409 / already-exists still completes the add intent.
            if last_tool_name == "create_customer":
                from app.memory_contract import (
                    apply_customer_row_to_parked_tickets,
                    maybe_offer_resume,
                    normalize_parked,
                )
                from app.tasks.catalog_commands import _directory_row_from_tool

                row = _directory_row_from_tool(data) or {}
                draft = (
                    state.get("customer_draft")
                    if isinstance(state.get("customer_draft"), dict)
                    else {}
                )
                cid = str(row.get("id") or "").strip()
                cname = str(row.get("name") or draft.get("name") or "").strip()
                err = str(data.get("message") or data.get("error") or "").lower()
                already = bool(cid and cname) and (
                    "already" in err
                    or "exist" in err
                    or "conflict" in err
                    or str(data.get("error_code") or "").upper()
                    in {"CONFLICT", "ALREADY_EXISTS"}
                    or isinstance(data.get("payload"), dict)
                    and (
                        isinstance(data["payload"].get("customer"), dict)
                        or isinstance(data["payload"].get("existing"), dict)
                    )
                )
                if already:
                    parked_now = normalize_parked(state.get("parked_drafts"))
                    parked_now = apply_customer_row_to_parked_tickets(
                        parked_now,
                        customer_id=cid,
                        name=cname,
                        email=str(row.get("email") or draft.get("email") or ""),
                        phone=str(row.get("phone") or draft.get("phone") or ""),
                    )
                    out["customer_draft"] = None
                    out["current_workflow"] = None
                    out["current_step"] = None
                    out["last_entity"] = {
                        "type": "customer",
                        "id": cid,
                        "name": cname,
                    }
                    out["parked_drafts"] = parked_now
                    if parked_now:
                        offer = maybe_offer_resume(
                            parked_now,
                            user_text=user_text,
                            page=page,
                            completed_tool="create_customer",
                        )
                        if offer:
                            offer_text = str(offer.get("offer_reply") or "").strip()
                            if offer_text:
                                out["reply"] = (
                                    str(out.get("reply") or "").strip()
                                    + "\n\n"
                                    + offer_text
                                ).strip()
                            out["parked_drafts"] = (
                                offer.get("parked_drafts") or parked_now
                            )
                            pending = offer.get("pending_resume")
                            if isinstance(pending, dict) and pending:
                                extra_data = dict(out.get("data") or {})
                                extra_data["pending_resume"] = pending
                                out["data"] = extra_data
                                prior_ctx = (
                                    state.get("conversation_context")
                                    if isinstance(
                                        state.get("conversation_context"), dict
                                    )
                                    else {}
                                )
                                ctx_out = dict(prior_ctx)
                                last_q = (
                                    dict(ctx_out["last_query"])
                                    if isinstance(ctx_out.get("last_query"), dict)
                                    else {}
                                )
                                last_q["pending_resume"] = pending
                                last_q["awaiting"] = "resume_offer"
                                ctx_out["last_query"] = last_q
                                out["conversation_context"] = ctx_out
                    keep_draft = None
            if keep_draft and keep_key:
                # Flag customer-not-found so next "yes" starts create_customer
                # instead of re-trying create_ticket in a loop.
                if last_tool_name == "create_ticket":
                    err_msg = str(data.get("message") or "").lower()
                    if "customer not found" in err_msg or "add the customer" in err_msg:
                        keep_draft["customer_not_found"] = True
                out[keep_key] = keep_draft
                out["current_workflow"] = state.get("current_workflow") or out.get(
                    "current_workflow"
                )
                out["current_step"] = str(keep_draft.get("awaiting") or "confirm")
    return out


def specialist_llm_or_query(
    agent_key: str,
    state: AgentState,
    *,
    should_query: bool,
) -> dict | None:
    """Specialist LLM tool loop. None means fall back to execute_*_query."""
    if not should_query:
        return None
    try:
        llm_out = run_specialist(agent_key, state)
    except Exception:  # noqa: BLE001
        return None
    data = llm_out.get("data") if isinstance(llm_out.get("data"), dict) else {}
    if not data.get("_tool_name") or not data.get("success"):
        return None
    llm_out["route"] = agent_key
    llm_out["workflow_handled"] = True
    return llm_out
