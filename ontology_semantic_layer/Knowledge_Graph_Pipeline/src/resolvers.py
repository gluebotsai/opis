from typing import Any

def sla_by_priority(row: dict[str, Any]) -> str | None:
    """
    Custom hook to determine which SLA a ticket falls under based on its priority.
    """
    priority = row.get("priority")
    if not priority:
        return None
    # For example, we might format the priority into a display name
    # that matches the SLA catalog's target key.
    return str(priority).strip().lower()
