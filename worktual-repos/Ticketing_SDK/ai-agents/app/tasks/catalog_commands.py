"""Phase 2–4 catalog / prefs / notifications chat helpers (Express tools only)."""

from __future__ import annotations

import re
from typing import Any


def _phrase(**kwargs: Any) -> str:
    from app.tasks.chat_commands import _llm_phrase

    return _llm_phrase(**kwargs)


def _actor_scope(user_id: str | None, org: str, role: str | None, user_name: str | None):
    from app.tools.express_client import ToolActor, tool_actor_scope

    actor = ToolActor(
        user_id=str(user_id or "").strip(),
        organization_id=str(org).strip(),
        user_role=role or None,
        user_name=user_name or None,
    )
    return actor, tool_actor_scope


def _decision_operation(semantic_decision: dict[str, Any] | None) -> str:
    d = semantic_decision if isinstance(semantic_decision, dict) else {}
    return str(d.get("operation") or "").strip().upper()


def _decision_action(semantic_decision: dict[str, Any] | None) -> str:
    d = semantic_decision if isinstance(semantic_decision, dict) else {}
    return str(d.get("action") or "").strip().upper()


def _decision_entity_name(semantic_decision: dict[str, Any] | None) -> str:
    d = semantic_decision if isinstance(semantic_decision, dict) else {}
    fields = d.get("fields") if isinstance(d.get("fields"), dict) else {}
    filters = d.get("filters") if isinstance(d.get("filters"), dict) else {}
    values = d.get("values") if isinstance(d.get("values"), list) else []
    first_val = str(values[0]).strip() if values else ""
    return (
        str(d.get("entity_name") or "").strip()
        or str(fields.get("name") or fields.get("title") or fields.get("displayName") or "").strip()
        or str(filters.get("query") or "").strip()
        or first_val
    )


def _existing_team_display_name(
    candidate: str,
    *,
    org: str,
    role: str | None,
    user_id: str | None,
    user_name: str | None,
) -> str | None:
    """Live directory match, case-insensitive. None if lookup fails."""
    needle = (candidate or "").strip().lower()
    if not needle:
        return None
    try:
        from app.tools.catalog_tools import list_queues

        actor, scope = _actor_scope(user_id, org, role, user_name)
        with scope(actor):
            listed = list_queues()
        if not listed.get("success"):
            return None
        payload = listed.get("payload")
        rows: list[Any] = []
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, list):
                rows = data
            elif payload.get("queueName") or payload.get("name"):
                rows = [payload]
        for row in rows:
            if not isinstance(row, dict):
                continue
            existing = str(row.get("queueName") or row.get("name") or "").strip()
            if existing.lower() == needle:
                return existing
    except Exception:  # noqa: BLE001
        return None
    return None


_KB_CATEGORY_ASK_CUSTOM_RE = re.compile(
    r"^((add|create)(\s+a)?(\s+new)?\s+category|"
    r"new\s+category|custom(\s+category)?|another\s+category|"
    r"add(\s+a)?\s+new\s+one)\s*$",
    re.I,
)

# Asking for the option list mid-create — stay on category; do not treat as a name.
# Structural slot helper (not intent routing).
_KB_CATEGORY_LIST_RE = re.compile(
    r"^(what(\s+are)?\s*categories?|options|list|"
    r"what\s+can\s+i\s+(pick|choose)|"
    r"(show|list|tell\s+me|give\s+me)(\s+me)?(\s+the)?(\s+available)?\s*"
    r"categories?|available\s+categories?)\s*$",
    re.I,
)

# Back-compat alias used by older tests / imports.
_KB_CATEGORY_META_RE = re.compile(
    r"^((add|create)(\s+a)?(\s+new)?\s+category|"
    r"new\s+category|custom(\s+category)?|another\s+category|"
    r"add(\s+a)?\s+new\s+one|"
    r"what(\s+are)?\s*categories?|options|list|"
    r"what\s+can\s+i\s+(pick|choose)|"
    r"(show|list|tell\s+me|give\s+me)(\s+me)?(\s+the)?(\s+available)?\s*"
    r"categories?|available\s+categories?)\s*$",
    re.I,
)

_KB_CATEGORY_EXPLICIT_RE = re.compile(
    r"^(?:the\s+)?category\s*(?:is|:|=)\s*(.+)$",
    re.I,
)


def _kb_articles_payload(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "articles", "items", "rows"):
        rows = payload.get(key)
        if isinstance(rows, list):
            return [x for x in rows if isinstance(x, dict)]
    return []


def _live_kb_categories(
    *,
    org: str,
    user_id: str | None,
    role: str | None,
    user_name: str | None,
) -> list[str]:
    """Distinct categories from Express KB list (empty if unavailable)."""
    from app.tools.catalog_tools import list_kb

    actor, scope = _actor_scope(user_id, org, role, user_name)
    if not actor.user_id or not actor.organization_id:
        return []
    try:
        with scope(actor):
            result = list_kb()
    except Exception:  # noqa: BLE001
        return []
    seen: dict[str, str] = {}
    for row in _kb_articles_payload(result):
        cat = str(row.get("category") or "").strip()
        if cat and cat.lower() not in seen:
            seen[cat.lower()] = cat
    return list(seen.values())


def _kb_category_next_step(categories: list[str]) -> str:
    if categories:
        shown = ", ".join(categories[:8])
        more = "…" if len(categories) > 8 else ""
        return (
            f"Pick a category ({shown}{more}), type a new name, "
            "or say **new category**."
        )
    return "What category should this article use? Type any name."


def _parse_kb_category(
    text: str, known: list[str]
) -> tuple[str | None, str]:
    """
    Return (category, status).

    status: ok | ask_custom | list | invalid
    """
    raw = (text or "").strip()
    if not raw:
        return None, "invalid"
    lower = raw.lower().rstrip("!?.")

    if _KB_CATEGORY_ASK_CUSTOM_RE.match(lower):
        return None, "ask_custom"
    if _KB_CATEGORY_LIST_RE.match(lower):
        return None, "list"

    m = _KB_CATEGORY_EXPLICIT_RE.match(raw)
    if m:
        raw = m.group(1).strip().strip("\"'")
        lower = raw.lower().rstrip("!?.")

    if not raw or len(raw) < 2:
        return None, "invalid"

    # Exact / case-insensitive match against live categories
    for cat in known:
        if cat.lower() == lower:
            return cat, "ok"

    # Substring match only for known categories (avoid false positives)
    for cat in known:
        cl = cat.lower()
        if len(cl) >= 3 and (cl == lower or lower == cl):
            return cat, "ok"

    # "Other" means a custom article category label (not General / not Priorities).
    if lower in {"other", "misc", "miscellaneous", "something else", "custom"}:
        return None, "ask_custom"

    # Freeform category (API accepts any non-empty string)
    if re.search(r"\b(cancel|never\s*mind|stop)\b", lower):
        return None, "invalid"
    # Long / multi-line answers are article body, not a category label.
    if len(raw) > 64 or "\n" in raw:
        return None, "invalid"
    if raw.islower() or raw.isupper():
        return raw.title(), "ok"
    return raw, "ok"


