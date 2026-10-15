"""Current date/time facts for all MAS and legacy agent prompts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.agents.create_campaign.schedule_agent import DEFAULT_TZ


def resolve_session_timezone(session: dict[str, Any] | None) -> str:
    """Best timezone for interpreting user-relative dates (today, tomorrow, 7pm)."""
    if not isinstance(session, dict):
        return DEFAULT_TZ
    for key in ("client_timezone", "user_timezone", "timezone"):
        raw = str(session.get(key) or "").strip()
        if raw:
            try:
                ZoneInfo(raw)
                return raw
            except Exception:  # noqa: BLE001
                continue
    launch = session.get("launch_plan")
    if isinstance(launch, dict):
        raw = str(launch.get("timezone") or "").strip()
        if raw:
            try:
                ZoneInfo(raw)
                return raw
            except Exception:  # noqa: BLE001
                pass
    return DEFAULT_TZ


def build_temporal_context_block(session: dict[str, Any] | None = None) -> str:
    """
    Factual clock block for LLM prompts. Use for scheduling, promos, event copy —
    do not invent today's date when this block is present.
    """
    tz_name = resolve_session_timezone(session)
    now_utc = datetime.now(timezone.utc)
    try:
        tz = ZoneInfo(tz_name)
        now_local = now_utc.astimezone(tz)
    except Exception:  # noqa: BLE001
        tz_name = DEFAULT_TZ
        now_local = now_utc.astimezone(ZoneInfo(DEFAULT_TZ))

    utc_s = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
    local_s = now_local.strftime("%Y-%m-%d %H:%M:%S")
    weekday = now_local.strftime("%A")
    iso_week = now_local.strftime("%G-W%V")

    lines = [
        "current_datetime:",
        f"  utc: {utc_s}",
        f"  timezone: {tz_name}",
        f"  local: {local_s} ({weekday}, ISO week {iso_week})",
        (
            "  scheduling_note: Campaign launches cannot be scheduled in the past "
            "relative to utc above; interpret user phrases like today/tomorrow/next "
            f"Friday in timezone {tz_name} unless they name another zone."
        ),
    ]
    return "\n".join(lines)


__all__ = ["build_temporal_context_block", "resolve_session_timezone"]
