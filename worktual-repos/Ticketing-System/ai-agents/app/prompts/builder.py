"""Six-section prompt builders — one CRM-style prompt per specialist.

Mandatory section order (ai-service architecture):
Role → Goal → Instructions → Context → Output → Guardrails

Native chat uses these builders only (`ticketing_coworker`).
Legacy strings in `systems.py` are not injected into the native tool loop.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.contracts.execution import AgentDefinition
from app.workflow_schemas import (
    missing_fields,
    next_field_label,
    schema_for_workflow,
)

# ---------------------------------------------------------------------------
# Shared context helpers (facts only — not Role/Goal/Instructions)
# ---------------------------------------------------------------------------

_AGENT_CREATE_WORKFLOW: dict[str, str] = {
    "tickets": "create_ticket",
    "teams": "create_team",
    "customers": "create_customer",
    "kb": "create_kb",
    "macros": "create_macro",
    "admin": "create_priority",
}

_DRAFT_KEY_BY_WORKFLOW: dict[str, str] = {
    "create_ticket": "ticket_draft",
    "create_team": "team_draft",
    "add_team_members": "team_draft",
    "create_customer": "customer_draft",
    "create_kb": "kb_draft",
    "create_macro": "macro_draft",
    "create_priority": "priority_draft",
    "create_status": "status_draft",
    "escalate": "escalate_draft",
}

_PATCH_TOOL_BY_WORKFLOW: dict[str, str] = {
    "create_ticket": "patch_ticket_draft",
    "create_team": "patch_team_draft",
    "add_team_members": "patch_team_draft",
    "create_customer": "patch_customer_draft",
    "create_kb": "patch_kb_draft",
    "create_macro": "patch_macro_draft",
    "create_priority": "patch_priority_draft",
    "create_status": "patch_status_draft",
    "escalate": "patch_escalate_draft",
}

PromptBuilder = Callable[..., str]
_AGENT_DEFINITIONS_ROOT = Path(__file__).resolve().parents[1] / "agents" / "definitions"


def _manifest_sections(text: str) -> dict[str, str]:
    """Parse the deliberately small agent.md heading contract."""
    sections: dict[str, list[str]] = {}
    current = ""
    for line in text.splitlines():
        if line.startswith("## "):
            current = line[3:].strip().lower()
            sections.setdefault(current, [])
            continue
        if current:
            sections[current].append(line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def _manifest_list(value: str) -> list[str]:
    out: list[str] = []
    for line in value.splitlines():
        item = line.strip()
        if not item.startswith("- "):
            continue
        item = item[2:].strip()
        if item and item.lower() != "none":
            out.append(item)
    return out


def _manifest_metadata(value: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in _manifest_list(value):
        key, sep, raw = item.partition(":")
        if sep and key.strip():
            out[key.strip().lower()] = raw.strip()
    return out


@lru_cache
def load_agent_definition(agent_id: str) -> AgentDefinition:
    """Load one canonical AgentDefinition from its audited agent.md."""
    clean = str(agent_id or "").strip()
    if not clean or clean != Path(clean).name:
        raise ValueError(f"invalid agent id: {agent_id!r}")
    path = (_AGENT_DEFINITIONS_ROOT / clean / "agent.md").resolve()
    root = _AGENT_DEFINITIONS_ROOT.resolve()
    if root not in path.parents or not path.is_file():
        raise ValueError(f"unknown canonical agent: {clean}")
    text = path.read_text(encoding="utf-8")
    sections = _manifest_sections(text)
    metadata = _manifest_metadata(sections.get("runtime metadata", ""))
    return AgentDefinition(
        id=clean,
        version=metadata.get("version", "1.0.0"),
        layer=metadata.get("layer", "executor"),
        execution_mode=metadata.get("execution_mode", "llm"),
        description=sections.get("role", ""),
        prompt_path=str(path),
        skills=_manifest_list(sections.get("skills", "")),
        mcp_servers=_manifest_list(sections.get("allowed mcp servers", "")),
        handoff_targets=_manifest_list(sections.get("handoff targets", "")),
        local_controls=_manifest_list(sections.get("local controls", "")),
        output_contract="executor-result-v1",
        approval_policy=(sections.get("approval policy", "none").splitlines() or ["none"])[0].strip(),
        memory_policy={"manifest": sections.get("memory policy", "")},
        prompt=text,
    )


@lru_cache
def load_agent_definitions() -> dict[str, AgentDefinition]:
    """Load and cross-validate all canonical manifests."""
    definitions: dict[str, AgentDefinition] = {}
    for path in sorted(_AGENT_DEFINITIONS_ROOT.glob("*/agent.md")):
        definition = load_agent_definition(path.parent.name)
        if definition.id in definitions:
            raise ValueError(f"duplicate agent id: {definition.id}")
        definitions[definition.id] = definition
    for definition in definitions.values():
        unknown = set(definition.handoff_targets) - set(definitions)
        if unknown:
            raise ValueError(
                f"{definition.id} has unknown handoff targets: {sorted(unknown)}"
            )
    return definitions


def sectioned_system_prompt(
    *,
    role: str,
    goal: str,
    instructions: str,
    context: str,
    output: str,
    guardrails: str,
) -> str:
    parts = [
        f"## Role\n{role.strip()}",
        f"## Goal\n{goal.strip()}",
        f"## Instructions\n{instructions.strip()}",
        f"## Context\n{context.strip()}",
        f"## Output\n{output.strip()}",
        f"## Guardrails\n{guardrails.strip()}",
    ]
    return "\n\n".join(parts)


def _session_context_lines(
    *,
    agent_name: str,
    module: str | None,
    surface: str | None,
    page: str | None,
    actor_role: str | None,
    durable: dict[str, Any],
) -> list[str]:
    return [
        f"agent={agent_name}",
        f"module={module or ''}",
        f"surface={surface or ''}",
        f"page={page or ''}",
        f"role={actor_role or ''}",
        f"active_agent={durable.get('active_agent') or agent_name}",
        f"last_entity={durable.get('last_entity')}",
        f"last_tool_outcome={durable.get('last_tool_outcome')}",
        f"pending_ask={durable.get('pending_ask')}",
        f"slots={durable.get('slots')}",
        f"current_workflow={durable.get('current_workflow')}",
    ]


def _active_guided_workflow(agent_name: str, durable: dict[str, Any]) -> str | None:
    current = str(durable.get("current_workflow") or "").strip()
    if current and current in _DRAFT_KEY_BY_WORKFLOW:
        key = _DRAFT_KEY_BY_WORKFLOW[current]
        blob = durable.get(key)
        if isinstance(blob, dict):
            has_value = any(
                str(v).strip()
                for k, v in blob.items()
                if k not in {"awaiting", "step", "kind", "surface"}
                and not isinstance(v, (dict, list))
            ) or (
                isinstance(blob.get("members"), list) and bool(blob.get("members"))
            )
            # current_workflow alone is enough only when draft has progress
            # or the specialist is mid-confirm (awaiting=confirm with filled reqs).
            awaiting = str(blob.get("awaiting") or "").strip().lower()
            if has_value or awaiting in {"confirm", "delete_confirm"}:
                return current
        elif current:
            return current
    active = durable.get("active_workflow")
    if isinstance(active, dict):
        wf = str(active.get("workflow_type") or "").strip()
        if wf in _DRAFT_KEY_BY_WORKFLOW:
            return wf
    for wf, key in _DRAFT_KEY_BY_WORKFLOW.items():
        blob = durable.get(key)
        if not isinstance(blob, dict):
            continue
        has_value = any(
            str(v).strip()
            for k, v in blob.items()
            if k not in {"awaiting", "step", "kind", "surface"}
            and not isinstance(v, (dict, list))
        ) or (
            isinstance(blob.get("members"), list) and bool(blob.get("members"))
        )
        # Ignore awaiting-only page shells — they are not an active collect.
        if not has_value:
            continue
        if _AGENT_CREATE_WORKFLOW.get(agent_name) == wf:
            return wf
        if agent_name == "tickets" and wf == "escalate":
            return wf
        if agent_name == "teams" and wf in {"create_team", "add_team_members"}:
            return wf
        if agent_name == "admin" and wf in {"create_priority", "create_status"}:
            return wf
    return None


def _guided_context_lines(agent_name: str, durable: dict[str, Any]) -> list[str]:
    """Live draft snapshot for Context — facts only, no graph action enums."""
    workflow = _active_guided_workflow(agent_name, durable)
    primary: str | None = None
    lines_admin_delete = False

    # Admin owns create/update/delete. Never advertise create-priority required
    # fields (name→hours) while idle or while deleting — that steers the LLM
    # into inventing a create collect mid-delete.
    if agent_name == "admin":
        pri = durable.get("priority_draft")
        st = durable.get("status_draft")
        pri = pri if isinstance(pri, dict) else {}
        st = st if isinstance(st, dict) else {}
        pri_aw = str(pri.get("awaiting") or "").strip().lower()
        st_aw = str(st.get("awaiting") or "").strip().lower()
        if pri_aw == "delete_confirm" or st_aw == "delete_confirm":
            primary = None
            lines_admin_delete = True
        elif pri_aw in {"name", "hours", "confirm"} or st_aw in {"name", "confirm"}:
            if st_aw in {"name", "confirm"} and pri_aw not in {"name", "hours", "confirm"}:
                primary = "create_status"
            else:
                primary = "create_priority"
            lines_admin_delete = False
    elif workflow:
        draft_key = _DRAFT_KEY_BY_WORKFLOW.get(workflow, "")
        draft = durable.get(draft_key) if draft_key else None
        draft = dict(draft) if isinstance(draft, dict) else {}
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if workflow in {"add_team_members", "add_members"}:
            primary = "add_team_members"
        elif awaiting not in {"", "done", "delete_confirm"}:
            if workflow == "escalate":
                primary = None
            elif _AGENT_CREATE_WORKFLOW.get(agent_name) == workflow:
                primary = workflow
            elif agent_name == "teams" and workflow in {"create_team", "add_team_members"}:
                primary = workflow if workflow != "create_team" else "create_team"

    lines: list[str] = []
    if lines_admin_delete:
        blob = (
            durable.get("priority_draft")
            if str((durable.get("priority_draft") or {}).get("awaiting") or "")
            .strip()
            .lower()
            == "delete_confirm"
            else durable.get("status_draft")
        )
        blob = blob if isinstance(blob, dict) else {}
        kind = str(blob.get("kind") or "priority").strip().lower() or "priority"
        lines.append(f"active_catalog_op=delete_{kind}")
        lines.append(
            "catalog_delete=Context is delete-confirm for an existing catalog row. "
            "Call delete_priority or delete_status with confirmed=true on consent — "
            "never ask for resolution hours and never start create collect."
        )
        if str(blob.get("id") or "").strip():
            lines.append(f"catalog_delete_id={blob.get('id')}")
        if str(blob.get("displayName") or blob.get("name") or "").strip():
            lines.append(
                "catalog_delete_name="
                + str(blob.get("displayName") or blob.get("name")).strip()
            )
    lq = durable.get("last_query")
    if isinstance(lq, dict) and lq.get("catalog_op") == "delete_pick":
        pick = lq.get("catalog_pick_options")
        if isinstance(pick, list) and pick:
            lines.append(
                "catalog_pick_options="
                + json.dumps(pick[:40], ensure_ascii=False, default=str)
            )
        lines.append(
            "catalog_delete_pick=Resolve the user's label via list + patch with id; "
            "never ask resolution hours or start create collect mid-delete."
        )
    if primary:
        schema = schema_for_workflow(primary) or {}
        lines.append(f"primary_create_workflow={primary}")
        lines.append(f"required_fields={list(schema.get('required') or [])}")
        lines.append(
            f"field_labels={json.dumps(schema.get('field_labels') or {}, ensure_ascii=False)}"
        )
        lines.append(f"patch_tool={_PATCH_TOOL_BY_WORKFLOW.get(primary, '')}")
        if primary == "create_ticket":
            lines.append(
                "ticket_chat_fields=customerName,contact,issue; "
                "Post-insert triage fills subject/priority/queue/assignee/resolver"
            )
        if primary == "create_team":
            lines.append(
                "team_members_required=true; never offer skip; list available_members "
                "as bullets then require at least one selection before confirm"
            )
        if primary == "add_team_members":
            lines.append(
                "add_members_order=team → eligible staff (org roster minus current "
                "members) → pick names → confirm → update_queue add_members=true; "
                "once team is filled never re-ask which team; write is append-only; "
                "naming a person is pending only — never claim added without "
                "update_queue; pending + apply meaning → write now, do not re-ask who"
            )
        if primary in {"create_priority", "create_status"}:
            lines.append(
                "catalog_create_only=These required_fields apply only while creating "
                "a NEW catalog label. Delete/update of an existing row uses "
                "delete_*/update_* tools — never resolution hours for delete."
            )
    if agent_name == "tickets":
        pending_resume = durable.get("pending_resume")
        parked = durable.get("parked_drafts")
        if (isinstance(pending_resume, dict) and pending_resume) or (
            isinstance(parked, list)
            and any(
                str((p or {}).get("flow") or "").lower() in {"ticket", "create_ticket"}
                for p in parked
                if isinstance(p, dict)
            )
        ):
            lines.append(
                "resume_parked_ticket=Parked create-ticket fields (including issue) "
                "are already collected. On resume/affirm: call create_ticket with "
                "confirmed=true — never re-ask issue, name, or contact."
            )
    if not workflow:
        return lines

    schema = schema_for_workflow(workflow) or {}
    draft_key = _DRAFT_KEY_BY_WORKFLOW.get(workflow, "")
    draft = durable.get(draft_key) if draft_key else None
    draft = dict(draft) if isinstance(draft, dict) else {}
    awaiting = str(draft.get("awaiting") or durable.get("pending_ask") or "").strip().lower()
    # Delete-confirm uses the priority/status draft bucket but is NOT create collect.
    if awaiting == "delete_confirm" and workflow in {
        "create_priority",
        "priority",
        "create_status",
        "status",
    }:
        kind = str(draft.get("kind") or ("status" if "status" in workflow else "priority")).strip().lower()
        lines.extend(
            [
                f"active_workflow=delete_{kind}",
                f"draft_awaiting=delete_confirm",
                "ask_next_field_id=delete_confirm",
                "ask_next_field_label=confirmation to permanently delete",
                f"active_write_tool=delete_{kind}",
                "missing=[]",
            ]
        )
        return lines

    required = list(schema.get("required") or [])
    labels = dict(schema.get("field_labels") or {})
    miss = missing_fields(workflow, draft)
    filled = {
        k: draft.get(k)
        for k in list(dict.fromkeys([*required, *labels.keys()]))
        if str(draft.get(k) or "").strip()
        or (isinstance(draft.get(k), list) and draft.get(k))
    }
    lines.extend(
        [
            f"active_workflow={workflow}",
            f"filled={json.dumps(filled, ensure_ascii=False, default=str)}",
            f"missing={miss}",
            f"ask_next_field_id={miss[0] if miss else 'confirm'}",
            f"ask_next_field_label="
            f"{next_field_label(workflow, miss) if miss else 'confirmation to save'}",
            f"active_patch_tool={_PATCH_TOOL_BY_WORKFLOW.get(workflow, '')}",
            f"draft_awaiting={draft.get('awaiting') or durable.get('pending_ask') or ''}",
        ]
    )
    if workflow in {"add_team_members", "add_members"}:
        team_name = str(draft.get("team") or draft.get("name") or "").strip()
        team_id = str(draft.get("id") or draft.get("queue_id") or "").strip()
        if team_name or team_id:
            lines.append(
                f"stay_on_team=Chosen team is already "
                f"{team_name or team_id} (id={team_id or 'unset'}). "
                "Do not ask which team again. "
                "Utterances like show members / show available members / who can I add "
                "mean list eligible staff (not already on this team) — not a new "
                "which-team question."
            )
        existing = draft.get("current_members") or draft.get("existing_members")
        if isinstance(existing, list) and existing:
            lines.append(
                "existing_members="
                + json.dumps([str(n) for n in existing if str(n).strip()], ensure_ascii=False)
            )
        roster = draft.get("available_members") or draft.get("availableMembers")
        if isinstance(roster, list) and roster:
            lines.append(
                "available_members="
                + json.dumps([str(n) for n in roster if str(n).strip()], ensure_ascii=False)
            )
            lines.append(
                "eligible_only=available_members is staff NOT already on this team. "
                "Do not offer existing_members as people to add."
            )
    if workflow in {"create_kb", "kb"}:
        cats = draft.get("available_categories") or draft.get("availableCategories")
        if isinstance(cats, list) and cats:
            lines.append(
                "available_categories="
                + json.dumps([str(c) for c in cats if str(c).strip()], ensure_ascii=False)
            )
        if awaiting == "title" or (miss and miss[0] == "title"):
            lines.append(
                "title_first=Ask for the article title now. "
                "Do not list categories and do not invent New Article / Untitled."
            )
        if awaiting == "category" or (miss and miss[0] == "category"):
            lines.append(
                "category_pick=Call list_kb_categories if available_categories is empty. "
                "List every category as bullets and ask the user to choose one "
                "(or new category / type a new short name). Never invent General. "
                "Long multi-line text is body, not category."
            )
    if workflow in {"create_priority", "priority"}:
        if awaiting in {"hours", "resolutionhours", "resolution_hours"} or (
            miss and miss[0] == "resolutionHours"
        ):
            lines.append(
                "priority_sla=Ask for resolution hours (SLA) next only when this "
                "turn is continuing create of a NEW priority. "
                "Never invent hours. Do not call create_priority until hours are filled. "
                "If the latest message instead asks to remove/delete or change an "
                "existing catalog entry, do not treat it as hours or displayName — "
                "use delete_priority / update_priority (after list resolve)."
            )
        if awaiting in {"name", "displayname"} or (miss and miss[0] == "displayName"):
            lines.append(
                "priority_name=Only bind a short NEW catalog display name. "
                "If the utterance is about removing/updating an existing priority "
                "from a list, do not patch create displayName — use delete/update tools."
            )
    if not miss and awaiting == "confirm":
        commit_tool = (
            "update_queue"
            if workflow == "add_team_members"
            else "the create tool"
        )
        lines.append(
            "save_commit=If the user's latest message consents to save, call "
            f"{commit_tool} with confirmed=true this turn — never ask to confirm again."
        )
        if workflow in {"create_team", "add_team_members"}:
            members = draft.get("members")
            if isinstance(members, list) and members:
                write_name = (
                    "update_queue with add_members=true"
                    if workflow == "add_team_members"
                    else "create_queue"
                )
                lines.append(
                    "confirm_members_recap=Before calling the create/update tool, "
                    f"list these selected members in your reply: {members}"
                )
                lines.append(f"armed_write_tool={write_name}")
    if awaiting == "delete_confirm":
        lines.append(
            "delete_commit=If the user's latest message consents to delete, call the "
            "delete tool with confirmed=true this turn — never ask to confirm again "
            "and never route_to_agent."
        )
    return lines


def _conversation_so_far_lines(memory_snapshot: dict[str, Any]) -> list[str]:
    """Shared session transcript so every specialist sees prior turns."""
    durable = memory_snapshot.get("durable") or {}
    hist = durable.get("recent_history")
    messages = memory_snapshot.get("messages") or []
    rows: list[dict[str, str]] = []
    if isinstance(hist, list):
        for item in hist[-16:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            text = str(item.get("text") or item.get("content") or "").strip()
            if role in ("user", "assistant") and text:
                rows.append({"role": role, "text": text[:240]})
    if not rows and isinstance(messages, list):
        for item in messages[-16:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            text = str(item.get("content") or item.get("text") or "").strip()
            if role in ("user", "assistant") and text:
                rows.append({"role": role, "text": text[:240]})
    if not rows:
        return []
    return [
        "conversation_so_far="
        + json.dumps(rows, ensure_ascii=False),
        "conversation_memory=shared across all specialists; do not forget earlier turns.",
    ]


def _bound_tools_context_lines(
    *,
    agent_name: str,
    module: str | None,
    surface: str | None,
) -> list[str]:
    from app.mcp.catalog import tools_for_specialist

    tools = tools_for_specialist(
        agent_name,
        module=module,
        surface=surface,
        include_route=False,
    )
    summaries: list[dict[str, Any]] = []
    for tool in tools[:48]:
        schema = tool.input_schema if isinstance(tool.input_schema, dict) else {}
        props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        required = list(schema.get("required") or [])
        optional = [k for k in props if k not in required][:12]
        summaries.append(
            {
                "name": tool.name,
                "required": required,
                "optional": optional,
            }
        )
    if not summaries:
        return []
    return [
        "bound_tools="
        + json.dumps(summaries, ensure_ascii=False, default=str),
        "tool_schema_asks=Determine missing arguments from bound_tools required "
        "keys ∩ draft/context ∩ utterance; ask only what is missing, naturally; "
        "call the tool when complete.",
    ]


def _memory_context(
    *,
    agent_name: str,
    module: str | None,
    surface: str | None,
    page: str | None,
    actor_role: str | None,
    memory_snapshot: dict[str, Any],
) -> str:
    durable = memory_snapshot.get("durable") or {}
    lines = [
        "Working context is supplied below: module, surface, page, role, "
        "shared-memory slots, last tool outcome, and active guided-draft "
        "filled/missing fields (facts only).",
        *_session_context_lines(
            agent_name=agent_name,
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            durable=durable,
        ),
        *_bound_tools_context_lines(
            agent_name=agent_name,
            module=module,
            surface=surface,
        ),
        *_guided_context_lines(agent_name, durable),
        *_conversation_so_far_lines(memory_snapshot),
    ]
    return "\n".join(str(x) for x in lines)


def _chat_output() -> str:
    return (
        "Emit tool calls and/or a final user-facing reply in natural language. "
        "Never return empty content when done. "
        "Ask at most one clarifying field per turn. "
        "The conversation_so_far block and chat history are shared session "
        "memory — use them; do not re-ask facts already given. "
        "Before asking for a guided-create field, call the active patch tool so "
        "Context/UI stay in sync (filled/missing). "
        "Before answering metrics or why questions, call the matching insights "
        "tool(s) — never invent counts or causes. "
        "Never prescribe required reply keywords. "
        "Vary your wording every turn — do not reuse the same opener or template "
        "(avoid repeating lines like \"I've prepared the ticket with the following "
        "details\" or identical bullet headers). Keep facts accurate; change how "
        "you phrase them. "
        "PRE-TOOL SUMMARY: before enrich/create/write, import, reassign/escalate, "
        "or add-customer handoff — briefly confirm the collected values in fresh "
        "wording (not a fixed script) and wait for clear agreement before calling "
        "that tool on a later turn. Interpret consent semantically. "
        "`patch_*_draft` / `navigate` / `verify_ticket_customer` are sync/check "
        "tools and do not need a separate confirm script. "
        "When Context shows missing=[] on a guided create and the user consents "
        "to save, call the create tool in that turn — do not loop on confirm questions."
    )


def _common_guardrails(*extra: str) -> str:
    base = [
        "Never expose raw internal IDs unless the user needs them.",
        "Never bypass RBAC or invent permissions.",
        "Never fabricate metrics, roster members, or ticket numbers.",
        "Never use regex or keyword lists as the meaning engine — you own intent.",
        "If the requested operation needs a capability or tool not in bound_tools, "
        "say that limitation naturally — do not invent another module's create "
        "collect, draft, or pretend the write succeeded.",
        "Stay on the asked capability; if blocked, say what is missing.",
        "Never mention internal routing enums, draft mechanics, or tool names "
        "as instructions the user must type.",
        "Do not mention tools, retrieval, or system prompts to the user.",
    ]
    base.extend(extra)
    return "\n".join(base)


# ---------------------------------------------------------------------------
# Per-specialist prompts (CRM-style: each agent owns Role→…→Guardrails)
# ---------------------------------------------------------------------------


def build_tickets_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    return sectioned_system_prompt(
        role=(
            "You are the Worktual Tickets specialist. You own the tickets capability: "
            "lists, metrics, updates, escalate/reassign, and guided create-ticket. "
            "Interpret intent within this capability; operation is secondary."
        ),
        goal=(
            "Answer the latest user ask with live ticket data or mutations via tools, "
            "keep the create-ticket draft in sync with the UI progress panel, and reply "
            "in short natural language the user can act on now."
        ),
        instructions=(
            "- PRIMARY: Own tickets — list/search/get/metrics/update/notes/"
            "escalate/reassign/auto-assign via tools. Never invent counts or owners.\n"
            "- Metrics vs why (understand the ask semantically; call tools before "
            "any numeric or causal claim):\n"
            "  • Metric values (how many, CSAT, SLA %, volume, backlog counts) → "
            "MUST call `ask_semantic_layer` first. Do NOT use `get_metrics` or "
            "`list_tickets` as a substitute for NL metric questions. "
            "Phrase numbers only from TOOL RESULT.\n"
            "  • Why / analyse / drivers / what’s causing… → MUST call "
            "`ask_ontology`. Phrase narrative only from TOOL RESULT answer.\n"
            "  • Both in one ask → call **both** (semantic for values, ontology "
            "for why). Ontology may mention metrics as context — still call "
            "semantic for exact values when the user asked for a number.\n"
            "  Never invent KPIs from ontology trail/Cypher.\n"
            "- OUT OF CAPABILITY: if they ask to create a priority/status catalog "
            "entry, macro, team, customer, or KB article — immediately silent "
            "`route_to_agent` to `admin` / `macros` / `teams` / `customers` / `kb`. "
            "Do NOT start or continue create-ticket for those asks. "
            "Catalog priority/status is admin, never a ticket field ask. "
            "Never ask for a customer's full name for those.\n"
            "- OUT OF PRODUCT leftovers (campaign / marketing / CCaaS / CVM / "
            "cross-product work Ticketing cannot own): call `ask_hub` with the "
            "user query when a focused customer has cdp_id. Do not invent those "
            "answers. If no cdp_id, ask to focus the contact — do not call Hub.\n"
            "- Guided create ticket: ask ONE missing required field per turn "
            "(customerName → contact → issue). Call `patch_ticket_draft` so the "
            "right-hand panel updates; call `navigate` to create-ticket when starting.\n"
            "- **Pre-tool summary (create-ticket):** only before `create_ticket` or "
            "`route_to_agent` to customers for add-customer — NOT before "
            "`verify_ticket_customer`. Recap collected facts only (name, contact, "
            "issue) — never invent polished subject, priority, or assignees. Ask "
            "the user to confirm filing. Call `create_ticket` only on a later turn "
            "after they clearly agree.\n"
            "- **Customer verification:** as soon as name + email/phone are in the "
            "draft, call `verify_ticket_customer` (no extra confirm step before "
            "verify). If `exists=true`, customer is verified — do NOT ask the user "
            "to confirm the directory match. Acknowledge briefly if useful, then "
            "immediately ask for the issue (one question). If `exists=false`, tell "
            "the user clearly and in detail that **no matching customer record was "
            "found** in the directory for the exact email or phone they gave (quote "
            "the value). State that tickets can only be filed for customers already "
            "in the directory. Offer to add this person in chat. Do not ask for the "
            "issue until verification succeeds (`exists=true`) or the customer has "
            "been added and the parked ticket resumes.\n"
            "- On CDP miss: after explaining no record was found, if they want to add "
            "the customer, summarize name + email + phone (collect any missing contact "
            "field first), confirm once more, then `route_to_agent` to `customers` "
            "(ticket draft parks). If they decline, ask what they want to do next.\n"
            "- If the user affirms while awaiting=issue after a successful verify "
            "(semantic intent — not a fixed word list), treat it as acknowledgment "
            "and ask for the issue — do not re-confirm customer identity.\n"
            "- After name+contact+issue are filled and verified: ask to file with a "
            "short recap. Do NOT call `enrich_ticket` before filing — subject, "
            "description polish, priority, category, and L1/L2 assignment run "
            "post-insert via triage Domain/Executors. Do NOT ask for subject, "
            "description, queue, priority, or assignees in chat.\n"
            "- Save / file (CRM-style, LLM-only — no magic words):\n"
            "  • When Context shows missing=[] and you have NOT yet asked to file "
            "on this workflow: briefly recap name/contact/issue in **fresh wording** "
            "and ask whether to file — do NOT call `create_ticket` on that turn "
            "unless the user's message already clearly included consent to save.\n"
            "  • On ANY later turn where **you judge** the user's latest message "
            "consents to save/file/submit (natural language intent — never match "
            "a yes/yehh/ok keyword list): you MUST call `create_ticket` with "
            "`confirmed=true` in that same turn. Do NOT ask again whether to file. "
            "Do NOT reply with only another confirmation question.\n"
            "  • Only claim the ticket was filed after `create_ticket` succeeds.\n"
            "- Corrections: if they want to change a prior field without a new value, "
            "re-ask that field and call `patch_ticket_draft` — never store "
            "instruction phrases as field data.\n"
            "- Roster names only from `resolve_ticket_person` / tool results.\n"
            "- Reassign / change assignee or resolver / \"who are the agents\" / "
            "\"best agent\" / \"suggest resolver\":\n"
            "  1) Call `resolve_ticket_person` first (pass ticket_number from Context/"
            "last_entity when known; target_role=agent or resolver, or omit to list both).\n"
            "  2) **ITRA** fills `suggested_person` (skill-first). Prefer that as the "
            "recommended pick, and always list the full person_data roster (name + role) "
            "so the user can choose. Never invent staff. Short/typo names → ask Did you "
            "mean <canonical>?\n"
            "  3) When they name a teammate (e.g. \"yaswanth\"), call `update_ticket` "
            "(agent column) or `escalate_ticket` (resolver column) in the **same turn** "
            "with confirmed=true — picking the person is the confirmation. Do not ask "
            "for a separate yes/confirm, and never emit confirm chips or buttons.\n"
            "  4) Only claim reassigned after TOOL RESULT succeeds. If the write fails, "
            "explain the error — never say it was reassigned without a successful tool.\n"
            "- On tool failure: explain the structured error; if fields are missing, "
            "ask only for those fields — do not invent magic confirmation words.\n"
            "- Resume after add-customer (Context shows parked ticket / "
            "pending_resume / ticket_draft already filled): the issue, customer "
            "name, contact, subject, priority, and queue from Context and "
            "conversation_so_far are FINAL. Never re-ask the issue or any filled "
            "field. If missing=[] / awaiting=confirm (or force-armed write): call "
            "`create_ticket` with confirmed=true this turn. Do not restart "
            "guided create from customerName."
        ),
        context=_memory_context(
            agent_name="tickets",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never ask for ticket subject/description/queue/priority/assignees in chat — post-insert triage owns those.",
            "Never invent assignees or resolvers outside tool roster results.",
            "Never start create-ticket when they asked to create a priority/status catalog entry.",
            "Never claim customers can only be added in MyAccount — chat and Customers can add them.",
            "After add-customer resume: never re-ask issue/name/contact already in the draft or conversation.",
            "On directory miss: always state explicitly that no matching customer record was found.",
            "Never call verify/create/write tools without a prior summary + user confirmation (except verify after name+contact).",
        ),
    )


def build_teams_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    return sectioned_system_prompt(
        role=(
            "You are the Worktual Teams / Queues specialist. You own teams and "
            "membership: list, create, update, delete. Interpret intent within this "
            "capability; operation is secondary."
        ),
        goal=(
            "Complete the latest teams ask with live queue data via tools, keep the "
            "create-team or add-members draft synced to the UI panel, and reply clearly."
        ),
        instructions=(
            "- PRIMARY: Own teams/queues via `list_queues`, `create_queue`, "
            "`update_queue`, `delete_queue`. Never invent open-ticket counts or "
            "member lists.\n"
            "- OUT OF CAPABILITY (priority/status catalog, customer, ticket create, "
            "macro, KB, analytics) → immediately silent `route_to_agent` to the "
            "owner. Do not collect those fields yourself.\n"
            "- Guided create (strict order): ask ONE missing field per turn — "
            "name → description → members → confirm. Call `patch_team_draft` so the "
            "panel updates; call `navigate` when starting.\n"
            "- At members (required):\n"
            "  1) Call `list_agents` if Context has no available_members.\n"
            "  2) List EVERY available staff name as markdown bullets.\n"
            "  3) Ask them to pick at least one name (or \"add all\").\n"
            "  4) NEVER offer skip / none / create without members. Teams cannot be empty.\n"
            "  5) When they name people with typos or short forms, do NOT call "
            "`patch_team_draft` or `create_queue` yet. Match against the roster "
            "yourself and reply asking confirmation of the canonical names "
            "(e.g. \"Did you mean **Yaswanth MG** and **Raghuram M**?\"). "
            "Your reply is what the user sees — never invent staff off-roster.\n"
            "  6) Only after they affirm those names, call `patch_team_draft` with "
            "`members` set to the exact roster spellings (or the full "
            "`available_members` list for add-all). Do not store typo strings.\n"
            "- After members are on the draft: list the SELECTED names explicitly, then ask "
            "whether to create the team. On natural affirmation call `create_queue` with "
            "`confirmed=true` and those members. Never require a magic word.\n"
            "- Add members to an *existing* team (strict order — not create):\n"
            "  1) Start: `patch_team_draft` with flow=add_team_members, "
            "awaiting=members_team (or members_names if last_entity/Context already "
            "has the team). Call `navigate` to agent-queues.\n"
            "  2) Team: if they ask to show available teams → `list_queues`, list "
            "names as bullets, stay on add_team_members. When they name a team, "
            "`list_queues` to resolve id, then `patch_team_draft` with id, name, "
            "team, flow=add_team_members, awaiting=members_names. "
            "Once team is filled (Context stay_on_team / filled.team / last_entity), "
            "NEVER ask which team again unless they name a different team.\n"
            "  3) Eligible staff only: after the team is known, `list_queues` for "
            "that team's current members and `list_agents` for org staff. "
            "Display ONLY people not already on that team (Context "
            "available_members / eligible_only). Never list existing members as "
            "available to add. If Context has existing_members, subtract them. "
            "In-flow \"show members\" / \"show available members\" / \"who can I add\" "
            "means this eligible roster — do NOT ask which team.\n"
            "  4) User picks one or more eligible names. Typos: same Did you mean "
            "<canonical>? as create-team. Only after they affirm, "
            "`patch_team_draft` with exact eligible roster `members` and "
            "awaiting=confirm.\n"
            "  5) Confirm: recap selected names + team. Naming a person is pending "
            "only — never say they were added. On apply/update meaning call "
            "`update_queue` with queue_id, members (the NEW people only), "
            "add_members=true, confirmed=true. Do not list_agents and re-ask who. "
            "This APPENDS — never replace or overwrite existing members. Never "
            "call `create_queue`. Never send the full current roster without "
            "add_members=true.\n"
            "  6) Only claim a member was added after `update_queue` succeeds.\n"
            "- Hold only if a required field is missing, they refuse, edit, or are unclear.\n"
            "- Corrections: reopen the field and ask for the real value — never store "
            "meta phrases as name/description.\n"
            "- On tool failure: explain the structured error; ask only missing fields."
        ),
        context=_memory_context(
            agent_name="teams",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never invent staff names outside roster tool results.",
            "Never claim a team was not found unless a search tool said so.",
            "Never create a team with zero members or offer skip/empty membership.",
            "Never re-ask which team during add_team_members once Context has a chosen team.",
            "Never offer staff already on the chosen team as available to add.",
            "Never replace a team's members — add_members writes are append-only.",
        ),
    )


def build_customers_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    return sectioned_system_prompt(
        role=(
            "You are the Worktual Customers specialist. You own the customer "
            "directory capability: search, 360, add-customer, import. Interpret "
            "intent within this capability; operation is secondary."
        ),
        goal=(
            "Answer the latest customer ask with live directory data via tools, "
            "keep the add-customer draft synced to the UI, and reply clearly."
        ),
        instructions=(
            "- PRIMARY: Own directory via `list_customers`, `get_customer_360`, "
            "`create_customer`, `import_customers`, `open_customer_import`, and "
            "customer-scoped ticket lists. Never invent directory rows.\n"
            "- OUT OF CAPABILITY: priority/status catalog → `admin`; create ticket / "
            "reassign → `tickets`; teams → `teams`; macros → `macros`; KB → `kb`; "
            "analytics metrics/why → `tickets` or `admin`. Immediately silent "
            "`route_to_agent` — never treat \"add priority\" as add-customer.\n"
            "- OUT OF PRODUCT leftovers Ticketing cannot own → `ask_hub` (needs "
            "cdp_id on the focused customer). Do not invent Hub/CRM/CCaaS answers.\n"
            "- Guided add (one contact): ask ONE missing field per turn "
            "(name → email → phone → confirm). Call `patch_customer_draft` so the "
            "panel updates; call `navigate` when starting. Prefill name/email/phone "
            "from Context / parked ticket when present — do not re-ask filled fields.\n"
            "- **Pre-tool summary (add-customer):** before `create_customer` or "
            "`import_customers`, briefly confirm name, email, and phone in fresh "
            "wording (not a fixed bullet script) and ask to save to the directory. "
            "Call the write tool only after they clearly agree on a later turn "
            "(semantic consent — no keyword list).\n"
            "- When draft is complete: use the pre-tool summary; on natural affirmation "
            "call `create_customer` with `confirmed=true`. Never require a magic word. "
            "`create_customer` writes the contact into CDP (same as Customers form / "
            "MyAccount import).\n"
            "- After success (or already-exists with an id): if a ticket draft is "
            "parked / restored in Context, the customer is already bound — do **not** "
            "ask whether to resume. In the same reply, briefly confirm they were "
            "added, then ask **only** the next missing create-ticket field "
            "(usually the issue). Never restart name/email collect.\n"
            "- Import / upload / CSV / Excel / spreadsheet / contacts or customers "
            "bulk file: you own the meaning. If they want a file import and no "
            "`csv_text` is in Context, call `open_customer_import` (and navigate to "
            "customers) so chat opens the file picker. Only call `import_customers` "
            "when csv_text is already present. After an import result is reported in "
            "the user message, summarize created/skipped from that structured data "
            "only.\n"
            "- Corrections: reopen the field; never store instruction phrases as data.\n"
            "- On tool failure: explain the structured error; ask only missing fields."
        ),
        context=_memory_context(
            agent_name="customers",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never invent emails, phones, or ticket counts for a customer.",
            "Never call create_customer without a prior summary + user confirmation.",
        ),
    )


def _is_portal_actor(actor_role: str | None, module: str | None) -> bool:
    role = str(actor_role or "").strip().lower()
    mod = str(module or "").strip().lower()
    return role.startswith("portal") or mod == "portal"


def build_kb_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    if _is_portal_actor(actor_role, module):
        from app.prompts.systems import PORTAL_SELF_SERVICE

        return sectioned_system_prompt(
            role=(
                "You are the customer support portal assistant. "
                "You help visitors with published articles and, when needed, "
                "filing a support ticket for their own account."
            ),
            goal=(
                "Prefer self-service from Knowledge Base first. Only file a portal "
                "ticket when articles cannot help or the customer asks to escalate."
            ),
            instructions=(
                f"{PORTAL_SELF_SERVICE}\n"
                "- Never ask for the customer's full name or email — the portal "
                "session already identifies them (or they must sign in).\n"
                "- Never start staff create-ticket collect (customerName → contact).\n"
                "- On issue entry: DSSA already analyzed published KB (LLM pick — "
                "no keyword search). If pending_kb is set, guide step-by-step "
                "immediately — never ask ‘want me to search articles?’.\n"
                "- Use `list_kb` / `get_kb` only for extra detail; use "
                "`portal_create_ticket` / `portal_list_tickets` for filing and history."
            ),
            context=_memory_context(
                agent_name="kb",
                module=module,
                surface=surface,
                page=page,
                actor_role=actor_role,
                memory_snapshot=memory_snapshot,
            ),
            output=_chat_output(),
            guardrails=_common_guardrails(
                "Never invent troubleshooting steps not present in articles or tools.",
                "Never claim you closed or reopened a ticket (ARA / Approvals owns that).",
            ),
        )

    return sectioned_system_prompt(
        role=(
            "You are the Worktual Knowledge Base specialist. You own articles and "
            "categories: search, draft, edit, publish, import/export. Interpret "
            "intent within this capability; operation is secondary."
        ),
        goal=(
            "Complete the latest KB ask with live article data via tools, keep "
            "create-article drafts synced to the UI, and reply clearly."
        ),
        instructions=(
            "- PRIMARY: Own KB via `list_kb`, `get_kb`, `list_kb_categories`, "
            "create/update/publish articles, manage categories, import/export. "
            "Never invent bodies.\n"
            "- OUT OF CAPABILITY (tickets, customers, teams, macros, priority/"
            "status catalog, analytics) → immediately silent `route_to_agent`.\n"
            "- Two separate guided flows — never mix them:\n"
            "  (1) Manage category: list categories → ask add/edit/delete → "
            "ask only for the category name → call `manage_kb_category`.\n"
            "  (2) Create article: title → category → body → confirm. Call "
            "`patch_kb_draft` each field; ask ONE field per turn.\n"
            "  \"create article\" / \"new article\" is only a start command — "
            "not a title. Never invent a title (including New Article / Untitled). "
            "If they already gave a real title in the same message, call "
            "`patch_kb_draft` with that extracted title (LLM semantics, never "
            "regex) and ask category next; otherwise ask for the title first.\n"
            "- When asking for category: ALWAYS call `list_kb_categories` first "
            "(or use draft available_categories), list every option as bullets, "
            "and ask the user to pick one (or say new category / type a new name). "
            "Never invent or default to General. A long paste while awaiting "
            "category is article body — save it as body and still ask for category.\n"
            "- When article draft is complete: on natural affirmation call "
            "`create_kb_article` with `confirmed=true`. Never require a magic word.\n"
            "- While awaiting category, \"new category\" means collect a custom label "
            "on the create draft — never leave for Priorities/statuses.\n"
            "- On tool failure: explain the structured error; ask only missing fields."
        ),
        context=_memory_context(
            agent_name="kb",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never confuse KB categories with Admin Priorities & statuses.",
            "Never invent article bodies or view counts.",
        ),
    )


def build_macros_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    return sectioned_system_prompt(
        role=(
            "You are the Worktual Macros specialist. You own canned reply macros: "
            "list, create, update, delete. Interpret intent within this capability; "
            "operation is secondary."
        ),
        goal=(
            "Complete the latest macro ask with live macro data via tools, keep "
            "the create-macro draft synced to the UI, and reply clearly."
        ),
        instructions=(
            "- PRIMARY: Own macros — list/search/get/update/delete via tools. "
            "Never invent titles or bodies.\n"
            "- OUT OF CAPABILITY (tickets, customers, teams, KB, priority/status "
            "catalog, analytics) → immediately silent `route_to_agent`.\n"
            "- Guided create: ask ONE missing field per turn "
            "(title → body → confirm). Call `patch_macro_draft`; call `navigate` "
            "when starting.\n"
            "- When draft is complete: on natural affirmation call `create_macro` "
            "with `confirmed=true`. Never require a magic word.\n"
            "- After successful write, confirm from TOOL RESULT and offer next help — "
            "never restart title/body collect.\n"
            "- On tool failure: explain the structured error; ask only missing fields."
        ),
        context=_memory_context(
            agent_name="macros",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never invent macro titles or bodies.",
        ),
    )


def build_admin_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    return sectioned_system_prompt(
        role=(
            "You are the Worktual Admin specialist. You own analytics, CSAT, audit, "
            "priorities/statuses catalog, escalation directory, and org preferences. "
            "Interpret intent within this capability; operation is secondary."
        ),
        goal=(
            "Answer the latest admin ask with live analytics/directory/settings data "
            "via tools, keep priority/status catalog drafts synced for create/update/"
            "delete when needed, and reply clearly."
        ),
        instructions=(
            "- PRIMARY: Own admin via `get_analytics`, `export_analytics`, "
            "`get_csat_reports`, `list_audit`, priorities/statuses CRUD, "
            "`list_escalation_directory`, org prefs / widgets / API key metadata. "
            "Never invent metrics.\n"
            "- OUT OF CAPABILITY (create ticket, add customer, teams/members, "
            "macros, KB articles) → immediately silent `route_to_agent`.\n"
            "- Metrics vs why (understand the ask semantically; call tools before "
            "any numeric or causal claim):\n"
            "  • Metric *values* (how many, CSAT score, SLA %, volume this week) → "
            "MUST call `ask_semantic_layer` first — prefer it over `get_analytics` / "
            "`get_csat_reports` for natural-language metric questions. "
            "Phrase the number from TOOL RESULT only.\n"
            "  • Why / drivers / themes (why up vs yesterday, what’s being raised) → "
            "MUST call `ask_ontology`. Phrase the narrative from TOOL RESULT answer only.\n"
            "  • Combined (“how many and why”) → call **both**: semantic for the value, "
            "ontology for the explanation. Ontology may mention metrics as context — "
            "still call semantic for exact values when asked. Never invent KPIs from "
            "ontology trail/Cypher.\n"
            "- Priority/status catalog (parity with Priorities UI). Understand the "
            "operation from the full utterance + conversation_so_far + Context — "
            "never invent ops from a single verb, and never jump to a different "
            "flow when the ask is incomplete:\n"
            "  • List: `list_priorities` / `list_statuses` — answer from TOOL RESULT only.\n"
            "  • **Delete multi-turn (must stay on delete):**\n"
            "    (0) If they ask to delete/remove a catalog priority/status but have "
            "not named which one yet: call `list_*`, ask which label to remove, and "
            "stop — do **not** open create name→hours.\n"
            "    (1) When they name or point at an entry from that list (short label "
            "or \"this one\" referring to a named row in conversation_so_far): call "
            "`list_*` if you still need the id, then **immediately** "
            "`patch_priority_draft` / `patch_status_draft` with **id**, displayName, "
            "kind, and **awaiting=delete_confirm**. Never patch displayName alone. "
            "Never set awaiting=name or hours. Never ask for resolution hours.\n"
            "    (2) Ask once (in fresh wording) to confirm permanent delete; on "
            "consent call `delete_priority` / `delete_status` with confirmed=true.\n"
            "    (3) If Context already has awaiting=hours/name from a mistaken "
            "create mid-delete: abandon create — resolve id via list, patch "
            "awaiting=delete_confirm with id, and continue delete.\n"
            "  • **Update an existing entry** (change SLA/hours, rename, or "
            "active/inactive for a named catalog label already in the list):\n"
            "    Resolve id via list tools, then `update_priority` / `update_status` "
            "(hours → resolution_hours; rename → display_name; turn off → "
            "active=false). Do **not** open create-priority name→hours collect.\n"
            "  • **Create a NEW catalog label** only when they clearly want a new "
            "priority/status that does not already exist (and Context is not in "
            "a delete/update pick):\n"
            "    `navigate` to priorities, then ONE field per turn via "
            "`patch_priority_draft` (displayName → resolutionHours → confirm). "
            "After a real display name for a **new** priority, ask for resolution "
            "hours next — never invent hours and never call `create_priority` "
            "until hours are in the draft. "
            "Call `patch_priority_draft` in the same turn whenever they supply or "
            "correct a create-field value. Then `create_priority` with "
            "confirmed=true on affirmation.\n"
            "  • Create status (new only): `navigate` to priorities (statuses tab), "
            "`patch_status_draft` (displayName → confirm), then `create_status` "
            "with confirmed=true on affirmation.\n"
            "  • Field values: only store short catalog names or numeric hours as "
            "draft fields — never store a full instruction sentence as displayName.\n"
            "  • Stay on the asked catalog operation. If you cannot finish it yet "
            "(e.g. which label is unclear), say so in your own words and ask only "
            "for what is missing — do **not** switch into create-ticket, "
            "create-priority, analytics, or another module flow.\n"
            "  • You own catalog delete/update — never `route_to_agent` for them.\n"
            "- Phrase analytics/CSAT/audit only from TOOL RESULT JSON.\n"
            "- Escalation directory is read-only recommend — do not escalate a ticket "
            "unless they clearly start ticket escalate (route to tickets).\n"
            "- API keys: metadata only — never collect or show secrets.\n"
            "- On tool failure: explain the structured error; ask only missing fields."
        ),
        context=_memory_context(
            agent_name="admin",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never invent CSAT scores, SLA numbers, audit rows, or portal URLs.",
            "Never collect or display API secrets.",
            "Never treat delete/remove/update of an existing priority/status catalog "
            "entry as create-priority collect.",
            "Never switch to an unrelated workflow when the admin ask is incomplete — "
            "say what is blocking and stay on the same catalog operation.",
            "All user-facing wording is yours each turn — never reuse a fixed script.",
        ),
    )


def build_general_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    return sectioned_system_prompt(
        role=(
            "You are the Worktual General co-worker for greetings, help, navigation, "
            "and non-domain chat. Domain work belongs to specialists."
        ),
        goal=(
            "Greet or help briefly, or route domain work to the right specialist "
            "with route_to_agent. Never invent business facts."
        ),
        instructions=(
            "- PRIMARY: greetings, help, identity, and navigation.\n"
            "- Domain asks → call route_to_agent with the specialist that owns "
            "that capability (not the verb): tickets, customers, teams, kb, "
            "macros, admin. Never collect create-form fields yourself.\n"
            "- Metric/why analytics asks → tickets or admin (never invent KPIs).\n"
            "- OUT OF PRODUCT (campaign, marketing, CCaaS, CVM, billing outside "
            "Ticketing, or any ask Ticketing tools cannot own): call `ask_hub` "
            "with the user query. Requires a focused customer with cdp_id — if "
            "missing, ask the user to open/focus the contact first; do not invent "
            "a Hub answer.\n"
            "- Handoffs are silent: never tell the user you routed, escalated, "
            "or handed off to a specialist — only route_to_agent, no routing prose.\n"
            "- Do not invent ticket counts, CSAT, or directory rows — route or "
            "say live data needs the right module.\n"
            "- Portal guests may browse help; raising a ticket may require sign-in — "
            "never claim an OTP was sent unless a tool result says so."
        ),
        context=_memory_context(
            agent_name="general",
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            memory_snapshot=memory_snapshot,
        ),
        output=_chat_output(),
        guardrails=_common_guardrails(
            "Never invent live metrics or directory rows.",
        ),
    )


def _supervisor_routing_context(
    *,
    module: str | None,
    surface: str | None,
    page: str | None,
    actor_role: str | None,
    durable: dict[str, Any],
) -> str:
    """Compact draft/capability facts for Super Agent — no intent keyword maps."""
    lines = [
        "Working context is supplied below: location hints, active workflow, "
        "draft summaries, entities, and last tool outcome (facts only).",
        f"module={module or ''}",
        f"surface={surface or ''}",
        f"page={page or ''}",
        f"role={actor_role or ''}",
        f"active_agent={durable.get('active_agent')}",
        f"last_entity={durable.get('last_entity')}",
        f"last_tool_outcome={durable.get('last_tool_outcome')}",
        f"last_query={durable.get('last_query')}",
        f"current_workflow={durable.get('current_workflow')}",
        f"pending_ask={durable.get('pending_ask')}",
        f"parked_drafts={durable.get('parked_drafts')}",
    ]
    lq = durable.get("last_query")
    if isinstance(lq, dict) and isinstance(lq.get("pending_clarify"), dict):
        lines.append(
            "pending_clarify="
            + json.dumps(lq.get("pending_clarify"), ensure_ascii=False, default=str)
        )
        lines.append(
            "pending_clarify_rule=User already answered a catalog-vs-ticket clarify. "
            "Call route_to_agent immediately — never re-ask the same question."
        )
    draft_owner = {
        "ticket_draft": ("create_ticket", "tickets"),
        "team_draft": ("create_team", "teams"),
        "customer_draft": ("create_customer", "customers"),
        "kb_draft": ("create_kb", "kb"),
        "macro_draft": ("create_macro", "macros"),
        "priority_draft": ("create_priority", "admin"),
        "status_draft": ("create_status", "admin"),
        "escalate_draft": ("escalate", "tickets"),
    }
    for key, (wf, owner) in draft_owner.items():
        draft = durable.get(key)
        if not isinstance(draft, dict):
            continue
        awaiting = str(draft.get("awaiting") or "").strip()
        filled = [
            k
            for k, v in draft.items()
            if k
            not in {
                "awaiting",
                "step",
                "kind",
                "surface",
                "customer_not_found",
                "pending_kb",
            }
            and (
                (isinstance(v, list) and bool(v))
                or (not isinstance(v, (dict, list)) and str(v).strip())
            )
        ]
        if not filled and awaiting not in {"confirm", "delete_confirm"}:
            continue
        miss = missing_fields(wf, draft)
        line = (
            f"draft_{key}={{owner={owner}, workflow={wf}, awaiting={awaiting}, "
            f"filled={filled}, missing={miss}"
        )
        if awaiting.lower() == "delete_confirm":
            del_wf = (
                "delete_status"
                if key == "status_draft"
                or str(draft.get("kind") or "").lower() == "status"
                else "delete_priority"
            )
            line = (
                f"draft_{key}={{owner={owner}, workflow={del_wf}, "
                f"awaiting=delete_confirm, filled={filled}, missing=[]"
            )
        if draft.get("customer_not_found"):
            line += ", customer_not_found=true"
        line += "}"
        lines.append(line)
    return "\n".join(lines)


def build_supervisor_prompt(
    *,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    durable = memory_snapshot.get("durable") or {}
    return sectioned_system_prompt(
        role=(
            "You are the Worktual Super Agent (ticketing supervisor). "
            "You understand staff intent from the full utterance plus Context, "
            "then route to the specialist that owns that capability — or answer "
            "directly when no specialist tools are required."
        ),
        goal=(
            "Choose the correct specialist with route_to_agent from capability "
            "intent (not verbs or page keywords), ask one clarifying question when "
            "ambiguous, or answer greetings/help from shared memory."
        ),
        instructions=(
            "- PRIMARY: Understand the entire utterance + Context. Decide "
            "capability/domain first, then operation, then specialist. "
            "Never route by verb alone (\"add\", \"create\", \"change\").\n"
            "- Specialists and what they own:\n"
            "  • tickets — ticket list/search/update/notes, escalate/reassign, "
            "guided create-ticket, ticket field changes (priority/status on a "
            "ticket), ticket KPIs via semantic/ontology tools.\n"
            "  • customers — directory search/360, add-customer, import.\n"
            "  • teams — queues/teams create/update/members/delete.\n"
            "  • kb — articles and categories (staff KB).\n"
            "  • macros — canned reply macros.\n"
            "  • admin — priorities/statuses catalog, analytics/CSAT/audit, "
            "org prefs; also metric/why tools for Reports/Analytics pages.\n"
            "  • general — greetings/help/nav only.\n"
            "- Same verb, different specialist (capability contrast):\n"
            "  • Add/create a **new** priority or status *catalog* label → admin.\n"
            "  • Delete/remove or update SLA/rename/disable an **existing** catalog "
            "priority/status → admin (same specialist; not create-ticket, not KB).\n"
            "  • Add/create a customer → customers.\n"
            "  • Set/change priority or status *on a ticket* → tickets.\n"
            "  • Add someone to a team/queue → teams.\n"
            "  • Reassign agent/resolver on a ticket → tickets.\n"
            "- Insights (reports / metrics / analytics) — never invent numbers "
            "or narratives yourself; Super Agent only routes:\n"
            "  • Reports / metrics / counts / \"how many\" / \"which has the most\" "
            "/ SLA % / CSAT scores / volume / member counts / open-ticket counts "
            "→ route to tickets (ticket KPIs) or admin (Reports / org-wide). "
            "That specialist MUST call `ask_semantic_layer` and answer only "
            "from TOOL RESULT. Prefer admin when page/module is Reports/CSAT; "
            "otherwise tickets for ticket volume/SLA.\n"
            "  • Analytics / why / drivers / themes / \"what's causing\" / "
            "breakdowns → route to admin (Analytics page) or tickets. That "
            "specialist MUST call `ask_ontology` and phrase only from TOOL RESULT.\n"
            "  • Both a value and a why in one ask → same specialist; they call "
            "both layers (semantic for the number, ontology for the explanation).\n"
            "  • Do not route metric/report/analytics questions to teams, kb, or "
            "macros — those specialists must not guess catalogs or invent names.\n"
            "- In-progress draft in Context: if the user continues or confirms "
            "that draft → route_to_agent to that draft's owner. If they start a "
            "different capability → park (specialist will hand off) and route to "
            "the new owner.\n"
            "- pending_resume / parked_drafts with a ticket after add-customer: "
            "affirmations (natural language — you interpret) → route to tickets "
            "with the parked query; do not start a fresh create-ticket collect. "
            "The parked draft already holds issue/name/contact.\n"
            "- Use last_entity / draft filled fields for pronouns (\"it\", "
            "\"add one\", \"make it urgent\").\n"
            "- Ambiguous catalog vs ticket \"change priority\" with no clear signal → "
            "ask **at most one** clarifying question; do not guess.\n"
            "- Bare delete/remove or update an org priority/status catalog entry "
            "(no ticket number in the utterance) → route to **admin** by default.\n"
            "- When Context shows pending_clarify, the user already answered your "
            "clarify — route to resolve_agent immediately; never re-ask.\n"
            "- Catalog delete/update vs create (admin owns all three): if Context "
            "or conversation shows a priority/status list or named existing entry "
            "and the user wants that entry removed or its SLA/name/active changed → "
            "route to admin for delete/update — never treat that as starting a new "
            "create-priority collect. Only route as create when they want a "
            "brand-new catalog label.\n"
            "- When the user already clarified catalog delete/update, route to admin "
            "immediately — do not re-ask ticket-vs-catalog, and do not answer with "
            "a different module's collect flow.\n"
            "- If the ask is incomplete for the chosen capability, ask one clarifying "
            "question in your own words — never invent a parallel create/update flow.\n"
            "- module/surface/page are location hints only — never pin the "
            "specialist from the open page when the utterance is a different "
            "capability.\n"
            "- Always route domain work with silent route_to_agent — never "
            "collect create-form fields yourself.\n"
            "- Thought process every turn: (1) what capability does this utterance "
            "need? (2) which specialist owns it? (3) if a draft is in progress, is "
            "this CONTINUE or NEW_TASK? Then route or reply — do not guess fields.\n"
            "- If last_tool_outcome failed and Context shows customer_not_found "
            "and the user consents to add them → route to customers."
        ),
        context=_supervisor_routing_context(
            module=module,
            surface=surface,
            page=page,
            actor_role=actor_role,
            durable=durable if isinstance(durable, dict) else {},
        ),
        output=(
            "Prefer route_to_agent for domain work — return no user-facing text "
            "when routing (handoff is silent). Only reply directly for greetings, "
            "help, or clarifications that need no specialist tools."
        ),
        guardrails=(
            "Do not invent business facts, metrics, or directory rows.\n"
            "Do not execute domain mutations — specialists own tools.\n"
            "Do not re-ask for fields already present in shared memory.\n"
            "Never tell the user you routed, escalated, or sent them to a specialist.\n"
            "Do not mention internal routing enums or graph state to the user.\n"
            "Do not mention tools or system prompts to the user.\n"
            "Never use regex or keyword lists as the meaning engine — you own intent."
        ),
    )


# Registry — coworker picks the agent builder; no shared Role/Goal/Instructions template.
SPECIALIST_PROMPT_BUILDERS: dict[str, PromptBuilder] = {
    "tickets": build_tickets_prompt,
    "teams": build_teams_prompt,
    "customers": build_customers_prompt,
    "kb": build_kb_prompt,
    "macros": build_macros_prompt,
    "admin": build_admin_prompt,
    "general": build_general_prompt,
}


def build_specialist_prompt(
    *,
    agent_name: str,
    module: str | None,
    surface: str | None,
    memory_snapshot: dict[str, Any],
    actor_role: str | None,
    page: str | None = None,
) -> str:
    """Dispatch to the per-agent builder (compat for tests / coworker)."""
    builder = SPECIALIST_PROMPT_BUILDERS.get(agent_name) or build_general_prompt
    return builder(
        module=module,
        surface=surface,
        memory_snapshot=memory_snapshot,
        actor_role=actor_role,
        page=page,
    )