def continue_team_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """name → description → members/skip → confirm (specialist create_queue). Also delete_confirm."""
    from app.workflow_schemas import (
        bind_awaiting_value,
        looks_like_create_team_command,
        members_from_user_text,
        merge_workflow_state,
        resolve_roster_name,
    )

    awaiting = str(team_draft.get("awaiting") or "").strip().lower()
    if awaiting == "members" and not str(team_draft.get("id") or "").strip():
        awaiting = "create_members"
        team_draft = {**team_draft, "awaiting": "create_members"}
    # Delete confirm path (parked on team_draft)
    if awaiting == "delete_confirm":
        return _continue_delete_team_confirm(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=team_draft,
            semantic_decision=semantic_decision,
        )
    if awaiting in ("members", "members_names", "members_team"):
        return _continue_add_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=team_draft,
        )
    if awaiting in ("remove_members", "remove_names", "remove_team"):
        return _continue_remove_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=team_draft,
        )
    if awaiting in ("edit_name", "edit_description", "edit_team"):
        return _continue_edit_team(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=team_draft,
            semantic_decision=semantic_decision,
        )

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    roster = team_draft.get("available_members") if isinstance(team_draft.get("available_members"), list) else None
    if not roster:
        tm = team_draft.get("tool_memory")
        names = (
            (tm.get("list_agents") or {}).get("names")
            if isinstance(tm, dict)
            else None
        )
        if isinstance(names, list):
            roster = [str(n).strip() for n in names if str(n).strip()]
    merged = merge_workflow_state(
        "create_team",
        team_draft,
        decision.get("fields"),
        user_text=text,
        roster_members=roster,
    )
    name = str(merged.get("name") or "").strip()
    if looks_like_create_team_command(name) or (
        awaiting == "name" and looks_like_create_team_command(text)
    ):
        name = ""

    if str(decision.get("action") or "").strip().upper() == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="cancelled",
                fallback="Acknowledge cancelling team create.",
                user_text=text,
                page_label=page or "Teams",
                context={"cancelled": True},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": None,
        }

    if awaiting == "confirm":
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "teams",
            "team_draft": team_draft,
            "current_workflow": str(team_draft.get("flow") or "create_team"),
            "current_step": "confirm",
        }

    description = str(merged.get("description") or team_draft.get("description") or "").strip()
    members = merged.get("members") if isinstance(merged.get("members"), list) else (
        team_draft.get("members") if isinstance(team_draft.get("members"), list) else None
    )
    members_skipped = bool(merged.get("members_skipped") or team_draft.get("members_skipped"))

    def _draft(**extra: Any) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if name:
            out["name"] = name
        if description:
            out["description"] = description
        if members is not None:
            out["members"] = members
        if members_skipped:
            out["members_skipped"] = True
        avail = extra.pop("available_members", None)
        if not isinstance(avail, list):
            prev = team_draft.get("available_members")
            avail = prev if isinstance(prev, list) else None
        if isinstance(avail, list) and avail:
            names = [str(n).strip() for n in avail if str(n).strip()]
            out["available_members"] = names
            tm = extra.pop("tool_memory", None)
            if not isinstance(tm, dict):
                tm = team_draft.get("tool_memory")
            prev_agents = (
                (tm.get("list_agents") or {})
                if isinstance(tm, dict)
                else {}
            )
            ents = prev_agents.get("entities") if isinstance(prev_agents, dict) else None
            if not isinstance(ents, list) or not ents:
                ents = [{"id": "", "name": n} for n in names]
            tm = {
                "list_agents": {
                    "names": names,
                    "count": len(names),
                    "entities": ents,
                }
            }
            out["tool_memory"] = tm
        else:
            extra.pop("tool_memory", None)
        out.update(extra)
        return out

    def _nav_actions(
        *,
        step: str,
        persist: dict[str, Any] | None = None,
        staff_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        action: dict[str, Any] = {
            "type": "create_team",
            "step": step,
            "awaiting": "create_members" if step == "members" else step,
        }
        if name:
            action["name"] = name
        if description:
            action["description"] = description
        if members:
            action["members"] = members
        if staff_names:
            action["availableMembers"] = staff_names
        if persist:
            action.update(persist)
        return [
            {"type": "navigate", "view": "agent-queues"},
            action,
        ]

    if awaiting == "name":
        if not name:
            bound = bind_awaiting_value("create_team", "name", text)
            name = str(bound.get("name") or "").strip()
        if len(name) < 2:
            return {
                "handled": True,
                "reply": _phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask again for the team name.",
                    user_text=text,
                    page_label=page or "Teams",
                    context={"nextStep": "team name"},
                ),
                "actions": _nav_actions(step="name"),
                "route": "teams",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": {"awaiting": "name"},
                "kb_draft": None,
            }
        taken = _existing_team_display_name(
            name,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
        )
        if taken:
            return {
                "handled": True,
                "reply": _phrase(
                    module="team",
                    kind="validation",
                    fallback=(
                        f"A team named **{taken}** already exists. "
                        "Choose a different name."
                    ),
                    user_text=text,
                    page_label=page or "Teams",
                    context={
                        "teamName": name,
                        "existingTeam": taken,
                        "duplicate": True,
                        "nextStep": "a different team name",
                    },
                ),
                "actions": _nav_actions(step="name"),
                "route": "teams",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": {"awaiting": "name"},
                "kb_draft": None,
                "current_workflow": "create_team",
                "current_step": "name",
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="got_name",
                fallback=(
                    f"Name is {name}. Ask for a short team description used to route tickets."
                ),
                user_text=text,
                page_label=page or "Teams",
                context={
                    "teamName": name,
                    "nextStep": "short team description",
                },
            ),
            "actions": _nav_actions(step="description"),
            "route": "teams",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": {"awaiting": "description", "name": name},
            "kb_draft": None,
            "current_workflow": "create_team",
            "current_step": "description",
        }

    if awaiting == "description":
        if len(description) < 3:
            bound = bind_awaiting_value("create_team", "description", text)
            description = str(bound.get("description") or "").strip()
        if len(description) < 3:
            return {
                "handled": True,
                "reply": _phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask again for a short team description.",
                    user_text=text,
                    page_label=page or "Teams",
                    context={
                        "teamName": name,
                        "nextStep": "short team description",
                    },
                ),
                "actions": _nav_actions(step="description"),
                "route": "teams",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": _draft(awaiting="description"),
                "kb_draft": None,
                "current_workflow": "create_team",
                "current_step": "description",
            }
        entities = _load_staff_entities(
            org=org, role=role, user_id=user_id, user_name=user_name
        )
        staff = [e["name"] for e in entities]
        staff_ctx = _available_staff_context(
            team_name=name,
            staff=staff,
            adding_members=False,
            description=description,
        )
        staff_ctx["currentWorkflow"] = "create_team"
        staff_ctx["currentStep"] = "create_members"
        staff_ctx["executedModule"] = "teams"
        return {
            "handled": True,
            "reply": _phrase_members_ask(
                kind="got_description",
                fallback=(
                    f"Description captured for {name}. Ask them to enter a member "
                    "name from the live staff list, or skip / none."
                ),
                user_text=text,
                page=page,
                context=staff_ctx,
                staff=staff,
            ),
            "actions": _nav_actions(step="members", staff_names=staff),
            "route": "teams",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": _draft(
                awaiting="create_members",
                available_members=staff,
                tool_memory={
                    "list_agents": {
                        "names": staff,
                        "count": len(staff),
                        "entities": entities,
                    }
                },
            ),
            "kb_draft": None,
            "current_workflow": "create_team",
            "current_step": "create_members",
        }

    if awaiting == "create_members":
        # Members come from NLU fields.members (canonical roster names).
        nlu_members = merged.get("members") if isinstance(merged.get("members"), list) else None
        nlu_skipped = bool(merged.get("members_skipped"))
        fields_in = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
        roster_now = [
            str(n).strip()
            for n in (
                (roster if isinstance(roster, list) else None)
                or team_draft.get("available_members")
                or []
            )
            if str(n).strip()
        ]

        def _on_roster(raw: str) -> str | None:
            return resolve_roster_name(raw, roster_now)

        from_text = members_from_user_text(text, roster_now)
        if from_text and not (nlu_members and [m for m in nlu_members if str(m).strip()]):
            # Regex roster binder — fallback only when NLU did not fill members.
            nlu_members = from_text
        elif not (nlu_members and [m for m in nlu_members if str(m).strip()]):
            # Gemma often puts the chosen roster in values when fields.members
            # is empty (e.g. "add all" → every available name).
            value_hits: list[str] = []
            seen_v: set[str] = set()
            for raw_v in decision.get("values") or []:
                canon_v = _on_roster(str(raw_v).strip())
                if canon_v and canon_v.lower() not in seen_v:
                    seen_v.add(canon_v.lower())
                    value_hits.append(canon_v)
            if value_hits and roster_now:
                roster_l = {n.lower() for n in roster_now}
                chosen_l = {m.lower() for m in value_hits}
                if roster_l and roster_l <= chosen_l:
                    nlu_members = value_hits
                elif value_hits:
                    nlu_members = value_hits
            if not (nlu_members and [m for m in nlu_members if str(m).strip()]):
                extras: list[str] = []
                for key in ("customerName", "customer_name", "assignee"):
                    val = fields_in.get(key)
                    if isinstance(val, str) and val.strip():
                        extras.append(val.strip())
                en = str(decision.get("entity_name") or "").strip()
                if en:
                    extras.append(en)
                recovered = []
                seen_m: set[str] = set()
                for extra in extras:
                    canon = _on_roster(extra)
                    if canon and canon.lower() not in seen_m:
                        seen_m.add(canon.lower())
                        recovered.append(canon)
                if recovered:
                    nlu_members = recovered
                elif text.strip():
                    canon_text = _on_roster(text.strip())
                    if canon_text:
                        nlu_members = [canon_text]
                    else:
                        nlu_members = None
        if nlu_skipped or (
            isinstance(nlu_members, list)
            and not [m for m in nlu_members if str(m).strip()]
            and (fields_in.get("members_skipped") or fields_in.get("members") == [])
        ):
            members = []
            members_skipped = True
        elif nlu_members is not None and [m for m in nlu_members if str(m).strip()]:
            members = [str(m).strip() for m in nlu_members if str(m).strip()]
            canon_members = []
            seen_c: set[str] = set()
            for m in members:
                canon = _on_roster(m) or m
                if canon.lower() not in seen_c:
                    seen_c.add(canon.lower())
                    canon_members.append(canon)
            members = canon_members
        elif awaiting == "confirm" and not nlu_members:
            members = []
            members_skipped = True
        elif members is None:
            staff_ents = _load_staff_entities(
                org=org, role=role, user_id=user_id, user_name=user_name
            )
            staff = list(roster_now) or [e["name"] for e in staff_ents]
            if not staff:
                prev = team_draft.get("available_members")
                if isinstance(prev, list):
                    staff = [str(n).strip() for n in prev if str(n).strip()]
            staff_ctx = _available_staff_context(
                team_name=name,
                staff=staff,
                adding_members=False,
                description=description,
            )
            staff_ctx["currentWorkflow"] = "create_team"
            staff_ctx["currentStep"] = "create_members"
            staff_ctx["executedModule"] = "teams"
            return {
                "handled": True,
                "reply": _phrase_members_ask(
                    kind="validation",
                    fallback=(
                        "Ask them to enter a member name from the live staff list, "
                        "or say skip / none."
                    ),
                    user_text=text,
                    page=page,
                    context=staff_ctx,
                    staff=staff,
                ),
                "actions": _nav_actions(step="members", staff_names=staff),
                "route": "teams",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": _draft(
                    awaiting="create_members",
                    available_members=staff,
                    tool_memory={
                        "list_agents": {
                            "names": staff,
                            "count": len(staff),
                            "entities": staff_ents
                            or [{"id": "", "name": n} for n in staff],
                        }
                    },
                ),
                "kb_draft": None,
                "current_workflow": "create_team",
                "current_step": "create_members",
            }

        if len(name) < 2 or len(description) < 3:
            next_step = "team name" if len(name) < 2 else "short team description"
            return {
                "handled": True,
                "reply": _phrase(
                    module="team",
                    kind="validation",
                    fallback=f"Ask for the {next_step} before creating the team.",
                    user_text=text,
                    page_label=page or "Teams",
                    context={"teamName": name, "nextStep": next_step},
                ),
                "actions": _nav_actions(step="name" if len(name) < 2 else "description"),
                "route": "teams",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": _draft(
                    awaiting="name" if len(name) < 2 else "description"
                ),
                "kb_draft": None,
                "current_workflow": "create_team",
                "current_step": "name" if len(name) < 2 else "description",
            }

        member_note = (
            f" with {len(members)} member{'s' if len(members) != 1 else ''}"
            if members
            else " (no members yet)"
        )
        confirm_draft = _draft(
            awaiting="confirm",
            members_skipped=members_skipped,
            flow="create_team",
        )
        if members:
            confirm_draft["members"] = members
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="confirm_hint",
                fallback=(
                    f"Summarize team {name}{member_note} and ask them to go ahead or change a field."
                ),
                user_text=text,
                page_label=page or "Teams",
                context={
                    "teamName": name,
                    "description": description,
                    "memberCount": len(members or []),
                    "awaiting": "confirm",
                    "nextStep": "review and tell me to create the team, or change a field",
                },
            ),
            "actions": _nav_actions(step="confirm"),
            "route": "teams",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": confirm_draft,
            "kb_draft": None,
            "current_workflow": "create_team",
            "current_step": "confirm",
        }

    # Post-create / existing-team roster update.
    if awaiting in ("members", "members_team"):
        return _continue_add_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=team_draft,
        )

    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "team_draft": team_draft,
    }


def _parse_member_names(text: str) -> list[str]:
    """Split 'deva, fazil and raghu' into person name tokens."""
    raw = (text or "").strip()
    lower = raw.lower().rstrip("!?.")
    raw = re.sub(
        r"^(?:please\s+)?(?:add|include|assign)\s+(?:these\s+)?(?:members?\s+)?"
        r"(?:to\s+(?:the\s+)?(?:team\s+)?)?",
        "",
        raw,
        flags=re.I,
    ).strip()
    raw = re.sub(
        r"\s+(?:to|in|into|on)\s+(?:the\s+)?(?:team\s+)?[\w\-]+.*$",
        "",
        raw,
        flags=re.I,
    ).strip()
    if not raw or lower in (
        "add members",
        "add member",
        "members",
        "add people",
        "add staff",
    ):
        return []
    raw = re.sub(r"\bmembers?\b", " ", raw, flags=re.I)
    parts = re.split(r"\s*(?:,|/|&|\band\b)\s*", raw, flags=re.I)
    out: list[str] = []
    for p in parts:
        n = p.strip(" \t\"'.")
        if len(n) < 2:
            continue
        if n.lower() in ("team", "queue", "the", "to", "in", "add", "please"):
            continue
        out.append(n)
    return out


def start_or_continue_add_team_members(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any] | None = None,
    intent_confirmed: bool = False,
    resolved_team_name: str | None = None,
    resolved_member_names: list[str] | None = None,
) -> dict[str, Any] | None:
    """Execute a semantically confirmed add-members workflow."""
    draft = team_draft if isinstance(team_draft, dict) else None
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    if awaiting in ("members", "members_names", "members_team"):
        return _continue_add_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=draft or {},
            semantic_decision={
                "entity_name": resolved_team_name,
                "values": resolved_member_names or [],
            }
            if intent_confirmed
            else None,
        )

    if not intent_confirmed:
        return None

    if role not in ("admin",):
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="forbidden",
                fallback="Only admins can add team members.",
                user_text=text,
                page_label=page or "Teams",
                context={"denied": True, "feature": "add members"},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    team_name = (resolved_team_name or "").strip() or None
    names = [str(name).strip() for name in (resolved_member_names or []) if str(name).strip()]
    # Do not treat the extracted team label as a staff member name.
    if team_name and names:
        tn = team_name.strip().lower()
        names = [n for n in names if n.strip().lower() != tn]
    if not team_name and draft and draft.get("name"):
        team_name = str(draft.get("name") or "").strip()

    qid = str((draft or {}).get("id") or "").strip() if draft else ""
    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    rows: list[dict[str, Any]] = []
    if actor.user_id and actor.organization_id:
        try:
            from app.tools.catalog_tools import list_queues

            with scope_fn(actor):
                rows = _queues_payload(list_queues())
        except Exception:  # noqa: BLE001
            rows = []

    hit = _match_queue_by_name(rows, team_name) if team_name else None
    if hit:
        team_name = str(hit.get("queueName") or hit.get("name") or team_name or "").strip()
        qid = str(hit.get("id") or qid).strip()

    if not team_name or not qid:
        live = _available_teams_context(rows)
        # If they typed a name that is not in DB, say so using their text + live list
        if team_name and rows:
            live = {
                **live,
                "unknownTeam": team_name,
                "nextStep": (
                    f"**{team_name}** was not found in this org’s teams. "
                    + str(live.get("nextStep") or "Reply with a team name from the list.")
                ),
            }
        elif team_name and not rows:
            live = {
                **live,
                "unknownTeam": team_name,
                "nextStep": (
                    f"Could not load teams to match **{team_name}**. "
                    "Check Teams on the right, or try again."
                ),
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=(
                    "Ask which existing team to update using only teams from Context.availableTeams."
                ),
                user_text=text,
                page_label=page or "Teams",
                context=live,
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": {
                "awaiting": "members_team",
                "name": "",
                "id": "",
                "available_teams": _team_labels_from_rows(rows),
            },
        }

    if not names:
        staff = _load_available_staff(
            org=org, role=role, user_id=user_id, user_name=user_name
        )
        staff_ctx = _available_staff_context(team_name=team_name, staff=staff)
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="members_prompt",
                fallback=(
                    f"Ask for staff names to add to existing team {team_name}. "
                    "List Context.availableMembers only; do not invent people."
                ),
                user_text=text,
                page_label=page or "Teams",
                context=staff_ctx,
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                    "availableMembers": staff,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "members_names",
                "name": team_name,
                "id": qid,
                "available_members": staff,
            },
            "last_entity": {"type": "team", "id": qid, "name": team_name},
            "escalate_draft": None,
            "macro_draft": None,
            "kb_draft": None,
        }

    staff = _load_available_staff(
        org=org, role=role, user_id=user_id, user_name=user_name
    )
    canon, unmatched = _canon_add_member_names(names, staff)
    if unmatched or not canon:
        staff_ctx = _available_staff_context(team_name=team_name, staff=staff)
        staff_ctx["error"] = True
        staff_ctx["unmatched"] = unmatched or names
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=f"Ask again for names to add to {team_name} using availableMembers.",
                user_text=text,
                page_label=page or "Teams",
                context=staff_ctx,
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                    "availableMembers": staff,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "members_names",
                "name": team_name,
                "id": qid,
                "available_members": staff,
            },
        }

    return _add_members_ask_confirm(
        canon,
        page=page,
        user_text=text,
        team_name=team_name,
        qid=qid,
    )


