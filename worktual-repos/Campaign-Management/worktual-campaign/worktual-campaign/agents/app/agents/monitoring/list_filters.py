"""Pure filters for LIST_MONITOR_CAMPAIGNS (dashboard parity with portfolio ran + channel rollup)."""

from __future__ import annotations

from typing import Any


def is_ran_campaign_status(status: str | None) -> bool:
    s = str(status or "").strip().lower()
    return s in ("live", "completed", "cancelled")


def normalize_row_channels(row: dict[str, Any]) -> list[str]:
    raw = row.get("channels") or row.get("channelIds") or []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for c in raw:
        if isinstance(c, str):
            key = c.strip().lower()
        elif isinstance(c, dict):
            key = str(c.get("channel") or "").strip().lower()
        else:
            continue
        if key in ("apppush", "app_push", "app-push"):
            key = "push"
        if key and key not in out:
            out.append(key)
    return out


def row_includes_channel(row: dict[str, Any], channel_key: str) -> bool:
    ch = str(channel_key or "").strip().lower()
    if not ch:
        return True
    return ch in normalize_row_channels(row)


def channel_rollup_count(totals: dict[str, Any] | None, channel_key: str) -> int | None:
    if not totals or not channel_key:
        return None
    for row in totals.get("channel_rollup") or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        if ch == channel_key:
            try:
                return int(row.get("campaigns") or 0)
            except (TypeError, ValueError):
                return 0
    return None
