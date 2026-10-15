"""Fill named slots. No business lists in this file."""

from __future__ import annotations

from pathlib import Path

TRUE = "TRUE"


def fill_slots(sql: str, slots: dict[str, str], *, base_ticket: str | None = None) -> str:
    out = sql
    if base_ticket is not None:
        out = out.replace("{{base_ticket}}", base_ticket)
    mapping = {
        "org_id": slots["org_id"],
        "tenant_sql": slots.get("tenant_sql", f"organization_id = {slots['org_id']}"),
        "scope_sql": slots.get("scope_sql", TRUE),
        "time_sql": slots.get("time_sql", TRUE),
        "segment_sql": slots.get("segment_sql", TRUE),
        "filters_sql": slots.get("filters_sql", TRUE),
        "dimension_select": slots.get("dimension_select", ""),
        "group_by_sql": slots.get("group_by_sql", ""),
        "window_days": slots.get("window_days", "1"),
        "window_days_sql": slots.get("window_days_sql", "1"),
        "segment_predicate": slots.get("segment_predicate", slots.get("segment_sql", TRUE)),
        "limit_sql": slots.get("limit_sql", ""),
    }
    for key, value in mapping.items():
        out = out.replace("{{" + key + "}}", value)
    if "{{" in out:
        raise ValueError(f"unfilled SQL slots remain: {out}")
    return out


def load_sql(path: Path) -> str:
    return path.read_text()


def fill_named(text: str, slots: dict[str, str]) -> str:
    out = text
    for key, value in slots.items():
        out = out.replace("{{" + key + "}}", str(value))
    if "{{" in out:
        raise ValueError(f"unfilled slots remain: {out}")
    return out