def _continue_add_team_members(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    name = str(team_draft.get("name") or "").strip()
    qid = str(team_draft.get("id") or "").strip()
    awaiting = str(team_draft.get("awaiting") or "").strip().lower()
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    resolved_team = str(decision.get("entity_name") or "").strip()
    resolved_values = [
        str(value).strip()
        for value in (decision.get("values") or [])
        if str(value).strip()
    ]

    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="cancelled",
                fallback="Acknowledge stopping member add; team stays as-is.",
                user_text=text,
                page_label=page or "Teams",
                context={"cancelled": True, "teamName": name},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    if awaiting == "confirm":
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "teams",
            "team_draft": team_draft,
            "current_workflow": "add_team_members",
            "current_step": "confirm",
        }

    # Semantic decision supplies entity_name in production. Legacy direct callers
    # may still provide a bare field value within an already-known workflow.
    selecting_team = awaiting == "members_team" or action == "PROVIDE_TEAM"
    if selecting_team or (not name or not qid):
        team_candidate = resolved_team
        if not team_candidate and not decision and selecting_team:
            team_candidate = (text or "").strip()
        if not team_candidate and not name:
            # Re-list live teams — never invent sample names
            actor, scope_fn = _actor_scope(user_id, org, role, user_name)
            rows: list[dict[str, Any]] = []
            if actor.user_id and actor.organization_id:
                try:
                    from app.tools.catalog_tools import list_queues

                    with scope_fn(actor):
                        rows = _queues_payload(list_queues())
                except Exception:  # noqa: BLE001
                    rows = []
            live = _available_teams_context(rows)
            return {
                "handled": True,
                "reply": _phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask which existing team using Context.availableTeams only.",
                    user_text=text,
                    page_label=page or "Teams",
                    context=live,
                ),
                "actions": [{"type": "navigate", "view": "agent-queues"}],
                "route": "teams",
                "team_draft": {
                    "awaiting": "members_team",
                    "name": "",
                    "id": "",
                    "available_teams": _team_labels_from_rows(rows),
                },
            }
        # Resolve team via list_queues (fresh start — do not re-enter continue)
        return start_or_continue_add_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=None,
            intent_confirmed=True,
            resolved_team_name=team_candidate or name,
            resolved_member_names=resolved_values,
        )

    if action == "PROVIDE_TEAM" and resolved_team:
        alt = start_or_continue_add_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=None,
            intent_confirmed=True,
            resolved_team_name=resolved_team,
            resolved_member_names=resolved_values,
        )
        if alt:
            return alt

    names = resolved_values if decision else _parse_member_names(text)
    if not names:
        staff = _load_available_staff(
            org=org, role=role, user_id=user_id, user_name=user_name
        )
        staff_ctx = _available_staff_context(team_name=name, staff=staff)
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=f"Ask again for names to add to {name} using availableMembers.",
                user_text=text,
                page_label=page or "Teams",
                context=staff_ctx,
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                    "availableMembers": staff,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "members_names",
                "name": name,
                "id": qid,
                "available_members": staff,
            },
        }

    staff = _load_available_staff(
        org=org, role=role, user_id=user_id, user_name=user_name
    )
    canon, unmatched = _canon_add_member_names(names, staff)
    if unmatched or not canon:
        staff_ctx = _available_staff_context(team_name=name, staff=staff)
        staff_ctx["error"] = True
        staff_ctx["unmatched"] = unmatched or names
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=f"Ask again for names to add to {name} using availableMembers.",
                user_text=text,
                page_label=page or "Teams",
                context=staff_ctx,
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                    "availableMembers": staff,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "members_names",
                "name": name,
                "id": qid,
                "available_members": staff,
            },
        }

    if not qid:
        actor, scope_fn = _actor_scope(user_id, org, role, user_name)
        rows: list[dict[str, Any]] = []
        if actor.user_id:
            try:
                from app.tools.catalog_tools import list_queues

                with scope_fn(actor):
                    rows = _queues_payload(list_queues())
            except Exception:  # noqa: BLE001
                rows = []
        hit = _match_queue_by_name(rows, name)
        qid = str((hit or {}).get("id") or "").strip()
        if hit:
            name = str(hit.get("queueName") or hit.get("name") or name).strip()

    return _add_members_ask_confirm(
        canon,
        page=page,
        user_text=text,
        team_name=name,
        qid=qid,
    )


def _canon_add_member_names(
    names: list[str], staff: list[str]
) -> tuple[list[str], list[str]]:
    from app.workflow_schemas import resolve_roster_name

    canon: list[str] = []
    unmatched: list[str] = []
    seen: set[str] = set()
    for raw in names:
        hit = resolve_roster_name(raw, staff)
        if not hit:
            unmatched.append(raw)
            continue
        key = hit.lower()
        if key in seen:
            continue
        seen.add(key)
        canon.append(hit)
    return canon, unmatched


def _add_members_ask_confirm(
    names: list[str],
    *,
    page: str | None,
    user_text: str,
    team_name: str,
    qid: str,
) -> dict[str, Any]:
    label = ", ".join(names)
    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="confirm_hint",
            fallback=f"Summarize adding {label} to {team_name} and ask them to go ahead or change the list.",
            user_text=user_text,
            page_label=page or "Teams",
            context={
                "teamName": team_name,
                "members": names,
                "awaiting": "confirm",
                "nextStep": "review and tell me to add them, or name different people",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {
                "type": "update_team",
                "name": team_name,
                "id": qid,
                "step": "confirm",
                "members": names,
            },
        ],
        "route": "teams",
        "team_draft": {
            "awaiting": "confirm",
            "flow": "add_members",
            "name": team_name,
            "id": qid,
            "members": names,
        },
        "current_workflow": "add_team_members",
        "current_step": "confirm",
        "last_entity": {"type": "team", "id": qid, "name": team_name},
    }


def _apply_add_team_members(
    names: list[str],
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    user_text: str,
    team_name: str,
    qid: str,
) -> dict[str, Any]:
    from app.tools.catalog_tools import update_queue

    if not qid:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=f"Could not find team {team_name} to update members.",
                user_text=user_text,
                page_label=page or "Teams",
                context={"error": True, "teamName": team_name},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    if not actor.user_id:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="created",
                fallback=f"Open the {team_name} form on the right to add members.",
                user_text=user_text,
                page_label=page or "Teams",
                context={"teamName": team_name, "addingMembers": True},
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "members": names,
                    "save": True,
                },
            ],
            "route": "teams",
            "team_draft": None,
        }

    with scope_fn(actor):
        result = update_queue(qid, members=names, add_members=True)

    if not result.get("success"):
        err = str(result.get("message") or "Could not add members")
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        available = payload.get("availableStaff") if isinstance(payload, dict) else None
        staff = (
            [str(x).strip() for x in available if str(x).strip()]
            if isinstance(available, list)
            else _load_available_staff(
                org=org, role=role, user_id=user_id, user_name=user_name
            )
        )
        staff_ctx = _available_staff_context(team_name=team_name, staff=staff)
        staff_ctx["error"] = True
        staff_ctx["errorDetail"] = err
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=(
                    f"Could not add members to {team_name}: {err}. "
                    "Offer Context.availableMembers and ask them to retry."
                ),
                user_text=user_text,
                page_label=page or "Teams",
                context=staff_ctx,
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                    "availableMembers": staff,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "members_names",
                "name": team_name,
                "id": qid,
                "available_members": staff,
            },
        }

    joined = ", ".join(names)
    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="members_added",
            fallback=(
                f"Confirm members ({joined}) were added to existing team {team_name}. "
                "Do not start create-team."
            ),
            user_text=user_text,
            page_label=page or "Teams",
            context={
                "teamName": team_name,
                "membersAdded": joined,
                "addingMembers": True,
                "filed": True,
                "nextStep": "offer another change (not create team)",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "refresh_teams"},
            {
                "type": "set_filter",
                "module": "teams",
                "query": team_name,
            },
            {
                "type": "update_team",
                "name": team_name,
                "id": qid,
                "members": names,
                "done": True,
                "refresh": True,
            },
        ],
        "route": "teams",
        "team_draft": None,
        "escalate_draft": None,
        "macro_draft": None,
        "kb_draft": None,
        "last_entity": {"type": "team", "id": qid, "name": team_name},
        "current_workflow": None,
        "current_step": None,
        "workflow_data": None,
    }


