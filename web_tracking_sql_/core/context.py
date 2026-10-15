"""Build small Domain indexes from the merged catalog."""

from __future__ import annotations

from typing import Any


def access_index_lines(access: dict[str, Any], role: str) -> str:
    matrix = access.get("matrix") or {}
    role_meta = (access.get("roles") or {}).get(role) or {}
    lines = [
        f"product: ticketing",
        f"role: {role}",
        f"default_scope: {role_meta.get('default_scope') or '-'}",
        f"my_tickets_column: {role_meta.get('my_tickets_column') or '-'}",
        f"created_by_me_column: {role_meta.get('created_by_me_column') or 'deny'}",
    ]
    for level, grants in matrix.items():
        grant = grants.get(role, "deny")
        lines.append(f"scope {level}: {grant}")
    return "\n".join(lines)


def kpi_index_lines(kpis: dict[str, Any], *, allowed: set[str] | None = None) -> str:
    lines = []
    for kpi_id, card in kpis.items():
        if allowed is not None and kpi_id not in allowed:
            continue
        label = card.get("label") or kpi_id
        syns = ", ".join(card.get("synonyms") or [])
        syn_str = f" | syns: [{syns}]" if syns else ""
        segs = ",".join((card.get("segments") or {}).keys()) or "-"
        dims = ",".join(card.get("allowed_dimensions") or []) or "-"
        dates = ",".join(card.get("allowed_date_columns") or []) or "-"
        scopes = ",".join(card.get("allowed_scope_levels") or []) or "-"
        lines.append(
            f"{kpi_id} ({label}) | {card.get('aggregation')} | segments: {segs} | group: {dims} | dates: {dates} | scopes: {scopes}{syn_str}"
        )
    return "\n".join(lines)


def graph_index_lines(measures: dict[str, Any], concepts: list[Any] | None = None) -> str:
    lines = []
    for measure_id, card in measures.items():
        hops = ",".join(card.get("hops") or []) or "-"
        dims = ",".join(card.get("allowed_dimensions") or []) or "-"
        scopes = ",".join(card.get("allowed_scope_levels") or []) or "-"
        lines.append(
            f"{measure_id} | {card.get('family')} | hops: {hops} | group: {dims} | scopes: {scopes}"
        )
    for card in concepts or []:
        when = card.get("when") or ""
        paths = "; ".join(card.get("paths") or [])
        lines.append(f"concept {card.get('measure')} | {when} | {paths}")
    return "\n".join(lines)


def entity_index_lines(catalog: dict[str, Any]) -> str:
    groups = catalog.get("entity_groups") or {}
    dims = catalog.get("dimensions") or {}
    dim_names = ",".join(dims.keys())
    lines = []
    for name, members in groups.items():
        lines.append(f"{name} | {','.join(members)} | group: {dim_names}")
    compares = catalog.get("compare_fields") or {}
    if compares:
        lines.append("compare_filters (hours unless csat_score):")
        for name, spec in compares.items():
            aliases = ",".join(spec.get("aliases") or []) or "-"
            lines.append(f"  {name} | aliases: {aliases} | reading: < <= > >= = | mention: number only")
    rosters = catalog.get("rosters") or {}
    if rosters:
        lines.append("rosters (shape list, measure = roster id, path catalog; not ticket ranking):")
        for name, spec in rosters.items():
            aliases = ",".join(spec.get("aliases") or []) or "-"
            lines.append(f"  {name} | table {spec.get('table')} | aliases: {aliases}")
    return "\n".join(lines)
