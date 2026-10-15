"""Shared presence labels for coworker tools. Offline is logged out; Not Ready is logged in."""

from typing import Any

LOGGED_OUT_PRESENCE = frozenset({"offline", "inactive", ""})

PRESENCE_LABELS = {
    "ready": "Ready",
    "available": "Ready",
    "not_ready": "Not Ready",
    "busy": "Busy",
    "away": "Away",
    "break": "Break",
    "after_contact_work": "After contact work",
    "offline": "Offline",
    "inactive": "Offline",
}


def is_logged_in_presence(presence: str) -> bool:
    return presence not in LOGGED_OUT_PRESENCE


def project_agent_presence(agent: dict[str, Any]) -> dict[str, Any]:
    presence = str(agent.get("presence") or "offline")
    logged_in = (
        bool(agent.get("loggedIn"))
        if "loggedIn" in agent
        else is_logged_in_presence(presence)
    )
    return {
        "name": agent.get("name") or agent.get("displayName"),
        "presence": presence,
        "presenceLabel": PRESENCE_LABELS.get(
            presence, presence.replace("_", " ").title()
        ),
        "loggedIn": logged_in,
        "session": "online" if logged_in else "offline",
        "id": agent.get("id"),
        "agentId": agent.get("agentId"),
    }


def annotate_presence_agents(
    agents: list[Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    annotated: list[dict[str, Any]] = []
    summary: list[dict[str, Any]] = []
    for raw in agents:
        if not isinstance(raw, dict):
            continue
        view = project_agent_presence(raw)
        annotated.append(
            {
                **raw,
                "loggedIn": view["loggedIn"],
                "session": view["session"],
                "presenceLabel": view["presenceLabel"],
            }
        )
        summary.append(view)
    return annotated, summary