def _queues_payload(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("data", "queues", "teams", "items", "rows"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [x for x in rows if isinstance(x, dict)]
    return []


def _agents_payload(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("data", "agents", "staff", "items", "rows"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [x for x in rows if isinstance(x, dict)]
    return []


def _staff_entities_from_rows(rows: list[dict[str, Any]], *, limit: int = 200) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for r in rows:
        label = str(r.get("name") or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": str(r.get("id") or "").strip(), "name": label})
        if len(out) >= max(1, limit):
            break
    return out


def _staff_labels_from_rows(rows: list[dict[str, Any]], *, limit: int = 200) -> list[str]:
    """Live staff display names from Express/DB — never invent people."""
    return [e["name"] for e in _staff_entities_from_rows(rows, limit=limit)]


def _load_available_staff(
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
) -> list[str]:
    return [e["name"] for e in _load_staff_entities(org=org, role=role, user_id=user_id, user_name=user_name)]


def _load_staff_entities(
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
) -> list[dict[str, str]]:
    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    if not actor.user_id or not actor.organization_id:
        return []
    try:
        from app.tools.catalog_tools import list_agents

        with scope_fn(actor):
            return _staff_entities_from_rows(_agents_payload(list_agents()))
    except Exception:  # noqa: BLE001
        return []


def _available_staff_context(
    *,
    team_name: str,
    staff: list[str],
    adding_members: bool = True,
    description: str | None = None,
) -> dict[str, Any]:
    ctx: dict[str, Any] = {
        "teamName": team_name,
        "addingMembers": adding_members,
        "staffFromDb": True,
        "staffCount": len(staff),
        "listAllStaffThenAskName": True,
    }
    if description:
        ctx["description"] = description
    if staff:
        ctx["availableMembers"] = staff
        listed = ", ".join(f"**{n}**" for n in staff)
        ctx["nextStep"] = (
            f"Show every staff member as a markdown bullet list ({listed}). "
            f"Then ask them to enter a member name from that list to add to "
            f"**{team_name}** (comma-separated if several), or say skip / none."
        )
    else:
        ctx["availableMembers"] = []
        ctx["nextStep"] = (
            f"No active staff were returned for this organization. "
            f"Ask them to enter a member name already in Ticketing for **{team_name}**, "
            f"or say skip / none."
        )
    return ctx


def _staff_roster_markdown(staff: list[str]) -> str:
    """Exact live names for chat — never invent people."""
    names = [str(n).strip() for n in staff if str(n).strip()]
    if not names:
        return ""
    return "\n".join(f"* **{n}**" for n in names)


def _phrase_members_ask(
    *,
    kind: str,
    fallback: str,
    user_text: str,
    page: str | None,
    context: dict[str, Any],
    staff: list[str],
) -> str:
    intro = _phrase(
        module="team",
        kind=kind,
        fallback=fallback,
        user_text=user_text,
        page_label=page or "Teams",
        context=context,
    )
    roster = _staff_roster_markdown(staff)
    if not roster:
        return intro
    from app.tasks.chat_commands import _compose_intro_and_list

    return _compose_intro_and_list(intro, roster)


def _team_labels_from_rows(rows: list[dict[str, Any]], *, limit: int = 40) -> list[str]:
    """Live team display names from Express/DB rows — never invent names."""
    out: list[str] = []
    seen: set[str] = set()
    for r in rows:
        label = str(r.get("queueName") or r.get("name") or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
        if len(out) >= max(1, limit):
            break
    return out


def _available_teams_context(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Facts for the phrase LLM — only what Postgres/Express returned."""
    labels = _team_labels_from_rows(rows)
    ctx: dict[str, Any] = {
        "addingMembers": True,
        "teamsFromDb": True,
        "teamCount": len(labels),
    }
    if labels:
        ctx["availableTeams"] = labels
        # Intent hint only — LLM must paraphrase; values come from DB
        shown = ", ".join(f"**{n}**" for n in labels[:12])
        more = f" (+{len(labels) - 12} more)" if len(labels) > 12 else ""
        ctx["nextStep"] = (
            f"Which team should get members? Reply with one of: {shown}{more}."
        )
    else:
        ctx["availableTeams"] = []
        ctx["nextStep"] = (
            "No teams were returned for this organization yet. "
            "Create a team first, then add members."
        )
    return ctx


def _match_queue_by_name(rows: list[dict[str, Any]], needle: str) -> dict[str, Any] | None:
    q = (needle or "").strip().lower()
    if not q:
        return None
    exact = [
        r
        for r in rows
        if str(r.get("queueName") or r.get("name") or "").strip().lower() == q
    ]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return exact[0]
    partial = [
        r
        for r in rows
        if q in str(r.get("queueName") or r.get("name") or "").strip().lower()
    ]
    if len(partial) == 1:
        return partial[0]
    return None


def start_or_continue_delete_team(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    Delete team by name via chat. Never treats delete as a list filter.
    Returns None if the message is not a delete-team intent.
    """
    from app.tools.catalog_tools import delete_queue, list_queues

    draft = team_draft if isinstance(team_draft, dict) else None
    if draft and str(draft.get("awaiting") or "") == "delete_confirm":
        return _continue_delete_team_confirm(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=draft,
            semantic_decision=semantic_decision,
        )

    if _decision_operation(semantic_decision) != "DELETE_TEAM":
        return None

    if role not in ("admin",):
        # Only admins can delete teams (matches form UI canCreate for teams)
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="forbidden",
                fallback="Only admins can delete teams.",
                user_text=text,
                page_label=page or "Teams",
                context={"denied": True, "feature": "delete team"},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    name = _decision_entity_name(semantic_decision)
    if not name or name.lower() in ("team", "queue", "the"):
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback="Ask which team to delete by name.",
                user_text=text,
                page_label=page or "Teams",
                context={"nextStep": "team name to delete"},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    rows: list[dict[str, Any]] = []
    if actor.user_id and actor.organization_id:
        try:
            with scope_fn(actor):
                rows = _queues_payload(list_queues())
        except Exception:  # noqa: BLE001
            rows = []

    hit = _match_queue_by_name(rows, name)
    if not hit:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=f"No team named {name} found. Ask them to check the list on the right.",
                user_text=text,
                page_label=page or "Teams",
                context={"error": True, "teamName": name, "nextStep": "exact team name from Teams"},
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {"type": "set_filter", "module": "teams", "query": name},
            ],
            "route": "teams",
            "team_draft": None,
        }

    qname = str(hit.get("queueName") or hit.get("name") or name).strip()
    qid = str(hit.get("id") or "").strip()
    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="confirm_prompt",
            fallback=f"Summarize deleting team {qname} and ask whether to proceed or keep it.",
            user_text=text,
            page_label=page or "Teams",
            context={
                "teamName": qname,
                "deleting": True,
                "nextStep": f"whether to permanently delete **{qname}** or keep it",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {
                "type": "delete_team",
                "name": qname,
                "id": qid,
                "step": "confirm",
            },
        ],
        "route": "teams",
        "team_draft": {
            "awaiting": "delete_confirm",
            "name": qname,
            "id": qid,
        },
        "escalate_draft": None,
        "macro_draft": None,
        "kb_draft": None,
    }


def _continue_delete_team_confirm(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tools.catalog_tools import delete_queue

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    name = str(team_draft.get("name") or "").strip()
    qid = str(team_draft.get("id") or "").strip()

    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="cancelled",
                fallback="Acknowledge cancelling team delete.",
                user_text=text,
                page_label=page or "Teams",
                context={"cancelled": True, "deleting": True},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "route": "teams",
        "team_draft": team_draft,
        "current_workflow": "delete_team",
        "current_step": "delete_confirm",
    }

def start_or_continue_remove_team_members(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any] | None = None,
    intent_confirmed: bool = False,
    resolved_team_name: str | None = None,
    resolved_member_names: list[str] | None = None,
) -> dict[str, Any] | None:
    """Remove members from a team via chat (admin). Mirrors add-members."""
    draft = team_draft if isinstance(team_draft, dict) else None
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    if awaiting in ("remove_members", "remove_names", "remove_team"):
        return _continue_remove_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=draft or {},
            semantic_decision={
                "entity_name": resolved_team_name,
                "values": resolved_member_names or [],
            }
            if intent_confirmed
            else None,
        )

    looks = bool(intent_confirmed)
    if not looks and awaiting not in ("remove_members", "remove_names", "remove_team"):
        return None

    if role not in ("admin",):
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="forbidden",
                fallback="Only admins can remove team members.",
                user_text=text,
                page_label=page or "Teams",
                context={"denied": True, "feature": "remove members"},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    team_name = (resolved_team_name or "").strip() or None
    names = [
        str(n).strip() for n in (resolved_member_names or []) if str(n).strip()
    ]

    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    rows: list[dict[str, Any]] = []
    if actor.user_id and actor.organization_id:
        try:
            from app.tools.catalog_tools import list_queues

            with scope_fn(actor):
                rows = _queues_payload(list_queues())
        except Exception:  # noqa: BLE001
            rows = []

    hit = _match_queue_by_name(rows, team_name) if team_name else None
    if hit:
        team_name = str(
            hit.get("queueName") or hit.get("name") or team_name or ""
        ).strip()
        qid = str(hit.get("id") or "").strip()
        current = [
            str(x).strip()
            for x in (hit.get("members") or hit.get("memberNames") or [])
            if str(x).strip()
        ]
        if names:
            return _apply_remove_team_members(
                names,
                org=org,
                role=role,
                user_id=user_id,
                user_name=user_name,
                page=page,
                user_text=text,
                team_name=team_name,
                qid=qid,
                current_members=current,
            )
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="members_prompt",
                fallback=f"Ask which members to remove from {team_name}.",
                user_text=text,
                page_label=page or "Teams",
                context={
                    "teamName": team_name,
                    "removingMembers": True,
                    "availableMembers": ", ".join(current) if current else "",
                    "nextStep": (
                        f"Who should I remove from **{team_name}**? "
                        "List names separated by commas."
                    ),
                },
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "remove_names",
                "name": team_name,
                "id": qid,
                "members": current,
            },
        }

    available = [
        str(r.get("queueName") or r.get("name") or "").strip()
        for r in rows
        if str(r.get("queueName") or r.get("name") or "").strip()
    ]
    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="validation",
            fallback="Ask which team to remove members from.",
            user_text=text,
            page_label=page or "Teams",
            context={
                "removingMembers": True,
                "availableTeams": ", ".join(available) if available else "",
                "nextStep": "team name to remove members from",
            },
        ),
        "actions": [{"type": "navigate", "view": "agent-queues"}],
        "route": "teams",
        "team_draft": {
            "awaiting": "remove_team",
            "available_teams": available,
        },
    }


def _continue_remove_team_members(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    awaiting = str(team_draft.get("awaiting") or "").strip().lower()
    action = _decision_action(semantic_decision)
    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="cancelled",
                fallback="Acknowledge cancelling remove-members.",
                user_text=text,
                page_label=page or "Teams",
                context={"cancelled": True, "removingMembers": True},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    entity_name = str(decision.get("entity_name") or "").strip()
    values = [
        str(v).strip() for v in (decision.get("values") or []) if str(v).strip()
    ]

    if awaiting == "remove_team":
        team_name = entity_name or (text or "").strip()
        return start_or_continue_remove_team_members(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            intent_confirmed=True,
            resolved_team_name=team_name,
        )

    team_name = str(team_draft.get("name") or "").strip()
    qid = str(team_draft.get("id") or "").strip()
    current = [
        str(x).strip()
        for x in (team_draft.get("members") or [])
        if str(x).strip()
    ]
    names = values or [
        p.strip()
        for p in re.split(r"\s*(?:,|&|\band\b)\s*", text or "", flags=re.I)
        if p.strip()
    ]
    return _apply_remove_team_members(
        names,
        org=org,
        role=role,
        user_id=user_id,
        user_name=user_name,
        page=page,
        user_text=text,
        team_name=team_name,
        qid=qid,
        current_members=current,
    )


def _apply_remove_team_members(
    names: list[str],
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    user_text: str,
    team_name: str,
    qid: str,
    current_members: list[str],
) -> dict[str, Any]:
    from app.tools.catalog_tools import update_queue

    if not qid or not names:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback="Ask which members to remove.",
                user_text=user_text,
                page_label=page or "Teams",
                context={
                    "teamName": team_name,
                    "removingMembers": True,
                    "nextStep": "member names to remove",
                },
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": {
                "awaiting": "remove_names",
                "name": team_name,
                "id": qid,
                "members": current_members,
            },
        }

    remove_set = {n.strip().lower() for n in names if n.strip()}
    remaining = [
        m for m in current_members if m.strip().lower() not in remove_set
    ]
    removed = [
        m for m in current_members if m.strip().lower() in remove_set
    ]
    if not removed:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback="Those names are not on the team; re-list current members.",
                user_text=user_text,
                page_label=page or "Teams",
                context={
                    "teamName": team_name,
                    "removingMembers": True,
                    "availableMembers": ", ".join(current_members),
                    "nextStep": "names from current roster",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "step": "members",
                    "open": True,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "remove_names",
                "name": team_name,
                "id": qid,
                "members": current_members,
            },
        }

    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    if not actor.user_id:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="created",
                fallback=f"Open {team_name} on the right to remove members.",
                user_text=user_text,
                page_label=page or "Teams",
                context={"teamName": team_name, "removingMembers": True},
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": team_name,
                    "id": qid,
                    "members": remaining,
                    "replaceMembers": True,
                    "save": True,
                },
            ],
            "route": "teams",
            "team_draft": None,
        }

    with scope_fn(actor):
        # Full replace (no addMembers) — same as Teams form toggle-off.
        result = update_queue(qid, members=remaining, add_members=False)

    if not result.get("success"):
        err = str(result.get("message") or "Could not remove members")
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=f"Could not remove members from {team_name}: {err}.",
                user_text=user_text,
                page_label=page or "Teams",
                context={
                    "error": True,
                    "teamName": team_name,
                    "removingMembers": True,
                    "errorDetail": err,
                },
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": {
                "awaiting": "remove_names",
                "name": team_name,
                "id": qid,
                "members": current_members,
            },
        }

    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="members_added",
            fallback=f"Removed members from {team_name}. List updated on the right.",
            user_text=user_text,
            page_label=page or "Teams",
            context={
                "teamName": team_name,
                "removingMembers": True,
                "removedMembers": ", ".join(removed),
                "filed": True,
            },
        ),
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "refresh_teams"},
            {
                "type": "update_team",
                "name": team_name,
                "id": qid,
                "members": remaining,
                "done": True,
                "refresh": True,
            },
        ],
        "route": "teams",
        "team_draft": None,
        "last_entity": {"type": "team", "id": qid, "name": team_name},
    }


# ---- Edit team name / description (hybrid PATCH) ----


