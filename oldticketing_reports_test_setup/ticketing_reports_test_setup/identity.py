"""Sidebar / form fields → pack Identity and connection payload."""

from __future__ import annotations

from reports_analytics_agent_ticketing.core.query_frame import Identity


def parse_queue_ids(raw: str) -> list[int]:
    out: list[int] = []
    for part in (raw or "").replace(";", ",").split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def identity_from_form(
    *,
    organization_id: int,
    user_id: int,
    role: str,
    my_queue_ids: str,
) -> Identity:
    return Identity(
        organization_id=int(organization_id),
        user_id=int(user_id),
        role=role,  # type: ignore[arg-type]
        my_queue_ids=parse_queue_ids(my_queue_ids),
    )
