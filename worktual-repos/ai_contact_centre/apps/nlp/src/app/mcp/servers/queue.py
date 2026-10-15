"""Queue MCP server with idempotent mutations."""

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

QueueDraftField = Literal[
    "name",
    "team",
    "description",
    "status",
    "businessHours",
    "shifts",
    "staffing",
    "staffingMode",
    "shiftAgents",
    "agentChannels",
    "addAnotherAgent",
    "channels",
    "review",
]
QueueDraftMode = Literal["create"]

from app.mcp.agent_presence import annotate_presence_agents
from app.mcp.context import (
    CcCoreError,
    CcCoreHTTPAdapter,
    execute_once,
    get_tool_context,
)


def _normalize_queue_status(value: str | None) -> Literal["active", "inactive"] | None:
    if not value:
        return None
    normalized = value.strip().casefold()
    if not normalized:
        return None
    if normalized in {"active", "enabled", "on", "live"}:
        return "active"
    if normalized in {"inactive", "disabled", "off", "paused", "wait", "later", "hold"}:
        return "inactive"
    if normalized.startswith("inact") or "inactive" in normalized or "paused" in normalized:
        return "inactive"
    if normalized.startswith("act") or "active" in normalized:
        return "active"

    def levenshtein(a: str, b: str) -> int:
        rows = [[index for index in range(len(b) + 1)] for _ in range(len(a) + 1)]
        for i in range(1, len(a) + 1):
            for j in range(1, len(b) + 1):
                cost = 0 if a[i - 1] == b[j - 1] else 1
                rows[i][j] = min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
        return rows[len(a)][len(b)]

    inactive_distance = levenshtein(normalized, "inactive")
    active_distance = levenshtein(normalized, "active")
    if inactive_distance <= 2 and inactive_distance < active_distance:
        return "inactive"
    if active_distance <= 2 and active_distance <= inactive_distance:
        return "active"
    return None


def _format_team_choice(team: dict[str, Any]) -> str:
    name = str(team.get("name", "Unnamed"))
    status = str(team.get("status", "active"))
    if status and status != "active":
        return f"{name} ({status})"
    return name


def _format_schedule_choice(schedule: dict[str, Any]) -> str:
    name = str(schedule.get("name", "Unnamed"))
    open_time = schedule.get("openTime")
    close_time = schedule.get("closeTime")
    timezone = str(schedule.get("timezone") or "").strip()
    working_days = schedule.get("workingDays") or []
    if open_time and close_time:
        hours = f"{open_time}–{close_time}"
        if timezone:
            hours = f"{hours} {timezone}"
    elif timezone:
        hours = timezone
    else:
        hours = "Always open"
    if working_days:
        days = ", ".join(str(day) for day in working_days[:4])
        if len(working_days) > 4:
            days = f"{days}, …"
        return f"{name} — {hours} ({days})"
    return f"{name} — {hours}"


GENERIC_SHIFT_TYPES = ("Regular", "Morning", "Afternoon", "Evening", "Night", "Custom")
STAFFING_FIELDS = {
    "staffing",
    "staffingMode",
    "shiftAgents",
    "agentChannels",
    "addAnotherAgent",
    "channels",
}
SHIFT_OR_LATER_FIELDS = {"shifts", "review", *STAFFING_FIELDS}


def _normalize_shift_key(value: str) -> str | None:
    normalized = value.strip().casefold()
    for shift in GENERIC_SHIFT_TYPES:
        if shift.casefold() == normalized:
            return shift
    return None


def _normalize_shift_types(values: list[str] | None) -> list[str]:
    seen: list[str] = []
    for raw in values or []:
        key = _normalize_shift_key(str(raw))
        if key and key not in seen:
            seen.append(key)
    return seen


def _queue_shift_names(
    detail: dict[str, Any],
    requested: list[str],
    assigned: list[dict[str, Any]],
) -> list[str]:
    """Shifts a new agent may join. Never invents Regular."""
    if requested:
        return list(requested)
    raw = detail.get("shiftTypes")
    if isinstance(raw, list):
        names: list[str] = []
        for item in raw:
            text = str(item).strip()
            if text and text not in names:
                names.append(text)
        if names:
            return names
    names = []
    for agent in assigned:
        text = str(agent.get("shiftType") or "").strip()
        if text and text not in names:
            names.append(text)
    return names


def _match_queue_shift(value: str, allowed: list[str]) -> str | None:
    raw = value.strip()
    if not raw:
        return None
    folded = raw.casefold()
    for shift in allowed:
        if shift.casefold() == folded:
            return shift
    canonical = _normalize_shift_key(raw)
    if not canonical:
        return None
    for shift in allowed:
        if shift.casefold() == canonical.casefold():
            return shift
    return None


def _require_add_shift(name: str, raw_shift: str, allowed: list[str]) -> str:
    if not allowed:
        raise CcCoreError(
            f"{name} was not added. This queue has no shifts. "
            "Set the queue shifts before adding an agent."
        )
    choices = ", ".join(allowed)
    matched = _match_queue_shift(raw_shift, allowed)
    if matched:
        return matched
    if raw_shift.strip():
        raise CcCoreError(
            f'{name} was not added. "{raw_shift.strip()}" is not a shift on this queue. '
            f"Choose one of: {choices}."
        )
    raise CcCoreError(f"{name} was not added. Choose a shift: {choices}.")


def _shift_types_from_schedule(schedule: dict[str, Any] | None) -> list[str]:
    if not schedule:
        return []
    seen: list[str] = []
    for shift in schedule.get("shifts") or []:
        if not isinstance(shift, dict):
            continue
        raw = shift.get("shiftType") or shift.get("shift_type")
        if not raw:
            continue
        key = _normalize_shift_key(str(raw))
        if key and key not in seen:
            seen.append(key)
    return seen


def _find_schedule(
    schedules: list[dict[str, Any]],
    *,
    hours_id: str | None,
    hours_name: str | None,
) -> dict[str, Any] | None:
    if hours_id:
        match = next((item for item in schedules if str(item.get("id")) == str(hours_id)), None)
        if match is not None:
            return match
    if hours_name:
        normalized = hours_name.strip().casefold()
        exact = next(
            (item for item in schedules if str(item.get("name", "")).casefold() == normalized),
            None,
        )
        if exact is not None:
            return exact
        return next(
            (
                item
                for item in schedules
                if normalized in str(item.get("name", "")).casefold()
            ),
            None,
        )
    return None


def _agent_display_name(agent: dict[str, Any]) -> str:
    existing = str(agent.get("name") or "").strip()
    if existing:
        return existing
    parts = [str(agent.get("firstName") or "").strip(), str(agent.get("lastName") or "").strip()]
    joined = " ".join(part for part in parts if part)
    return joined or str(agent.get("workEmail") or "Agent")


def _agent_choice_label(agent: dict[str, Any]) -> str:
    name = str(agent.get("name") or _agent_display_name(agent))
    queue_name = str(agent.get("currentQueueName") or "").strip()
    if not queue_name:
        return name
    status = str(agent.get("currentQueueStatus") or "").strip()
    suffix = f"on {queue_name}"
    if status:
        suffix = f"{suffix}, {status}"
    return f"{name} ({suffix})"


CHANNEL_HANDLE_ALIASES = {
    "calls": "handlesCalls",
    "call": "handlesCalls",
    "voice": "handlesCalls",
    "email": "handlesEmail",
    "chat": "handlesChat",
    "whatsapp": "handlesWhatsapp",
    "instagram": "handlesInstagram",
    "facebook": "handlesFacebook",
}


def _channels_to_handles(channels: list[str] | None) -> dict[str, bool]:
    handles = {
        "handlesCalls": False,
        "handlesEmail": False,
        "handlesChat": False,
        "handlesWhatsapp": False,
        "handlesInstagram": False,
        "handlesFacebook": False,
    }
    normalized = [str(item).strip().casefold() for item in (channels or []) if str(item).strip()]
    if not normalized or "all" in normalized:
        return {key: True for key in handles}
    for channel in normalized:
        key = CHANNEL_HANDLE_ALIASES.get(channel)
        if key:
            handles[key] = True
    if not any(handles.values()):
        return {key: True for key in handles}
    return handles