def start_or_continue_edit_team(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Rename / set description for an existing team (admin)."""
    from app.tools.catalog_tools import list_queues, update_queue

    draft = team_draft if isinstance(team_draft, dict) else None
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()

    if awaiting in ("edit_name", "edit_description", "edit_team"):
        return _continue_edit_team(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=draft or {},
            semantic_decision=semantic_decision,
        )

    if _decision_operation(semantic_decision) != "UPDATE_TEAM":
        return None

    if role not in ("admin",):
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="forbidden",
                fallback="Only admins can edit teams.",
                user_text=text,
                page_label=page or "Teams",
                context={"denied": True, "feature": "edit team"},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    name_hint = _decision_entity_name(semantic_decision)
    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    rows: list[dict[str, Any]] = []
    if actor.user_id and actor.organization_id:
        try:
            with scope_fn(actor):
                rows = _queues_payload(list_queues())
        except Exception:  # noqa: BLE001
            rows = []

    hit = _match_queue_by_name(rows, name_hint) if name_hint else None
    if hit:
        qname = str(hit.get("queueName") or hit.get("name") or "").strip()
        qid = str(hit.get("id") or "").strip()
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="got_name",
                fallback=f"Ask for the new name for team {qname}.",
                user_text=text,
                page_label=page or "Teams",
                context={
                    "teamName": qname,
                    "editingTeam": True,
                    "nextStep": f"What should **{qname}** be renamed to?",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "name": qname,
                    "id": qid,
                    "step": "edit",
                    "open": True,
                },
            ],
            "route": "teams",
            "team_draft": {
                "awaiting": "edit_name",
                "name": qname,
                "id": qid,
                "description": str(hit.get("description") or ""),
            },
        }

    available = [
        str(r.get("queueName") or r.get("name") or "").strip()
        for r in rows
        if str(r.get("queueName") or r.get("name") or "").strip()
    ]
    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="validation",
            fallback="Ask which team to edit.",
            user_text=text,
            page_label=page or "Teams",
            context={
                "editingTeam": True,
                "availableTeams": ", ".join(available) if available else "",
                "nextStep": "team name to edit",
            },
        ),
        "actions": [{"type": "navigate", "view": "agent-queues"}],
        "route": "teams",
        "team_draft": {"awaiting": "edit_team", "available_teams": available},
    }


def _continue_edit_team(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    team_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.tools.catalog_tools import update_queue

    awaiting = str(team_draft.get("awaiting") or "").strip().lower()
    lower = (text or "").strip().lower()
    action = _decision_action(semantic_decision)
    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="cancelled",
                fallback="Acknowledge cancelling team edit.",
                user_text=text,
                page_label=page or "Teams",
                context={"cancelled": True, "editingTeam": True},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": None,
        }

    if awaiting == "edit_team":
        return start_or_continue_edit_team(
            f"edit team {text.strip()}",
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
        )

    qid = str(team_draft.get("id") or "").strip()
    old_name = str(team_draft.get("name") or "").strip()
    if awaiting == "edit_name":
        new_name = (text or "").strip()
        if len(new_name) < 2:
            return {
                "handled": True,
                "reply": _phrase(
                    module="team",
                    kind="validation",
                    fallback="Ask again for the new team name.",
                    user_text=text,
                    page_label=page or "Teams",
                    context={
                        "editingTeam": True,
                        "nextStep": "new team name",
                    },
                ),
                "actions": [{"type": "navigate", "view": "agent-queues"}],
                "route": "teams",
                "team_draft": team_draft,
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="got_type",
                fallback="Ask for an optional description, or say skip.",
                user_text=text,
                page_label=page or "Teams",
                context={
                    "teamName": new_name,
                    "editingTeam": True,
                    "nextStep": (
                        "Optional: new description, or say **skip** to keep "
                        "the current one."
                    ),
                },
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": {
                "awaiting": "edit_description",
                "name": old_name,
                "id": qid,
                "new_name": new_name,
                "description": str(team_draft.get("description") or ""),
            },
        }

    # edit_description → PATCH
    new_name = str(team_draft.get("new_name") or old_name).strip()
    desc = str(team_draft.get("description") or "")
    if not re.search(r"\b(skip|keep|same|none)\b", lower):
        desc = (text or "").strip()

    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    if not actor.user_id or not qid:
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="created",
                fallback="Open the team form on the right to save the rename.",
                user_text=text,
                page_label=page or "Teams",
                context={"teamName": new_name, "editingTeam": True},
            ),
            "actions": [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "update_team",
                    "id": qid,
                    "name": new_name,
                    "description": desc,
                    "save": True,
                },
            ],
            "route": "teams",
            "team_draft": None,
        }

    with scope_fn(actor):
        result = update_queue(qid, name=new_name, description=desc)

    if not result.get("success"):
        err = str(result.get("message") or "Could not update team")
        return {
            "handled": True,
            "reply": _phrase(
                module="team",
                kind="validation",
                fallback=err,
                user_text=text,
                page_label=page or "Teams",
                context={"error": True, "teamName": new_name, "editingTeam": True},
            ),
            "actions": [{"type": "navigate", "view": "agent-queues"}],
            "route": "teams",
            "team_draft": team_draft,
        }

    return {
        "handled": True,
        "reply": _phrase(
            module="team",
            kind="created",
            fallback=f"Team updated to {new_name}. List refreshed on the right.",
            user_text=text,
            page_label=page or "Teams",
            context={"teamName": new_name, "editingTeam": True, "filed": True},
        ),
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "refresh_teams"},
            {
                "type": "update_team",
                "id": qid,
                "name": new_name,
                "done": True,
                "refresh": True,
            },
        ],
        "route": "teams",
        "team_draft": None,
        "last_entity": {"type": "team", "id": qid, "name": new_name},
    }


# ---- Add customer (directory) ----


def _name_offered_this_turn(name: str, user_text: str) -> bool:
    """True when this utterance actually contains the candidate name."""
    from app.workflow_schemas import looks_like_create_customer_command

    n = (name or "").strip().lower()
    t = (user_text or "").strip().lower()
    if not n or not t:
        return False
    if looks_like_create_customer_command(n):
        return False
    return n in t


def _seed_customer_name(
    *,
    ticket_draft: dict[str, Any] | None,
    parked_drafts: list | None,
    session_history: list | None,
    semantic_decision: dict[str, Any] | None,
    user_text: str = "",
) -> str:
    from app.workflow_schemas import (
        looks_like_create_customer_command,
        looks_like_person_name,
        normalize_customer_fields,
    )

    del session_history  # Prior turns are not a customer name (e.g. "yes proceed").
    fields = (
        semantic_decision.get("fields")
        if isinstance(semantic_decision, dict)
        and isinstance(semantic_decision.get("fields"), dict)
        else {}
    )
    seeded = normalize_customer_fields(fields).get("name") or ""
    if looks_like_person_name(str(seeded)) and (
        not looks_like_create_customer_command(user_text)
        or _name_offered_this_turn(str(seeded), user_text)
    ):
        return str(seeded).strip()
    if isinstance(ticket_draft, dict):
        n = str(ticket_draft.get("customerName") or ticket_draft.get("name") or "").strip()
        if looks_like_person_name(n):
            return n
    for item in reversed(parked_drafts or []):
        if not isinstance(item, dict):
            continue
        if str(item.get("flow") or "").strip().lower() != "ticket":
            continue
        draft = item.get("draft") if isinstance(item.get("draft"), dict) else {}
        n = str(draft.get("customerName") or draft.get("name") or "").strip()
        if looks_like_person_name(n):
            return n
    return ""


def _seed_customer_contact(
    *,
    ticket_draft: dict[str, Any] | None,
    parked_drafts: list | None,
) -> tuple[str, str]:
    from app.workflow_schemas import email_looks_valid, phone_looks_valid

    def _from(draft: dict[str, Any] | None) -> tuple[str, str]:
        if not isinstance(draft, dict):
            return "", ""
        email = str(draft.get("email") or draft.get("customerEmail") or "").strip()
        phone = str(draft.get("phone") or draft.get("customerPhone") or "").strip()
        if email and not email_looks_valid(email):
            email = ""
        if phone and not phone_looks_valid(phone):
            phone = ""
        return email, phone

    email, phone = _from(ticket_draft)
    if email or phone:
        return email, phone
    for item in reversed(parked_drafts or []):
        if not isinstance(item, dict):
            continue
        if str(item.get("flow") or "").strip().lower() != "ticket":
            continue
        draft = item.get("draft") if isinstance(item.get("draft"), dict) else {}
        email, phone = _from(draft)
        if email or phone:
            return email, phone
    return "", ""


def start_create_customer_flow(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    ticket_draft: dict[str, Any] | None = None,
    parked_drafts: list | None = None,
    session_history: list | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Start add-customer: seed name/email/phone from ticket draft / history when present."""
    from app.workflow_schemas import email_looks_valid, phone_looks_valid

    role_l = (role or "").strip().lower()
    if role_l != "admin":
        return {
            "handled": True,
            "reply": _phrase(
                module="nav",
                kind="forbidden",
                fallback="Only admins can add customers. Suggest searching the directory.",
                user_text=text,
                page_label=page,
                context={"feature": "Customers", "denied": True},
            ),
            "actions": [{"type": "navigate", "view": "customers"}],
            "route": "customers",
            "customer_draft": None,
        }
    name = _seed_customer_name(
        ticket_draft=ticket_draft,
        parked_drafts=parked_drafts,
        session_history=session_history,
        semantic_decision=semantic_decision,
        user_text=text,
    )
    email, phone = _seed_customer_contact(
        ticket_draft=ticket_draft,
        parked_drafts=parked_drafts,
    )
    if name and email_looks_valid(email) and phone_looks_valid(phone):
        return continue_customer_draft(
            "",
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            customer_draft={
                "awaiting": "confirm",
                "name": name,
                "email": email,
                "phone": phone,
            },
            parked_drafts=parked_drafts,
        )
    if name and email_looks_valid(email):
        draft = {"awaiting": "phone", "name": name, "email": email}
        if phone_looks_valid(phone):
            draft["phone"] = phone
        return {
            "handled": True,
            "reply": _phrase(
                module="customer",
                kind="got_email",
                fallback=f"Email is {email}. Ask for their phone number.",
                user_text=text,
                page_label=page or "Customers",
                context={
                    "customerName": name,
                    "email": email,
                    "nextStep": "phone number",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "customers"},
                {
                    "type": "create_customer",
                    "name": name,
                    "email": email,
                    "step": "phone",
                },
            ],
            "route": "customers",
            "customer_draft": draft,
            "current_workflow": "create_customer",
            "current_step": "phone",
        }
    if name:
        draft = {"awaiting": "email", "name": name}
        if phone_looks_valid(phone):
            draft["phone"] = phone
        return {
            "handled": True,
            "reply": _phrase(
                module="customer",
                kind="got_name",
                fallback=f"Name is {name}. Ask for their email address.",
                user_text=text,
                page_label=page or "Customers",
                context={
                    "customerName": name,
                    "nextStep": "email address",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "customers"},
                {
                    "type": "create_customer",
                    "name": name,
                    "step": "email",
                    **({"phone": phone} if phone_looks_valid(phone) else {}),
                },
            ],
            "route": "customers",
            "customer_draft": draft,
            "current_workflow": "create_customer",
            "current_step": "email",
        }
    return {
        "handled": True,
        "reply": _phrase(
            module="customer",
            kind="start",
            fallback="Start add-customer: acknowledge and ask for the customer name.",
            user_text=text,
            page_label=page or "Customers",
            context={"nextStep": "customer full name"},
        ),
        "actions": [
            {"type": "navigate", "view": "customers"},
            {"type": "create_customer", "step": "name"},
        ],
        "route": "customers",
        "customer_draft": {"awaiting": "name"},
        "current_workflow": "create_customer",
        "current_step": "name",
    }


def _directory_row_from_tool(result: dict[str, Any] | None) -> dict[str, Any] | None:
    payload = result.get("payload") if isinstance(result, dict) else None
    if not isinstance(payload, dict):
        return None
    for key in ("customer", "existing"):
        row = payload.get(key)
        if isinstance(row, dict) and str(row.get("id") or "").strip():
            return row
    if str(payload.get("id") or "").strip() and (
        payload.get("email") or payload.get("name") or payload.get("phone")
    ):
        return payload
    return None


def _lookup_directory_row(
    *,
    org: str,
    role: str | None,
    user_id: str | None,
    user_name: str | None,
    email: str,
    phone: str,
) -> dict[str, Any] | None:
    from app.tools.catalog_tools import list_customers

    actor, scope = _actor_scope(user_id, org, role, user_name)
    with scope(actor):
        listed = list_customers(
            exact_email=email or None,
            exact_phone=phone or None,
        )
    payload = listed.get("payload") if isinstance(listed, dict) else None
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return None
    want_email = (email or "").strip().lower()
    want_phone = re.sub(r"\D", "", phone or "")
    for row in rows:
        if not isinstance(row, dict):
            continue
        hit_email = str(row.get("email") or "").strip().lower()
        hit_phone = re.sub(r"\D", "", str(row.get("phone") or ""))
        if want_email and hit_email == want_email:
            return row
        if want_phone and len(want_phone) >= 7 and hit_phone and (
            hit_phone == want_phone
            or hit_phone.endswith(want_phone)
            or want_phone.endswith(hit_phone)
        ):
            return row
    return None


def _finish_customer_saved(
    text: str,
    *,
    page: str | None,
    name: str,
    email: str,
    phone: str,
    cid: str,
    parked_drafts: list | None,
    reused: bool,
) -> dict[str, Any]:
    last_entity = {"type": "customer", "id": cid, "name": name}
    created = {
        "handled": True,
        "reply": _phrase(
            module="customer",
            kind="created",
            fallback=(
                f"{name} is already in the directory. List refreshed on the right."
                if reused
                else f"{name} is in the directory. List refreshed on the right."
            ),
            user_text=text,
            page_label=page or "Customers",
            context={
                "customerName": name,
                "customerId": cid or None,
                "filed": not reused,
                "reused": reused,
            },
        ),
        "actions": [
            {"type": "navigate", "view": "customers"},
            {
                "type": "create_customer",
                "done": True,
                "refresh": True,
                "id": cid,
                "name": name,
                "email": email,
                "phone": phone,
            },
        ],
        "route": "customers",
        "customer_draft": None,
        "last_entity": last_entity,
    }
    ticket = None
    rest: list[dict[str, Any]] = []
    for item in parked_drafts or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("flow") or "").strip().lower() == "ticket" and ticket is None:
            ticket = item.get("draft") if isinstance(item.get("draft"), dict) else None
            continue
        rest.append(item)
    if not isinstance(ticket, dict):
        if rest:
            created["parked_drafts"] = rest
        return created
    from app.workflow_state import apply_last_entity_to_ticket
    from app.tasks.chat_commands import _ticket_ask_missing
    from app.workflow_schemas import missing_ticket_fields, ticket_draft_from_state

    bound = apply_last_entity_to_ticket(dict(ticket), last_entity)
    if email:
        bound["customerEmail"] = email
    if phone:
        bound["customerPhone"] = phone
    bound["customerId"] = cid
    bound["customerName"] = name or str(bound.get("customerName") or "")
    missing = missing_ticket_fields(bound)
    step = "confirm"
    if missing:
        step = {
            "customerName": "name",
            "contact": "contact",
            "issue": "issue",
            "priority": "priority",
        }.get(missing[0], missing[0])
    bound = ticket_draft_from_state(bound, awaiting=step)
    if missing:
        resumed = _ticket_ask_missing(
            text,
            page=page or "Create Ticket",
            data=bound,
            missing=missing,
            kind="got_contact",
        )
    else:
        from app.tasks.chat_commands import _ticket_confirm_prompt

        resumed = _ticket_confirm_prompt(text, page=page or "Create Ticket", data=bound)
    resumed = dict(resumed)
    resumed["customer_draft"] = None
    resumed["last_entity"] = last_entity
    resumed["ticket_draft"] = bound
    resumed["current_workflow"] = "create_ticket"
    resumed["current_step"] = step
    if rest:
        resumed["parked_drafts"] = rest
    else:
        resumed["parked_drafts"] = []
    actions = list(created.get("actions") or []) + list(resumed.get("actions") or [])
    resumed["actions"] = actions
    return resumed


