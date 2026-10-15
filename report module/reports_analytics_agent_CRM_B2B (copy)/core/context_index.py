"""Compact catalog cards for Domain and SQL executor prompts (meaning, not names only)."""

from __future__ import annotations

from typing import Any

from .loader import load_kpis, load_schema


def kpi_index_lines(kpis: dict[str, Any] | None = None) -> str:
    cards = kpis if kpis is not None else load_kpis()
    lines = ["## Certified KPI cards (pick by meaning, not by similar name)"]
    for kpi_id, card in (cards or {}).items():
        if not isinstance(card, dict):
            continue
        label = card.get("label") or kpi_id
        syns = ", ".join(card.get("synonyms") or [])
        dims = ",".join(card.get("allowed_dimensions") or []) or "-"
        dates = ",".join(card.get("allowed_date_columns") or []) or "-"
        scopes = ",".join(card.get("allowed_scope_levels") or []) or "-"
        definition = card.get("definition") or {}
        num = definition.get("numerator") or "-"
        includes = definition.get("includes") or "-"
        excludes = definition.get("excludes") or "-"
        syn_str = f" | syns: [{syns}]" if syns else ""
        lines.append(
            f"- `{kpi_id}` ({label}) | {card.get('aggregation')} | unit={card.get('unit')} "
            f"| group: {dims} | dates: {dates} | scopes: {scopes}{syn_str}"
        )
        lines.append(f"  meaning: {num}. includes: {includes}. excludes: {excludes}.")
    return "\n".join(lines)


def view_index_lines(schema: dict[str, Any] | None = None) -> str:
    doc = schema if schema is not None else load_schema()
    views = doc.get("views") or {}
    lines = ["## Warehouse views (use meaning, then column names)"]
    for name, meta in views.items():
        if not isinstance(meta, dict):
            continue
        desc = str(meta.get("description") or "").strip()
        lines.append(f"- `rpt.{name}`: {desc or 'CRM reporting view.'}")
    lines.append(
        "Object map: deals/opportunities → rpt.deals; leads/contacts → rpt.contacts; "
        "quotes → rpt.quotes; invoices → rpt.invoices; companies/accounts → rpt.companies; "
        "activities/tasks/meetings → rpt.activities."
    )
    return "\n".join(lines)