def _usable_user_id(value: str | None, fallback_name: str | None = None) -> str | None:
    candidate = str(value or "").strip()
    if not candidate or " " in candidate:
        return None
    if fallback_name and candidate.casefold() == fallback_name.strip().casefold():
        return None
    return candidate


def _agent_row_from_channels(
    user_id: str,
    shift: str,
    channels: list[str] | None,
) -> dict[str, Any]:
    return {
        "userId": user_id,
        "shiftType": shift,
        **_channels_to_handles(channels),
        "chatConcurrency": 1,
        "emailConcurrency": 1,
        "socialConcurrency": 1,
        "whatsappConcurrency": 1,
        "instagramConcurrency": 1,
        "facebookConcurrency": 1,
        "callType": "both",
    }


def _agents_from_assignments(assignments: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not assignments:
        return []
    agents: list[dict[str, Any]] = []
    for raw_shift, raw_value in assignments.items():
        shift = _normalize_shift_key(str(raw_shift))
        if not shift or not isinstance(raw_value, dict):
            continue
        ids = [str(item) for item in (raw_value.get("agentIds") or []) if item]
        names = [str(item) for item in (raw_value.get("agentNames") or []) if item]
        channel_map = raw_value.get("channelByAgentId")
        if not isinstance(channel_map, dict):
            channel_map = {}
        for index, raw_id in enumerate(ids):
            name = names[index] if index < len(names) else None
            user_id = _usable_user_id(raw_id, name)
            if not user_id:
                continue
            channels = channel_map.get(user_id) or channel_map.get(name or "")
            agents.append(
                _agent_row_from_channels(
                    user_id,
                    shift,
                    channels if isinstance(channels, list) else None,
                )
            )
    return agents


def _staged_queue_fields() -> dict[str, Any]:
    staged = get_tool_context().queue_draft
    if not isinstance(staged, dict):
        return {}
    fields = staged.get("fields")
    return dict(fields) if isinstance(fields, dict) else {}


def _merge_assignment_maps(
    base: dict[str, Any] | None,
    incoming: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not incoming:
        return base
    if not base:
        return incoming
    merged = dict(base)
    for shift, row in incoming.items():
        if not isinstance(row, dict):
            continue
        if not row.get("agentIds") and not row.get("agentNames") and not row.get("agents"):
            continue
        merged[str(shift)] = row
    return merged


def _merge_queue_fields(incoming: dict[str, Any], staged: dict[str, Any]) -> dict[str, Any]:
    merged = dict(staged)
    for key, value in incoming.items():
        if value is None:
            continue
        if key == "shiftAgentAssignments":
            if isinstance(value, dict) and value:
                current = merged.get(key)
                merged[key] = _merge_assignment_maps(
                    current if isinstance(current, dict) else {},
                    value,
                )
            continue
        merged[key] = value
    return merged


_QUEUE_FIELD_RANK = {
    "name": 0,
    "team": 1,
    "description": 2,
    "status": 3,
    "businessHours": 4,
    "shifts": 5,
    "staffing": 6,
    "staffingMode": 6,
    "shiftAgents": 6,
    "agentChannels": 6,
    "addAnotherAgent": 6,
    "channels": 6,
    "review": 7,
}

_QUEUE_FIELD_QUESTIONS = {
    "name": "What should we name this queue?",
    "team": "Which team owns this queue?",
    "description": "Want to add a short description?",
    "status": "Should this queue be active or inactive?",
    "businessHours": "Which schedule should we use for this queue?",
    "shifts": "Which shifts should this queue cover?",
    "staffing": "Add people to each shift and choose their channels, then click Done staffing.",
    "review": "Create this queue now?",
}


def _queue_has_name(fields: dict[str, Any]) -> bool:
    return bool(str(fields.get("name") or "").strip())


def _queue_has_team(fields: dict[str, Any]) -> bool:
    return bool(str(fields.get("teamName") or fields.get("teamId") or "").strip())


def _queue_has_status(fields: dict[str, Any]) -> bool:
    return fields.get("status") in {"active", "inactive"}


def _queue_staffing_done(fields: dict[str, Any]) -> bool:
    return bool(fields.get("staffingComplete") or fields.get("staffingSkipped"))


def _queue_has_shift_types(fields: dict[str, Any]) -> bool:
    shift_types = fields.get("shiftTypes")
    return bool(isinstance(shift_types, list) and any(str(item).strip() for item in shift_types))


def _first_incomplete_queue_field(fields: dict[str, Any], hours_resolved: bool) -> str | None:
    if not _queue_has_name(fields):
        return "name"
    if not _queue_has_team(fields):
        return "team"
    if not _queue_has_status(fields):
        return "status"
    if not hours_resolved:
        return "businessHours"
    if not _queue_staffing_done(fields):
        if not _queue_has_shift_types(fields) and fields.get("businessHoursSkipped"):
            return "shifts"
        return "staffing"
    return None


def _queue_field_satisfied(
    field: str | None,
    fields: dict[str, Any],
    hours_resolved: bool,
) -> bool:
    if field in {None, "review"}:
        return _first_incomplete_queue_field(fields, hours_resolved) is None
    if field == "name":
        return _queue_has_name(fields)
    if field == "team":
        return _queue_has_team(fields)
    if field == "description":
        return "description" in fields
    if field == "status":
        return _queue_has_status(fields)
    if field == "businessHours":
        return hours_resolved
    if field == "shifts":
        return _queue_has_shift_types(fields)
    if field in STAFFING_FIELDS:
        return _queue_staffing_done(fields)
    return False


def _snap_queue_next_field(
    fields: dict[str, Any],
    next_field: str | None,
    hours_resolved: bool,
) -> str:
    canonical = _first_incomplete_queue_field(fields, hours_resolved) or "review"
    if next_field is None:
        return canonical
    if _queue_field_satisfied(next_field, fields, hours_resolved):
        return canonical
    if _QUEUE_FIELD_RANK.get(next_field, 7) > _QUEUE_FIELD_RANK.get(canonical, 7):
        return canonical
    return next_field


def _queue_draft_ready(fields: dict[str, Any], next_field: str | None) -> bool:
    return (
        _first_incomplete_queue_field(fields, hours_resolved=True) is None
        and next_field == "review"
    )


def _ready_queue_create_at_turn_start() -> bool:
    draft = get_tool_context().queue_draft_at_turn_start
    if not isinstance(draft, dict):
        return False
    if draft.get("persistedQueueId"):
        return False
    if draft.get("ready"):
        return True
    fields = draft.get("fields")
    return _queue_draft_ready(
        fields if isinstance(fields, dict) else {},
        draft.get("nextField") if isinstance(draft.get("nextField"), str) else None,
    )


def _as_entity_id(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text.isdigit() else None


def _assignments_have_numeric_ids(assignments: dict[str, Any] | None) -> bool:
    if not isinstance(assignments, dict) or not assignments:
        return False
    found = False
    for raw_value in assignments.values():
        if not isinstance(raw_value, dict):
            continue
        ids = raw_value.get("agentIds") or []
        if not isinstance(ids, list):
            return False
        if not ids:
            continue
        found = True
        for item in ids:
            if not _as_entity_id(item):
                return False
    return found


def _as_shift_type_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]
        return parts or None
    if isinstance(value, list):
        parts = [str(item).strip() for item in value if str(item).strip()]
        return parts or None
    return None


def _as_assignment_map(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _as_agent_rows(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list):
        return None
    rows = [item for item in value if isinstance(item, dict)]
    return rows or None


def _first_present(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (list, dict)) and not value:
            continue
        return value
    return None


def _as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _queue_updated_at(queue: dict[str, Any]) -> str:
    return str(queue.get("updatedAt") or queue.get("createdAt") or "")


def _assigned_agents(queue: dict[str, Any]) -> list[dict[str, Any]]:
    raw = queue.get("agents")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _agent_name_matches(query: str, name: str) -> bool:
    needle = query.strip().casefold()
    haystack = name.strip().casefold()
    if not needle or not haystack:
        return False
    if needle == haystack or needle in haystack:
        return True
    name_tokens = haystack.split()
    return all(
        any(token == part or token.startswith(part) for token in name_tokens)
        for part in needle.split()
        if part
    )


def _put_agent_payload(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        "userId": str(agent.get("userId") or agent.get("id") or ""),
        "shiftType": str(agent.get("shiftType") or "Regular"),
        "handlesCalls": bool(agent.get("handlesCalls")),
        "handlesEmail": bool(agent.get("handlesEmail")),
        "handlesChat": bool(agent.get("handlesChat")),
        "handlesWhatsapp": bool(agent.get("handlesWhatsapp")),
        "handlesInstagram": bool(agent.get("handlesInstagram")),
        "handlesFacebook": bool(agent.get("handlesFacebook")),
        "chatConcurrency": int(agent.get("chatConcurrency") or 1),
        "emailConcurrency": int(agent.get("emailConcurrency") or 1),
        "socialConcurrency": int(agent.get("socialConcurrency") or 1),
        "whatsappConcurrency": int(agent.get("whatsappConcurrency") or 1),
        "instagramConcurrency": int(agent.get("instagramConcurrency") or 1),
        "facebookConcurrency": int(agent.get("facebookConcurrency") or 1),
        "callType": str(agent.get("callType") or "both"),
    }


_HANDLE_TO_CHANNEL = {
    "handlesCalls": "calls",
    "handlesEmail": "email",
    "handlesChat": "chat",
    "handlesWhatsapp": "whatsapp",
    "handlesInstagram": "instagram",
    "handlesFacebook": "facebook",
}
_HANDLE_TO_CAPACITY = {
    "handlesChat": "chatConcurrency",
    "handlesEmail": "emailConcurrency",
    "handlesWhatsapp": "whatsappConcurrency",
    "handlesInstagram": "instagramConcurrency",
    "handlesFacebook": "facebookConcurrency",
}
_CAPACITY_ALIASES = {
    "chat": "chatConcurrency",
    "email": "emailConcurrency",
    "social": "socialConcurrency",
    "whatsapp": "whatsappConcurrency",
    "instagram": "instagramConcurrency",
    "facebook": "facebookConcurrency",
}
_GRACE_MINUTES = {0, 5, 10, 15, 30}
_CALL_TYPES = {"inbound", "outbound", "both"}


def _as_object_list(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        return [{"name": part} for part in _as_str_list(value)]
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        rows: list[dict[str, Any]] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                rows.append({"name": item.strip()})
            elif isinstance(item, dict):
                rows.append(item)
        return rows
    return []


def _agent_channels(agent: dict[str, Any]) -> list[str]:
    return [
        channel
        for handle, channel in _HANDLE_TO_CHANNEL.items()
        if agent.get(handle)
    ]


def _apply_agent_patch(agent: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    next_agent = _put_agent_payload(agent)
    channels = patch.get("channels") or patch.get("channel")
    if isinstance(channels, str):
        channels = _as_str_list(channels)
    if isinstance(channels, list):
        next_agent.update(_channels_to_handles(channels))
    shift = _normalize_shift_key(str(patch.get("shiftType") or patch.get("shift") or ""))
    if shift:
        next_agent["shiftType"] = shift
    call_type = str(patch.get("callType") or "").strip().casefold()
    if call_type in _CALL_TYPES:
        next_agent["callType"] = call_type
    raw_capacity = patch.get("capacity")
    if isinstance(raw_capacity, dict):
        for key, value in raw_capacity.items():
            mapped = _CAPACITY_ALIASES.get(str(key).strip().casefold()) or (
                str(key) if str(key) in _CAPACITY_ALIASES.values() else None
            )
            if mapped:
                next_agent[mapped] = max(1, int(value))
    elif raw_capacity is not None and str(raw_capacity).strip():
        shared = max(1, int(raw_capacity))
        for handle, capacity_key in _HANDLE_TO_CAPACITY.items():
            if next_agent.get(handle):
                next_agent[capacity_key] = shared
    for capacity_key in _CAPACITY_ALIASES.values():
        if patch.get(capacity_key) is not None:
            next_agent[capacity_key] = max(1, int(patch[capacity_key]))
    return next_agent


def _match_directory_agents(
    query: str,
    directory: dict[str, str],
) -> list[tuple[str, str]]:
    matches: list[tuple[str, str]] = []
    seen: set[str] = set()
    for agent_id, name in directory.items():
        if agent_id in seen:
            continue
        if _agent_name_matches(query, name) or _agent_name_matches(query, agent_id):
            matches.append((agent_id, name))
            seen.add(agent_id)
    return matches


def _require_one_agent(query: str, matches: list[tuple[str, str]], *, context: str) -> tuple[str, str]:
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(name for _agent_id, name in matches)
        raise CcCoreError(f'"{query}" matches more than one {context}: {names}. Say the full name.')
    raise CcCoreError(f'{query} was not found among {context}.')


def _last_assigned_agent(
    assignments: dict[str, Any] | None,
    shift: str | None,
) -> tuple[str | None, str | None]:
    if not assignments:
        return None, None
    row = assignments.get(shift) if shift else None
    if not isinstance(row, dict):
        last = next((item for item in reversed(list(assignments.values())) if isinstance(item, dict)), None)
        row = last
    if not isinstance(row, dict):
        return None, None
    ids = [str(item) for item in row.get("agentIds") or [] if item]
    names = [str(item) for item in row.get("agentNames") or [] if item]
    return (ids[-1] if ids else None), (names[-1] if names else None)


def _staffing_actions(current_shift: str | None, shift_types: list[str] | None) -> dict[str, Any]:
    other_shifts: list[str] = []
    for raw in shift_types or []:
        key = _normalize_shift_key(str(raw))
        if key and key != current_shift:
            other_shifts.append(key)
    actions = [
        {
            "id": f"shift-{shift}",
            "label": f"Staff {shift} next",
            "message": f"Staff the {shift} shift next.",
        }
        for shift in other_shifts
    ]
    actions.append(
        {
            "id": "done",
            "label": "Done staffing",
            "message": "We're done staffing.",
        }
    )
    return {
        "currentShift": current_shift,
        "otherShifts": other_shifts,
        "actions": actions,
    }


def _agent_summary(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": agent["id"],
        "name": _agent_display_name(agent),
        "workEmail": agent.get("workEmail"),
        "teamId": agent.get("teamId"),
        "skills": agent.get("skills", []),
        "shiftTypes": agent.get("shiftTypes", []),
        "currentQueueId": agent.get("currentQueueId"),
        "currentQueueName": agent.get("currentQueueName"),
        "currentQueueStatus": agent.get("currentQueueStatus"),
    }


def _staffing_agent_row(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        **_agent_summary(agent),
        "firstName": agent.get("firstName"),
        "lastName": agent.get("lastName"),
        "status": agent.get("status") or "active",
    }


class QueueMCPServer:
    tool_names = (
        "list_queues",
        "list_teams",
        "list_business_hours",
        "stage_queue_draft",
        "create_queue",
        "update_queue",
        "update_queue_status",
        "delete_queue",
        "list_agents",
        "list_eligible_agents",
        "list_presence",
    )

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("queue")
        descriptions = {
            "list_queues": (
                "List queues with team, status, and assigned people. "
                "Pass queueName to return one queue with channels, capacity, skills, "
                "hours, and agent rows."
            ),
            "list_teams": "List teams for queue ownership. Call before asking the user to pick a team; include every team name in your question.",
            "list_business_hours": "List business hours schedules and the shift types on each schedule. Call this after status and before asking for hours or shifts. Include every schedule in your question.",
            "stage_queue_draft": "Stage a non-mutating queue_draft preview for conversational setup.",
            "create_queue": (
                "Create a queue after the conversational draft is complete. "
                "Pass name, teamName, status, description, businessHoursId or "
                "businessHoursName, shiftTypes, and shiftAgentAssignments from the "
                "staged draft. Omitted hours, shifts, and assignments are taken from "
                "the trusted staged draft. This persists staffing — do not call it "
                "with only name/team/status when people were already staged."
            ),
            "update_queue": (
                "Persist changes to an existing queue after confirmation. "
                "One write tool for settings and staffing: name/newName, description, "
                "teamName, status, businessHoursName, skills, missedCallbackGraceMinutes, "
                "addAgents, removeAgentNames, and agentUpdates (channels, capacity, "
                "shift, callType). Each new person in addAgents needs shiftType set to "
                "one of this queue's shifts. A missing or unknown shift is not saved. "
                "Omitted fields on an existing agent stay unchanged. Never claim an update "
                "without this result."
            ),
            "update_queue_status": "Change queue status only. Prefer update_queue for any other change.",
            "delete_queue": (
                "Permanently delete an existing queue after the user confirmed. "
                "Pass queueName. This is the only persist for deletion — list_queues "
                "does not delete. Returns {id, name, deleted: true}. Never claim a "
                "delete without this result. Quote the returned name only when "
                "deleted is true."
            ),
            "list_agents": "List workforce agents and their setup.",
            "list_eligible_agents": "List Contact Center Agent and Admin users eligible for a queue, including people on another queue who can be moved.",
            "list_presence": (
                "List current workforce presence. Use agentPresence for online/offline "
                "questions: session=offline is logged out; presence=not_ready is logged "
                "in and Not Ready. Never treat Not Ready as Offline."
            ),
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    async def _queues(self) -> list[dict[str, Any]]:
        payload = await self.http.request(
            "GET",
            "/api/v1/setup/ccaas/queues",
            get_tool_context(),
            params={"page": 1, "pageSize": 100, "sort": "updatedAt", "order": "desc"},
        )
        return list(payload.get("queues", []))

    async def _teams(self) -> list[dict[str, Any]]:
        payload = await self.http.request(
            "GET",
            "/api/v1/setup/ccaas/teams",
            get_tool_context(),
        )
        return list(payload.get("teams", []))

    async def _business_hours(self) -> list[dict[str, Any]]:
        payload = await self.http.request(
            "GET",
            "/api/v1/setup/ccaas/business-hours",
            get_tool_context(),
        )
        return list(payload.get("schedules", []))

    async def _find_queues(self, queue_name: str) -> list[dict[str, Any]]:
        normalized = queue_name.strip().strip("[]").casefold()
        matches = [
            queue
            for queue in await self._queues()
            if str(queue.get("name", "")).strip().strip("[]").casefold() == normalized
        ]
        matches.sort(key=_queue_updated_at, reverse=True)
        return matches

    async def _find_queue(self, queue_name: str) -> dict[str, Any]:
        matches = await self._find_queues(queue_name)
        if not matches:
            raise CcCoreError(f'Queue "{queue_name}" was not found')
        return matches[0]

    async def _find_team(self, team_name: str | None = None, team_id: str | None = None) -> dict[str, Any]:
        teams = await self._teams()
        if team_id:
            for team in teams:
                if str(team.get("id")) == str(team_id):
                    return {**team, "id": str(team["id"])}
        if team_name:
            normalized = team_name.strip().casefold()
            for team in teams:
                if str(team.get("name", "")).casefold() == normalized:
                    return {**team, "id": str(team["id"])}
        raise CcCoreError(f'Team "{team_name or team_id}" was not found')

    async def _queue_detail(self, queue_id: str) -> dict[str, Any]:
        payload = await self.http.request(
            "GET",
            f"/api/v1/setup/ccaas/queues/{queue_id}",
            get_tool_context(),
        )
        queue = payload.get("queue") if isinstance(payload, dict) else None
        if not isinstance(queue, dict):
            raise CcCoreError(f'Queue "{queue_id}" was not found')
        return queue

    async def _agent_directory(self) -> dict[str, str]:
        return {
            str(agent["id"]): str(agent["name"])
            for agent in await self._eligible_agents()
            if agent.get("id")
        }

    def _resolve_remove_ids(
        self,
        queries: list[str],
        assigned: list[dict[str, Any]],
        directory: dict[str, str],
    ) -> tuple[set[str], list[str], list[str]]:
        assigned_ids = {
            str(agent.get("userId") or agent.get("id") or "")
            for agent in assigned
            if agent.get("userId") or agent.get("id")
        }
        remove_ids: set[str] = set()
        resolved_names: list[str] = []
        missing: list[str] = []
        for query in queries:
            matches: list[tuple[str, str]] = []
            seen: set[str] = set()
            for agent_id in assigned_ids:
                name = directory.get(agent_id) or agent_id
                if agent_id in seen:
                    continue
                if _agent_name_matches(query, name) or _agent_name_matches(query, agent_id):
                    matches.append((agent_id, name))
                    seen.add(agent_id)
            if len(matches) == 1:
                agent_id, name = matches[0]
                remove_ids.add(agent_id)
                if name not in resolved_names:
                    resolved_names.append(name)
            elif len(matches) > 1:
                names = ", ".join(name for _agent_id, name in matches)
                raise CcCoreError(
                    f'"{query}" matches more than one assigned agent: {names}. '
                    "Say the full name."
                )
            else:
                missing.append(query)
        return remove_ids, resolved_names, missing

    async def _select_queue_for_update(
        self,
        queue_name: str,
        remove_queries: list[str],
        remove_ids: list[str],
        *,
        directory: dict[str, str] | None = None,
        matches: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        matches = list(matches) if matches is not None else await self._find_queues(queue_name)
        if not matches:
            raise CcCoreError(f'Queue "{queue_name}" was not found')
        if not remove_queries and not remove_ids:
            return matches[0]
        directory = directory if directory is not None else await self._agent_directory()
        candidates: list[dict[str, Any]] = []
        for queue in matches:
            assigned = _assigned_agents(queue)
            found_ids, _names, missing = self._resolve_remove_ids(
                remove_queries,
                assigned,
                directory,
            )
            explicit_ids = {
                agent_id
                for agent_id in remove_ids
                if any(str(agent.get("userId") or agent.get("id")) == agent_id for agent in assigned)
            }
            if (remove_queries and not missing and found_ids) or explicit_ids:
                candidates.append(queue)
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            raise CcCoreError(
                f'Several queues are named "{queue_name}" and have that person. '
                "Open the queue you want, or say which team it belongs to."
            )
        assigned_names = []
        for queue in matches[:1]:
            for agent in _assigned_agents(queue):
                agent_id = str(agent.get("userId") or agent.get("id") or "")
                assigned_names.append(directory.get(agent_id) or agent_id)
        visible = ", ".join(name for name in assigned_names if name) or "nobody"
        wanted = ", ".join(remove_queries or remove_ids)
        raise CcCoreError(
            f'{wanted} is not assigned to "{queue_name}". Assigned now: {visible}.'
        )

    async def _eligible_agents(
        self,
        *,
        team_id: str | None = None,
        team_name: str | None = None,
    ) -> list[dict[str, Any]]:
        payload = await self.http.request(
            "GET",
            "/api/v1/setup/ccaas/eligible-agents",
            get_tool_context(),
        )
        agents = [_agent_summary(agent) for agent in payload.get("agents", [])]
        preferred_team_id = team_id
        if not preferred_team_id and team_name:
            normalized = team_name.strip().casefold()
            team = next(
                (
                    item
                    for item in await self._teams()
                    if str(item.get("name", "")).casefold() == normalized
                ),
                None,
            )
            if team is not None:
                preferred_team_id = str(team["id"])
        # Match the editor: show unassigned people and people on another queue,
        # not only members of the owning team.
        if preferred_team_id:
            agents.sort(
                key=lambda agent: (
                    0 if agent.get("teamId") == preferred_team_id else 1,
                    str(agent.get("name") or ""),
                )
            )
        return agents

    async def _resolve_shift_assignments(
        self,
        assignments: dict[str, Any] | None,
        *,
        team_id: str | None,
        team_name: str | None,
    ) -> dict[str, Any]:
        if not assignments:
            return {}

        eligible = await self._eligible_agents(team_id=team_id, team_name=team_name)
        by_id = {str(agent["id"]): agent for agent in eligible}
        by_name = {str(agent["name"]).casefold(): agent for agent in eligible}

        def resolve_agent(name: str | None, agent_id: str | None) -> tuple[str, str]:
            if agent_id and agent_id in by_id:
                agent = by_id[agent_id]
                return str(agent["id"]), str(agent["name"])
            if name:
                matched = by_name.get(name.strip().casefold())
                if matched is None:
                    for candidate in eligible:
                        candidate_name = str(candidate["name"]).casefold()
                        if name.strip().casefold() in candidate_name or candidate_name in name.strip().casefold():
                            matched = candidate
                            break
                if matched is not None:
                    return str(matched["id"]), str(matched["name"])
            resolved_id = agent_id or name or ""
            resolved_name = name or agent_id or ""
            return resolved_id, resolved_name

        resolved: dict[str, Any] = {}
        for raw_shift, raw_value in assignments.items():
            shift = _normalize_shift_key(str(raw_shift))
            if not shift or not isinstance(raw_value, dict):
                continue

            agent_ids: list[str] = []
            agent_names: list[str] = []
            channel_by_agent_id: dict[str, list[str]] = {}

            agents_payload = raw_value.get("agents")
            if isinstance(agents_payload, list):
                for item in agents_payload:
                    if not isinstance(item, dict):
                        continue
                    agent_id, agent_name = resolve_agent(
                        str(item.get("name") or item.get("agentName") or ""),
                        str(item.get("id") or item.get("userId") or item.get("agentId") or "") or None,
                    )
                    if not agent_id and not agent_name:
                        continue
                    agent_ids.append(agent_id)
                    agent_names.append(agent_name)
                    channels = item.get("channels")
                    if isinstance(channels, list):
                        channel_by_agent_id[agent_id or agent_name] = [
                            str(channel) for channel in channels
                        ]
                        if agent_name:
                            channel_by_agent_id[agent_name] = channel_by_agent_id[agent_id or agent_name]
            else:
                raw_ids = raw_value.get("agentIds") or []
                raw_names = raw_value.get("agentNames") or []
                if isinstance(raw_ids, list) and isinstance(raw_names, list):
                    for index, raw_name in enumerate(raw_names):
                        raw_id = raw_ids[index] if index < len(raw_ids) else None
                        agent_id, agent_name = resolve_agent(
                            str(raw_name) if raw_name is not None else None,
                            str(raw_id) if raw_id is not None else None,
                        )
                        agent_ids.append(agent_id)
                        agent_names.append(agent_name)
                channel_map = raw_value.get("channelByAgentId")
                if isinstance(channel_map, dict):
                    for key, channels in channel_map.items():
                        if isinstance(channels, list):
                            channel_by_agent_id[str(key)] = [str(channel) for channel in channels]

            if agent_ids or agent_names:
                resolved[shift] = {
                    "agentIds": agent_ids,
                    "agentNames": agent_names,
                    "channelByAgentId": channel_by_agent_id or None,
                }

        return resolved

    def _queue_summary(
        self,
        queue: dict[str, Any],
        *,
        teams: dict[Any, Any],
        directory: dict[str, str],
        detailed: bool = False,
    ) -> dict[str, Any]:
        assigned = _assigned_agents(queue)
        agent_names = [
            directory.get(str(agent.get("userId") or agent.get("id") or ""))
            or str(agent.get("userId") or agent.get("id") or "")
            for agent in assigned
            if agent.get("userId") or agent.get("id")
        ]
        summary: dict[str, Any] = {
            "id": queue["id"],
            "name": queue["name"],
            "teamName": teams.get(queue.get("teamId"), "Unassigned"),
            "status": queue["status"],
            "agentCount": len(assigned),
            "agentNames": [name for name in agent_names if name],
            "updatedAt": queue.get("updatedAt"),
        }
        if not detailed:
            return summary
        agents = []
        for agent in assigned:
            payload = _put_agent_payload(agent)
            agent_id = payload["userId"]
            agents.append(
                {
                    **payload,
                    "name": directory.get(agent_id) or agent_id,
                    "channels": _agent_channels(payload),
                }
            )
        summary.update(
            {
                "description": queue.get("description"),
                "teamId": queue.get("teamId"),
                "businessHoursId": queue.get("businessHoursId"),
                "shiftTypes": queue.get("shiftTypes") or [],
                "skills": queue.get("skills") or [],
                "missedCallbackGraceMinutes": queue.get("missedCallbackGraceMinutes"),
                "agents": agents,
            }
        )
        return summary

    async def list_queues(self, queueName: str | None = None) -> dict[str, Any]:
        teams = {team["id"]: team["name"] for team in await self._teams()}
        directory = await self._agent_directory()
        if queueName:
            matches = await self._find_queues(queueName)
            if not matches:
                raise CcCoreError(f'Queue "{queueName}" was not found')
            queues = []
            for queue in matches:
                detail = await self._queue_detail(str(queue["id"]))
                queues.append(
                    self._queue_summary(
                        detail,
                        teams=teams,
                        directory=directory,
                        detailed=True,
                    )
                )
            return {"queues": queues}
        return {
            "queues": [
                self._queue_summary(queue, teams=teams, directory=directory)
                for queue in await self._queues()
            ]
        }

    async def list_teams(self) -> dict[str, Any]:
        teams = await self._teams()
        choices = [_format_team_choice(team) for team in teams]
        names = [str(team.get("name", "")) for team in teams if team.get("name")]
        return {
            "teams": teams,
            "choices": choices,
            "summary": ", ".join(names) if names else "none",
        }

    async def list_business_hours(self) -> dict[str, Any]:
        schedules = await self._business_hours()
        choices = [_format_schedule_choice(schedule) for schedule in schedules]
        summarized = []
        for schedule in schedules:
            shift_types = _shift_types_from_schedule(schedule)
            summarized.append(
                {
                    "id": schedule["id"],
                    "name": schedule["name"],
                    "timezone": schedule.get("timezone"),
                    "workingDays": schedule.get("workingDays", []),
                    "openTime": schedule.get("openTime"),
                    "closeTime": schedule.get("closeTime"),
                    "shiftTypes": shift_types,
                }
            )
        return {
            "schedules": summarized,
            "choices": choices,
            "summary": "; ".join(choices) if choices else "none",
        }

    async def stage_queue_draft(
        self,
        mode: QueueDraftMode = "create",
        nextField: QueueDraftField | None = None,
        nextQuestion: str | None = None,
        name: str | None = None,
        teamName: str | None = None,
        teamId: str | None = None,
        description: str | None = None,
        status: str | None = None,
        businessHoursId: str | None = None,
        businessHoursName: str | None = None,
        businessHoursSkipped: bool = False,
        shiftTypes: list[str] | None = None,
        staffingMode: str | None = None,
        staffingComplete: bool | None = None,
        staffingSkipped: bool | None = None,
        currentShift: str | None = None,
        currentAgentId: str | None = None,
        currentAgentName: str | None = None,
        shiftAgentAssignments: dict[str, Any] | None = None,
        channels: list[str] | None = None,
        ready: bool | None = None,
    ) -> dict[str, Any]:
        resolved_team_id = teamId
        resolved_team_name = teamName
        if teamName and not teamId:
            normalized = teamName.strip().casefold()
            team = next(
                (
                    item
                    for item in await self._teams()
                    if str(item.get("name", "")).casefold() == normalized
                ),
                None,
            )
            if team is not None:
                resolved_team_id = team["id"]
                resolved_team_name = team["name"]

        resolved_status = _normalize_queue_status(status) if isinstance(status, str) else None

        schedules = await self._business_hours()
        resolved_hours_id = businessHoursId
        resolved_hours_name = businessHoursName
        guidance: str | None = None
        if businessHoursSkipped:
            resolved_hours_id = ""
            resolved_hours_name = businessHoursName or "Default (always open)"
            resolved_schedule = None
        else:
            resolved_schedule = _find_schedule(
                schedules,
                hours_id=resolved_hours_id,
                hours_name=resolved_hours_name,
            )
            if resolved_schedule is not None:
                resolved_hours_id = str(resolved_schedule["id"])
                resolved_hours_name = str(resolved_schedule.get("name") or resolved_hours_name)

        staged = _staged_queue_fields()
        hours_resolved = bool(businessHoursSkipped or resolved_schedule is not None)
        if not hours_resolved and staged.get("businessHoursSkipped"):
            businessHoursSkipped = True
            resolved_hours_id = ""
            resolved_hours_name = str(staged.get("businessHoursName") or "Default (always open)")
            resolved_schedule = None
            hours_resolved = True
        elif not hours_resolved:
            resolved_schedule = _find_schedule(
                schedules,
                hours_id=str(staged.get("businessHoursId") or "") or None,
                hours_name=str(staged.get("businessHoursName") or "") or None,
            )
            if resolved_schedule is not None:
                resolved_hours_id = str(resolved_schedule["id"])
                resolved_hours_name = str(resolved_schedule.get("name") or resolved_hours_name)
                hours_resolved = True

        hours_resolved = bool(businessHoursSkipped or resolved_schedule is not None)
        schedule_shifts = _shift_types_from_schedule(resolved_schedule)
        resolved_shift_types = _normalize_shift_types(
            shiftTypes if shiftTypes is not None else staged.get("shiftTypes")
        )
        if schedule_shifts:
            resolved_shift_types = list(schedule_shifts)

        if nextField in SHIFT_OR_LATER_FIELDS and not hours_resolved:
            nextField = "businessHours"
            nextQuestion = "Which schedule should we use for this queue?"
            resolved_shift_types = []
            guidance = (
                "Ask for a business hours schedule before shifts. "
                "Call list_business_hours in this turn and list every schedule. "
                "Re-pass businessHoursName/businessHoursId on every later stage_queue_draft call."
            )
        elif nextField in STAFFING_FIELDS:
            nextField = "staffing"
        elif nextField == "shifts" and hours_resolved and schedule_shifts:
            if not resolved_shift_types:
                resolved_shift_types = list(schedule_shifts)
            nextField = "staffing"
            nextQuestion = (
                "Add people to each shift and choose their channels, then click Done staffing."
            )
            guidance = (
                "This schedule already defines its shifts: "
                + ", ".join(resolved_shift_types)
                + ". Show one staffing form. Do not ask Regular/Morning/Afternoon/Evening/Night/Custom "
                "and do not ask a separate channel question."
            )

        if nextField == "staffing" and not resolved_shift_types and (
            businessHoursSkipped or not schedule_shifts
        ):
            nextField = "shifts"
            nextQuestion = "Which shifts should this queue cover?"

        shiftTypes = resolved_shift_types or None

        resolved_assignments: dict[str, Any] | None = None
        if shiftAgentAssignments is not None:
            resolved_assignments = await self._resolve_shift_assignments(
                shiftAgentAssignments,
                team_id=resolved_team_id or staged.get("teamId"),
                team_name=resolved_team_name or staged.get("teamName"),
            )

        incoming_fields = {
            key: value
            for key, value in {
                "name": name,
                "teamName": resolved_team_name,
                "teamId": resolved_team_id,
                "description": description,
                "status": resolved_status,
                "businessHoursId": resolved_hours_id,
                "businessHoursName": resolved_hours_name,
                "businessHoursSkipped": True if businessHoursSkipped else None,
                "shiftTypes": shiftTypes,
                "staffingMode": staffingMode,
                "staffingComplete": staffingComplete,
                "staffingSkipped": True if staffingSkipped else None,
                "currentShift": _normalize_shift_key(currentShift) if currentShift else None,
                "currentAgentId": currentAgentId,
                "currentAgentName": currentAgentName,
                "shiftAgentAssignments": resolved_assignments,
                "channels": channels,
            }.items()
            if value is not None
        }
        fields = _merge_queue_fields(incoming_fields, staged)
        if fields.get("status") in {"active", "inactive"} and nextField == "status":
            nextField = "businessHours"
            nextQuestion = nextQuestion or "Which schedule should we use for this queue?"
        if resolved_shift_types:
            fields["shiftTypes"] = list(resolved_shift_types)
        if businessHoursSkipped:
            fields["businessHoursSkipped"] = True
            fields["businessHoursId"] = ""
            fields["businessHoursName"] = resolved_hours_name
        elif resolved_schedule is not None:
            fields["businessHoursId"] = resolved_hours_id
            fields["businessHoursName"] = resolved_hours_name

        assignment_source = fields.get("shiftAgentAssignments")
        if not isinstance(assignment_source, dict):
            assignment_source = {}
        normalized_shift = _normalize_shift_key(str(fields.get("currentShift") or "")) or None
        if not normalized_shift and assignment_source:
            for raw_shift in reversed(list(assignment_source.keys())):
                inferred = _normalize_shift_key(str(raw_shift))
                if inferred:
                    normalized_shift = inferred
                    break
        if not normalized_shift and fields.get("shiftTypes"):
            normalized_shift = _normalize_shift_key(str(fields["shiftTypes"][0]))
        if schedule_shifts:
            if normalized_shift and normalized_shift not in schedule_shifts:
                normalized_shift = schedule_shifts[0]
                guidance = (
                    (guidance + " " if guidance else "")
                    + "currentShift must be one of this schedule's shifts: "
                    + ", ".join(schedule_shifts)
                    + "."
                )
            elif not normalized_shift and nextField == "staffing":
                normalized_shift = schedule_shifts[0]
        if normalized_shift:
            fields["currentShift"] = normalized_shift

        if fields.get("businessHoursSkipped"):
            hours_resolved = True
        snapped = _snap_queue_next_field(fields, nextField, hours_resolved)
        if snapped != nextField:
            nextField = snapped
            nextQuestion = _QUEUE_FIELD_QUESTIONS.get(snapped, nextQuestion)
        elif not nextQuestion:
            nextQuestion = _QUEUE_FIELD_QUESTIONS.get(nextField or "")

        draft_payload: dict[str, Any] = {
            "mode": mode,
            "fields": fields,
            "nextField": nextField,
            "nextQuestion": nextQuestion,
            "ready": _queue_draft_ready(fields, nextField),
        }
        if nextField == "team":
            teams = await self._teams()
            draft_payload["choices"] = [_format_team_choice(team) for team in teams]
            draft_payload["choicesLabel"] = "Available teams"
        elif nextField == "businessHours":
            draft_payload["choices"] = [_format_schedule_choice(schedule) for schedule in schedules]
            draft_payload["choicesLabel"] = "Available schedules"
        elif nextField == "shifts":
            draft_payload["choices"] = schedule_shifts or list(GENERIC_SHIFT_TYPES)
            draft_payload["choicesLabel"] = "Available shifts"
        elif nextField == "staffing":
            eligible = await self._eligible_agents(
                team_id=fields.get("teamId") or resolved_team_id,
                team_name=fields.get("teamName") or resolved_team_name,
            )
            unassigned = [agent for agent in eligible if not agent.get("currentQueueId")]
            elsewhere = [agent for agent in eligible if agent.get("currentQueueId")]
            draft_payload["staffingForm"] = {
                "shiftTypes": fields.get("shiftTypes") or [],
                "queueName": fields.get("name"),
                "currentShift": normalized_shift,
                "assignments": assignment_source,
                "available": [_staffing_agent_row(agent) for agent in unassigned],
                "elsewhere": [_staffing_agent_row(agent) for agent in elsewhere],
                "doneMessage": "We're done staffing.",
            }
            form_note = (
                "The UI already shows one staffing form with this schedule's shifts. "
                "Do not invent names, do not emit an Available-agents or channels list, "
                "and do not ask a follow-up channel question."
            )
            guidance = f"{guidance} {form_note}".strip() if guidance else form_note

        result: dict[str, Any] = {"_queue_draft": draft_payload}
        if guidance:
            result["guidance"] = guidance
        return result

    async def create_queue(
        self,
        name: str,
        teamName: str,
        status: Literal["active", "inactive"] | None = None,
        description: str | None = None,
        businessHoursId: str | None = None,
        businessHoursName: str | None = None,
        businessHoursSkipped: bool = False,
        shiftTypes: Any = None,
        agents: Any = None,
        shiftAgentAssignments: Any = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        started = context.queue_draft_at_turn_start
        if isinstance(started, dict) and started.get("persistedQueueId"):
            return {
                "id": started["persistedQueueId"],
                "alreadyCreated": True,
                "name": str(
                    _first_present(name, _staged_queue_fields().get("name")) or ""
                ).strip()
                or None,
            }
        if not _ready_queue_create_at_turn_start():
            raise CcCoreError(
                "This queue is not ready to create. Finish staffing in the form, "
                "or say you want no agents, then confirm create."
            )
        staged = _staged_queue_fields()
        shiftTypes = _as_shift_type_list(shiftTypes)
        agents = _as_agent_rows(agents)
        shiftAgentAssignments = _as_assignment_map(shiftAgentAssignments)
        resolved_name = str(_first_present(name, staged.get("name")) or "").strip()
        resolved_team_name = str(_first_present(teamName, staged.get("teamName")) or "").strip()
        resolved_status = _normalize_queue_status(
            str(_first_present(status, staged.get("status")) or "active")
        ) or "active"
        resolved_description = _first_present(description, staged.get("description"))
        if isinstance(resolved_description, str) and not resolved_description.strip():
            resolved_description = None

        if not resolved_name:
            raise CcCoreError("Queue name is required to create a queue")
        if not resolved_team_name:
            raise CcCoreError("Team name is required to create a queue")

        staged_team_id = _as_entity_id(staged.get("teamId"))
        if staged_team_id:
            team = {"id": staged_team_id, "name": resolved_team_name}
        else:
            normalized = resolved_team_name.casefold()
            team = next(
                (
                    item
                    for item in await self._teams()
                    if str(item.get("name", "")).casefold() == normalized
                ),
                None,
            )
        if team is None:
            raise CcCoreError(f'Team "{resolved_team_name}" was not found')
        team = {**team, "id": str(team["id"])}

        hours_skipped = bool(
            businessHoursSkipped or staged.get("businessHoursSkipped")
        )
        hours_id = _first_present(businessHoursId, staged.get("businessHoursId"))
        hours_name = _first_present(businessHoursName, staged.get("businessHoursName"))
        resolved_hours_id: str | None = None
        resolved_hours_name: str | None = None
        resolved_schedule: dict[str, Any] | None = None
        resolved_shifts = _normalize_shift_types(
            list(_first_present(shiftTypes, staged.get("shiftTypes")) or [])
        )
        staged_hours_id = None if hours_skipped else _as_entity_id(hours_id)
        if hours_skipped:
            resolved_hours_name = str(hours_name or "Default (always open)")
            if not resolved_shifts:
                resolved_shifts = ["Regular"]
        elif staged_hours_id:
            resolved_hours_id = staged_hours_id
            resolved_hours_name = str(hours_name) if hours_name else None
        else:
            resolved_schedule = _find_schedule(
                await self._business_hours(),
                hours_id=str(hours_id) if hours_id else None,
                hours_name=str(hours_name) if hours_name else None,
            )
            if resolved_schedule is not None:
                resolved_hours_id = str(resolved_schedule["id"])
                resolved_hours_name = str(resolved_schedule.get("name") or hours_name or "")
                schedule_shifts = _shift_types_from_schedule(resolved_schedule)
                if schedule_shifts:
                    resolved_shifts = list(schedule_shifts)
            elif hours_id:
                resolved_hours_id = str(hours_id)
                resolved_hours_name = str(hours_name) if hours_name else None
            else:
                fallback = team.get("businessHoursId")
                resolved_hours_id = str(fallback) if fallback else None

        resolved_assignments = None
        assignment_source = _first_present(
            shiftAgentAssignments,
            staged.get("shiftAgentAssignments"),
        )
        if isinstance(assignment_source, dict) and assignment_source:
            if _assignments_have_numeric_ids(assignment_source):
                resolved_assignments = assignment_source
            else:
                resolved_assignments = await self._resolve_shift_assignments(
                    assignment_source,
                    team_id=team["id"],
                    team_name=team["name"],
                )
        persisted_agents = [
            agent
            for agent in (agents or [])
            if isinstance(agent, dict) and _usable_user_id(str(agent.get("userId") or ""))
        ]
        if not persisted_agents:
            persisted_agents = _agents_from_assignments(resolved_assignments)
        persisted_agents = [
            {**agent, "userId": str(agent["userId"])}
            for agent in persisted_agents
        ]

        arguments = {
            "name": resolved_name,
            "teamName": team["name"],
            "status": resolved_status,
            "description": resolved_description,
            "businessHoursId": resolved_hours_id,
            "businessHoursName": resolved_hours_name,
            "shiftTypes": resolved_shifts,
            "agents": persisted_agents,
        }
        async def operation() -> dict[str, Any]:
            payload = await self.http.request(
                "POST",
                "/api/v1/setup/ccaas/queues",
                context,
                timeout=45.0,
                json_body={
                    "name": resolved_name,
                    "description": resolved_description,
                    "teamId": str(team["id"]),
                    "businessHoursId": (
                        str(resolved_hours_id) if resolved_hours_id is not None else None
                    ),
                    "shiftTypes": resolved_shifts,
                    "skills": [],
                    "status": resolved_status,
                },
            )
            queue = payload["queue"]
            if persisted_agents:
                try:
                    await self.http.request(
                        "PUT",
                        f"/api/v1/setup/ccaas/queues/{queue['id']}/agents",
                        context,
                        timeout=45.0,
                        json_body={"agents": persisted_agents},
                    )
                except Exception as exc:
                    try:
                        await self.http.request(
                            "DELETE",
                            f"/api/v1/setup/ccaas/queues/{queue['id']}",
                            context,
                        )
                    except Exception:
                        pass
                    if isinstance(exc, CcCoreError):
                        raise CcCoreError(
                            "Queue was not published because agents could not be saved. "
                            f"{exc}"
                        ) from exc
                    raise CcCoreError(
                        "Queue was not published because agents could not be saved."
                    ) from exc
            return {
                "id": queue["id"],
                "createdAt": queue.get("createdAt"),
                "name": queue["name"],
                "teamName": team["name"],
                "status": queue["status"],
                "businessHoursId": resolved_hours_id,
                "businessHoursName": resolved_hours_name,
                "shiftTypes": resolved_shifts,
                "agentCount": len(persisted_agents),
            }

        return await execute_once("create_queue", arguments, operation)

    async def update_queue(
        self,
        queueName: str,
        newName: str | None = None,
        description: str | None = None,
        teamName: str | None = None,
        teamId: str | None = None,
        status: str | None = None,
        businessHoursId: str | None = None,
        businessHoursName: str | None = None,
        shiftTypes: Any = None,
        skills: Any = None,
        missedCallbackGraceMinutes: int | None = None,
        addAgents: Any = None,
        removeAgentNames: Any = None,
        removeAgentIds: Any = None,
        agentUpdates: Any = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        resolved_status = _normalize_queue_status(status) if isinstance(status, str) else None
        resolved_name = newName.strip() if isinstance(newName, str) and newName.strip() else None
        remove_names = _as_str_list(removeAgentNames)
        remove_ids = _as_str_list(removeAgentIds)
        add_rows = _as_object_list(addAgents)
        update_rows = _as_object_list(agentUpdates)
        resolved_shifts = _normalize_shift_types(_as_shift_type_list(shiftTypes))
        resolved_skills = _as_str_list(skills) if skills is not None else None
        if missedCallbackGraceMinutes is not None and missedCallbackGraceMinutes not in _GRACE_MINUTES:
            raise CcCoreError("missedCallbackGraceMinutes must be 0, 5, 10, 15, or 30.")
        staff_queries = [
            *remove_names,
            *[
                str(row.get("name") or row.get("agentName") or "")
                for row in update_rows
                if row.get("name") or row.get("agentName")
            ],
        ]
        has_settings = any(
            value is not None
            for value in (
                resolved_name,
                description,
                teamName,
                teamId,
                resolved_status,
                businessHoursId,
                businessHoursName,
                resolved_shifts or None,
                resolved_skills,
                missedCallbackGraceMinutes,
            )
        )
        has_staffing = bool(remove_names or remove_ids or add_rows or update_rows)
        if not has_settings and not has_staffing:
            raise CcCoreError(
                "Pass a settings field and/or addAgents, removeAgentNames, or agentUpdates."
            )

        matches = await self._find_queues(queueName)
        directory = await self._agent_directory() if has_staffing else {}
        queue = await self._select_queue_for_update(
            queueName,
            staff_queries if has_staffing else [],
            remove_ids,
            directory=directory,
            matches=matches,
        )
        detail = await self._queue_detail(str(queue["id"]))
        assigned = [_put_agent_payload(agent) for agent in _assigned_agents(detail)]
        assigned_by_id = {str(agent["userId"]): agent for agent in assigned if agent.get("userId")}

        remove_set, removed_names, missing = self._resolve_remove_ids(
            remove_names,
            assigned,
            directory,
        )
        for agent_id in remove_ids:
            if agent_id in assigned_by_id:
                remove_set.add(agent_id)
                name = directory.get(agent_id) or agent_id
                if name not in removed_names:
                    removed_names.append(name)
            else:
                missing.append(agent_id)
        if missing:
            visible = ", ".join(
                directory.get(agent_id) or agent_id for agent_id in assigned_by_id
            ) or "nobody"
            raise CcCoreError(
                f'{", ".join(missing)} is not assigned to "{detail.get("name") or queueName}". '
                f"Assigned now: {visible}."
            )

        remaining = [
            agent for agent in assigned if str(agent.get("userId") or "") not in remove_set
        ]
        remaining_by_id = {str(agent["userId"]): dict(agent) for agent in remaining}
        updated_names: list[str] = []
        for row in update_rows:
            query = str(row.get("name") or row.get("agentName") or row.get("id") or row.get("userId") or "")
            if not query:
                continue
            assigned_directory = {
                agent_id: directory.get(agent_id) or agent_id
                for agent_id in remaining_by_id
            }
            agent_id, name = _require_one_agent(
                query,
                _match_directory_agents(query, assigned_directory),
                context="assigned agent",
            )
            remaining_by_id[agent_id] = _apply_agent_patch(remaining_by_id[agent_id], row)
            if name not in updated_names:
                updated_names.append(name)

        added_names: list[str] = []
        allowed_shifts = _queue_shift_names(detail, resolved_shifts, _assigned_agents(detail))
        for row in add_rows:
            query = str(row.get("name") or row.get("agentName") or row.get("id") or row.get("userId") or "")
            if not query:
                continue
            agent_id, name = _require_one_agent(
                query,
                _match_directory_agents(query, directory),
                context="eligible agent",
            )
            if agent_id in remaining_by_id:
                remaining_by_id[agent_id] = _apply_agent_patch(remaining_by_id[agent_id], row)
                if name not in updated_names:
                    updated_names.append(name)
                continue
            shift = _require_add_shift(
                name,
                str(row.get("shiftType") or row.get("shift") or ""),
                allowed_shifts,
            )
            channels = row.get("channels") or row.get("channel")
            if isinstance(channels, str):
                channels = _as_str_list(channels)
            created = _apply_agent_patch(
                _agent_row_from_channels(agent_id, shift, channels if isinstance(channels, list) else None),
                row,
            )
            remaining_by_id[agent_id] = created
            added_names.append(name)

        next_agents = [_put_agent_payload(agent) for agent in remaining_by_id.values()]
        remaining_names = [
            directory.get(str(agent["userId"])) or str(agent["userId"]) for agent in next_agents
        ]
        staffing_changed = next_agents != assigned

        patch_body: dict[str, Any] = {}
        if resolved_name:
            patch_body["name"] = resolved_name
        if description is not None:
            patch_body["description"] = description
        if resolved_status is not None:
            patch_body["status"] = resolved_status
        if resolved_skills is not None:
            patch_body["skills"] = resolved_skills
        if missedCallbackGraceMinutes is not None:
            patch_body["missedCallbackGraceMinutes"] = missedCallbackGraceMinutes
        if resolved_shifts:
            patch_body["shiftTypes"] = resolved_shifts
        resolved_team_name = None
        if teamName or teamId:
            team = await self._find_team(team_name=teamName, team_id=teamId)
            patch_body["teamId"] = team["id"]
            resolved_team_name = team["name"]
        resolved_hours_name = None
        if businessHoursId or businessHoursName:
            schedule = _find_schedule(
                await self._business_hours(),
                hours_id=businessHoursId,
                hours_name=businessHoursName,
            )
            if schedule is None:
                raise CcCoreError(
                    f'Business hours "{businessHoursName or businessHoursId}" were not found'
                )
            patch_body["businessHoursId"] = str(schedule["id"])
            resolved_hours_name = str(schedule.get("name") or "")
            schedule_shifts = _shift_types_from_schedule(schedule)
            if schedule_shifts and "shiftTypes" not in patch_body:
                patch_body["shiftTypes"] = list(schedule_shifts)

        if not patch_body and not staffing_changed:
            raise CcCoreError("Nothing to change on this queue.")

        arguments = {
            "queueName": detail.get("name") or queueName,
            "queueId": str(detail.get("id") or queue["id"]),
            "patch": patch_body,
            "addAgents": added_names,
            "removeAgentNames": removed_names,
            "updatedAgents": updated_names,
        }

        async def operation() -> dict[str, Any]:
            updated = detail
            if patch_body:
                payload = await self.http.request(
                    "PATCH",
                    f"/api/v1/setup/ccaas/queues/{detail['id']}",
                    context,
                    timeout=45.0,
                    json_body=patch_body,
                )
                updated = payload["queue"]
            if staffing_changed:
                await self.http.request(
                    "PUT",
                    f"/api/v1/setup/ccaas/queues/{detail['id']}/agents",
                    context,
                    timeout=45.0,
                    json_body={"agents": next_agents},
                )
            return {
                "id": updated["id"],
                "name": updated.get("name") or resolved_name or detail.get("name"),
                "status": updated.get("status") or resolved_status or detail.get("status"),
                "teamName": resolved_team_name,
                "businessHoursName": resolved_hours_name,
                "description": updated.get("description") if description is not None else None,
                "skills": updated.get("skills") if resolved_skills is not None else None,
                "addedAgents": added_names,
                "removedAgents": removed_names,
                "updatedAgents": updated_names,
                "remainingAgents": remaining_names,
                "agentCount": len(next_agents),
            }

        return await execute_once("update_queue", arguments, operation)

    async def update_queue_status(
        self,
        queueName: str,
        status: Literal["active", "inactive"],
    ) -> dict[str, Any]:
        return await self.update_queue(queueName=queueName, status=status)

    async def delete_queue(self, queueName: str) -> dict[str, Any]:
        context = get_tool_context()
        queue = await self._find_queue(queueName)
        arguments = {"queueName": queue["name"]}
        async def operation() -> dict[str, Any]:
            await self.http.request(
                "DELETE",
                f"/api/v1/setup/ccaas/queues/{queue['id']}",
                context,
                timeout=45.0,
            )
            return {
                "id": queue["id"],
                "name": queue["name"],
                "deleted": True,
            }

        return await execute_once("delete_queue", arguments, operation)

    async def list_agents(self) -> dict[str, Any]:
        return await self.http.request(
            "GET",
            "/api/v1/setup/workforce/agents",
            get_tool_context(),
        )

    async def list_eligible_agents(
        self,
        teamName: str | None = None,
    ) -> dict[str, Any]:
        return {
            "agents": await self._eligible_agents(team_name=teamName),
        }

    async def list_presence(self) -> dict[str, Any]:
        payload = await self.http.request(
            "GET",
            "/api/v1/setup/workforce/presence",
            get_tool_context(),
        )
        raw_agents = payload.get("agents", []) if isinstance(payload, dict) else []
        agents, agent_presence = annotate_presence_agents(
            raw_agents if isinstance(raw_agents, list) else []
        )
        return {"agents": agents, "agentPresence": agent_presence}