def continue_customer_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    customer_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
    parked_drafts: list | None = None,
) -> dict[str, Any]:
    """name → email → phone → confirm (specialist create_customer). No fake created."""
    from app.workflow_schemas import (
        bind_awaiting_value,
        email_looks_valid,
        looks_like_create_customer_command,
        merge_workflow_state,
        phone_looks_valid,
    )

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    merged = merge_workflow_state(
        "create_customer", customer_draft, decision.get("fields"), user_text=text
    )
    awaiting = str(customer_draft.get("awaiting") or "").strip().lower()
    name = str(merged.get("name") or customer_draft.get("name") or "").strip()
    if looks_like_create_customer_command(name) or (
        awaiting == "name" and looks_like_create_customer_command(text)
    ):
        name = ""
    email = str(merged.get("email") or customer_draft.get("email") or "").strip()
    phone = str(merged.get("phone") or customer_draft.get("phone") or "").strip()
    if awaiting == "contact":
        if not email_looks_valid(email):
            awaiting = "email"
        elif not phone_looks_valid(phone):
            awaiting = "phone"
        else:
            awaiting = "confirm"
    action = str(decision.get("action") or "").strip().upper()

    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="customer",
                kind="cancelled",
                fallback="Acknowledge cancelling add-customer.",
                user_text=text,
                page_label=page or "Customers",
                context={"cancelled": True},
            ),
            "actions": [{"type": "navigate", "view": "customers"}],
            "route": "customers",
            "customer_draft": None,
        }

    if awaiting == "confirm":
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "customers",
            "customer_draft": customer_draft,
            "current_workflow": "create_customer",
            "current_step": "confirm",
        }

    # missing_fields is SoT; awaiting is only the UI / ask hint.
    from app.workflow_schemas import awaiting_hint_from_missing, missing_fields

    probe = {"name": name, "email": email, "phone": phone}
    miss = missing_fields("create_customer", probe)
    if miss:
        awaiting = awaiting_hint_from_missing("create_customer", probe)
    elif name and email_looks_valid(email) and phone_looks_valid(phone):
        # All required filled this turn — drive confirm_hint via phone block.
        awaiting = "phone"

    def _draft(**extra: Any) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if name:
            out["name"] = name
        if email:
            out["email"] = email
        if phone:
            out["phone"] = phone
        out.update(extra)
        return out

    def _nav(*, step: str, persist: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        action: dict[str, Any] = {"type": "create_customer", "step": step}
        if name:
            action["name"] = name
        if email:
            action["email"] = email
        if phone:
            action["phone"] = phone
        if persist:
            action.update(persist)
        return [{"type": "navigate", "view": "customers"}, action]

    if awaiting == "name":
        if not name:
            bound = bind_awaiting_value("create_customer", "name", text)
            name = str(bound.get("name") or "").strip()
        if len(name) < 2:
            return {
                "handled": True,
                "reply": _phrase(
                    module="customer",
                    kind="validation",
                    fallback="Ask again for the customer full name.",
                    user_text=text,
                    page_label=page or "Customers",
                    context={"nextStep": "customer full name"},
                ),
                "actions": _nav(step="name"),
                "route": "customers",
                "customer_draft": {"awaiting": "name"},
                "current_workflow": "create_customer",
                "current_step": "name",
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="customer",
                kind="got_name",
                fallback=f"Name is {name}. Ask for their email address.",
                user_text=text,
                page_label=page or "Customers",
                context={
                    "customerName": name,
                    "nextStep": "email address",
                },
            ),
            "actions": _nav(step="email"),
            "route": "customers",
            "customer_draft": _draft(awaiting="email"),
            "current_workflow": "create_customer",
            "current_step": "email",
        }

    if awaiting == "email":
        if not email_looks_valid(email):
            bound = bind_awaiting_value("create_customer", "email", text)
            if bound.get("email"):
                email = str(bound.get("email") or email).strip()
            elif not email_looks_valid(email):
                email = str(merged.get("email") or email).strip()
        if not email_looks_valid(email):
            return {
                "handled": True,
                "reply": _phrase(
                    module="customer",
                    kind="validation",
                    fallback="Ask again for a valid email address.",
                    user_text=text,
                    page_label=page or "Customers",
                    context={
                        "customerName": name or None,
                        "nextStep": "email address",
                    },
                ),
                "actions": _nav(step="email"),
                "route": "customers",
                "customer_draft": _draft(awaiting="email"),
                "current_workflow": "create_customer",
                "current_step": "email",
            }
        if not phone_looks_valid(phone):
            return {
                "handled": True,
                "reply": _phrase(
                    module="customer",
                    kind="got_email",
                    fallback=f"Email is {email}. Ask for their phone number.",
                    user_text=text,
                    page_label=page or "Customers",
                    context={
                        "customerName": name,
                        "email": email,
                        "nextStep": "phone number",
                    },
                ),
                "actions": _nav(step="phone"),
                "route": "customers",
                "customer_draft": _draft(awaiting="phone"),
                "current_workflow": "create_customer",
                "current_step": "phone",
            }
        awaiting = "phone"

    if awaiting == "phone":
        if not phone_looks_valid(phone):
            bound = bind_awaiting_value("create_customer", "phone", text)
            if bound.get("phone"):
                phone = str(bound.get("phone") or phone).strip()
            elif not phone_looks_valid(phone):
                phone = str(merged.get("phone") or phone).strip()
        if not phone_looks_valid(phone):
            return {
                "handled": True,
                "reply": _phrase(
                    module="customer",
                    kind="validation",
                    fallback="Ask again for a valid phone number.",
                    user_text=text,
                    page_label=page or "Customers",
                    context={
                        "customerName": name or None,
                        "email": email or None,
                        "nextStep": "phone number",
                    },
                ),
                "actions": _nav(step="phone"),
                "route": "customers",
                "customer_draft": _draft(awaiting="phone"),
                "current_workflow": "create_customer",
                "current_step": "phone",
            }

        if (role or "").strip().lower() != "admin":
            return {
                "handled": True,
                "reply": _phrase(
                    module="nav",
                    kind="forbidden",
                    fallback="Only admins can add customers.",
                    user_text=text,
                    page_label=page,
                    context={"feature": "Customers", "denied": True},
                ),
                "actions": [{"type": "navigate", "view": "customers"}],
                "route": "customers",
                "customer_draft": None,
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="customer",
                kind="confirm_hint",
                fallback=(
                    f"Summarize adding {name} with email {email} and phone {phone}. "
                    "Ask them to go ahead or change a field."
                ),
                user_text=text,
                page_label=page or "Customers",
                context={
                    "customerName": name,
                    "email": email or None,
                    "phone": phone or None,
                    "awaiting": "confirm",
                    "nextStep": "review and tell me to add them, or change a field",
                },
            ),
            "actions": _nav(step="confirm"),
            "route": "customers",
            "customer_draft": _draft(awaiting="confirm"),
            "current_workflow": "create_customer",
            "current_step": "confirm",
        }

    return {
        "handled": True,
        "reply": _phrase(
            module="customer",
            kind="validation",
            fallback="Ask for the next add-customer field.",
            user_text=text,
            page_label=page or "Customers",
            context={"nextStep": "customer full name"},
        ),
        "actions": _nav(step=awaiting or "name"),
        "route": "customers",
        "customer_draft": customer_draft,
    }


# ---- Priority / status catalog (hybrid admin) ----

def continue_priority_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    priority_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Collect priority/status fields → confirm (specialist write tools)."""
    from app.workflow_schemas import (
        bind_awaiting_value,
        merge_workflow_state,
        sanitize_priority_draft_fields,
        usable_catalog_label,
    )

    wf_id = (
        "create_status"
        if str(priority_draft.get("kind") or "").strip().lower() == "status"
        else "create_priority"
    )
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    start = str(priority_draft.get("_intent_start_text") or "").strip()
    merged = merge_workflow_state(
        wf_id, priority_draft, decision.get("fields"), user_text=text
    )
    awaiting = str(priority_draft.get("awaiting") or "").strip().lower()
    if awaiting in ("name", "hours"):
        from app.workflow_schemas import missing_fields as _pri_missing

        slot = "displayName" if awaiting == "name" else "resolutionHours"
        if slot in _pri_missing(wf_id, merged):
            bound = bind_awaiting_value(wf_id, awaiting, text)
            if bound:
                merged = merge_workflow_state(wf_id, merged, bound, user_text=text)
    if start:
        merged["_intent_start_text"] = start
    merged = sanitize_priority_draft_fields(merged)
    if start:
        merged["_intent_start_text"] = start
    kind = str(merged.get("kind") or priority_draft.get("kind") or "priority").strip().lower()
    action = str(decision.get("action") or "").strip().upper()
    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="priority",
                kind="cancelled",
                fallback="Acknowledge cancelling the priorities change.",
                user_text=text,
                page_label=page or "Priorities",
                context={"cancelled": True},
            ),
            "actions": [{"type": "navigate", "view": "priorities"}],
            "route": "general",
            "priority_draft": None,
        }

    if awaiting in {"confirm", "delete_confirm"}:
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "general",
            "priority_draft": priority_draft,
            "current_workflow": wf_id if awaiting == "confirm" else "delete_priority",
            "current_step": awaiting,
        }

    if awaiting == "name" and kind == "status":
        display = usable_catalog_label(
            str(merged.get("displayName") or merged.get("name") or "").strip(),
            start_utterance=start,
            kind="status",
        )
        if len(display) < 2:
            stay = {"awaiting": "name", "kind": "status"}
            if start:
                stay["_intent_start_text"] = start
            return {
                "handled": True,
                "reply": _phrase(
                    module="priority",
                    kind="validation",
                    fallback="Ask for the status display name.",
                    user_text=text,
                    page_label=page or "Priorities",
                    context={"nextStep": "status display name"},
                ),
                "actions": [
                    {"type": "navigate", "view": "priorities"},
                    {"type": "create_status"},
                ],
                "route": "general",
                "priority_draft": stay,
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="priority",
                kind="confirm_hint",
                fallback=f"Summarize creating status {display} and ask them to go ahead or change the name.",
                user_text=text,
                page_label=page or "Priorities",
                context={
                    "displayName": display,
                    "awaiting": "confirm",
                    "nextStep": "review and tell me to save it, or change the name",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "priorities"},
                {"type": "create_status", "displayName": display, "step": "confirm"},
            ],
            "route": "general",
            "priority_draft": {
                "awaiting": "confirm",
                "kind": "status",
                "displayName": display,
                **({"_intent_start_text": start} if start else {}),
            },
            "current_workflow": "create_status",
            "current_step": "confirm",
        }

    if awaiting == "name":
        display = usable_catalog_label(
            str(merged.get("displayName") or merged.get("name") or "").strip(),
            start_utterance=start,
            kind="priority",
        )
        if len(display) < 2:
            stay = {"awaiting": "name", "kind": "priority"}
            if start:
                stay["_intent_start_text"] = start
            return {
                "handled": True,
                "reply": _phrase(
                    module="priority",
                    kind="validation",
                    fallback="Ask for the priority display name.",
                    user_text=text,
                    page_label=page or "Priorities",
                    context={"nextStep": "priority display name"},
                ),
                "actions": [
                    {"type": "navigate", "view": "priorities"},
                    {"type": "create_priority"},
                ],
                "route": "general",
                "priority_draft": stay,
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="priority",
                kind="got_name",
                fallback="Ask for resolution hours.",
                user_text=text,
                page_label=page or "Priorities",
                context={
                    "displayName": display,
                    "nextStep": "resolution hours, e.g. 24",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "priorities"},
                {
                    "type": "create_priority",
                    "displayName": display,
                    "step": "hours",
                },
            ],
            "route": "general",
            "priority_draft": {
                "awaiting": "hours",
                "kind": "priority",
                "displayName": display,
                **({"_intent_start_text": start} if start else {}),
            },
        }

    if awaiting == "hours":
        display = str(
            merged.get("displayName") or priority_draft.get("displayName") or ""
        ).strip()
        hours_val = merged.get("resolutionHours")
        m = None if hours_val in (None, "") else True
        if hours_val in (None, ""):
            m = re.search(r"(\d+(?:\.\d+)?)", text or "")
        if not m:
            return {
                "handled": True,
                "reply": _phrase(
                    module="priority",
                    kind="validation",
                    fallback="Ask for a numeric hours value.",
                    user_text=text,
                    page_label=page or "Priorities",
                    context={
                        "displayName": display,
                        "nextStep": "resolution hours as a number",
                    },
                ),
                "actions": [{"type": "navigate", "view": "priorities"}],
                "route": "general",
                "priority_draft": priority_draft,
            }
        hours = float(hours_val) if hours_val not in (None, "") else float(m.group(1))
        return {
            "handled": True,
            "reply": _phrase(
                module="priority",
                kind="confirm_hint",
                fallback=f"Summarize creating priority {display} at {hours} hours and ask them to go ahead or change a field.",
                user_text=text,
                page_label=page or "Priorities",
                context={
                    "displayName": display,
                    "resolutionHours": hours,
                    "awaiting": "confirm",
                    "nextStep": "review and tell me to save it, or change a field",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "priorities"},
                {
                    "type": "create_priority",
                    "displayName": display,
                    "resolutionHours": hours,
                    "step": "confirm",
                },
            ],
            "route": "general",
            "priority_draft": {
                "awaiting": "confirm",
                "kind": "priority",
                "displayName": display,
                "resolutionHours": hours,
            },
            "current_workflow": "create_priority",
            "current_step": "confirm",
        }

    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "priority_draft": priority_draft,
    }


def start_or_continue_delete_priority_or_status(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    priority_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Delete priority/status by display name (admin)."""
    from app.tools.catalog_tools import list_priorities, list_statuses

    draft = priority_draft if isinstance(priority_draft, dict) else None
    if draft and str(draft.get("awaiting") or "") == "delete_confirm":
        return continue_priority_draft(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            priority_draft=draft,
            semantic_decision=semantic_decision,
        )

    operation = _decision_operation(semantic_decision)
    if operation not in {"DELETE_PRIORITY", "DELETE_STATUS"}:
        return None
    if role != "admin":
        return {
            "handled": True,
            "reply": _phrase(
                module="priority",
                kind="forbidden",
                fallback="Only admins can delete priorities or statuses.",
                user_text=text,
                page_label=page or "Priorities",
                context={"denied": True},
            ),
            "actions": [],
            "route": "general",
            "priority_draft": None,
        }

    kind = "status" if operation == "DELETE_STATUS" else "priority"
    label = _decision_entity_name(semantic_decision)
    actor, scope_fn = _actor_scope(user_id, org, role, user_name)
    rows: list[dict[str, Any]] = []
    if actor.user_id and actor.organization_id:
        try:
            with scope_fn(actor):
                raw = (
                    list_statuses(include_inactive=True)
                    if kind == "status"
                    else list_priorities(include_inactive=True)
                )
            payload = raw.get("payload") if isinstance(raw, dict) else None
            if isinstance(payload, list):
                rows = payload
            elif isinstance(payload, dict):
                rows = list(payload.get("data") or payload.get("items") or [])
        except Exception:  # noqa: BLE001
            rows = []

    needle = label.lower()
    hit = None
    for r in rows:
        if not isinstance(r, dict):
            continue
        dn = str(r.get("displayName") or r.get("label") or r.get("name") or "").strip()
        if dn.lower() == needle or needle in dn.lower():
            hit = r
            break
    if not hit:
        return {
            "handled": True,
            "reply": _phrase(
                module="priority",
                kind="validation",
                fallback=f"No {kind} named {label} found.",
                user_text=text,
                page_label=page or "Priorities",
                context={"error": True, "displayName": label},
            ),
            "actions": [{"type": "navigate", "view": "priorities"}],
            "route": "general",
            "priority_draft": None,
        }

    dn = str(
        hit.get("displayName") or hit.get("label") or hit.get("name") or label
    ).strip()
    pid = str(hit.get("id") or "").strip()
    return {
        "handled": True,
        "reply": _phrase(
            module="priority",
            kind="validation",
            fallback=f"Confirm delete {kind} {dn}.",
            user_text=text,
            page_label=page or "Priorities",
            context={
                "displayName": dn,
                "deleting": True,
                "nextStep": f"whether to permanently delete **{dn}** or keep it",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "priorities"},
            {
                "type": f"delete_{kind}",
                "displayName": dn,
                "id": pid,
                "step": "confirm",
                "kind": kind,
            },
        ],
        "route": "general",
        "priority_draft": {
            "awaiting": "delete_confirm",
            "kind": kind,
            "id": pid,
            "displayName": dn,
        },
    }


# ---- KB category manage (sidebar Manage Categories parity) ----

_KB_MANAGE_START_RE = re.compile(
    r"^(manage\s+categor(y|ies)|add(\s+a|\s+new)?\s+categor(y|ies)|"
    r"new\s+categor(y|ies)|create(\s+a|\s+new)?\s+categor(y|ies))\s*$",
    re.I,
)
_KB_MANAGE_MODE_RE = re.compile(r"^(add|edit|delete|remove|update)\s*$", re.I)


def _is_manage_category_draft(draft: dict[str, Any] | None) -> bool:
    if not isinstance(draft, dict):
        return False
    flow = str(draft.get("flow") or "").strip().lower()
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    return flow == "manage_category" or awaiting in {"category_name", "manage_mode"}


def start_or_continue_kb_category_manage(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    kb_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
    force_start: bool = False,
) -> dict[str, Any] | None:
    """
    Idle KB: manage / add category → ask for label → manage_kb_category tool.
    Does not start create-article. Mid create-article still uses continue_kb_draft.
    """
    from app.tools.catalog_tools import list_kb_categories, manage_kb_category

    del semantic_decision  # reserved for future field binds
    raw = (text or "").strip()
    lower = raw.lower().rstrip("!?.")
    draft = kb_draft if isinstance(kb_draft, dict) else None
    managing = _is_manage_category_draft(draft)
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower() if managing else ""

    # Never steal create-article category step (title/category/body).
    if (
        isinstance(draft, dict)
        and not managing
        and str(draft.get("awaiting") or "").strip().lower()
        in {"title", "category", "body", "confirm"}
    ):
        return None

    if role in ("resolver", "viewer", "customer"):
        if force_start or managing or _KB_MANAGE_START_RE.match(lower):
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="forbidden",
                    fallback="This role cannot manage KB categories.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"denied": True, "feature": "KB categories"},
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "kb_draft": None,
            }
        return None

    live_cats = _live_kb_categories(
        org=org, user_id=user_id, role=role, user_name=user_name
    )

    def _ask_name(*, mode: str = "add") -> dict[str, Any]:
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="ask_custom_category",
                fallback="Ask them to type the new category name.",
                user_text=text,
                page_label=page or "Knowledge Base",
                context={
                    "categories": live_cats,
                    "nextStep": "category name",
                    "manageCategory": True,
                },
            ),
            "actions": [
                {"type": "navigate", "view": "kb"},
                {"type": "add_kb_category", "prompt": True},
            ],
            "route": "kb",
            "kb_draft": {
                "flow": "manage_category",
                "awaiting": "category_name",
                "mode": mode,
            },
            "current_workflow": "manage_kb_category",
            "current_step": "category_name",
        }

    def _list_and_offer() -> dict[str, Any]:
        listed = list_kb_categories()
        cats = live_cats
        if listed.get("success"):
            payload = listed.get("payload") if isinstance(listed.get("payload"), dict) else {}
            rows = payload.get("categories") if isinstance(payload.get("categories"), list) else []
            if rows:
                cats = [str(c).strip() for c in rows if str(c).strip()]
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="list_categories",
                fallback=(
                    "List the categories and ask whether to add, edit, or delete one."
                ),
                user_text=text,
                page_label=page or "Knowledge Base",
                context={
                    "categories": cats,
                    "nextStep": "add, edit, or delete a category",
                    "manageCategory": True,
                },
            ),
            "actions": [
                {"type": "navigate", "view": "kb"},
                {"type": "add_kb_category", "prompt": True},
            ],
            "route": "kb",
            "kb_draft": {
                "flow": "manage_category",
                "awaiting": "manage_mode",
            },
            "current_workflow": "manage_kb_category",
            "current_step": "manage_mode",
            "data": {
                "success": True,
                "_tool_name": "list_kb_categories",
                "last_query": {
                    "entity": "kb",
                    "operation": "MANAGE_CATEGORY",
                    "pending": {"awaiting": "manage_mode"},
                },
            },
        }

    if awaiting == "category_name":
        if re.search(r"\b(cancel|never\s*mind|stop)\b", lower):
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="cancelled",
                    fallback="Acknowledge cancelling category manage.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"cancelled": True},
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "kb_draft": None,
                "current_workflow": None,
                "current_step": None,
            }
        if _KB_MANAGE_MODE_RE.match(lower):
            return _ask_name(mode=lower if lower in {"add", "edit", "delete"} else "add")
        if _KB_MANAGE_START_RE.match(lower) or lower in {"list", "show", "options"}:
            return _list_and_offer()
        # Reject create-article / long body paste as a category name.
        if len(raw) > 64 or "\n" in raw:
            return _ask_name(mode=str((draft or {}).get("mode") or "add"))
        label = raw.strip().strip("\"'")
        if len(label) < 2:
            return _ask_name(mode=str((draft or {}).get("mode") or "add"))
        # Avoid treating bare workflow words as labels.
        if label.lower() in {"article", "articles", "kb", "knowledge", "priority", "priorities"}:
            return _ask_name(mode=str((draft or {}).get("mode") or "add"))
        hit = manage_kb_category(name=label, mode="add")
        if not hit.get("success"):
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback="Could not add that category; ask them to try another name.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"error": hit.get("message") or hit.get("error_code")},
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "kb_draft": {
                    "flow": "manage_category",
                    "awaiting": "category_name",
                    "mode": "add",
                },
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="created",
                fallback=f"Confirm category {label} is available in KB filters.",
                user_text=text,
                page_label=page or "Knowledge Base",
                context={"category": label, "added": True, "manageCategory": True},
            ),
            "actions": [
                {"type": "navigate", "view": "kb"},
                {"type": "add_kb_category", "category": label},
            ],
            "route": "kb",
            "kb_draft": None,
            "current_workflow": None,
            "current_step": None,
            "data": {
                "success": True,
                "_tool_name": "manage_kb_category",
                "payload": (hit.get("payload") if isinstance(hit.get("payload"), dict) else {}),
            },
        }

    if awaiting == "manage_mode":
        if re.search(r"\b(cancel|never\s*mind|stop)\b", lower):
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="cancelled",
                    fallback="Acknowledge cancelling category manage.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"cancelled": True},
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "kb_draft": None,
                "current_workflow": None,
                "current_step": None,
            }
        if lower in {"add", "create", "new"} or "add" in lower and "categor" in lower:
            return _ask_name(mode="add")
        if lower in {"edit", "update", "rename"}:
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback=(
                        "Explain categories rename by updating articles; "
                        "offer to add a new category label instead."
                    ),
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"categories": live_cats, "manageCategory": True},
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "kb_draft": {
                    "flow": "manage_category",
                    "awaiting": "manage_mode",
                },
            }
        if lower in {"delete", "remove"}:
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback=(
                        "Explain unused labels drop from filters when unused; "
                        "offer to add a category instead."
                    ),
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"categories": live_cats, "manageCategory": True},
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "kb_draft": {
                    "flow": "manage_category",
                    "awaiting": "manage_mode",
                },
            }
        # They typed a name directly after the list.
        if len(raw) >= 2 and len(raw) <= 64 and "\n" not in raw:
            return start_or_continue_kb_category_manage(
                text,
                org=org,
                role=role,
                user_id=user_id,
                user_name=user_name,
                page=page,
                kb_draft={
                    "flow": "manage_category",
                    "awaiting": "category_name",
                    "mode": "add",
                },
                force_start=True,
            )
        return _list_and_offer()

    if force_start or _KB_MANAGE_START_RE.match(lower):
        if re.search(r"\b(add|new|create)\b", lower) and "manage" not in lower:
            return _ask_name(mode="add")
        return _list_and_offer()

    # Bare "add" only when we already know this is category manage (force/draft).
    if _KB_MANAGE_MODE_RE.match(lower) and force_start:
        return _ask_name(mode=lower if lower in {"add", "edit", "delete"} else "add")

    return None


# ---- KB article guided create ----


def continue_kb_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    kb_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """title → category → body → confirm (specialist create_kb_article)."""
    if _is_manage_category_draft(kb_draft):
        hit = start_or_continue_kb_category_manage(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            kb_draft=kb_draft,
            semantic_decision=semantic_decision,
            force_start=True,
        )
        if hit:
            return hit
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        bind_awaiting_value,
        bind_primary_missing,
        merge_workflow_state,
        missing_fields,
        mark_kb_intent_start,
        sanitize_kb_draft_fields,
        usable_kb_title,
    )

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    kb_draft = sanitize_kb_draft_fields(kb_draft)
    start_awaiting = str(kb_draft.get("awaiting") or "").strip().lower()
    awaiting = start_awaiting
    start_kb = str(kb_draft.get("_intent_start_text") or "").strip()
    title_now = str(kb_draft.get("title") or kb_draft.get("name") or "").strip()
    body_now = str(kb_draft.get("body") or kb_draft.get("content") or "").strip()
    if start_awaiting == "title" and not start_kb and not title_now and not body_now:
        from app.workflow_schemas import utterance_is_kb_create_start

        if utterance_is_kb_create_start(text):
            kb_draft = mark_kb_intent_start(kb_draft, text)
            start_kb = str(kb_draft.get("_intent_start_text") or "").strip()
    extracted = (
        dict(decision.get("fields") or {})
        if isinstance(decision.get("fields"), dict)
        else {}
    )
    # Before binding: "add new category" / list asks stay on the category step.
    # Long paste while awaiting category is article body provided early.
    if start_awaiting == "category":
        title_early = str(kb_draft.get("title") or "").strip()
        body_early = str(kb_draft.get("body") or "").strip()
        live_cats = _live_kb_categories(
            org=org, user_id=user_id, role=role, user_name=user_name
        )
        looks_like_body = len((text or "").strip()) > 64 or "\n" in (text or "")
        if looks_like_body and not body_early:
            body_early = (text or "").strip()
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="got_body_need_category",
                    fallback=(
                        "Saved the article details; ask which category it belongs to."
                    ),
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title_early,
                        "categories": live_cats,
                        "nextStep": _kb_category_next_step(live_cats),
                        "bodyReady": True,
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    {
                        "type": "create_kb",
                        "title": title_early,
                        "body": body_early,
                        "step": "category",
                    },
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {
                    "awaiting": "category",
                    "title": title_early,
                    "body": body_early,
                },
            }
        _cat, _st = _parse_kb_category(text, live_cats)
        if _st in {"ask_custom", "list"}:
            draft_cat: dict[str, Any] = {
                "awaiting": "category",
                "title": title_early,
            }
            if body_early:
                draft_cat["body"] = body_early
            create_action: dict[str, Any] = {
                "type": "create_kb",
                "title": title_early,
                "step": "category",
            }
            if body_early:
                create_action["body"] = body_early
            if _st == "ask_custom":
                return {
                    "handled": True,
                    "reply": _phrase(
                        module="kb",
                        kind="ask_custom_category",
                        fallback="Ask them to type the category name they want.",
                        user_text=text,
                        page_label=page or "Knowledge Base",
                        context={
                            "title": title_early,
                            "categories": live_cats,
                            "nextStep": "article category name",
                        },
                    ),
                    "actions": [
                        {"type": "navigate", "view": "kb"},
                        create_action,
                    ],
                    "route": "kb",
                    "escalate_draft": None,
                    "macro_draft": None,
                    "team_draft": None,
                    "kb_draft": draft_cat,
                }
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="list_categories",
                    fallback=(
                        "List the available article categories and ask them to pick one."
                    ),
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title_early,
                        "categories": live_cats,
                        "nextStep": _kb_category_next_step(live_cats),
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    create_action,
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": draft_cat,
            }
    prior_miss = missing_fields("create_kb", kb_draft)
    # Category answers are parsed explicitly — do not blind-bind the utterance
    # (e.g. "category is help" must not become the literal category string).
    merge_user_text = None if awaiting in ("confirm", "category") else text
    if start_kb and (text or "").strip().rstrip("!?. ").lower() == start_kb.strip().rstrip("!?. ").lower():
        merge_user_text = None
    merged = merge_workflow_state(
        "create_kb",
        kb_draft,
        extracted,
        user_text=merge_user_text,
    )
    # Start commands / invented "New Article" are not titles. Titled extract is LLM.
    extracted_title_from_command = False
    start_kb = str(merged.get("_intent_start_text") or kb_draft.get("_intent_start_text") or "").strip()
    if start_kb:
        merged["_intent_start_text"] = start_kb
    if not usable_kb_title(str(merged.get("title") or ""), start_utterance=start_kb):
        merged = sanitize_kb_draft_fields(merged)
        if start_kb:
            merged["_intent_start_text"] = start_kb
    # missing_fields is SoT — never blind-bind into a filled title via stale awaiting.
    if awaiting not in ("confirm", "delete_confirm", "category"):
        miss_now = missing_fields("create_kb", merged)
        if miss_now:
            bound: dict[str, Any] = {}
            if awaiting in miss_now:
                same_start = bool(
                    start_kb
                    and (text or "").strip().rstrip("!?. ").lower()
                    == start_kb.strip().rstrip("!?. ").lower()
                )
                bound = {} if same_start else bind_awaiting_value(
                    "create_kb", awaiting, text
                )
            elif not extracted and not extracted_title_from_command:
                bound = bind_primary_missing("create_kb", merged, text)
            if bound:
                merged = merge_workflow_state(
                    "create_kb", merged, bound, user_text=text
                )
            awaiting = awaiting_hint_from_missing("create_kb", merged)
        else:
            awaiting = "confirm"
    elif awaiting == "category":
        # Keep awaiting on category until _parse_kb_category accepts a label.
        awaiting = "category"
    title = usable_kb_title(
        str(merged.get("title") or kb_draft.get("title") or ""),
        start_utterance=start_kb,
    )
    if title:
        merged["title"] = title
    else:
        awaiting = "title"
    category = str(merged.get("category") or kb_draft.get("category") or "").strip()
    body = str(merged.get("body") or kb_draft.get("body") or "").strip()
    # Title just filled this turn → ask category; do not re-parse the title
    # utterance as a category name.
    if (
        "title" in prior_miss
        and title
        and not category
        and "category" in missing_fields("create_kb", merged)
    ):
        awaiting = "title"
    action = str(decision.get("action") or "").strip().upper()

    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="cancelled",
                fallback="Acknowledge cancelling KB article create.",
                user_text=text,
                page_label=page or "Knowledge Base",
                context={"cancelled": True},
            ),
            "actions": [{"type": "navigate", "view": "kb"}],
            "route": "kb",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": None,
        }

    if awaiting == "title":
        if len(title) < 2:
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback="Ask again for an article title.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={"nextStep": "article title"},
                ),
                "actions": [{"type": "navigate", "view": "kb"}, {"type": "create_kb"}],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {"awaiting": "title"},
            }
        live_cats = _live_kb_categories(
            org=org, user_id=user_id, role=role, user_name=user_name
        )
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="got_title",
                fallback=f"Title is {title}; ask for category.",
                user_text=text,
                page_label=page or "Knowledge Base",
                context={
                    "title": title,
                    "categories": live_cats,
                    "nextStep": _kb_category_next_step(live_cats),
                },
            ),
            "actions": [
                {"type": "navigate", "view": "kb"},
                {"type": "create_kb", "title": title, "step": "category"},
            ],
            "route": "kb",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": {"awaiting": "category", "title": title},
        }

    if awaiting == "category":
        live_cats = _live_kb_categories(
            org=org, user_id=user_id, role=role, user_name=user_name
        )
        category, status = _parse_kb_category(text, live_cats)
        if status == "ask_custom":
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="ask_custom_category",
                    fallback="Ask them to type the category name they want.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title,
                        "categories": live_cats,
                        "nextStep": "article category name",
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    {"type": "create_kb", "title": title, "step": "category"},
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {"awaiting": "category", "title": title},
            }
        if status == "list":
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="list_categories",
                    fallback=(
                        "List the available article categories and ask them to pick one."
                    ),
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title,
                        "categories": live_cats,
                        "nextStep": _kb_category_next_step(live_cats),
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    {"type": "create_kb", "title": title, "step": "category"},
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {"awaiting": "category", "title": title},
            }
        if not category or status != "ok":
            create_keep: dict[str, Any] = {
                "type": "create_kb",
                "title": title,
                "step": "category",
            }
            draft_keep: dict[str, Any] = {"awaiting": "category", "title": title}
            if body:
                create_keep["body"] = body
                draft_keep["body"] = body
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback="Ask again for a short category name (or say new category).",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title,
                        "categories": live_cats,
                        "nextStep": _kb_category_next_step(live_cats),
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    create_keep,
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": draft_keep,
            }
        if body:
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="got_body",
                    fallback=f"Category {category}; ask confirm to publish.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title,
                        "category": category,
                        "nextStep": "confirm publish",
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    {
                        "type": "create_kb",
                        "title": title,
                        "category": category,
                        "body": body,
                        "step": "confirm",
                    },
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {
                    "awaiting": "confirm",
                    "title": title,
                    "category": category,
                    "body": body,
                },
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="got_category",
                fallback=f"Category {category}; ask for article body.",
                user_text=text,
                page_label=page or "Knowledge Base",
                context={
                    "title": title,
                    "category": category,
                    "nextStep": "article content",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "kb"},
                {
                    "type": "create_kb",
                    "title": title,
                    "category": category,
                    "step": "body",
                },
            ],
            "route": "kb",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": {
                "awaiting": "body",
                "title": title,
                "category": category,
            },
        }

    if awaiting == "body":
        if len(body) < 10:
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback="Ask for longer article content (10+ chars).",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title,
                        "nextStep": "article content",
                    },
                ),
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    {
                        "type": "create_kb",
                        "title": title,
                        "category": category,
                        "step": "body",
                    },
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {
                    "awaiting": "body",
                    "title": title,
                    "category": category,
                },
            }
        return {
            "handled": True,
            "reply": _phrase(
                module="kb",
                kind="got_body",
                fallback=f"Body ready for {title}; ask confirm to publish.",
                user_text=text,
                page_label=page or "Knowledge Base",
                context={
                    "title": title,
                    "category": category,
                    "bodyPreview": body[:80],
                    "nextStep": "confirm or cancel",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "kb"},
                {
                    "type": "create_kb",
                    "title": title,
                    "category": category,
                    "body": body,
                    "step": "confirm",
                },
            ],
            "route": "kb",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": {
                "awaiting": "confirm",
                "title": title,
                "category": category,
                "body": body,
            },
        }

    if awaiting == "confirm":
        if not category:
            fields = (
                decision.get("fields")
                if isinstance(decision.get("fields"), dict)
                else {}
            )
            category = str(fields.get("category") or "").strip()
        missing = [
            name
            for name, val, need in (
                ("title", title, 2),
                ("category", category, 1),
                ("body", body, 10),
            )
            if len(val) < need
        ]
        if missing:
            return {
                "handled": True,
                "reply": _phrase(
                    module="kb",
                    kind="validation",
                    fallback="Ask only for the missing article fields.",
                    user_text=text,
                    page_label=page or "Knowledge Base",
                    context={
                        "title": title or None,
                        "category": category or None,
                        "hasBody": bool(body),
                        "missing": missing,
                        "nextStep": missing[0],
                    },
                ),
                "actions": [{"type": "navigate", "view": "kb"}],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {
                    "awaiting": "confirm",
                    "title": title,
                    "category": category,
                    "body": body,
                },
            }
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "kb",
            "kb_draft": {
                "awaiting": "confirm",
                "title": title,
                "category": category,
                "body": body,
            },
            "current_workflow": "create_kb",
            "current_step": "confirm",
        }

    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "escalate_draft": None,
        "macro_draft": None,
        "team_draft": None,
        "kb_draft": kb_draft,
    }


def try_settings_and_prefs_command(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
) -> dict[str, Any] | None:
    """Phase 4: non-secret prefs/notifications tools; secrets → navigate only."""
    lower = text.strip().lower()

    # Secrets — UI only (do not steal KB/howto phrases like "password reset")
    secret_password = bool(
        re.search(
            r"\b(change|update)\s+(my\s+)?password\b"
            r"|\b(reset)\s+(my\s+)?password\b"
            r"|\bpassword\s+(change|update)\b"
            r"|\b(my\s+)?password\s+is\b",
            lower,
        )
    ) and not re.search(r"\b(kb|knowledge|article|ticket|howto|how\s+to|search)\b", lower)
    if secret_password or re.search(
        r"\b(revoke\s+all\s+sessions|deactivate\s+account|delete\s+(my\s+)?data|api\s+keys?)\b",
        lower,
    ):
        feature = "password" if secret_password else "sessions"
        if "session" in lower:
            feature = "sessions"
        elif "deactivat" in lower:
            feature = "deactivate"
        elif "delete" in lower and "data" in lower:
            feature = "delete-data"
        elif "api" in lower and "key" in lower:
            feature = "api-keys"
        return {
            "handled": True,
            "reply": _phrase(
                module="nav",
                kind="filter",
                fallback=(
                    f"Intent: {feature} is UI-only for security; open Settings / Account "
                    "and complete it there — do not collect secrets in chat."
                ),
                user_text=text,
                page_label=page or "Settings",
                context={
                    "feature": feature,
                    "uiOnly": True,
                    "nextStep": "finish in Settings / Account",
                },
            ),
            "actions": [{"type": "navigate", "view": "settings"}],
            "route": "general",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": None,
        }

    if re.search(r"\b(mark\s+all\s+(notifications?\s+)?read|clear\s+notifications?)\b", lower):
        actor, scope_fn = _actor_scope(user_id, org, role, user_name)
        from app.tools.catalog_tools import mark_all_notifications_read

        if not actor.user_id:
            return {
                "handled": True,
                "reply": _phrase(
                    module="nav",
                    kind="validation",
                    fallback="Cannot mark notifications without sign-in context.",
                    user_text=text,
                    page_label=page,
                    context={"authRequired": False},
                ),
                "actions": [],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": None,
            }
        with scope_fn(actor):
            result = mark_all_notifications_read()
        ok = bool(result.get("success"))
        return {
            "handled": True,
            "reply": _phrase(
                module="nav",
                kind="filter",
                fallback=(
                    "All notifications marked read."
                    if ok
                    else str(result.get("message") or "Could not update notifications")
                ),
                user_text=text,
                page_label=page,
                context={"notifications": "read-all", "ok": ok},
            ),
            "actions": [],
            "route": "general",
            "escalate_draft": None,
            "macro_draft": None,
            "team_draft": None,
            "kb_draft": None,
        }

    return None


def try_recent_activity_command(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
) -> dict[str, Any] | None:
    """Retired: Home activity is NLU GET_METRICS + list_activities."""
    return None


def try_metrics_command(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
) -> dict[str, Any] | None:
    """Retired: CSAT/macros/metrics go through NLU specialists."""
    return None
